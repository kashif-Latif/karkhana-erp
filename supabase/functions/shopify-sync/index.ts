// Supabase Edge Function: shopify-sync   (Karkhana — project ozkhkhlwjblzgwmjbdde)
// Deploy with VERIFY JWT OFF ; auth is enforced manually below.
//
// WHAT IT DOES
//   test_auth              check the three stores' credentials, write nothing
//   debug_env              which secrets this function can see (names only)
//   pull_orders            Shopify orders  -> online_orders
//   pull_fulfillments      Shopify tracking numbers -> online_logistics
//   repair_order_numbers   fill in parcels whose order reference is broken
//
// WHAT CHANGED — WRITE THE COLUMNS MIGRATION 0062 ADDED
//   This function used to store only name / date / customer / amount / status.
//   Three consequences, all of which looked like something else:
//
//   * shopify_order_id was never written, so fulfillments/create and
//     refunds/create — which carry the NUMERIC order id and no name — had
//     nothing to attach to and silently did nothing.
//   * financial_status and fulfillment_status were collapsed into one `status`
//     column, so "paid but not yet fulfilled" could not be expressed.
//   * the agent's own reason, typed into the Shopify order NOTE, was never
//     fetched at all — which is why the Returns page could only ever show the
//     courier's wording.
//
//   The GraphQL query and the mapping below now carry all of it.
//
// OWNERSHIP RULES (these prevent data loss — see migration 0042)
//   * online_logistics is keyed on tracking_id — one tracking number is one
//     physical parcel.
//   * Seeding uses ignoreDuplicates: an existing parcel is NEVER overwritten.
//     postex-sync and ownex-sync own where a parcel actually is.
//   * On COD, financial_status stays PENDING until somebody marks it paid by
//     hand. It is not evidence money arrived — that lives in
//     online_logistics.payment_status / cpr_number and is never touched here.
//
// SECRETS
//   SHOPIFY_{LM|TS|TRZ}_DOMAIN / _CLIENT_ID / _SECRET
//   SHOPIFY_{LM|TS|TRZ}_TOKEN     optional — only if client-credentials fails
//   SHOPIFY_API_VERSION           optional, defaults to 2026-01
//   SYNC_KEY                      our own shared secret

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

const API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2026-01";
const STORES = ["LM", "TS", "TRZ"];

/** Secrets may be stored uppercase (SHOPIFY_LM_DOMAIN) or lowercase, as copied
 *  from the old app_secrets table. Env vars are case-sensitive, so try both
 *  rather than forcing anyone to retype values. */
const env = (k: string) =>
  (Deno.env.get(k) ?? Deno.env.get(k.toLowerCase()) ?? Deno.env.get(k.toUpperCase()) ?? "").trim();

/* ------------------------------------------------------------------ */
/*  Shopify access                                                     */
/* ------------------------------------------------------------------ */
async function accessToken(store: string) {
  const s = store.toUpperCase();
  const domain = env(`SHOPIFY_${s}_DOMAIN`).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain) return { error: `SHOPIFY_${s}_DOMAIN is not set` };

  const fixed = env(`SHOPIFY_${s}_TOKEN`);
  if (fixed) return { domain, token: fixed, how: "admin token" };

  const cid = env(`SHOPIFY_${s}_CLIENT_ID`);
  const sec = env(`SHOPIFY_${s}_SECRET`);
  if (!cid || !sec) return { error: `SHOPIFY_${s}_CLIENT_ID / _SECRET missing` };

  const r = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: cid, client_secret: sec, grant_type: "client_credentials" }),
  });
  const txt = await r.text();
  if (!r.ok) return { error: `token exchange failed (${r.status})`, detail: txt.slice(0, 200), domain };
  try {
    const { access_token } = JSON.parse(txt);
    if (!access_token) return { error: "no access_token in response", detail: txt.slice(0, 200), domain };
    return { domain, token: access_token, how: "client credentials" };
  } catch {
    return { error: "token response was not JSON", detail: txt.slice(0, 200), domain };
  }
}

