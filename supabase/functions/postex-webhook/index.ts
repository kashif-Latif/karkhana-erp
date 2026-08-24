// Karkhana — PostEx status webhook
//
// Deploy to the KARKHANA project with VERIFY JWT OFF, then point PostEx's
// "Status Updates Webhook" at:
//   https://ozkhkhlwjblzgwmjbdde.supabase.co/functions/v1/postex-webhook
//
// IT IS CURRENTLY POINTED AT THE OLD LITTLE MINORS PROJECT. Until that URL is
// changed, PostEx pushes nothing here and status can only ever be as fresh as
// the 10-minute poll.
//
// WHAT CHANGED IN THIS VERSION
//   1. RETURN DIRECTION. A parcel on its way back is RTS; only one that is
//      physically back is Returned. The old classifier collapsed both into
//      Returned, which is the same fault migrations 0059/0060 fixed for OwnEx —
//      and it is worse here, because a parcel wrongly marked Returned stops
//      anyone chasing it.
//   2. OUT-OF-ORDER PROTECTION. Webhooks retry and can arrive late. A stale
//      "In Transit" must never overwrite a Delivered that already landed.
//   3. EVERY EVENT LOGGED, even unmatched ones. Migration 0063 added a trigger
//      that drops an event whose status matches the last one, so the log now
//      records CHANGES rather than noise.
//
// SECRETS
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-provided)
//   POSTEX_WEBHOOK_SECRET                     (optional but recommended)

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

/** PostEx's free-text status -> our states.
 *
 *  The order of these tests is the whole point. "Return In Transit" contains
 *  both "return" and "transit"; testing for a finished return first would file
 *  a parcel that is still travelling as already back with us. Returning stages
 *  are therefore matched BEFORE the plain return test.
 *
 *  The patterns mirror is_returning() in migration 0060, so the webhook and the
 *  dashboard cannot disagree about what "coming back" means. */
function classify(raw: string): { delivery_status: string; needs_review: boolean } {
  const s = (raw || "").toLowerCase().trim();

  if (/delivered/.test(s))                   return { delivery_status: "Delivered", needs_review: false };
  if (/cancel|expired|un-?assigned/.test(s)) return { delivery_status: "Cancelled", needs_review: false };

  // ---- coming back, not yet back ----
  if (/return[ _-]?(requested|initiated|in[ _-]?progress|in[ _-]?transit|to[ _-]?shipper)|out[ _-]?for[ _-]?return|returning/.test(s))
                                             return { delivery_status: "RTS", needs_review: false };

  // ---- physically back with us ----
  if (/returned|\brts\b|return[ _-]?received/.test(s))
                                             return { delivery_status: "Returned", needs_review: false };

  // everything still moving. Includes wordings the v4.1.9 PDF never lists but
  // the live API really sends: Transferred, In Stock, Ready for Delivery,
  // In-Transit (hyphenated), and "Reason - REFUSED TO RECEIVE".
  if (/unbooked|booked|warehouse|in stock|transferred|ready for delivery|out for delivery|picked|attempt|refus|en.?route|in.?transit|transit|on root|under review|shipper advice|hold/.test(s))
                                             return { delivery_status: "In Transit", needs_review: false };

  return { delivery_status: "In Transit", needs_review: true };   // truly unknown -> flag, never guess
}

/** How far along a parcel is. A webhook that arrives late must not drag a
 *  parcel backwards — PostEx retries, and retries can land out of order. */
const RANK: Record<string, number> = {
  "In Transit": 1, "RTS": 2, "Returned": 3, "Cancelled": 3, "Delivered": 4,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // optional shared-secret check
    const expected = Deno.env.get("POSTEX_WEBHOOK_SECRET");
    if (expected) {
      const got = req.headers.get("x-webhook-secret");
      if (got !== expected) return json({ error: "forbidden" }, 403);
    }

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const p = await req.json().catch(() => ({}));

    const trackingId = p.trackingNumber || p.tracking_number || p.trackingId || p.cn;
    const rawStatus  = p.transactionStatus || p.status || p.orderStatusMessage || p.transactionStatusMessage;

    // always log the raw event first — even if we cannot match it. The dedup
    // trigger from 0063 drops it if the status has not actually changed.
    await db.from("online_courier_events").insert({
      courier: "PostEx",
      tracking_id: trackingId ? String(trackingId) : null,
      raw_status: rawStatus ? String(rawStatus) : null,
      payload: { source: "webhook", ...p },
    });

    if (!trackingId || !rawStatus) return json({ error: "missing trackingNumber or status", received: p }, 400);

    const { delivery_status, needs_review } = classify(String(rawStatus));
    const today = new Date().toISOString().slice(0, 10);

    // ---- refuse to move a parcel backwards ----
    const { data: current } = await db.from("online_logistics")
      .select("delivery_status").eq("tracking_id", String(trackingId)).maybeSingle();

    if (current) {
      const was = RANK[String(current.delivery_status)] ?? 0;
      const now = RANK[delivery_status] ?? 0;
      if (now < was) {
        return json({
          success: true, matched: true, applied: false,
          note: `late webhook ignored — parcel is already ${current.delivery_status}`,
          tracking_id: trackingId, incoming: rawStatus,
        });
      }
    }

    const upd: Record<string, unknown> = {
      delivery_status, needs_review, raw_status: String(rawStatus),
      updated_at: new Date().toISOString(),
    };
    if (needs_review) upd.review_status = String(rawStatus);
    if (delivery_status === "Delivered" || delivery_status === "Returned") upd.delivery_date = today;
    if (delivery_status === "RTS" || delivery_status === "Returned") {
      upd.rts = "Yes";
      upd.rts_reason = `PostEx: ${rawStatus}`;
    }
    // a parcel that was rescued is no longer an RTS — clear the flag rather
    // than leaving a stale "Yes" behind it
    if (delivery_status === "Delivered") upd.rts = null;

    const { data, error } = await db.from("online_logistics")
      .update(upd).eq("tracking_id", String(trackingId))
      .select("order_number, store_code, tracking_id");
    if (error) throw error;

    if (!data || data.length === 0) {
      return json({ success: true, matched: false, note: "no shipment with that tracking number yet", tracking_id: trackingId });
    }

    // refresh the customer's risk rating from their full delivery history
    const orderNum = data[0].order_number;
    if ((delivery_status === "Delivered" || delivery_status === "Returned") && orderNum) {
      const { data: o } = await db.from("online_orders").select("phone").eq("order_number", orderNum).limit(1).maybeSingle();
      if (o?.phone) {
        const { data: theirOrders } = await db.from("online_orders").select("order_number").eq("phone", o.phone);
        const nums = (theirOrders ?? []).map((x: { order_number: string }) => x.order_number);
        if (nums.length) {
          const { data: logs } = await db.from("online_logistics").select("delivery_status").in("order_number", nums);
          const delivered = (logs ?? []).filter((l: { delivery_status: string }) => l.delivery_status === "Delivered").length;
          const returned  = (logs ?? []).filter((l: { delivery_status: string }) => l.delivery_status === "Returned").length;
          const rating = returned >= 2 ? "High RTS Risk"
                       : (delivered >= 2 && returned === 0) ? "Trusted Customer"
                       : (delivered + returned > 0) ? "Returning" : "New";
          await db.from("online_orders").update({ customer_rating: rating }).eq("phone", o.phone);
        }
      }
    }

    return json({ success: true, matched: true, applied: true, tracking_id: trackingId,
                  order_number: orderNum, classified: delivery_status, needs_review });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
