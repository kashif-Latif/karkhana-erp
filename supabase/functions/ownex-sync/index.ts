// Supabase Edge Function: ownex-sync   (Karkhana — ozkhkhlwjblzgwmjbdde)
// Deploy with --no-verify-jwt ; auth enforced manually below.
//
// HOW OWNEX WORKS FOR US
//   OwnEx never sent API documentation, and their merchant portal runs on
//   Next.js Server Actions that cannot be called from outside. But their PUBLIC
//   tracking endpoint is open, unauthenticated, and returns clean JSON:
//
//     GET https://shipper.ownexpress.pk/api/v1/public/booking/status/{trackingId}
//
//   Found by watching the tracker on ownexpress.pk — not by guessing. The path
//   sits three levels deeper than any candidate we probed, which is exactly why
//   endpoints get tested rather than assumed.
//
// WHAT THIS GIVES US
//   * live delivery status for every OwnEx parcel, on the same nightly schedule
//     as PostEx — no token, no support ticket
//   * the full movement history and station routing
//   NOT COD settlement — the public endpoint carries no money fields. Settlement
//   still comes from the invoice export via Smart import.
//
// OWNERSHIP RULE
//   The courier's own system is authoritative for WHERE a parcel is, so it may
//   correct delivery_status. It knows nothing about money, so payment_status,
//   cpr_number and cpr_net_amount are never touched here.
//
// DIRECTION IS READ FROM HISTORY, NOT FROM THE CURRENT STATUS  ← new
//   OwnEx reuses `transit-received` and `in-transit` on BOTH legs. Verified on
//   parcel 312010001714: transit-received at Karachi on 08 Aug (outbound) and
//   transit-received at Lahore on 22 Aug (return) — same code, opposite meaning.
//
//   Worse, the unambiguous return codes are transient. On that parcel:
//       13:34 return_requested · 13:50 return-pbag · 14:00 in-transit
//       15:25 transit-received
//   The RTS signal was the current status for 16 minutes against a 45-minute
//   stale window. Polling currentStatus alone can miss it entirely, which is
//   exactly how 34 parcels ended up sitting in the forward bucket while the
//   OwnEx portal counted them as returns.
//
//   So the return leg is now derived from the history array and stored ONCE in
//   return_leg_started_at (migration 0059). Direction becomes a recorded fact
//   instead of something re-guessed from whatever code happens to be current.
//
// THE REASON WAS ALWAYS THERE — WE WERE DISCARDING IT   (migration 0076)
//   Every history entry carries a `description` alongside its status:
//
//       {"status":"Verifying Reason","code":"debrief",
//        "description":"UNTRACEABLE ADDRESS"}
//
//   This function read that array for direction detection, kept "Verifying
//   Reason" in raw_status and threw the description away. "Verifying Reason" is
//   the courier saying it has not decided yet — the ABSENCE of a reason. The
//   description beside it is the reason, and it now lands in
//   online_logistics.courier_reason_text.
//
//   Only codes that explain something are read: debrief, reason, reattempt and
//   the return stages. Movement codes carry station names in `description`, and
//   "Lahore Hub" is not a reason a parcel came back.
//
//   The column is never nulled. A parcel that moves again after a debrief must
//   not lose the finding — a reason once given is not un-given.
//
// ACTIONS
//   discover_codes      sample parcels, report every status code AND every
//                       reason wording seen, write nothing
//   track               refresh parcels still in motion  (the scheduled job)
//   backfill_return_leg one-off: stamp direction on parcels already misfiled

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

const TRACK_URL = (id: string) =>
  `https://shipper.ownexpress.pk/api/v1/public/booking/status/${encodeURIComponent(id)}`;

/* `description` is the field this function used to drop on the floor. In the
   history array it is where the courier writes what actually went wrong:

     {"status":"Verifying Reason","code":"debrief",
      "description":"UNTRACEABLE ADDRESS"}

   "Verifying Reason" is the status — the courier saying it has not decided.
   "UNTRACEABLE ADDRESS" is the reason. We kept the first and discarded the
   second, which is why the Returns page had nothing better than tags to show. */
type Hist = { code: string; status: string; date: string; description?: string };
type Tracked = {
  trackingId: string; ok: boolean;
  code?: string; status?: string; date?: string; route?: string;
  description?: string;
  history?: Hist[]; error?: string;
};

