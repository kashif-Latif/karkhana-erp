-- 0078_reason_backfill_corrected.sql
--
-- 0076 RECOVERED ZERO ROWS. THIS IS WHY.
--
-- 0076 assumed PostEx welded its reason onto the status behind a marker:
--     "Reason - REFUSED TO RECEIVE"
-- and extracted the text after "Reason - ". No row in this database looks like
-- that, so the UPDATE matched nothing and the Returns page stayed empty.
--
-- The assumption was inherited from a handoff note and never checked against
-- the data. The data says the reasons are already there, sitting BARE in
-- rts_reason with no marker at all:
--
--     rts_reason                                       parcels
--     ------------------------------------------------ -------
--     RFD                                                  345   (201 PX + 144 OX)
--     REFUSED TO RECEIVE                                    20
--     Wrong Address                                         13
--     Late Delivery                                          6
--     Return Requested / Return Initiated                   20
--     CONSIGNEE NOT AVAILABLE                                1
--     NO SUCH CONSIGNEE                                      1
--     CONTACT NOT ESTABLISHED DELIVERY NOT ARRANGED          1
--     HOLD ON CONSIGNEE REQUEST                              1
--     Shipper Advice                                         1
--
-- Mixed in with them, in the same column, is our own status echo:
--
--     PostEx: Returned          1,610      <- not a reason
--     PostEx: Attempted            46      <- not a reason
--     PostEx: Out For Return       21      <- not a reason
--     OwnEx: Verifying Reason      33      <- the ABSENCE of a reason
--     OwnEx: Waiting for Advice    12      <- the absence of a reason
--
-- THE RULE, and it is this simple:
--     a "COURIER: " prefix means WE wrote it, echoing a status.
--     no prefix means the COURIER wrote it, and it is a reason.
--
-- Safe to run more than once. Requires 0076 (for the column).

begin;

-- ---------------------------------------------------------------------------
-- The backfill 0076 should have been.
-- ---------------------------------------------------------------------------
update online_logistics
   set courier_reason_text = btrim(rts_reason)
 where courier_reason_text is null
   and rts_reason is not null
   -- our own echo: "PostEx: Returned", "OwnEx: Verifying Reason"
   and rts_reason !~* '^\s*(postex|ownex)\s*:'
   -- and the same non-answers should they ever appear unprefixed
   and btrim(rts_reason) !~* '^(verifying reason|waiting for advice|reason|pending|n/?a|none|null|unknown|-+)$'
   and length(btrim(rts_reason)) >= 3;

-- ---------------------------------------------------------------------------
-- FIX hub_returns_reason_coverage — it was scoring junk as an explanation.
--
-- It reported "2,378 of 2,672 returns explained by agent". Ten samples, all
-- ten identical:
--
--     order #8557 · agent_note "RTS" · tags "Call Confirmed · PostEx"
--
-- "RTS" is a three-letter code meaning return-to-sender. It restates the status
-- and explains nothing. Counting it as an explanation made a broken page look
-- 89% healthy, which is worse than reporting nothing at all — it is a test that
-- passes on noise, and it hid the exact complaint it was built to measure.
--
-- A note has to be a SENTENCE to count: more than one word, and not a status
-- code wearing a note's clothing.
-- ---------------------------------------------------------------------------
create or replace function is_real_note(p_text text)
returns boolean
language sql
immutable
as $function$
  select p_text is not null
     and length(btrim(p_text)) >= 8
     -- at least two words. "RTS", "Returned", "Cancelled" are one.
     and btrim(p_text) ~ '\s'
     -- known codes and status echoes, whole-string only, so a real sentence
     -- that happens to contain the word "returned" still counts.
     and btrim(p_text) !~* '^(rts|rtd|rfd|return|returned|cancel|cancelled|delivered|n/?a|none|null|ok|done|-+)$';
$function$;

grant execute on function is_real_note(text) to authenticated;

drop function if exists hub_returns_reason_coverage(text, text);

create function hub_returns_reason_coverage(
  p_store   text default null,
  p_courier text default null
)
returns table (
  source text,
  n      bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with r as (
    select agent_note, courier_reason_text, order_tags, shopify_reason,
           is_real_note(agent_note) as agent_real
      from v_returns_all
     where (p_store   is null or p_store = 'ALL' or store_code = p_store)
       and (p_courier is null or p_courier = 'All couriers' or courier = p_courier)
  )
  -- Ordinal column then ORDER BY on it: ORDER BY over a bare UNION ALL with an
  -- expression is rejected by Postgres.
  --
  -- The FIRST branch names every column. A union takes its column names from
  -- branch one alone, so an unaliased count(*) there leaves the outer query
  -- with nothing called `n` to select — which parses cleanly and only fails
  -- when run. pglast checks syntax, not name resolution; it cannot catch this.
  select source, n from (
    select 1 as ord, 'agent sentence'::text as source,
           count(*) filter (where agent_real) as n from r
    union all
    select 2, 'courier reason'::text,
           count(*) filter (where not agent_real and courier_reason_text is not null) from r
    union all
    select 3, 'agent CODE only (RTS etc — not an explanation)'::text,
           count(*) filter (where not agent_real and agent_note is not null
                              and courier_reason_text is null) from r
    union all
    select 4, 'Shopify dropdown only'::text,
           count(*) filter (where not agent_real and courier_reason_text is null
                              and agent_note is null and shopify_reason is not null) from r
    union all
    select 5, 'tags only'::text,
           count(*) filter (where not agent_real and courier_reason_text is null
                              and agent_note is null and shopify_reason is null
                              and coalesce(array_length(order_tags,1),0) > 0) from r
    union all
    select 6, 'nothing at all'::text,
           count(*) filter (where not agent_real and courier_reason_text is null
                              and agent_note is null and shopify_reason is null
                              and coalesce(array_length(order_tags,1),0) = 0) from r
    union all
    select 7, 'TOTAL returns'::text, count(*) from r
  ) t
  order by ord;
$function$;

grant execute on function hub_returns_reason_coverage(text, text) to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- 1. What the corrected backfill recovered. Expect roughly 400 parcels,
-- --    led by RFD, and NOTHING beginning "PostEx:" or "OwnEx:".
-- select courier, courier_reason_text, count(*)
--   from online_logistics
--  where courier_reason_text is not null
--  group by 1,2 order by 3 desc limit 30;
--
-- -- 2. The honest coverage. "agent sentence" will collapse from 2,378 to near
-- --    zero — that is the correction, not a regression.
-- select * from hub_returns_reason_coverage('ALL', null);
--
-- -- 3. THE OPEN QUESTION: what does RFD mean?
-- --    345 parcels, the single most common reason in the database, and it is an
-- --    abbreviation neither courier has defined to us. "Refused For Delivery" is
-- --    a plausible reading and plausible is not good enough to print in front of
-- --    the team. Ask PostEx and OwnEx, then expand it here rather than guessing:
-- --
-- --    update online_logistics set courier_reason_text = '<their words>'
-- --     where courier_reason_text = 'RFD';