async function gqlFor(store: string) {
  const a = await accessToken(store);
  if ("error" in a && a.error) return a as { error: string; detail?: string };
  const { domain, token } = a as { domain: string; token: string };
  return {
    domain,
    call: async (query: string, variables?: unknown) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        const j = await r.json().catch(() => null);

        // Shopify's `errors` is NOT always an array. On auth failure, a missing
        // scope, or an unsupported API version it returns a STRING:
        //   {"errors":"[API] Invalid API key or access token"}
        // Calling .some() on that throws, and the throw hid the very message
        // that explains what went wrong. Normalise before inspecting.
        const errs = j?.errors;
        const errText = typeof errs === "string" ? errs
          : Array.isArray(errs) ? errs.map((e: { message?: string }) => e?.message ?? String(e)).join(" | ")
          : errs ? JSON.stringify(errs)
          : "";

        // throttling is the only error worth retrying — everything else is a
        // real answer and must be reported, not slept through
        if (/throttl/i.test(errText)) {
          await new Promise((res) => setTimeout(res, 3000));
          continue;
        }

        // an HTTP-level rejection never carries data; say what Shopify said
        if (!r.ok || (errText && !j?.data)) {
          return { __error: `HTTP ${r.status}: ${errText || "no message"}` };
        }
        return j;
      }
      return null;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Mapping helpers                                                    */
/* ------------------------------------------------------------------ */

/** The business day as YOUR SHOP sees it.
 *
 *  Shopify returns created_at in UTC. Slicing the first ten characters files an
 *  order placed at 02:00 in Karachi under YESTERDAY, because 02:00 PKT is 21:00
 *  UTC the previous day. Every window — 7, 30, 60 days — was therefore off by
 *  whatever volume arrives between midnight and 5am local, which is why the
 *  counts never quite matched Shopify's own dashboard.
 *
 *  en-CA formats as YYYY-MM-DD, which is what the date column wants. */
const SHOP_TZ = "Asia/Karachi";
function shopDay(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: SHOP_TZ });
}

/** GraphQL returns "gid://shopify/Order/12345"; the webhooks send the bare
 *  number. Store the number, or the two can never be matched — which is why
 *  fulfillments/create and refunds/create had no order to attach to. */
function orderIdFromGid(gid?: string): number | null {
  const m = /\/(\d+)\s*$/.exec(String(gid ?? ""));
  return m ? Number(m[1]) : null;
}

/** courier names arrive in many spellings — normalise to our two */
function normaliseCourier(raw: string) {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/own\s*ex|ownexpress/i.test(t)) return "OwnEx";
  if (/post\s*ex/i.test(t)) return "PostEx";
  return t; // unknown carrier — kept verbatim rather than guessed
}

/** Shopify statuses that carry REAL courier information. Everything else —
 *  FULFILLED, CONFIRMED, SUBMITTED, LABEL_* — only means "the merchant marked it
 *  shipped" and must never overwrite a status we already know from the courier.
 *  Proven empirically: 60 days of LM data returned only FULFILLED and CANCELED,
 *  so the courier apps never write progress back to Shopify. */
const INFORMATIVE = new Set([
  "DELIVERED", "PICKED_UP", "NOT_DELIVERED", "FAILURE",
  "IN_TRANSIT", "OUT_FOR_DELIVERY", "ATTEMPTED_DELIVERY", "CANCELED", "LABEL_VOIDED",
]);

function mapDelivery(display: string) {
  const d = (display ?? "").toUpperCase();
  if (d === "DELIVERED" || d === "PICKED_UP") return "Delivered";
  if (d === "CANCELED" || d === "LABEL_VOIDED") return "Cancelled";
  if (d === "NOT_DELIVERED" || d === "FAILURE") return "Returned";
  return "In Transit";
}

const KNOWN_DISPLAY = new Set([
  "DELIVERED", "PICKED_UP", "CANCELED", "LABEL_VOIDED", "NOT_DELIVERED", "FAILURE",
  "IN_TRANSIT", "OUT_FOR_DELIVERY", "ATTEMPTED_DELIVERY", "FULFILLED", "CONFIRMED",
  "SUBMITTED", "LABEL_PRINTED", "LABEL_PURCHASED", "MARKED_AS_FULFILLED",
  "PENDING_FULFILLMENT", "READY_FOR_PICKUP",
]);