async function trackOne(id: string): Promise<Tracked> {
  try {
    const r = await fetch(TRACK_URL(id), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { trackingId: id, ok: false, error: `http ${r.status}` };
    const j = await r.json();
    if (!j?.success || !j?.data) return { trackingId: id, ok: false, error: "not found" };
    const d = j.data;
    const cs = d.currentStatus ?? {};
    const from = cs.details?.fromStation?.name;
    const to = cs.details?.transitStation?.name ?? cs.details?.toStation?.name;
    return {
      trackingId: id, ok: true,
      code: String(cs.code ?? "").toLowerCase(),
      status: String(cs.status ?? ""),
      date: cs.date ?? undefined,
      route: from && to ? `${from} -> ${to}` : from || undefined,
      description: cs.description ? String(cs.description) : undefined,
      history: (d.history ?? []).map((h: { code?: string; status?: string; date?: string; description?: string }) => ({
        code: String(h.code ?? "").toLowerCase(), status: String(h.status ?? ""), date: h.date ?? "",
        description: h.description ? String(h.description) : undefined,
      })),
    };
  } catch (e) {
    return { trackingId: id, ok: false, error: String(e).slice(0, 120) };
  }
}

/* The complete OwnEx vocabulary, read from 150 live parcels via discover_codes
   — every code below was observed, none assumed. Their own labels are kept in
   the comments so the mapping can be checked at a glance. */
const CODE_MAP: Record<string, { status: string; attempt?: boolean }> = {
  // ---- moving (direction UNKNOWN from the code alone) -------------------
  unbooked:           { status: "In Transit" },   // Unbooked
  booked:             { status: "In Transit" },   // Booked
  arrived:            { status: "In Transit" },   // Arrived
  pbag:               { status: "In Transit" },   // Preparing Transit
  "in-transit":       { status: "In Transit" },   // In-Transit        ← both legs
  "transit-received": { status: "In Transit" },   // Transit Received  ← both legs
  "de-manifested":    { status: "In Transit" },   // Ready for Delivery
  "en-route":         { status: "In Transit" },   // Out for Delivery

  // ---- delivery was attempted and failed -------------------------------
  // still in transit, but the customer refused or was unavailable. Flagged so
  // these parcels surface for chasing instead of sitting quietly as "moving".
  debrief:   { status: "In Transit", attempt: true },   // Verifying Reason
  reason:    { status: "In Transit", attempt: true },   // Reason / Waiting for Advice
  reattempt: { status: "In Transit", attempt: true },   // Ready for Re-Attempt

  // ---- coming back -----------------------------------------------------
  // STAGES of a return, not a completed one: the parcel is on its way back but
  // not yet received, so it is RTS rather than Returned. These are transient —
  // see the header note. Presence in HISTORY is what counts, not currency.
  return_requested:       { status: "RTS" },      // Return In Progress
  "return-pbag":          { status: "RTS" },      // Preparing Transit (return leg)
  "return-de-manifested": { status: "RTS" },      // Waiting for Submission

  // ---- finished --------------------------------------------------------
  delivered: { status: "Delivered" },             // Delivered
  returned:  { status: "Returned" },              // Returned — back with us
};

function mapCode(code: string): { status: string; certain: boolean; attempt: boolean } {
  const hit = CODE_MAP[code];
  if (hit) return { status: hit.status, certain: true, attempt: !!hit.attempt };
  // OwnEx may add codes later. These patterns are a best guess, so they are
  // marked NOT certain — the parcel still gets flagged for review rather than
  // quietly accepted. Flag, never guess.
  if (/^deliver/.test(code)) return { status: "Delivered", certain: false, attempt: false };
  if (/^return|^rts/.test(code)) return { status: "RTS", certain: false, attempt: false };
  if (/cancel|expire/.test(code)) return { status: "Cancelled", certain: false, attempt: false };
  return { status: "In Transit", certain: false, attempt: false };
}

/* Both separators are real: `return_requested` uses an underscore,
   `return-pbag` a hyphen. Matching one and not the other loses half the signal. */
const isReturnCode = (c: string) => /^return[-_]/.test(c ?? "");

/** The first moment the courier put this parcel on the return leg, or null. */
function returnLegStart(history?: Hist[]): string | null {
  const hit = (history ?? []).find((h) => isReturnCode(h.code));
  return hit?.date || null;
}

/* ---------------------------------------------------------------------------
   THE COURIER'S REASON

   Codes that carry an explanation. `debrief` is the important one — it is the
   entry that holds "UNTRACEABLE ADDRESS" — but a return stage can carry one too.
   Movement codes (in-transit, arrived, transit-received) describe geography, not
   cause, and their descriptions are station names. Reading those would put
   "Lahore Hub" in front of the team as a reason for the parcel coming back.
--------------------------------------------------------------------------- */
const REASON_CODES = new Set([
  "debrief", "reason", "reattempt",
  "return_requested", "return-pbag", "return-de-manifested", "returned",
]);

/* Descriptions that are not explanations. The courier does write these, and
   showing them is worse than showing nothing, because a placeholder in the
   reason column reads as an answer. */
const EMPTY_REASON = /^(n\/?a|none|null|-+|verifying reason|reason|pending|no reason)$/i;

function cleanReason(v: unknown): string {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!s || s.length < 3 || EMPTY_REASON.test(s)) return "";
  return s.slice(0, 200);
}

