-- 0076_courier_reason_text.sql
--
-- THE PROBLEM
--   The courier's real reason has been arriving all along and being thrown away.
--
--   OwnEx history, verbatim:
--       {"status":"Verifying Reason","code":"debrief",
--        "description":"UNTRACEABLE ADDRESS"}
--
--   `ownex-sync` reads that array for direction detection, keeps
--   "Verifying Reason" in raw_status, and discards "UNTRACEABLE ADDRESS".
--   "Verifying Reason" is the courier saying it has NOT decided yet — it is the
--   absence of a reason. The description beside it is the reason.
--
--   PostEx buries the same thing inside transactionStatus itself:
--       "Reason - REFUSED TO RECEIVE"
--   and we stored the whole string, prefix and all, into rts_reason.
--
-- THE FIX
--   A dedicated column holding ONLY the courier's explanation, in the courier's
--   own words, with no prefix and no status wording mixed in.
--
--   rts_reason is left exactly as it is. It is a status echo ("PostEx: Returned")
--   and is used elsewhere; overloading it further is how it became unreadable.
--   Two different facts, two columns.
--
-- PRIORITY ON THE RETURNS PAGE (unchanged in spirit, now with a real middle rung)
--   1. agent staff note      "stock not available"        <- a human typed it
--   2. courier reason text   "UNTRACEABLE ADDRESS"        <- the courier's finding
--   3. tags                                               <- last resort
--
-- WHAT THE BACKFILL CAN AND CANNOT RECOVER
--   PostEx: recoverable NOW. The wording is already sitting in rts_reason behind
--           the "Reason - " prefix, so it is extracted here — no re-sync needed.
--   OwnEx:  NOT recoverable. We only ever kept "Verifying Reason"; the
--           description was never written to any table, not even to
--           online_courier_events, which stores raw_status alone. Those rows
--           fill in on the next ownex-sync pass.
--
-- Safe to run more than once.

begin;

alter table online_logistics
  add column if not exists courier_reason_text text;

comment on column online_logistics.courier_reason_text is
  'The courier''s own explanation for a failed delivery or return — "UNTRACEABLE ADDRESS", "REFUSED TO RECEIVE". Just the reason: no "PostEx:" prefix, no status wording. Distinct from rts_reason, which echoes the status. Never overwritten with null: a reason once given is not un-given by a later movement.';

-- ---------------------------------------------------------------------------
-- BACKFILL — PostEx only, and only where the prefix proves a reason follows
--
--   rts_reason: 'PostEx: Reason - REFUSED TO RECEIVE'  ->  'REFUSED TO RECEIVE'
--
-- The regex requires the literal "Reason - " marker, so "PostEx: Returned" and
-- "PostEx: Failed Attempt" are left alone — they are statuses, not reasons, and
-- promoting them would put exactly the wrong text in front of the team.
-- ---------------------------------------------------------------------------
update online_logistics
   set courier_reason_text = btrim(
         regexp_replace(rts_reason, '^.*?reason\s*[-–:]\s*', '', 'i')
       )
 where courier_reason_text is null
   and rts_reason is not null
   and rts_reason ~* 'reason\s*[-–:]\s*\S'
   -- "Verifying Reason" has nothing after it. Guard against capturing empty.
   and btrim(regexp_replace(rts_reason, '^.*?reason\s*[-–:]\s*', '', 'i')) <> '';

-- Same again from raw_status. The PULL path (postex_pull) writes raw_status but
-- never touches rts_reason, so a parcel that arrived through a date-window pull
-- rather than through tracking has the wording in a different column. Missing
-- this pass would leave those rows blank for no reason anyone could see.
update online_logistics
   set courier_reason_text = btrim(
         regexp_replace(raw_status, '^.*?reason\s*[-–:]\s*', '', 'i')
       )
 where courier_reason_text is null
   and raw_status is not null
   and raw_status ~* 'reason\s*[-–:]\s*\S'
   and btrim(regexp_replace(raw_status, '^.*?reason\s*[-–:]\s*', '', 'i')) <> '';