/* `note` is the field the agent actually types the reason into — cancelReason
   is only Shopify's fixed list, so on its own it explains nothing. */
const ORDER_Q = `query($a:String,$q:String){
  orders(first:250, after:$a, query:$q, sortKey:CREATED_AT, reverse:true){
    edges{ node{
      id name createdAt updatedAt cancelledAt cancelReason
      cancellation { staffNote }
      displayFulfillmentStatus displayFinancialStatus
      note tags
      totalPriceSet{ shopMoney{ amount } }
      shippingAddress{ name phone city address1 }
      billingAddress{ phone city }
      fulfillments(first:10){
        createdAt displayStatus
        trackingInfo{ number company }
      }
    } }
    pageInfo{ hasNextPage endCursor }
  }
}`;

/* The probe query for `inspect_reasons`. Validated against the live 2026-01
   Admin schema before it was written here, not assumed.

   Scopes it needs: read_orders AND read_returns. If read_returns is missing,
   Shopify answers with ACCESS_DENIED on the `returns` field and the action
   reports that verbatim instead of quietly showing nothing.

   `message` is on the Event interface, so it is selected once rather than per
   type; only `rawMessage` needs the CommentEvent fragment. rawMessage is the
   text as typed — `message` comes back as formatted HTML. */
const PROBE_Q = `query($q:String!){
  orders(first:10, query:$q){
    edges{ node{
      id name cancelledAt cancelReason
      cancellation { staffNote }
      note tags displayFulfillmentStatus
      events(first:30, sortKey:CREATED_AT, reverse:true){
        edges{ node{ __typename createdAt message ... on CommentEvent { rawMessage } } }
      }
      returns(first:5){
        edges{ node{
          status totalQuantity
          returnLineItems(first:10){
            edges{ node{ ... on ReturnLineItem { returnReasonNote customerNote } } }
          }
        } }
      }
      refunds(first:5){ id note createdAt }
      metafields(first:20){ edges{ node{ namespace key value } } }
    } }
  }
}`;

type ProbeOrder = {
  name: string; cancelledAt: string | null; cancelReason?: string | null;
  cancellation?: { staffNote?: string | null } | null;
  note?: string | null; tags?: string[]; displayFulfillmentStatus?: string;
  events?: { edges?: { node: { __typename: string; createdAt: string; message?: string; rawMessage?: string } }[] };
  returns?: { edges?: { node: { status?: string; totalQuantity?: number;
    returnLineItems?: { edges?: { node: { returnReasonNote?: string | null; customerNote?: string | null } }[] } } }[] };
  refunds?: { id: string; note?: string | null; createdAt?: string }[];
  metafields?: { edges?: { node: { namespace: string; key: string; value: string } }[] };
};

/** Shopify's `message` is formatted HTML. An agent's sentence wrapped in markup
 *  is not readable in a table, and entities like &amp; must not reach the page
 *  as literal text. */
function strip(html: string): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

type ShopOrder = {
  id?: string; name: string; createdAt: string; updatedAt?: string;
  cancelledAt: string | null; cancelReason?: string | null;
  cancellation?: { staffNote?: string | null } | null;
  displayFulfillmentStatus: string; displayFinancialStatus?: string | null;
  note?: string | null; tags?: string[];
  totalPriceSet?: { shopMoney?: { amount?: string } };
  shippingAddress?: { name?: string; phone?: string; city?: string; address1?: string };
  billingAddress?: { phone?: string; city?: string };
  fulfillments?: { createdAt: string; displayStatus: string; trackingInfo?: { number?: string; company?: string }[] }[];
};

function dateFilter(since: string, start?: string, end?: string) {
  if (start && end) return `created_at:>='${start}' created_at:<='${end}' status:any`;
  if (start) return `created_at:>='${start}' status:any`;
  return `created_at:>='${since}' status:any`;
}

