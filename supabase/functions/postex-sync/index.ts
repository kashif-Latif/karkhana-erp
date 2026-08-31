// Karkhana — PostEx live sync  (built from Merchant API Guide v4.1.9)
// Deploy to the KARKHANA project, with VERIFY JWT OFF.
//
// ACTIONS
//   postex_pull      pull ALL orders for a date range  -> replaces manual load-sheet
//                    AND status-file uploads in one call
//   postex_track     bulk-track everything still moving
//   postex_payments  read payment status -> auto CPR / COD reconciliation
//   postex_book      create an order at PostEx -> returns & stores tracking number
//   postex_loadsheet generate the load-sheet PDF for a set of tracking numbers
//
// SECRETS (Project Settings -> Edge Functions -> Secrets)
//   POSTEX_API_TOKEN   your token from PostEx portal -> Setting -> API
//   SYNC_KEY           a password you invent; the app must send it
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically)
//
// AUTH — READ THIS BEFORE CHANGING IT
//   call_sync() in the database sends the shared secret as the `x-sync-key`
//   HEADER. ownex-sync and shopify-sync both read the header. This function
//   originally read only `body.sync_key`, so every scheduled call failed
//   authentication even with a correct key — and failed SILENTLY, because
//   pg_net reports success on dispatch and never surfaces the reply. Combined
//   with Verify JWT being on (which rejects at the gateway, before this code
//   runs at all), PostEx automation could never have worked.
//   Both forms are accepted below so any older caller keeps working.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

// Documented bases. Note PostEx uses BOTH "services" and "service" (shipper-advice).
const B  = "https://api.postex.pk/services/integration/api/order";
const B1 = "https://api.postex.pk/service/integration/api/order";

/** PostEx's 13 documented statuses -> our four states. */
function classify(raw: string): { delivery_status: string; needs_review: boolean } {
  const s = (raw || "").toLowerCase().trim();
  if (/delivered/.test(s))                        return { delivery_status: "Delivered", needs_review: false };
  if (/return|rts/.test(s))                       return { delivery_status: "Returned",  needs_review: false };
  if (/cancel|expired|un-?assigned/.test(s))      return { delivery_status: "Cancelled", needs_review: false };
  // everything still moving. Includes wordings the v4.1.9 PDF never lists but
  // the live API really sends: Transferred, In Stock, Ready for Delivery,
  // In-Transit (hyphenated), and "Reason - REFUSED TO RECEIVE".
  /* NOT YET COLLECTED IS NOT THE SAME AS MOVING.
     "Unbooked" was in the same bucket as "In Transit", so a parcel PostEx has
     never picked up displayed as though it were on its way to the customer.
     43 TRZ and TS parcels showed In Transit this morning while PostEx's own
     portal said Unbooked for every one of them — they were sitting in the
     warehouse.

     The distinction is operational, not cosmetic: an unbooked parcel needs
     somebody to chase the pickup, and an in-transit one needs nothing. Merging
     them hides the only one that requires action. Checked before the general
     rule below, because "unbooked" contains "booked". */
  if (/un-?booked|not.?booked/.test(s))           return { delivery_status: "Unbooked",   needs_review: false };
  if (/booked|warehouse|in stock|transferred|ready for delivery|out for delivery|picked|attempt|refus|en.?route|in.?transit|transit|on root|under review|shipper advice|hold/.test(s))
                                                  return { delivery_status: "In Transit", needs_review: false };
  return { delivery_status: "In Transit", needs_review: true };   // truly unknown -> flag, never guess
}

/* ---------------------------------------------------------------------------
   THE COURIER'S REASON, PULLED OUT OF THE STATUS STRING   (migration 0076)

   PostEx does not send a separate reason field on the tracking response. It
   welds the reason onto the status:

       "Reason - REFUSED TO RECEIVE"
       "Reason - CUSTOMER NOT AVAILABLE"

   We stored that whole string, prefix and all, into rts_reason — so the Returns
   page could only show "PostEx: Reason - REFUSED TO RECEIVE", which reads like
   machine output and got ignored. What belongs in front of the team is
   "REFUSED TO RECEIVE".

   The "Reason - " marker is REQUIRED. Without it, "Returned" and
   "Failed Attempt" would be promoted into the reason column, and a status
   masquerading as an explanation is worse than an empty cell.

   A couple of detail fields are checked too, in case they ever appear — but
   nothing is invented if they do not. --------------------------------------- */
