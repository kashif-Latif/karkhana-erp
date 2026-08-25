// Supabase Edge Function: shopify-webhook   (Karkhana — ozkhkhlwjblzgwmjbdde)
// Deploy with VERIFY JWT OFF — Shopify cannot send a Supabase JWT, so the
// gateway would reject every delivery before this code ran. Security comes from
// the HMAC signature instead, which is stronger: it proves the request really
// came from Shopify and was not altered.
//
// TOPICS TO REGISTER on each of the three stores
//   orders/create             a new order
//   orders/updated            anything changed
//   orders/paid               payment captured
//   orders/fulfilled          fully shipped
//   orders/partially_fulfilled
//   orders/cancelled
//   refunds/create            money going back
//   fulfillments/create       ← carries the TRACKING NUMBER
//   fulfillments/update       ← carries courier progress
//
// WHY fulfillments/* WORKS NOW AND DID NOT BEFORE
//   Their payload carries the NUMERIC order id and no order name, and we keyed
//   orders on the name — so those topics had to be skipped, which is why a
//   tracking number could never arrive in real time. Migration 0062 added
//   online_orders.shopify_order_id, so they resolve cleanly.
//
// IDEMPOTENCY — DO NOT REMOVE
//   Shopify retries a delivery for up to 48 hours until it gets a fast 200, and
//   retries can arrive out of order. Every delivery id is recorded in
//   online_shopify_events under a unique index; a repeat conflicts and this
//   function stops. Without it, one refund could be counted several times.
//
// OWNERSHIP RULES (these prevent data loss — see migration 0042)
//   * Shopify owns orders, payments and tracking NUMBERS.
//   * The couriers own where a parcel physically is. Shopify's "fulfilled" only
//     means the merchant marked it shipped, so a parcel we already track is
//     never overwritten here — seeding uses ignoreDuplicates.
//   * On COD, financial_status stays PENDING until somebody marks it paid by
//     hand. It is NOT evidence money arrived. Real settlement lives in
//     online_logistics.payment_status / cpr_number and is never touched here.

import { createClient } from "npm:@supabase/supabase-js@2";

const ok = (body = "ok") => new Response(body, { status: 200 });
const bad = (msg: string, code = 401) => new Response(msg, { status: code });

const env = (k: string) =>
  (Deno.env.get(k) ?? Deno.env.get(k.toLowerCase()) ?? Deno.env.get(k.toUpperCase()) ?? "").trim();

const STORES = ["LM", "TS", "TRZ"];

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** The business day as the shop sees it. Shopify sends UTC; slicing the first
 *  ten characters files a 02:00 Karachi order under yesterday, which is why our
 *  daily counts never matched Shopify's dashboard. Must stay identical to the
 *  same helper in shopify-sync, or push and poll would disagree. */
const SHOP_TZ = "Asia/Karachi";
function shopDay(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: SHOP_TZ });
}
const ts  = (v: unknown) => { const s = String(v ?? "").trim(); return s ? s : null; };

/** Which store sent this? The domain header is only a hint — Shopify sends the
 *  .myshopify.com domain while a stored domain may be the custom one. The
 *  signature is the reliable answer: only the right store's secret verifies. */
function domainHint(domain: string) {
  const d = (domain ?? "").toLowerCase().trim();
  for (const st of STORES) {
    const known = env(`SHOPIFY_${st}_DOMAIN`).toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (known && (known === d || d.startsWith(known.split(".")[0]))) return st;
  }
  return null;
}