async function fetchOrders(call: (q: string, v?: unknown) => Promise<Record<string, unknown> | null>,
                           filter: string, maxPages: number, budgetMs = 50_000) {
  const out: ShopOrder[] = [];
  const started = Date.now();
  let after: string | null = null;
  for (let p = 0; p < maxPages; p++) {
    // always return before the caller gives up waiting — a partial answer that
    // arrives beats a complete one that times out
    if (Date.now() - started > budgetMs) return { rows: out, truncated: true, stopped: "time budget" };
    const res = await call(ORDER_Q, { a: after, q: filter }) as
      { data?: { orders?: { edges: { node: ShopOrder }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };
        errors?: unknown; __error?: string };
    if (res?.__error) return { rows: out, error: res.__error };
    const conn = res?.data?.orders;
    if (!conn) return { rows: out, error: res?.errors ? JSON.stringify(res.errors).slice(0, 300) : "no data returned" };
    for (const e of conn.edges) out.push(e.node);
    if (!conn.pageInfo.hasNextPage) return { rows: out, truncated: false };
    after = conn.pageInfo.endCursor;
  }
  return { rows: out, truncated: true };
}

/* ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    /* auth: shared sync key (cron) or a signed-in user */
    const key = req.headers.get("x-sync-key") ?? "";
    let ok = !!key && key === (Deno.env.get("SYNC_KEY") ?? "\u0000");
    if (!ok) {
      const tok = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!tok) return json({ error: "unauthorized" }, 401);
      const { data, error } = await db.auth.getUser(tok);
      if (error || !data?.user) return json({ error: "unauthorized" }, 401);
      ok = true;
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "test_auth";
    const stores: string[] = body.store ? [String(body.store).toUpperCase()] : STORES;
    const days = Math.min(Number(body.days) || 10, 365);
    const pages = Math.min(Number(body.pages) || 4, 20);
    const dryRun = body.dry_run !== false; // safe by default
    const budgetMs = Math.min(Number(body.max_seconds) || 45, 120) * 1000;
    const winStart: string | undefined = body.start_date;
    const winEnd: string | undefined = body.end_date;

    /* ================= debug_env ================= */
    if (action === "debug_env") {
      const all = Deno.env.toObject();
      const interesting = Object.keys(all)
        .filter((k) => /^(SHOPIFY|POSTEX|OWNEX|SYNC)/i.test(k)).sort()
        .map((k) => ({ name: k, length: (all[k] ?? "").length }));
      const expected = STORES.flatMap((st) => [`SHOPIFY_${st}_DOMAIN`, `SHOPIFY_${st}_CLIENT_ID`, `SHOPIFY_${st}_SECRET`]);
      const missing = expected.filter((k) => !env(k));
      return json({ ok: true, visible_secrets: interesting, missing_expected: missing });
    }

    /* ================= test_auth ================= */
    if (action === "test_auth") {
      const report = [];
      for (const st of stores) {
        const a = await accessToken(st);
        if ("error" in a && a.error) { report.push({ store: st, ok: false, ...a }); continue; }
        const { domain } = a as { domain: string };
        const g = await gqlFor(st);
        let shop = null, note = "";
        if (!("error" in g)) {
          const res = await g.call(`{ shop { name } }`) as
            { data?: { shop?: { name: string } }; errors?: unknown; __error?: string };
          shop = res?.data?.shop?.name ?? null;
          // report Shopify's own words — that is the whole point of test_auth
          if (!shop) note = res?.__error ?? JSON.stringify(res?.errors ?? res).slice(0, 300);
        }
        report.push({ store: st, ok: !!shop, domain, how: (a as { how: string }).how, shop, note: note || undefined });
      }
      return json({ ok: true, api_version: API_VERSION, report });
    }

    /* ================= inspect_reasons =================
       READ-ONLY. Writes nothing, changes nothing.

       WHY THIS EXISTS INSTEAD OF A FIX
         The Returns page shows tags because the sync only ever ASKED Shopify
         for four things: cancellation.staffNote, cancelReason, note and tags.
         Three of those are noise and the fourth only exists on a cancelled
         order. The sentence an agent types — "delivery boy was too late" —
         is in Shopify, we have simply never requested it.

         There are FOUR places it could be, and which one your agents use is a
         fact about how they work, not something to be deduced:

           1. events -> CommentEvent.rawMessage
              A timeline comment. Shopify's own words: "a comment that staff
              members add to the timeline... to document internal notes."
              This is the most likely one.
           2. returns -> returnLineItems.returnReasonNote / .customerNote
              Only populated if the team uses Shopify's Returns feature rather
              than just cancelling. Needs the read_returns scope.
           3. refunds -> note
              Where a reason often ends up when a refund is issued.
           4. metafields
              Where a third-party COD/confirmation app would put it.

         Guessing a format cost three rounds on the OwnEx load sheet. So this
         action dumps ALL FOUR for real orders and reports which are populated.
         You read the output, point at the field holding the real sentence, and
         only then does anything get wired.

       USE
         { "action": "inspect_reasons", "store": "LM",
           "order_numbers": ["#LM15082", "#LM15090"] }

         Or omit order_numbers and it picks recent orders by itself. Give it
         orders you KNOW have a reason typed on them — an empty result from an
         order nobody annotated proves nothing. */
    if (action === "inspect_reasons") {
      const names: string[] = body.order_numbers ?? body.orders ?? [];
      const report: Record<string, unknown>[] = [];

      for (const st of stores) {
        const g = await gqlFor(st);
        if ("error" in g) { report.push({ store: st, ok: false, ...g }); continue; }

        // Named orders if given, otherwise whatever is most recent. `status:any`
        // matters: without it Shopify hides cancelled orders, which are exactly
        // the ones carrying a reason.
        const q = names.length
          ? names.map((n) => `name:${JSON.stringify(String(n).replace(/^#/, ""))}`).join(" OR ") + " status:any"
          : "status:any";

        const res = await g.call(PROBE_Q, { q }) as {
          data?: { orders?: { edges?: { node: ProbeOrder }[] } };
          errors?: unknown; __error?: string;
        };

        if (!res?.data?.orders) {
          // Report Shopify's own words. A missing read_returns scope shows up
          // here as an ACCESS_DENIED on the `returns` field, and that is worth
          // seeing plainly rather than as an empty result.
          report.push({ store: st, ok: false,
                        shopify_said: res?.__error ?? JSON.stringify(res?.errors ?? res).slice(0, 600) });
          continue;
        }

        const orders = (res.data.orders.edges ?? []).slice(0, names.length || 10).map((e) => {
          const o = e.node;
          const comments = (o.events?.edges ?? [])
            .filter((x) => x.node.__typename === "CommentEvent")
            .map((x) => ({ at: x.node.createdAt, text: strip(x.node.rawMessage ?? x.node.message ?? "") }))
            .filter((c) => c.text);
          const otherEvents = (o.events?.edges ?? [])
            .filter((x) => x.node.__typename !== "CommentEvent")
            .slice(0, 8)
            .map((x) => ({ type: x.node.__typename, at: x.node.createdAt, text: strip(x.node.message ?? "") }));

          const returnNotes: Record<string, unknown>[] = [];
          for (const r of o.returns?.edges ?? []) {
            for (const li of r.node.returnLineItems?.edges ?? []) {
              if (li.node.returnReasonNote || li.node.customerNote) {
                returnNotes.push({ status: r.node.status,
                                   reason_note: li.node.returnReasonNote || null,
                                   customer_note: li.node.customerNote || null });
              }
            }
          }

          return {
            order: o.name,
            fulfillment: o.displayFulfillmentStatus,
            cancelled: !!o.cancelledAt,

            // --- what we read TODAY ---
            now_reading: {
              cancel_staff_note: o.cancellation?.staffNote ?? null,
              cancel_reason: o.cancelReason ?? null,
              note: o.note ?? null,
              tags: o.tags ?? [],
            },

            // --- what we have NEVER read ---
            never_read: {
              timeline_comments: comments,
              return_notes: returnNotes,
              refund_notes: (o.refunds ?? []).map((r) => strip(r.note ?? "")).filter(Boolean),
              metafields: (o.metafields?.edges ?? [])
                .map((x) => ({ key: `${x.node.namespace}.${x.node.key}`, value: String(x.node.value ?? "").slice(0, 200) }))
                .filter((m) => m.value),
            },

            other_events: otherEvents,
          };
        });

        // The whole point: which source is actually populated, counted.
        const tally = { timeline_comments: 0, return_notes: 0, refund_notes: 0, metafields: 0,
                        cancel_staff_note: 0, note: 0, tags_only: 0 };
        for (const o of orders) {
          const n = o.never_read;
          if (n.timeline_comments.length) tally.timeline_comments++;
          if (n.return_notes.length) tally.return_notes++;
          if (n.refund_notes.length) tally.refund_notes++;
          if (n.metafields.length) tally.metafields++;
          if (o.now_reading.cancel_staff_note) tally.cancel_staff_note++;
          if (o.now_reading.note) tally.note++;
          if (!n.timeline_comments.length && !n.return_notes.length && !n.refund_notes.length
              && !o.now_reading.cancel_staff_note && !o.now_reading.note
              && (o.now_reading.tags ?? []).length) tally.tags_only++;
        }

        report.push({ store: st, ok: true, examined: orders.length, populated_in: tally, orders });
      }

      return json({
        ok: true, action, api_version: API_VERSION, wrote_nothing: true,
        read_this: "Look at populated_in. Whichever count is high is where your agents actually type. Then tell me which one and I will wire exactly that — nothing else.",
        report,
      });
    }

    /* ================= pull_orders ================= */
    if (action === "pull_orders") {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const summary = [];
      for (const st of stores) {
        const g = await gqlFor(st);
        if ("error" in g) { summary.push({ store: st, ok: false, ...g }); continue; }

        const { rows, error, truncated } = await fetchOrders(g.call, dateFilter(since, winStart, winEnd), pages, budgetMs);
        if (error) { summary.push({ store: st, ok: false, error }); continue; }

        const mapped = rows.map((o) => ({
          order_number: o.name,
          store_code: st,

          // ---- migration 0062: the stable id and the three axes ----
          // Without shopify_order_id the fulfillment and refund webhooks have no
          // order to attach to, because their payloads carry only the number.
          shopify_order_id: orderIdFromGid(o.id),
          shopify_created_at: o.createdAt ?? null,
          shopify_updated_at: o.updatedAt ?? null,
          financial_status: (o.displayFinancialStatus ?? "").toUpperCase() || null,
          fulfillment_status: (o.displayFulfillmentStatus ?? "").toUpperCase() || null,
          cancelled_at: o.cancelledAt ?? null,
          cancel_reason: o.cancelReason ?? null,
          // THE REAL REASON. Proven from an order timeline: the sentence a human
          // typed lives on the cancellation event, not on order.note — which
          // holds CUSTOMER notes and is nearly always empty. Reading note alone
          // is why the Returns page showed the courier's wording instead.
          cancel_staff_note: o.cancellation?.staffNote ?? null,
          note: o.note ?? null,
          tags: (o.tags ?? []).length ? o.tags : null,

          order_date: shopDay(o.createdAt),
          customer_name: o.shippingAddress?.name || "Unknown",
          phone: o.shippingAddress?.phone || o.billingAddress?.phone || "0000000000",
          city: o.shippingAddress?.city || o.billingAddress?.city || "Unknown",
          address: o.shippingAddress?.address1 || null,
          amount: parseFloat(o.totalPriceSet?.shopMoney?.amount ?? "0") || 0,
          // EXACT match, never a substring test.
          //   /FULFILLED/.test("UNFULFILLED") === true
          // because "UNFULFILLED" contains "FULFILLED". Every unfulfilled order
          // was therefore filed as Dispatched, which is why the Orders page read
          // 3,316 dispatched against 3 pending while the old system showed 1,290
          // pending for the same window. The counts were not drifting — they
          // were inverted.
          status: o.cancelledAt ? "Cancelled"
            : ["FULFILLED", "PARTIALLY_FULFILLED"].includes((o.displayFulfillmentStatus ?? "").toUpperCase())
              ? "Dispatched"
              : "Pending",
          shopify_sync: new Date().toISOString(),
        }));

        if (dryRun) { summary.push({ store: st, ok: true, fetched: rows.length, dry_run: true, sample: mapped.slice(0, 3) }); continue; }

        let saved = 0;
        for (let i = 0; i < mapped.length; i += 300) {
          const { data, error: e2 } = await db.from("online_orders")
            .upsert(mapped.slice(i, i + 300), { onConflict: "store_code,order_number" })
            .select("id");
          if (e2) { summary.push({ store: st, ok: false, error: e2.message, saved }); break; }
          saved += (data ?? []).length;
        }
        summary.push({ store: st, ok: true, fetched: rows.length, saved, truncated: truncated || undefined });
      }
      return json({ ok: true, dry_run: dryRun, from: winStart ? `${winStart} to ${winEnd ?? "today"}` : `last ${days} days`, summary });
    }

    /* ================= repair_order_numbers ================= */
    if (action === "repair_order_numbers") {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const summary = [];
      for (const st of stores) {
       try {
        const g = await gqlFor(st);
        if ("error" in g) { summary.push({ store: st, ok: false, ...g }); continue; }
        const { rows, error, truncated } = await fetchOrders(g.call, dateFilter(since, winStart, winEnd), pages, budgetMs);
        if (error) { summary.push({ store: st, ok: false, error }); continue; }

        const byTracking = new Map<string, string>();
        for (const o of rows)
          for (const f of o.fulfillments ?? [])
            for (const t of f.trackingInfo ?? []) {
              const n = (t.number ?? "").trim();
              if (n && o.name) byTracking.set(n, o.name);
            }

        const { data: broken } = await db.from("online_logistics")
          .select("tracking_id")
          .or("order_number.is.null,order_number.eq.#,order_number.eq.")
          .not("tracking_id", "is", null).limit(5000);

        const fixable = (broken ?? []).map((r: { tracking_id: string }) => r.tracking_id)
          .filter((t: string) => byTracking.has(t));

        if (dryRun) {
          summary.push({ store: st, ok: true, shopify_parcels: byTracking.size, broken_in_db: (broken ?? []).length, fixable: fixable.length });
          continue;
        }

        let fixed = 0;
        for (const t of fixable) {
          const name = byTracking.get(t)!;
          const store_code = /^#?TRZ/i.test(name) ? "TRZ" : /^#?TS/i.test(name) ? "TS" : /^#?LM/i.test(name) ? "LM" : st;
          const { data } = await db.from("online_logistics")
            .update({ order_number: name, store_code, needs_review: false, review_status: null })
            .eq("tracking_id", t).select("id");
          fixed += (data ?? []).length;
        }
        summary.push({ store: st, ok: true, truncated: truncated || undefined, broken_in_db: (broken ?? []).length, repaired: fixed });
       } catch (e) {
        summary.push({ store: st, ok: false, error: (e as Error)?.message ?? String(e) });
       }
      }
      return json({ ok: true, dry_run: dryRun, summary });
    }

    /* ================= pull_fulfillments ================= */
    if (action === "pull_fulfillments") {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const updateStatus = body.update_status !== false;
      const summary = [];

      for (const st of stores) {
       try {
        const g = await gqlFor(st);
        if ("error" in g) { summary.push({ store: st, ok: false, ...g }); continue; }

        const { rows, error, truncated, stopped } = await fetchOrders(g.call, dateFilter(since, winStart, winEnd), pages, budgetMs);
        if (error) { summary.push({ store: st, ok: false, error }); continue; }

        const parcels: Record<string, unknown>[] = [];
        const byCourier: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        const unknownStatuses = new Set<string>();

        for (const o of rows) {
          for (const f of o.fulfillments ?? []) {
            for (const t of f.trackingInfo ?? []) {
              const num = (t.number ?? "").trim();
              if (!num) continue;
              const courier = normaliseCourier(t.company ?? "");
              const display = (f.displayStatus ?? "").toUpperCase();
              if (display && !KNOWN_DISPLAY.has(display)) unknownStatuses.add(display);
              byCourier[courier ?? "unknown"] = (byCourier[courier ?? "unknown"] ?? 0) + 1;
              byStatus[display || "(none)"] = (byStatus[display || "(none)"] ?? 0) + 1;
              parcels.push({
                tracking_id: num,
                order_number: o.name,
                store_code: st,
                courier,
                dispatch_date: f.createdAt?.slice(0, 10) ?? null,
                delivery_status: INFORMATIVE.has(display) ? mapDelivery(display) : "In Transit",
                raw_status: display || null,
                cod_amount: parseFloat(o.totalPriceSet?.shopMoney?.amount ?? "0") || null,
                needs_review: !courier,
              });
            }
          }
        }

        if (dryRun) {
          summary.push({
            store: st, ok: true, orders: rows.length, parcels: parcels.length,
            truncated: truncated || undefined,
            note: truncated ? `Only the first ${rows.length} orders were read${stopped ? ` (stopped on ${stopped})` : ""}.` : undefined,
            by_courier: byCourier, by_status: byStatus,
            unknown_shopify_statuses: [...unknownStatuses],
          });
          continue;
        }

        // seed only — an existing parcel is never overwritten, so the courier
        // syncs keep ownership of everything they already track.
        // The same tracking number can appear on more than one fulfillment
        // line; Postgres rejects a batch that hits the same conflict target twice.
        const uniqueParcels = [...new Map(parcels.map((p) => [p.tracking_id, p])).values()];

        let inserted = 0; let writeError = "";
        for (let i = 0; i < uniqueParcels.length; i += 300) {
          const { data, error: e2 } = await db.from("online_logistics")
            .upsert(uniqueParcels.slice(i, i + 300), { onConflict: "tracking_id", ignoreDuplicates: true })
            .select("id");
          if (e2) { writeError = e2.message; break; }
          inserted += (data ?? []).length;
        }
        if (writeError) { summary.push({ store: st, ok: false, error: writeError, inserted }); continue; }

        let statusUpdated = 0;
        if (updateStatus) {
          for (const p of uniqueParcels) {
            if (p.courier !== "OwnEx") continue;
            const raw = String(p.raw_status ?? "");
            // a merchant-side "FULFILLED" is not news — writing it back would
            // turn already-delivered parcels into "In Transit" and destroy the
            // OwnEx receivable figure
            if (!INFORMATIVE.has(raw)) continue;
            const { data } = await db.from("online_logistics")
              .update({ delivery_status: p.delivery_status, raw_status: raw })
              .eq("tracking_id", p.tracking_id).eq("courier", "OwnEx").select("id");
            statusUpdated += (data ?? []).length;
          }
        }

        const events = parcels.filter((p) => p.raw_status).slice(0, 1000)
          .map((p) => ({ tracking_id: p.tracking_id, courier: p.courier ?? "unknown", raw_status: p.raw_status }));
        if (events.length) await db.from("online_courier_events").insert(events);

        summary.push({
          store: st, ok: true, orders: rows.length, parcels: parcels.length,
          truncated: truncated || undefined,
          new_parcels: inserted, ownex_status_updated: statusUpdated,
          by_courier: byCourier, by_status: byStatus,
          unknown_shopify_statuses: [...unknownStatuses],
        });
       } catch (e) {
        const err = e as Error;
        summary.push({ store: st, ok: false, error: err?.message ?? String(e) });
       }
      }
      return json({ ok: true, dry_run: dryRun, summary });
    }

    return json({ error: "unknown action — use debug_env, test_auth, pull_orders, pull_fulfillments or repair_order_numbers" }, 400);
  } catch (e) {
    const err = e as Error;
    return json({ error: err?.message ?? String(e), stack: (err?.stack ?? "").split("\n").slice(0, 6) }, 500);
  }
});