/** The courier's own explanation for this parcel, or null if it has not given
 *  one. Never invents; an absent reason stays absent. */
function courierReason(t: Tracked): string | null {
  // Newest first. The history array's order is the courier's, not ours, so it
  // is sorted rather than trusted — the most recent finding is the live one.
  const hist = [...(t.history ?? [])].sort((a, b) =>
    String(b.date ?? "").localeCompare(String(a.date ?? "")));

  for (const h of hist) {
    if (REASON_CODES.has(h.code)) {
      const r = cleanReason(h.description);
      if (r) return r;
    }
  }
  // The current status may carry one the history has not caught up with.
  const cur = cleanReason(t.description);
  if (cur && cur.toLowerCase() !== String(t.status ?? "").toLowerCase()) return cur;

  return null;
}

/** small waves, so we stay polite to a public endpoint */
async function inWaves(ids: string[], size: number, deadline: number) {
  const out: Tracked[] = [];
  for (let i = 0; i < ids.length; i += size) {
    if (Date.now() > deadline) break;
    out.push(...await Promise.all(ids.slice(i, i + size).map(trackOne)));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const key = req.headers.get("x-sync-key") ?? "";
    let allowed = !!key && key === (Deno.env.get("SYNC_KEY") ?? "\u0000");
    if (!allowed) {
      const tok = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!tok) return json({ error: "unauthorized" }, 401);
      const { data, error } = await db.auth.getUser(tok);
      if (error || !data?.user) return json({ error: "unauthorized" }, 401);
      allowed = true;
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "track";
    const limit = Math.min(Number(body.limit) || 200, 1000);
    const wave = Math.min(Number(body.concurrency) || 5, 10);
    const deadline = Date.now() + Math.min(Number(body.max_seconds) || 60, 140) * 1000;

    /* ============ discover_codes — read-only vocabulary check ============ */
    if (action === "discover_codes") {
      let ids: string[] = body.tracking_ids ?? [];
      if (!ids.length) {
        // sample newest first; their history rows reveal delivered / returned
        const { data } = await db.from("online_logistics")
          .select("tracking_id")
          .eq("courier", "OwnEx").not("tracking_id", "is", null)
          .order("dispatch_date", { ascending: false, nullsFirst: false })
          .limit(limit);
        ids = (data ?? []).map((r: { tracking_id: string }) => r.tracking_id);
      }
      const results = await inWaves(ids, wave, deadline);

      const codes: Record<string, { seen: number; label: string; reasons: Record<string, number> }> = {};
      let failed = 0;
      for (const t of results) {
        if (!t.ok) { failed++; continue; }
        const all: { code: string; status: string; description?: string }[] = [
          { code: t.code ?? "", status: t.status ?? "", description: t.description },
          ...(t.history ?? []),
        ];
        for (const h of all) {
          if (!h.code) continue;
          codes[h.code] = codes[h.code] ?? { seen: 0, label: h.status, reasons: {} };
          codes[h.code].seen++;
          // The descriptions, grouped by the code that carried them. This is
          // read-only evidence: run it and you can see "UNTRACEABLE ADDRESS"
          // sitting under `debrief` before anything is written anywhere.
          const r = cleanReason(h.description);
          if (r) codes[h.code].reasons[r] = (codes[h.code].reasons[r] ?? 0) + 1;
        }
      }
      const table = Object.entries(codes)
        .sort((a, b) => b[1].seen - a[1].seen)
        .map(([code, v]) => ({
          code, label: v.label, seen: v.seen,
          maps_to: mapCode(code).status, certain: mapCode(code).certain,
          carries_reason: REASON_CODES.has(code),
          reasons: Object.entries(v.reasons).sort((a, b) => b[1] - a[1]).slice(0, 12)
                         .map(([text, n]) => ({ text, n })),
        }));
      const unmapped = table.filter((r) => !r.certain).map((r) => r.code);

      return json({
        ok: true, checked: results.length, failed, codes: table, unmapped,
        note: unmapped.length
          ? "These codes are not understood yet — send them to me and I will map them properly."
          : "Every code in circulation is understood.",
      });
    }

    /* ============ track — the scheduled refresh ==========================
       ALSO the one-off backfill: `backfill_return_leg` runs the same logic but
       widens the selection to parcels that were already misfiled, and does not
       apply the stale window. */
    if (action === "track" || action === "backfill_return_leg") {
      const backfill = action === "backfill_return_leg";

      // Every UPDATE fires a Realtime event to every open browser tab, so
      // rewriting identical rows costs egress twice: once to the courier, once
      // to every watching browser. Skip the write when nothing changed.
      const priorStatus = new Map<string, string | null>();
      // ...and what reason we already hold. Without this, the "nothing changed"
      // shortcut below would skip the write on a parcel whose status is steady
      // but whose reason has only just arrived — which is most of them, since a
      // debrief entry appears while the code stays put.
      const priorReason = new Map<string, string | null>();

      let ids: string[] = body.tracking_ids ?? [];
      if (!ids.length) {
        // Only parcels still moving — settled ones need no re-checking.
        //
        // NOTE: RTS is deliberately NOT excluded. A parcel on the return leg is
        // still travelling; excluding it meant it could never progress to
        // Returned, so the returned count could only ever grow through imports.
        // This is safe ONLY because direction now comes from history: without
        // that, the next poll would read `transit-received`, call it In Transit
        // and wipe the return flag.
        const terminal = '("Delivered","Returned","Cancelled")';

        let q = db.from("online_logistics")
          .select("tracking_id, raw_status, courier_reason_text")
          .eq("courier", "OwnEx").not("tracking_id", "is", null);

        if (backfill) {
          // Everything not finally settled, plus anything already claiming to be
          // returned that no one has physically received yet — those include the
          // rows Smart import filed as Returned off a portal label.
          q = q.not("delivery_status", "in", '("Delivered","Cancelled")')
               .is("return_received_at", null);
        } else {
          q = q.not("delivery_status", "in", terminal);
          const staleMinutes = Number(body.stale_minutes ?? 45);
          if (staleMinutes > 0) {
            const cutoff = new Date(Date.now() - staleMinutes * 60000).toISOString();
            q = q.or(`updated_at.is.null,updated_at.lt.${cutoff}`);
          }
        }

        const { data } = await q
          .order("updated_at", { ascending: true, nullsFirst: true })
          .limit(limit);
        ids = (data ?? []).map((r: { tracking_id: string }) => r.tracking_id);
        // remember what we already hold, so an unchanged parcel is not rewritten
        for (const r of (data ?? []) as
             { tracking_id: string; raw_status?: string | null; courier_reason_text?: string | null }[]) {
          priorStatus.set(r.tracking_id, r.raw_status ?? null);
          priorReason.set(r.tracking_id, r.courier_reason_text ?? null);
        }
      }
      if (!ids.length) return json({ ok: true, checked: 0, note: "Nothing due a refresh — every parcel in transit was checked recently." });

      const results = await inWaves(ids, wave, deadline);
      const dryRun = body.dry_run === true;

      let updated = 0, unchanged = 0, flagged = 0, failed = 0, attempts = 0;
      let returnLegFound = 0, directionCorrected = 0, rescued = 0;
      let reasonsFound = 0, reasonsNew = 0;
      const reasonSamples: Record<string, unknown>[] = [];
      const nowShowing: Record<string, number> = {};
      const corrections: Record<string, unknown>[] = [];
      const events: Record<string, unknown>[] = [];

      for (const t of results) {
        if (!t.ok) { failed++; continue; }
        const m = mapCode(t.code ?? "");
        let status = m.status;
        const certain = m.certain;
        const attempt = m.attempt;

        // ---- direction, from history ------------------------------------
        const legStart = returnLegStart(t.history);
        if (legStart) returnLegFound++;

        // A parcel that has ever been put on the return leg is coming back,
        // even though the current code (transit-received / in-transit / arrived)
        // is identical to an outbound movement.
        //
        // Terminal codes still win: `delivered` means the return was cancelled
        // and the parcel was rescued; `returned` means it is physically back.
        if (legStart && status === "In Transit") {
          status = "RTS";
          directionCorrected++;
          corrections.push({ tracking_id: t.trackingId, was: t.status, now: "RTS", leg_started: legStart });
        }
        if (legStart && status === "Delivered") rescued++;

        // ---- the courier's own explanation, if it has given one ----------
        const reason = courierReason(t);
        if (reason) {
          reasonsFound++;
          if (reasonSamples.length < 20) reasonSamples.push({ tracking_id: t.trackingId, reason, status: t.status });
        }
        // Only NEW information counts as a change worth writing.
        const reasonIsNew = !!reason && reason !== priorReason.get(t.trackingId);
        if (reasonIsNew) reasonsNew++;

        if (!certain) flagged++;
        if (attempt) attempts++;
        nowShowing[status] = (nowShowing[status] ?? 0) + 1;
        events.push({ tracking_id: t.trackingId, courier: "OwnEx", raw_status: t.status ?? t.code ?? "" });
        if (dryRun) continue;

        // unchanged status, direction already recorded, no new reason — nothing to write
        if (priorStatus.get(t.trackingId) === (t.status ?? null) && !legStart && !reasonIsNew) {
          unchanged++; continue;
        }

        const patch: Record<string, unknown> = {
          delivery_status: status,
          raw_status: t.status ?? t.code ?? null,
          needs_review: !certain,
          // Set explicitly. The stale-window rotation orders and filters on this
          // column, so if nothing writes it the same rows are polled forever and
          // the tail is never reached.
          updated_at: new Date().toISOString(),
        };

        if (legStart) {
          // History is immutable — the first return event never changes date, so
          // writing it every time is idempotent. It also upgrades the rows that
          // migration 0059 seeded with an approximate timestamp.
          patch.return_leg_started_at = legStart;
          patch.return_leg_source = "history";
        }

        // Only ever written when we HAVE one. A later movement that carries no
        // description must not erase the finding that came before it — a reason
        // once given is not un-given.
        if (reason) patch.courier_reason_text = reason;

        if (status === "Delivered" && t.date) patch.delivery_date = String(t.date).slice(0, 10);
        if (!certain) patch.review_status = `unmapped OwnEx code: ${t.code}`;
        // a failed attempt is worth seeing — the team can call the customer
        if (attempt) patch.rts_reason = `OwnEx: ${t.status}${t.route ? ` (${t.route})` : ""}`;
        if (status === "RTS" || status === "Returned") patch.rts = "Yes";
        // a rescued parcel is no longer an RTS — clear the flag rather than
        // leaving a stale "Yes" behind it
        if (status === "Delivered") patch.rts = null;

        const { data } = await db.from("online_logistics")
          .update(patch)
          .eq("tracking_id", t.trackingId).eq("courier", "OwnEx")
          .select("id");
        if ((data ?? []).length) updated++; else unchanged++;
      }

      if (!dryRun && events.length) await db.from("online_courier_events").insert(events.slice(0, 1000));

      return json({
        ok: true, action, dry_run: dryRun,
        requested: ids.length, checked: results.length,
        updated, not_found: unchanged, failed,
        flagged_unknown_code: flagged,
        failed_delivery_attempts: attempts,
        on_return_leg: returnLegFound,
        direction_corrected: directionCorrected,
        rescued_after_return_started: rescued,
        // The point of this run: how many parcels the courier has actually
        // explained, and how many of those explanations are new to us.
        courier_reasons_seen: reasonsFound,
        courier_reasons_new: reasonsNew,
        reason_samples: reasonSamples,
        corrections: corrections.slice(0, 50),
        now_showing: nowShowing,
        stopped_early: results.length < ids.length ? "time budget — run again to continue" : undefined,
      });
    }

    return json({ error: "unknown action — use discover_codes, track or backfill_return_leg" }, 400);
  } catch (e) {
    const err = e as Error;
    return json({ error: err?.message ?? String(e), stack: (err?.stack ?? "").split("\n").slice(0, 5) }, 500);
  }
});
