-- 0079_clean_reason_rows.sql
--
-- CLEANING UP AFTER MY OWN BUG.
--
-- The first ownex-sync fell back to currentStatus.description when no history
-- entry carried a reason. That field holds the LEG the parcel is on, not why it
-- failed, so 20 parcels ended up with this in their reason column:
--
--     Lahore <i class="ri-arrow-right-line"></i> Karachi
--
-- A route, complete with the icon markup. The function even carried a comment
-- saying a station name is not a reason; the fallback contradicted it.
--
-- Two things wrong, fixed in two places:
--   the SYNC no longer reads that field at all, and rejects markup and
--   route-shaped strings if it ever meets one elsewhere (deployed separately);
--   this migration clears the rows already written.
--
-- Also strips the courier's own label: "Verified Reason CNA" is the finding CNA
-- with a heading in front of it, and the heading is not part of the answer.
--
-- Safe to run more than once. Requires 0076.

begin;

-- 1. Anything carrying HTML is a route, not a reason. Clear it — do not try to
--    salvage the text, because "Lahore Karachi" with the tags stripped looks
--    like a reason and is not one.
update online_logistics
   set courier_reason_text = null
 where courier_reason_text ~ '<[^>]+>';

-- 2. Route-shaped, without markup: "Lahore -> Karachi", "Multan → Sukkur".
update online_logistics
   set courier_reason_text = null
 where courier_reason_text ~ '^[^<>]{2,30}\s*(->|-->|→|=>|»)\s*[^<>]{2,30}$';

-- 3. Strip the courier's label. "Verified Reason CNA" -> "CNA".
update online_logistics
   set courier_reason_text = btrim(
         regexp_replace(courier_reason_text, '^\s*verif(y|ie)(ing|d)\s+reason\s*[:\-–]?\s*', '', 'i'))
 where courier_reason_text ~* '^\s*verif(y|ie)(ing|d)\s+reason'
   and btrim(regexp_replace(courier_reason_text, '^\s*verif(y|ie)(ing|d)\s+reason\s*[:\-–]?\s*', '', 'i')) <> '';

-- 4. "Verifying Reason" with nothing after it is the ABSENCE of a reason —
--    the courier saying it has not decided. Step 3 leaves those as an empty
--    string; they become null here.
update online_logistics
   set courier_reason_text = null
 where courier_reason_text is not null
   and (btrim(courier_reason_text) = ''
     or btrim(courier_reason_text) ~* '^(verif(y|ie)(ing|d) reason|reason|pending|no reason|n/?a|none|null|-+)$'
     or length(btrim(courier_reason_text)) < 3);

commit;

-- ===========================================================================
-- VERIFY — no markup, no arrows, no bare labels.
-- ===========================================================================
-- select courier, courier_reason_text, count(*)
--   from online_logistics
--  where courier_reason_text is not null
--  group by 1,2 order by 3 desc limit 30;
--
-- -- Must return 0 rows:
-- select count(*) from online_logistics
--  where courier_reason_text ~ '<[^>]+>'
--     or courier_reason_text ~ '(->|→|=>)'
--     or courier_reason_text ~* '^verif';
--
-- ===========================================================================
-- STILL UNANSWERED: what do RFD and CNA stand for?
--
-- The database now hints at both, which is not the same as knowing:
--   CNA  appears beside "CONSIGNEE NOT AVAILABLE" in the same column
--   RFD  appears beside "REFUSED TO RECEIVE"
--
-- Plausible is not good enough to print in front of the team, and RFD is the
-- most common reason you have. Ask both couriers, then expand here:
--
--   update online_logistics set courier_reason_text = '<their words>'
--    where courier_reason_text in ('RFD');
-- ===========================================================================