const REASON_MARKER = /reason\s*[-–:]\s*(.+)$/i;
const EMPTY_REASON = /^(n\/?a|none|null|-+|verifying reason|reason|pending|no reason)$/i;

function cleanReason(v: unknown): string {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!s || s.length < 3 || EMPTY_REASON.test(s)) return "";
  return s.slice(0, 200);
}

function postexReason(raw: string, detail?: Record<string, unknown> | null): string | null {
  const m = REASON_MARKER.exec(String(raw ?? ""));
  const fromStatus = cleanReason(m?.[1]);
  if (fromStatus) return fromStatus;

  for (const k of ["reason", "reasonDescription", "returnReason", "remarks", "statusReason"]) {
    const v = cleanReason(detail?.[k]);
    if (v && v.toLowerCase() !== String(raw ?? "").toLowerCase()) return v;
  }
  return null;
}

const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? null : n; };

/** One PostEx account serves all three stores, so the API can't tell them apart.
 *  The merchant's own order reference does: #LM15082 / #TS2673 / #TRZ1715.
 *  Check TRZ before TS — otherwise "TRZ" would never match. */
function storeFromRef(ref: unknown, fallback: string): string {
  const s = String(ref ?? "").toUpperCase().replace(/^#/, "");
  if (s.startsWith("TRZ")) return "TRZ";
  if (s.startsWith("TS"))  return "TS";
  if (s.startsWith("LM"))  return "LM";
  return fallback;
}
const day = (v: unknown) => { const s = String(v ?? "").trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };

async function px(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(path, { ...init, headers: { token, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await r.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}

/** PostEx's listing endpoints are GET-only and take QUERY PARAMS — despite the
 *  v4.1.9 guide showing a JSON body. (POST returns 405 Method Not Allowed.)
 *  We send GET with query params, and keep a POST fallback purely in case they
 *  change it later. Arrays are sent comma-separated, which Spring binds to List. */
async function pxQuery(path: string, token: string, params: Record<string, unknown>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const get = await px(`${path}?${qs.toString()}`, token, { method: "GET" });
  if (get.ok) return { ...get, via: "GET" };

  const post = await px(path, token, { method: "POST", body: JSON.stringify(params) });
  return { ...post, via: "POST", getAttempt: { status: get.status, body: get.body } };
}


/** Track ONE parcel. The documented single-order endpoint, used per parcel.
 *
 *  WHY THIS EXISTS: /v1/track-bulk-order returned 405 Method Not Allowed on
 *  every scheduled run — GET was refused and the POST fallback rejected too. It
 *  reported ok:true with `updated: 0` and the failures buried in an `errors`
 *  array, so nothing surfaced. The effect was that any parcel older than the
 *  3-day pull window never changed status again: dispatched six days ago,
 *  delivered yesterday, still "In Transit" in our table.
 *
 *  One request per parcel is slower than a bulk call, but a slow endpoint that
 *  answers beats a fast one that 405s. */
async function pxTrackOne(tracking: string, token: string) {
  const paths = [
    `${B}/v1/track-order/${encodeURIComponent(tracking)}`,
    `${B1}/v1/track-order/${encodeURIComponent(tracking)}`,
  ];
  for (const path of paths) {
    const r = await px(path, token, { method: "GET" });
    if (!r.ok) continue;
    const raw = (r.body ?? {}) as Record<string, unknown>;
    const dist = raw.dist ?? raw;
    const d = (Array.isArray(dist) ? (dist[0] ?? {}) : (dist ?? {})) as Record<string, unknown>;
    const t = (d.trackingResponse ?? d) as Record<string, unknown>;
    const status = String(t.transactionStatus ?? d.transactionStatus ?? "");
    if (status) return { ok: true, status, detail: t };
  }
  return { ok: false as const, status: "", detail: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    // ---- who is allowed to trigger a sync? ----
    // Either (a) a server/cron caller holding SYNC_KEY, or (b) a signed-in
    // Karkhana user who holds online.access. The browser must NEVER see
    // SYNC_KEY, so the app authenticates as the logged-in user instead.
    const gate = Deno.env.get("SYNC_KEY");
    let allowed = false;

    // call_sync() sends the key as the x-sync-key HEADER — see the note at the
    // top of this file. The body form is kept for older callers.
    const headerKey = req.headers.get("x-sync-key") ?? "";
    if (gate && (headerKey === gate || body.sync_key === gate)) {
      allowed = true;                                   // server-to-server
    } else {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (jwt) {
        const { data: u } = await db.auth.getUser(jwt);
        if (u?.user) {
          // evaluate the permission AS THAT USER, so their real rights apply
          const asUser = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { global: { headers: { Authorization: `Bearer ${jwt}` } } },
          );
          const { data: ok } = await asUser.rpc("has_permission", { p_permission_code: "online.access" });
          allowed = ok === true;
        }
      }
    }
    if (!allowed) return json({ error: "unauthorized" }, 401);

    const token = Deno.env.get("POSTEX_API_TOKEN");
    if (!token) return json({ error: "POSTEX_API_TOKEN not set" }, 400);

    const action = body.action ?? "postex_pull";
    const store  = body.store ?? "LM";

    // ---------------------------------------------------------------
    // PULL — every order in a date range. Replaces load-sheet + status uploads.
    // ---------------------------------------------------------------
    if (action === "postex_pull") {
      const to   = body.toDate   ?? new Date().toISOString().slice(0, 10);
      const from = body.fromDate ?? new Date(Date.now() - (body.days ?? 7) * 864e5).toISOString().slice(0, 10);

      // NOTE: the v4.1.9 PDF documents fromDate/toDate, but the live API demands
      // startDate/endDate. We send both spellings so it works either way.
      // The v4.1.9 PDF and the live API disagree on parameter names, so we send
      // every spelling. Spring ignores params it doesn't declare, so this is safe.
      //   PDF says orderStatusID / fromDate / toDate
      //   API wants orderStatusId / startDate / endDate   (note the lowercase 'd')
      const res = await pxQuery(`${B}/v1/get-all-order`, token, {
        orderStatusId: 0, orderStatusID: 0,                // 0 = every status
        startDate: from, endDate: to,
        fromDate: from, toDate: to,
      });
      if (!res.ok) return json({ error: "PostEx rejected the request", status: res.status,
                                 tried: res.via, detail: res.body, getAttempt: res.getAttempt }, 502);

      const list = (res.body as { dist?: unknown[] })?.dist ?? [];
      const rows: Record<string, unknown>[] = [];
      const reasonRows: { tracking_id: string; courier_reason_text: string }[] = [];

      for (const item of list as Record<string, unknown>[]) {
        const t = (item.trackingResponse ?? item) as Record<string, unknown>;
        const tracking = String(t.trackingNumber ?? item.trackingNumber ?? "").trim();
        if (!tracking) continue;
        const ref = String(t.orderRefNumber ?? "").trim();
        const raw = String(t.transactionStatus ?? "");
        const { delivery_status, needs_review } = classify(raw);
        // Collected, but NOT added to the upsert payload below.
        //
        // PostgREST decides the column list from the FIRST object in the array,
        // so a ragged payload either errors or silently nulls the column on
        // every row that omitted it — which would wipe reasons recorded earlier.
        // Uniform rows for the upsert; the reasons go in as a separate pass.
        const reason = postexReason(raw, t);
        if (reason) reasonRows.push({ tracking_id: tracking, courier_reason_text: reason });
        rows.push({
          tracking_id: tracking,
          order_number: ref || null,
          store_code: storeFromRef(ref, store),   // real store, from the order prefix
          courier: "PostEx",
          delivery_status, needs_review, raw_status: raw || null,
          review_status: needs_review ? raw : null,
          dispatch_date: day(t.transactionDate) ?? day(t.orderPickupDate),
          delivery_date: day(t.orderDeliveryDate),
          cod_amount: num(t.invoicePayment),
          courier_fee: num(t.transactionFee),
          courier_tax: num(t.transactionTax),
          upfront_amount: num(t.upfrontPayment),
          reserve_amount: num(t.reservePayment),
        });
      }

      let merged = 0;
      for (let i = 0; i < rows.length; i += 300) {
        const { data, error } = await db.from("online_logistics")
          .upsert(rows.slice(i, i + 300), { onConflict: "tracking_id" }).select("id");
        if (error) return json({ error: error.message, at: i }, 500);
        merged += (data ?? []).length;
      }
      /* Second pass: the reasons.
   
         RING-FENCED ON PURPOSE. postex_pull is the job that keeps Orders and
         Logistics populated, and it worked before this change. Nothing added
         here is allowed to slow it down or take it with it if it fails:
   
           - CAPPED. One UPDATE per parcel is a sequential round trip, and an
             unbounded loop could run past the function's time limit and fail a
             pull that had already merged its rows successfully.
           - WRAPPED. A throw here is swallowed and reported, never propagated.
             A missing reason is a cosmetic gap on the Returns page; a failed
             pull is missing orders.
   
         In practice this loop is empty: no PostEx status in this database
         carries the "Reason - " marker, so postexReason() returns null for all
         of them. The guards are for the day PostEx changes that, not for now. */
      const REASON_CAP = 200;
      let reasoned = 0, reasonSkipped = Math.max(0, reasonRows.length - REASON_CAP);
      let reasonError: string | undefined;
      try {
        for (const rr of reasonRows.slice(0, REASON_CAP)) {
          const { data } = await db.from("online_logistics")
            .update({ courier_reason_text: rr.courier_reason_text })
            .eq("tracking_id", rr.tracking_id).eq("courier", "PostEx").select("id");
          reasoned += (data ?? []).length;
        }
      } catch (e) {
        reasonError = String(e instanceof Error ? e.message : e).slice(0, 200);
      }

      /* NO EVENT LOG FROM THE PULL.
         This used to insert up to 500 rows on every run — 96 runs a day — for
         parcels whose status is already stored on the parcel itself, with
         updated_at to say when. It recorded nothing that could not be read from
         online_logistics, and it was one of the two things filling the free
         tier. The tracking paths below still log, because those fire on an
         actual status change. */
      return json({ ok: true, action, from, to, called_via: res.via,
                    fetched: rows.length, merged,
                    courier_reasons_captured: reasoned,
                    courier_reasons_skipped: reasonSkipped || undefined,
                    courier_reason_error: reasonError });
    }

    // ---------------------------------------------------------------
    // TRACK — bulk-track everything still in transit
    // ---------------------------------------------------------------
    if (action === "postex_track") {
      const staleMinutes = Number(body.stale_minutes ?? 30);
      const cutoff = new Date(Date.now() - staleMinutes * 60000).toISOString();

      let openQ = db.from("online_logistics")
        .select("tracking_id, delivery_status, raw_status, courier_reason_text").eq("courier", "PostEx")
        .not("tracking_id", "is", null)
        // Everything NOT finally settled.
        //
        // This used to be ["In Transit", "Pending"] only, which froze two groups
        // permanently:
        //   * "Failed Attempt" — 22 parcels untouched since 21 Aug, and these
        //     are precisely the ones that need chasing
        //   * "RTS" — a parcel on its way back could never progress to Returned,
        //     the same fault ownex-sync had before migration 0059
        // Delivered / Returned / Cancelled are terminal and stay excluded.
        .not("delivery_status", "in", '("Delivered","Returned","Cancelled")')
        // Least recently checked first.
        //
        // Without an ORDER BY, Postgres returns whatever rows are cheapest to
        // read — in practice the same ones every run. Once the open set grows
        // past the limit, the tail would never be checked at all: a parcel could
        // sit unrefreshed indefinitely while its neighbours were polled 144
        // times a day. Ordering by updated_at makes the whole set rotate, which
        // is what ownex-sync already does.
        .order("updated_at", { ascending: true, nullsFirst: true })
        .limit(body.limit ?? 250);
      if (staleMinutes > 0) openQ = openQ.or(`updated_at.is.null,updated_at.lt.${cutoff}`);
      const { data: open } = await openQ;

      // Skip anything checked recently.
      //
      // Without this the job re-fetched all ~214 open parcels every 10 minutes
      // — about 31,000 requests a day at ONE REQUEST PER PARCEL, since PostEx's
      // bulk endpoint returns 405. That was the main driver behind 164 MB of
      // egress in a single day against a 5 GB monthly allowance.
      // A 30-minute window cuts it to a third and loses nothing: a parcel's
      // status does not change three times an hour.
      const nums = (open ?? []).map((r: { tracking_id: string }) => r.tracking_id).filter(Boolean);
      if (!nums.length) return json({ ok: true, action, checked: 0, updated: 0, note: "nothing in transit" });

      let updated = 0; let unchanged = 0; let bulkWorked = false; const errors: string[] = [];
      let reasonsFound = 0;

      // Try the bulk endpoint once. If it answers, use it — it is far cheaper.
      // If it does not, fall through to one request per parcel rather than
      // reporting success while updating nothing.
      const probe = await pxQuery(`${B}/v1/track-bulk-order`, token, { trackingNumber: nums.slice(0, 5) });
      bulkWorked = probe.ok;
      if (!bulkWorked) errors.push(`bulk endpoint unavailable: HTTP ${probe.status} (${probe.via}) — using per-parcel tracking`);

      if (!bulkWorked) {
        // small waves, so we stay polite to their API
        for (let i = 0; i < nums.length; i += 8) {
          const wave = nums.slice(i, i + 8);
          const results = await Promise.all(wave.map(async (tn) => ({ tn, ...(await pxTrackOne(tn, token)) })));
          // What we already hold, so an unchanged parcel is not rewritten.
          // Every UPDATE fires a Realtime event to every open browser tab, so
          // rewriting 250 identical rows six times an hour was costing egress
          // twice over — once to PostEx, once to every watching tab.
          const prior = new Map((open ?? []).map((r: { tracking_id: string; raw_status: string | null }) =>
            [r.tracking_id, r.raw_status]));
          // What reason we already hold. A parcel whose status has not moved but
          // whose reason column is still empty DOES need writing — otherwise the
          // shortcut below would keep every existing "Reason - ..." parcel blank
          // forever, since its status never changes again.
          const priorReason = new Map((open ?? []).map(
            (r: { tracking_id: string; courier_reason_text: string | null }) =>
              [r.tracking_id, r.courier_reason_text]));

          for (const r of results) {
            if (!r.ok || !r.status) continue;
            const reason = postexReason(r.status, r.detail as Record<string, unknown> | null);
            const reasonIsNew = !!reason && reason !== priorReason.get(r.tn);
            if (prior.get(r.tn) === r.status && !reasonIsNew) { unchanged++; continue; }   // nothing new
            const { delivery_status, needs_review } = classify(r.status);
            const upd: Record<string, unknown> = {
              delivery_status, needs_review, raw_status: r.status,
              updated_at: new Date().toISOString(),
            };
            if (needs_review) upd.review_status = r.status;
            /* ONLY POSTEX'S OWN DATE. Never today's.
               This fell back to `new Date()` when PostEx sent no date — and for
               older parcels PostEx has long since dropped that field, so every
               one it reported got stamped with the day we happened to ask. A
               parcel dispatched in November 2024 ended up with a delivery date
               of 25 August 2026, which then drove its age, its place in the
               returns list, and any rule that judges by age.

               A missing date is missing. Leaving the column null is honest and
               the page falls back to dispatch_date, which is real. */
            const dd = day((r.detail as Record<string, unknown>)?.orderDeliveryDate);
            if (dd && (delivery_status === "Delivered" || delivery_status === "Returned"))
              upd.delivery_date = dd;
            if (delivery_status === "Returned") { upd.rts = "Yes"; upd.rts_reason = `PostEx: ${r.status}`; }
            else if (/refus|attempt/i.test(r.status)) { upd.rts_reason = `PostEx: ${r.status}`; }
            // rts_reason stays a status echo. The reason itself gets its own
            // column, unprefixed, so the Returns page has something readable
            // rather than machine output. Only written when we have one.
            if (reason) { upd.courier_reason_text = reason; reasonsFound++; }
            const { data } = await db.from("online_logistics").update(upd).eq("tracking_id", r.tn).select("id");
            updated += (data ?? []).length;
            await db.from("online_courier_events").insert({ courier: "PostEx", tracking_id: r.tn, raw_status: r.status, payload: { source: "track-single" } });
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        return json({ ok: true, action, checked: nums.length, updated, unchanged,
                      method: "per-parcel", stale_minutes: staleMinutes,
                      courier_reasons_captured: reasonsFound,
                      errors: errors.slice(0, 5) });
      }

      for (let i = 0; i < nums.length; i += 50) {          // bulk endpoint, 50 at a time
        const chunk = nums.slice(i, i + 50);
        const res = await pxQuery(`${B}/v1/track-bulk-order`, token, { trackingNumber: chunk });
        if (!res.ok) { errors.push(`chunk ${i}: HTTP ${res.status} (${res.via})`); continue; }
        for (const entry of ((res.body as { dist?: unknown[] })?.dist ?? []) as Record<string, unknown>[]) {
          const t = (entry.trackingResponse ?? {}) as Record<string, unknown>;
          const tn = String(entry.trackingNumber ?? t.trackingNumber ?? "").trim();
          const raw = String(t.transactionStatus ?? "");
          if (!tn || !raw) continue;
          const { delivery_status, needs_review } = classify(raw);
          const upd: Record<string, unknown> = { delivery_status, needs_review, raw_status: raw };
          if (needs_review) upd.review_status = raw;
          // Same rule as above: PostEx's date or nothing. Never today's.
          const dd2 = day(t.orderDeliveryDate);
          if (dd2 && (delivery_status === "Delivered" || delivery_status === "Returned"))
            upd.delivery_date = dd2;
          if (delivery_status === "Returned") { upd.rts = "Yes"; upd.rts_reason = `PostEx: ${raw}`; }
          else if (/refus|attempt/i.test(raw)) { upd.rts_reason = `PostEx: ${raw}`; }
          const reason = postexReason(raw, t);
          if (reason) { upd.courier_reason_text = reason; reasonsFound++; }
          const { data } = await db.from("online_logistics").update(upd).eq("tracking_id", tn).select("id");
          updated += (data ?? []).length;
          await db.from("online_courier_events").insert({ courier: "PostEx", tracking_id: tn, raw_status: raw, payload: { source: "track" } });
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return json({ ok: true, action, checked: nums.length, updated, method: "bulk",
                    courier_reasons_captured: reasonsFound, errors: errors.slice(0, 10) });
    }

    // ---------------------------------------------------------------
    // PAYMENTS — CPR / COD reconciliation, straight from PostEx
    // ---------------------------------------------------------------
    if (action === "postex_payments") {
      const { data: unpaid } = await db.from("online_logistics")
        .select("tracking_id").eq("courier", "PostEx")
        .eq("delivery_status", "Delivered")
        .not("tracking_id", "is", null)
        .neq("payment_status", "Paid")
        .limit(body.limit ?? 200);
      const nums = (unpaid ?? []).map((r: { tracking_id: string }) => r.tracking_id).filter(Boolean);

      let settled = 0, notYet = 0; const errors: string[] = []; const sample: unknown[] = [];
      for (const tn of nums) {
        try {
          const res = await px(`${B}/v1/payment-status/${encodeURIComponent(tn)}`, token);
          if (!res.ok) { errors.push(`${tn}: HTTP ${res.status}`); continue; }

          // PostEx has returned dist as an object here, but be tolerant of an
          // array or a bare object so one odd response can't crash the run.
          const raw = (res.body ?? {}) as Record<string, unknown>;
          const dist = raw.dist ?? raw;
          const d = (Array.isArray(dist) ? (dist[0] ?? {}) : (dist ?? {})) as Record<string, unknown>;
          if (sample.length < 2) sample.push(d);            // so we can see the real shape

          const isSettled = d.settle === true || String(d.settle).toLowerCase() === "true";
          if (!isSettled) { notYet++; continue; }

          const cpr = d.cprNumber_1 ?? d.cprNumber_2 ?? null;
          const { data, error } = await db.from("online_logistics").update({
            payment_status: "Paid",
            payment_date: day(d.settlementDate) ?? day(d.upfrontPaymentDate) ?? day(d.reservePaymentDate),
            cpr_number: cpr ? String(cpr) : null,
          }).eq("tracking_id", tn).select("id");
          if (error) { errors.push(`${tn}: ${error.message}`); continue; }
          settled += (data ?? []).length;
        } catch (err) {
          errors.push(`${tn}: ${String(err)}`);             // never let one row kill the batch
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      return json({ ok: true, action, checked: nums.length, settled,
                    not_settled_yet: notYet, errors: errors.slice(0, 10), sample_response: sample });
    }

    // ---------------------------------------------------------------
    // BOOK — create an order at PostEx, store the tracking number
    // ---------------------------------------------------------------
    if (action === "postex_book") {
      const o = body.order ?? {};
      for (const f of ["orderRefNumber", "customerName", "customerPhone", "deliveryAddress", "cityName", "invoicePayment"]) {
        if (!o[f]) return json({ error: `missing required field: ${f}` }, 400);
      }
      const res = await px(`${B}/v3/create-order`, token, {
        method: "POST",
        body: JSON.stringify({
          orderRefNumber: String(o.orderRefNumber), invoicePayment: Number(o.invoicePayment),
          customerName: String(o.customerName), customerPhone: String(o.customerPhone),
          deliveryAddress: String(o.deliveryAddress), cityName: String(o.cityName),
          orderDetail: o.orderDetail ?? "", transactionNotes: o.transactionNotes ?? "",
          invoiceDivision: Number(o.invoiceDivision ?? 1), items: Number(o.items ?? 1),
          orderType: o.orderType ?? "Normal",
          ...(o.pickupAddressCode ? { pickupAddressCode: String(o.pickupAddressCode) } : {}),
        }),
      });
      if (!res.ok) return json({ error: "PostEx refused the booking", status: res.status, detail: res.body }, 502);
      const d = ((res.body as { dist?: unknown })?.dist ?? {}) as Record<string, unknown>;
      const tracking = String(d.trackingNumber ?? "");
      if (!tracking) return json({ error: "no tracking number returned", detail: res.body }, 502);

      await db.from("online_logistics").upsert({
        tracking_id: tracking, order_number: String(o.orderRefNumber), store_code: store,
        courier: "PostEx", delivery_status: "In Transit", status: String(d.orderStatus ?? "UnBooked"),
        dispatch_date: new Date().toISOString().slice(0, 10),
        cod_amount: Number(o.invoicePayment), payment_status: "Pending",
      }, { onConflict: "tracking_id" });

      return json({ ok: true, action, tracking_number: tracking, order_status: d.orderStatus ?? null });
    }

    // ---------------------------------------------------------------
    // LOAD SHEET — the PDF, generated for a set of tracking numbers
    // ---------------------------------------------------------------
    if (action === "postex_loadsheet") {
      const nums: string[] = body.trackingNumbers ?? [];
      if (!nums.length) return json({ error: "trackingNumbers required" }, 400);
      const r = await fetch(`${B}/v2/generate-load-sheet`, {
        method: "POST", headers: { token, "content-type": "application/json" },
        body: JSON.stringify({ trackingNumbers: nums, ...(body.pickupAddress ? { pickupAddress: body.pickupAddress } : {}) }),
      });
      if (!r.ok) return json({ error: `PostEx HTTP ${r.status}`, detail: await r.text() }, 502);
      const pdf = await r.arrayBuffer();                       // hand the PDF straight back
      return new Response(pdf, { status: 200, headers: { ...CORS, "content-type": "application/pdf",
        "content-disposition": `attachment; filename="loadsheet-${new Date().toISOString().slice(0,10)}.pdf"` } });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