-- ---------------------------------------------------------------------------
-- Rebuild v_returns_all so the page can read the new column.
--
-- DROP first. CREATE OR REPLACE VIEW can only APPEND a column, never insert one
-- mid-list — that is precisely how migration 0058 failed. The column belongs
-- next to courier_reason, so a drop is required.
--
-- Everything else below is character-for-character the 0073 definition.
-- ---------------------------------------------------------------------------
drop view if exists v_returns_all;

create view v_returns_all as
select
  l.tracking_id,
  l.order_number,
  l.store_code,
  l.courier,
  l.cod_amount,
  l.delivery_status,
  l.raw_status,

  case
    when l.return_received_at is not null then 'Received'
    when o.cancelled_at is not null       then 'Cancelled in Shopify'
    when l.delivery_status = 'RTS'        then 'Coming back'
    else                                       'Awaiting receipt'
  end                                            as stage,

  l.rts_reason                                   as courier_reason,      -- status echo
  l.courier_reason_text                          as courier_reason_text, -- the real reason
  o.cancel_staff_note                            as agent_note,
  o.cancel_reason                                as shopify_reason,
  o.note                                         as shopify_note,
  o.tags                                         as order_tags,
  o.cancelled_at                                 as order_cancelled_at,
  o.customer_name,
  o.phone,
  o.city,

  coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date)
                                                 as return_date,
  l.return_received_at,
  (l.return_received_at is not null)             as received,

  (l.return_received_at is null and o.cancelled_at is null)
                                                 as needs_chasing,

  l.return_claim_status,
  l.return_claim_ref,
  l.dispatch_date,
  l.delivery_date,
  (current_date - coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date))
                                                 as age_days
from online_logistics l
left join online_orders o
       on o.order_number = l.order_number
      and o.store_code   = l.store_code
where l.delivery_status in ('RTS', 'Returned');

grant select on v_returns_all to authenticated;

-- ---------------------------------------------------------------------------
-- How much of the reason gap is actually filled, counted in the database.
--
-- The health check currently asks whether a return has "an agent note or a tag".
-- That was the best available answer before this migration. It now has a third
-- and better source, and the tag test lives in the browser where SQL cannot see
-- it, so the honest count belongs here.
-- ---------------------------------------------------------------------------
create or replace function hub_returns_reason_coverage(
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
    select agent_note, courier_reason_text, order_tags, shopify_reason
      from v_returns_all
     where (p_store   is null or p_store = 'ALL' or store_code = p_store)
       and (p_courier is null or p_courier = 'All couriers' or courier = p_courier)
  )
  -- Ordinal column, then ORDER BY on it. ORDER BY over a bare UNION ALL with an
  -- expression is rejected by Postgres; this shape is the one that works.
  select source, n from (
    select 1 as ord, 'agent note'::text     as source, count(*) filter (where agent_note is not null)          as n from r
    union all
    select 2, 'courier reason'::text,             count(*) filter (where agent_note is null
                                                                     and courier_reason_text is not null)      from r
    union all
    select 3, 'Shopify reason'::text,             count(*) filter (where agent_note is null
                                                                     and courier_reason_text is null
                                                                     and shopify_reason is not null)           from r
    union all
    select 4, 'tags only'::text,                  count(*) filter (where agent_note is null
                                                                     and courier_reason_text is null
                                                                     and shopify_reason is null
                                                                     and coalesce(array_length(order_tags,1),0) > 0) from r
    union all
    select 5, 'no reason at all'::text,           count(*) filter (where agent_note is null
                                                                     and courier_reason_text is null
                                                                     and shopify_reason is null
                                                                     and coalesce(array_length(order_tags,1),0) = 0) from r
    union all
    select 6, 'TOTAL returns'::text,              count(*)                                                     from r
  ) t
  order by ord;
$function$;

grant execute on function hub_returns_reason_coverage(text, text) to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- 1. What the PostEx backfill recovered, immediately, with no re-sync:
-- select courier, courier_reason_text, count(*)
--   from online_logistics
--  where courier_reason_text is not null
--  group by 1, 2 order by 3 desc limit 20;
--
-- -- 2. The gap, before redeploying the syncs. OwnEx will be almost all
-- --    "no reason at all" here — that is expected and is what the sync fixes.
-- select * from hub_returns_reason_coverage('ALL', null);
--
-- -- 3. Rerun (2) an hour after redeploying ownex-sync and postex-sync.
-- --    "courier reason" should climb and "no reason at all" should fall.