/** last resort: the order prefix tells us the store */
function storeFromName(name: string) {
  const u = (name ?? "").trim().toUpperCase();
  if (/^#?TRZ/.test(u)) return "TRZ";
  if (/^#?TS/.test(u)) return "TS";
  if (/^#?LM/.test(u)) return "LM";
  return null;
}

async function validSignature(raw: string, header: string, secret: string) {
  if (!header || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const mine = btoa(String.fromCharCode(...new Uint8Array(sig)));
  // constant-time compare, so the endpoint cannot be probed byte by byte
  if (mine.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

const courierFrom = (raw: string) => {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/own\s*ex|ownexpress/i.test(t)) return "OwnEx";
  if (/post\s*ex/i.test(t)) return "PostEx";
  return t;                                   // unknown carrier kept verbatim, never guessed
};

type Fulfillment = {
  id?: number; order_id?: number; status?: string; shipment_status?: string | null;
  tracking_number?: string | null; tracking_numbers?: string[]; tracking_company?: string | null;
  created_at?: string; updated_at?: string;
};

type Order = {
  id?: number; name?: string; created_at?: string; updated_at?: string;
  cancelled_at?: string | null; cancel_reason?: string | null;
  financial_status?: string | null; fulfillment_status?: string | null;
  total_price?: string; subtotal_price?: string; total_discounts?: string; total_tax?: string;
  currency?: string; gateway?: string; payment_gateway_names?: string[];
  tags?: string; note?: string | null;
  line_items?: { quantity?: number }[];
  shipping_lines?: { price?: string }[];
  shipping_address?: { name?: string; phone?: string; city?: string; address1?: string };
  billing_address?: { phone?: string; city?: string };
  fulfillments?: Fulfillment[];
};

type Refund = { id?: number; order_id?: number; transactions?: { amount?: string; kind?: string; status?: string }[] };

Deno.serve(async (req) => {
  if (req.method !== "POST") return bad("method not allowed", 405);

  // the raw body is needed byte-for-byte — parsing first would break the HMAC
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const domain = req.headers.get("x-shopify-shop-domain") ?? "";
  const deliveryId = req.headers.get("x-shopify-webhook-id") ?? "";

  // Shop-level webhooks (Settings -> Notifications) are signed with the SHOP's
  // own signing secret; app-registered ones use the client secret. Accept either,
  // and let whichever secret verifies tell us the store — a mismatched domain
  // then cannot break anything.
  const hint = domainHint(domain);
  const order = hint ? [hint, ...STORES.filter((s) => s !== hint)] : STORES;

  let store = "";
  outer:
  for (const st of order) {
    for (const sec of [env(`SHOPIFY_${st}_WEBHOOK_SECRET`), env(`SHOPIFY_${st}_SECRET`)]) {
      if (sec && await validSignature(raw, hmac, sec)) { store = st; break outer; }
    }
  }
  if (!store) {
    console.error(`bad signature from ${domain} (${topic}) — no store secret matched`);
    return bad("bad signature");
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch { return ok("unparseable"); }

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date().toISOString();

    /* ---------- idempotency: record the delivery, or stop ----------
       The unique index on webhook_id IS the guard. A retry conflicts here and
       we answer 200 immediately, so Shopify stops retrying and nothing is
       processed twice. */
    const isOrderTopic = /^orders\//.test(topic);
    const shopifyOrderId =
      isOrderTopic ? num((payload as Order).id)
                   : num((payload as Fulfillment | Refund).order_id);
    const orderName = isOrderTopic ? String((payload as Order).name ?? "").trim() : "";

    if (deliveryId) {
      const { error: dup } = await db.from("online_shopify_events").insert({
        webhook_id: deliveryId, topic, store_code: store,
        shopify_order_id: shopifyOrderId, order_number: orderName || null, payload,
      });
      if (dup && /duplicate|23505/i.test(dup.message)) return ok("duplicate — already handled");
    } else {
      await db.from("online_shopify_events").insert({
        topic, store_code: store, shopify_order_id: shopifyOrderId,
        order_number: orderName || null, payload,
        note: "no X-Shopify-Webhook-Id header",
      });
    }

    /* =====================================================================
       REFUNDS — money going back. Carries order_id, never a name.
       ===================================================================== */
    if (topic === "refunds/create") {
      if (!shopifyOrderId) return ok("refund without order_id");
      const r = payload as Refund;
      const amount = (r.transactions ?? [])
        .filter((t) => (t.kind === "refund") && (t.status === "success" || !t.status))
        .reduce((s, t) => s + (Number(t.amount) || 0), 0);

      const { data: existing } = await db.from("online_orders")
        .select("refunded_amount").eq("shopify_order_id", shopifyOrderId).maybeSingle();

      await db.from("online_orders").update({
        refunded_amount: Number(existing?.refunded_amount ?? 0) + amount,
        last_event_topic: topic, last_event_at: now,
      }).eq("shopify_order_id", shopifyOrderId);

      return ok(`refund ${amount} on ${shopifyOrderId}`);
    }

    /* =====================================================================
       FULFILLMENTS — this is where the TRACKING NUMBER arrives.
       ===================================================================== */
    if (topic === "fulfillments/create" || topic === "fulfillments/update") {
      const f = payload as Fulfillment;
      if (!shopifyOrderId) return ok("fulfillment without order_id");

      // resolve the order — only possible because 0062 stores the numeric id
      const { data: o } = await db.from("online_orders")
        .select("order_number, store_code, amount")
        .eq("shopify_order_id", shopifyOrderId).maybeSingle();
      if (!o) return ok("order not seen yet — the nightly sweep will pick it up");

      const numbers = (f.tracking_numbers?.length ? f.tracking_numbers : [f.tracking_number ?? ""])
        .map((n) => String(n ?? "").trim()).filter(Boolean);

      const parcels = numbers.map((tid) => ({
        tracking_id: tid,
        order_number: o.order_number,
        store_code: o.store_code,
        courier: courierFrom(f.tracking_company ?? ""),
        dispatch_date: (f.created_at ?? "").slice(0, 10) || null,
        cod_amount: Number(o.amount ?? 0) || null,
        delivery_status: "In Transit",
        needs_review: !courierFrom(f.tracking_company ?? ""),
      }));

      if (parcels.length) {
        // ignoreDuplicates: a parcel the couriers already track keeps its real
        // status. Shopify must never overwrite where a parcel physically is.
        const unique = [...new Map(parcels.map((p) => [p.tracking_id, p])).values()];
        await db.from("online_logistics")
          .upsert(unique, { onConflict: "tracking_id", ignoreDuplicates: true });
      }

      await db.from("online_orders").update({
        fulfillment_status: (f.status ?? "").toUpperCase() || null,
        fulfilled_at: ts(f.created_at),
        last_event_topic: topic, last_event_at: now,
      }).eq("shopify_order_id", shopifyOrderId);

      return ok(`${topic} ${o.order_number} parcels:${parcels.length}`);
    }

    /* =====================================================================
       ORDER TOPICS — create / updated / paid / fulfilled / cancelled
       ===================================================================== */
    const p = payload as Order;
    const name = (p.name ?? "").trim();
    if (!name) return ok("no order name");
    const store_code = storeFromName(name) ?? store;   // the prefix is the most specific signal

    const shipping = (p.shipping_lines ?? []).reduce((s, l) => s + (Number(l.price) || 0), 0);
    const items = (p.line_items ?? []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);

    await db.from("online_orders").upsert({
      order_number: name,
      store_code,
      shopify_order_id: shopifyOrderId,
      shopify_created_at: ts(p.created_at),
      shopify_updated_at: ts(p.updated_at),
      order_date: shopDay(p.created_at),
      customer_name: p.shipping_address?.name || "Unknown",
      phone: p.shipping_address?.phone || p.billing_address?.phone || "0000000000",
      city: p.shipping_address?.city || p.billing_address?.city || "Unknown",
      address: p.shipping_address?.address1 || null,
      amount: Number(p.total_price ?? 0) || 0,

      // the three axes, kept apart — see migration 0062
      financial_status: (p.financial_status ?? "").toUpperCase() || null,
      fulfillment_status: (p.fulfillment_status ?? "").toUpperCase() || null,
      cancelled_at: ts(p.cancelled_at),
      cancel_reason: p.cancel_reason ?? null,

      payment_gateway: p.gateway || (p.payment_gateway_names ?? [])[0] || null,
      currency: p.currency ?? null,
      subtotal: num(p.subtotal_price),
      discount_total: num(p.total_discounts),
      tax_total: num(p.total_tax),
      shipping_total: shipping || null,
      item_count: items || null,
      tags: p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : null,
      note: p.note ?? null,

      last_event_topic: topic,
      last_event_at: now,
      shopify_sync: now,
    }, { onConflict: "store_code,order_number" });

    /* ---------- any parcels riding on the order payload ---------- */
    const parcels: Record<string, unknown>[] = [];
    for (const f of p.fulfillments ?? []) {
      const numbers = f.tracking_numbers?.length ? f.tracking_numbers : [f.tracking_number ?? ""];
      for (const n of numbers) {
        const tid = String(n ?? "").trim();
        if (!tid) continue;
        parcels.push({
          tracking_id: tid,
          order_number: name,
          store_code,
          courier: courierFrom(f.tracking_company ?? ""),
          dispatch_date: (f.created_at ?? p.created_at ?? "").slice(0, 10) || null,
          cod_amount: Number(p.total_price ?? 0) || null,
          delivery_status: "In Transit",
        });
      }
    }
    if (parcels.length) {
      const unique = [...new Map(parcels.map((x) => [x.tracking_id, x])).values()];
      await db.from("online_logistics")
        .upsert(unique, { onConflict: "tracking_id", ignoreDuplicates: true });
    }

    // a cancelled order should not leave its parcel looking live
    if ((topic === "orders/cancelled" || p.cancelled_at) && parcels.length) {
      for (const x of parcels) {
        await db.from("online_logistics")
          .update({ delivery_status: "Cancelled" })
          .eq("tracking_id", x.tracking_id)
          .in("delivery_status", ["In Transit", "Queued"]);
      }
    }

    return ok(`${topic} ${name} ${store_code} parcels:${parcels.length}`);
  } catch (e) {
    // still answer 200 — a 500 makes Shopify retry for two days over something
    // a retry will not fix, and the raw payload is already saved in
    // online_shopify_events so nothing is lost.
    console.error("shopify-webhook", String(e));
    return ok("logged");
  }
});
