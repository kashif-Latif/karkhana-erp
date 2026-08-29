// shopify-writeback — closes returned orders in Shopify.
//
// THIS IS THE ONLY THING IN THIS SYSTEM THAT WRITES TO SHOPIFY.
// Everything else reads. That asymmetry was deliberate and this breaks it, so
// it is built to be hard to misuse rather than convenient.
//
// WHAT IT DOES
//   Finds parcels that came back — Returned or RTS — whose Shopify order is
//   still open, and closes them there. A returned COD order that stays open in
//   Shopify is counted as a live sale by every Shopify report the business
//   looks at, which is why they diverge from this system.
//
// WHY CLOSE AND NOT CANCEL
//   Shopify cancellation is PERMANENT. There is no un-cancel; the only way back
//   is to recreate the order, losing its number and history. Across thousands of
//   old orders, one wrong filter would be unrecoverable.
//
//   Closing (archiving) takes the order out of the open list and out of the
//   default reports, and can be reopened one call at a time or in bulk from the
//   Shopify admin. It achieves what is actually wanted — these stop looking
//   like live orders — and stays reversible.
//
//   `cancel` is available as an explicit action for anyone who genuinely wants
//   it, and refuses to run without confirm:"CANCEL PERMANENTLY".
//
// SAFETY
//   dry_run defaults to TRUE. A run that writes must ask for it.
//   Every order touched is recorded in online_shopify_writebacks, before and
//   after, so there is a list to reopen from if the filter was wrong.
//   Rate limited to 2 calls a second — Shopify's REST limit is 2/s per store.
//   max defaults to 200 so a mistake is 200 orders, not 4,000.
//
// CALL
// ACTIONS
//   close    archive a returned order — reversible from the Shopify admin
//   cancel   permanent, refuses without confirm:"CANCEL PERMANENTLY"
//   deliver  mark a DELIVERED parcel's fulfillment as delivered in Shopify, so
//            the shop agrees with what the courier reported
//   paid     record the COD cash against the order, so Shopify stops showing it
//            as payment pending. This is the one that makes Shopify's revenue
//            reports agree with the money the courier actually settled.
//
//   { action: "close", from: "2024-01-01", to: "2026-06-30",
//     stores: ["LM","TS","TRZ"], dry_run: true, max: 200, key: SYNC_KEY }
//
//   Or specific orders instead of a date range:
//   { action: "close", orders: ["#10838","#10877"], dry_run: false, key: ... }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2026-01";
const env = (k: string) =>
  (Deno.env.get(k) ?? Deno.env.get(k.toLowerCase()) ?? Deno.env.get(k.toUpperCase()) ?? "").trim();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function store(code: string) {
  const s = code.toUpperCase();
  const domain = env(`SHOPIFY_${s}_DOMAIN`).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const token = env(`SHOPIFY_${s}_TOKEN`);
  return domain && token ? { domain, token } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    /* TWO WAYS IN, AND NEITHER PUTS A SECRET IN A BROWSER.
       A cron job or a manual test sends SYNC_KEY. The app sends the signed-in
       person's own token, and the function checks they hold hub.finance.manage
       — the same permission that lets them import a settlement in the first
       place. Shipping SYNC_KEY to the browser so a button could work would hand
       every visitor the ability to close orders in the shop. */
    const expected = Deno.env.get("SYNC_KEY") ?? "\u0000";
    let allowed = String(body.key ?? "") === expected;

    if (!allowed) {
      const auth = req.headers.get("Authorization") ?? "";
      const jwt = auth.replace(/^Bearer\s+/i, "");
      if (jwt) {
        const asUser = createClient(
          Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: `Bearer ${jwt}` } } });
        const { data: who } = await asUser.auth.getUser();
        if (who?.user) {
          // my_permissions() runs as the caller, so this is their real list.
          const { data: perms } = await asUser.rpc("my_permissions");
          const list = (perms ?? []) as string[];
          const { data: prof } = await asUser.from("app_users")
            .select("is_super_admin").eq("id", who.user.id).maybeSingle();
          allowed = !!prof?.is_super_admin || list.includes("hub.finance.manage");
        }
      }
    }

    if (!allowed) {
      return json({ error: "Not authorised. Send SYNC_KEY, or sign in with hub.finance.manage." }, 401);
    }

    const action: string = String(body.action ?? "close");
    const dryRun: boolean = body.dry_run !== false;      // must be asked to write
    /* 50 A CALL, NOT 200.
       64 orders at 550ms each, plus 64 round trips to Shopify, runs past a
       minute — and the caller gives up before the reply arrives. The work
       finished every time; only the answer was lost, which looked like a crash
       and invited running it again. Fifty comes back in about half a minute.
       Call it repeatedly; it skips what it has already done. */
    const max: number = Math.min(Number(body.max ?? 50), 200);
    const stores: string[] = Array.isArray(body.stores) && body.stores.length
      ? body.stores.map((s: string) => s.toUpperCase()) : ["LM", "TS", "TRZ"];

    if (action === "cancel" && body.confirm !== "CANCEL PERMANENTLY") {
      return json({
        error: "Cancelling cannot be undone in Shopify. To proceed, send " +
               'confirm: "CANCEL PERMANENTLY". Consider action:"close" instead, ' +
               "which archives the order and can be reopened.",
      }, 400);
    }

    // ---- which parcels ------------------------------------------------------
    /* Two queries, not an embedded join.
       shopify_order_id lives on online_orders, and PostgREST can only embed
       tables joined by a FOREIGN KEY. These two are matched on order_number AND
       store_code — a natural pair, not a declared relationship — so asking for
       the embed gives "could not find a relationship in the schema cache".
       They are fetched separately and paired in code below.

       Both columns, always: order numbers repeat across the three stores, and
       matching on the number alone would close a TopShop order because a Little
       Minors parcel came back. */
    /* WHICH PARCELS THIS ACTION IS ABOUT.
       `deliver` and `paid` act on what the courier DELIVERED; `close` and
       `cancel` on what came back. Everything else about the run — the dry run,
       the batching, the audit log, the rate limit — is the same either way,
       because the dangerous parts are dangerous whichever direction the write
       goes. */
    const wantStatuses = (action === "deliver" || action === "paid")
      ? ["Delivered"] : ["Returned", "RTS"];

    let q = db.from("online_logistics")
      .select("tracking_id,order_number,store_code,delivery_status,delivery_date,dispatch_date,return_leg_started_at")
      .in("delivery_status", wantStatuses)
      .in("store_code", stores)
      .limit(max);

    /* A settlement names parcels by TRACKING NUMBER, not by order number — the
       courier has never heard of a Shopify order. Accepting both means the CPR
       import can pass what it actually has. */
    if (Array.isArray(body.tracking) && body.tracking.length) {
      q = q.in("tracking_id", body.tracking);
    } else if (Array.isArray(body.orders) && body.orders.length) {
      q = q.in("order_number", body.orders);
    } else {
      // The date a parcel started coming back, falling back the same way the
      // returns page and migration 0101 do, so the three agree on what is old.
      // A delivery is dated by delivery_date; a return by when it turned back.
      const dateCol = (action === "deliver" || action === "paid") ? "delivery_date" : "return_leg_started_at";
      const plainDate = action === "deliver" || action === "paid";
      if (body.to) q = q.lte(dateCol, plainDate ? body.to : `${body.to}T23:59:59Z`);
      if (body.from) q = q.gte(dateCol, plainDate ? body.from : `${body.from}T00:00:00Z`);
    }

    const { data: rows, error } = await q;
    if (error) return json({ error: error.message }, 500);
    if (!rows?.length) return json({ ok: true, dry_run: dryRun, found: 0, report: "Nothing matched." });

    /* WHAT HAS ALREADY BEEN CLOSED, so a second call does not do it again.
       Without this every re-run repeated the same orders — harmless in Shopify,
       but it burns the rate limit and makes the audit log useless as a record of
       what actually changed. */
    const { data: doneRows } = await db.from("online_shopify_writebacks")
      .select("order_number,store_code")
      .eq("succeeded", true)
      .eq("action", action);
    const alreadyDone = new Set((doneRows ?? []).map((d) => `${d.store_code}|${d.order_number}`));

    // The matching orders, keyed by store + number.
    const { data: orderRows, error: oe } = await db.from("online_orders")
      .select("order_number,store_code,shopify_order_id,cancelled_at")
      .in("order_number", [...new Set(rows.map((r) => String(r.order_number)))])
      .in("store_code", stores);
    if (oe) return json({ error: oe.message }, 500);
    const orders = new Map<string, { shopify_order_id: number | null; cancelled_at: string | null }>();
    for (const o of orderRows ?? []) {
      orders.set(`${o.store_code}|${o.order_number}`, {
        shopify_order_id: o.shopify_order_id as number | null,
        cancelled_at: o.cancelled_at as string | null,
      });
    }

    /* THE AUDIT TABLE MUST EXIST BEFORE ANYTHING IS WRITTEN.
       Without it a run can change orders in Shopify and leave no record of
       which — and Shopify cannot tell you which changes came from here. Better
       to refuse with a clear message than to half-succeed unrecorded. */
    if (!dryRun) {
      const { error: te } = await db.from("online_shopify_writebacks").select("id").limit(1);
      if (te) {
        return json({ error: "online_shopify_writebacks is missing or unreadable — run migration 0103 first. " +
                             "Nothing was written. (" + te.message + ")" }, 400);
      }
    }

    // ---- act ----------------------------------------------------------------
    const results: Record<string, unknown>[] = [];
    let closed = 0, skipped = 0, failed = 0;

    for (const r of rows) {
      const st = store(String(r.store_code));
      if (!st) { skipped++; results.push({ order: r.order_number, skipped: "no credentials for this store" }); continue; }

      if (alreadyDone.has(`${r.store_code}|${r.order_number}`)) {
        skipped++; results.push({ order: r.order_number, skipped: "already done in an earlier run" }); continue;
      }

      const o = orders.get(`${r.store_code}|${r.order_number}`);
      if (!o) { skipped++; results.push({ order: r.order_number, skipped: "no matching Shopify order" }); continue; }
      // Already cancelled in Shopify by an agent — leave it alone.
      if (o.cancelled_at) { skipped++; results.push({ order: r.order_number, skipped: "already cancelled in Shopify" }); continue; }
      const gid = o.shopify_order_id;
      if (!gid) { skipped++; results.push({ order: r.order_number, skipped: "no Shopify id on this parcel" }); continue; }

      if (dryRun) {
        results.push({ order: r.order_number, store: r.store_code, would: action });
        closed++;
        continue;
      }

      const id = String(gid).replace(/\D/g, "");            // REST wants the number

      /* MARKING DELIVERED IS TWO CALLS, NOT ONE.
         Shopify has no "delivered" field on an order. Delivery is an event on a
         FULFILLMENT, so the fulfillment has to be found first. An order that was
         never fulfilled has nothing to mark — that is reported rather than
         forced, because creating a fulfillment to hang an event on would invent
         a shipment that never existed in Shopify. */
      /* MARKING COD AS PAID.
         Shopify has no "set paid" switch. Payment is a TRANSACTION against the
         order, so the cash the courier collected is recorded as one. Until that
         happens every delivered COD order sits as "payment pending" and
         Shopify's revenue reports show nothing for money that is already in the
         bank.

         The amount comes from the order's own outstanding balance, not from our
         cod_amount — if the two ever disagree, Shopify's figure is the one its
         reports are built on, and inventing a transaction for a different sum
         would put the shop permanently out of balance. */
      if (action === "paid") {
        let ok3 = false, detail3 = "";
        try {
          const or = await fetch(
            `https://${st.domain}/admin/api/${API_VERSION}/orders/${id}.json?fields=id,total_outstanding,financial_status,currency`,
            { headers: { "X-Shopify-Access-Token": st.token } });
          const oj = await or.json();
          const ord = oj?.order ?? {};
          const outstanding = Number(ord.total_outstanding ?? 0);

          if (ord.financial_status === "paid" || outstanding <= 0) {
            skipped++;
            results.push({ order: r.order_number, skipped: "already paid in Shopify" });
            await sleep(550);
            continue;
          }

          const tr = await fetch(
            `https://${st.domain}/admin/api/${API_VERSION}/orders/${id}/transactions.json`,
            { method: "POST",
              headers: { "X-Shopify-Access-Token": st.token, "content-type": "application/json" },
              body: JSON.stringify({ transaction: {
                kind: "sale", status: "success", gateway: "Cash on Delivery (COD)",
                amount: outstanding.toFixed(2), currency: ord.currency ?? "PKR",
              } }) });
          ok3 = tr.ok;
          if (!ok3) detail3 = `${tr.status} ${(await tr.text().catch(() => "")).slice(0, 200)}`;
        } catch (err) { detail3 = err instanceof Error ? err.message : String(err); }

        if (ok3) { closed++; results.push({ order: r.order_number, store: r.store_code, done: "marked paid" }); }
        else     { failed++; results.push({ order: r.order_number, store: r.store_code, failed: detail3 }); }

        try {
          await db.from("online_shopify_writebacks").insert({
            order_number: r.order_number, store_code: r.store_code,
            shopify_order_id: String(gid), action,
            succeeded: ok3, error: ok3 ? null : detail3.slice(0, 500),
          });
        } catch { /* the write already happened */ }

        await sleep(550);
        continue;
      }

      if (action === "deliver") {
        let fid = "";
        try {
          const fr = await fetch(
            `https://${st.domain}/admin/api/${API_VERSION}/orders/${id}/fulfillments.json`,
            { headers: { "X-Shopify-Access-Token": st.token } });
          const fj = await fr.json();
          const list = (fj?.fulfillments ?? []) as Record<string, unknown>[];
          const open = list.find((f) => f.status !== "cancelled");
          fid = open ? String(open.id) : "";
        } catch { /* handled as a failure below */ }

        if (!fid) {
          skipped++;
          results.push({ order: r.order_number, skipped: "no fulfillment in Shopify to mark" });
          await sleep(550);
          continue;
        }

        let ok2 = false, detail2 = "";
        try {
          const er = await fetch(
            `https://${st.domain}/admin/api/${API_VERSION}/fulfillments/${fid}/events.json`,
            { method: "POST",
              headers: { "X-Shopify-Access-Token": st.token, "content-type": "application/json" },
              body: JSON.stringify({ event: { status: "delivered" } }) });
          ok2 = er.ok;
          if (!ok2) detail2 = `${er.status} ${(await er.text().catch(() => "")).slice(0, 200)}`;
        } catch (err) { detail2 = err instanceof Error ? err.message : String(err); }

        if (ok2) { closed++; results.push({ order: r.order_number, store: r.store_code, done: "delivered" }); }
        else     { failed++; results.push({ order: r.order_number, store: r.store_code, failed: detail2 }); }

        try {
          await db.from("online_shopify_writebacks").insert({
            order_number: r.order_number, store_code: r.store_code,
            shopify_order_id: String(gid), action,
            succeeded: ok2, error: ok2 ? null : detail2.slice(0, 500),
          });
        } catch { /* the write already happened */ }

        await sleep(550);
        continue;
      }

      const url = action === "cancel"
        ? `https://${st.domain}/admin/api/${API_VERSION}/orders/${id}/cancel.json`
        : `https://${st.domain}/admin/api/${API_VERSION}/orders/${id}/close.json`;

      /* ONE BAD ROW MUST NOT END THE RUN.
         An unhandled throw here stops everything and returns a 500 — after some
         orders have already been changed, with no record of which. Each order
         is handled on its own: it succeeds, or it is recorded as failed, and
         the run carries on to the next. */
      let ok = false, detail = "";
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "X-Shopify-Access-Token": st.token, "content-type": "application/json" },
          body: action === "cancel" ? JSON.stringify({ reason: "customer", email: false }) : "{}",
        });
        ok = res.ok;
        if (!ok) detail = `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }

      if (ok) { closed++; results.push({ order: r.order_number, store: r.store_code, done: action }); }
      else    { failed++; results.push({ order: r.order_number, store: r.store_code, failed: detail }); }

      // Recorded either way, and never allowed to break the run.
      try {
        await db.from("online_shopify_writebacks").insert({
          order_number: r.order_number, store_code: r.store_code,
          shopify_order_id: String(gid), action,
          succeeded: ok, error: ok ? null : detail.slice(0, 500),
        });
      } catch { /* the write already happened; losing the log must not stop it */ }

      // Shopify's REST limit is 2 calls a second per store. Going faster earns
      // 429s and a partly-finished run, which is the worst outcome here.
      await sleep(550);
    }

    return json({
      ok: true, dry_run: dryRun, action, found: rows.length,
      closed, skipped, failed,
      report: dryRun
        ? `${closed} orders would be ${action}d. Nothing was written. Send dry_run:false to do it.`
        : `${closed} ${action}d, ${skipped} skipped, ${failed} failed.` +
          (closed === max ? ` There may be more — call again to continue.` : ` Nothing left in this range.`),
      sample: results.slice(0, 25),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
