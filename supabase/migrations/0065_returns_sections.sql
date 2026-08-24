-- 0065_returns_sections.sql
--
-- Returns move out of Finance and into Logistics, split into the three
-- questions that actually get asked:
--
--   1. ALL RETURNS          everything that ever came back, newest first —
--                           the historical record
--   2. PENDING RETURNS      the courier says it is coming back or is back, but
--                           nobody here has confirmed holding it. OLDEST FIRST,
--                           because couriers stop honouring claims after a
--                           while — an old pending row is money about to be lost
--   3. PENDING DELIVERED    delivered, money not yet received. This is the
--                           receivable — about Rs 1.19M across both couriers
--
-- WHY VIEWS AND A FUNCTION RATHER THAN BROWSER CODE
--   PostgREST caps a response at 1,000 rows whatever .limit() says, so counting
--   in the browser silently understates every total once a set grows past that.
--   It already bit this project once (migration 0051). The cards below read
--   hub_returns_sections(), which counts in the database; the tables read the
--   views and are explicitly a page of rows, not a total.
--
-- TWO REASONS, NOT ONE
--   The courier's reason (rts_reason: "REFUSED TO RECEIVE") and the agent's own
--   reason in Shopify (cancel_reason / note) are different facts and are kept
--   apart. Merging them would hide which one you are reading.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. Every return, whatever stage it is at
-- ---------------------------------------------------------------------------
create or replace view v_returns_all as
select
  l.tracking_id,
  l.order_number,
  l.store_code,
  l.courier,
  l.cod_amount,
  l.delivery_status,
  l.raw_status,
  -- the stage, in the couriers' own terms
  case
    when l.return_received_at is not null then 'Received'
    when l.delivery_status = 'RTS'        then 'Coming back'
    else                                       'Awaiting receipt'
  end                                            as stage,
  l.rts_reason                                   as courier_reason,
  o.cancel_reason                                as shopify_reason,
  o.note                                         as shopify_note,
  o.customer_name,
  o.phone,
  o.city,
  -- when the return actually began. return_leg_started_at (migration 0059) is
  -- the courier's own timestamp and the most accurate of the three.
  coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date)
                                                 as return_date,
  l.return_received_at,
  (l.return_received_at is not null)             as received,
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

-- ---------------------------------------------------------------------------
-- 2. Delivered but the money has not arrived — the receivable
-- ---------------------------------------------------------------------------
create or replace view v_delivered_unpaid as
select
  l.tracking_id,
  l.order_number,
  l.store_code,
  l.courier,
  l.cod_amount,
  l.delivery_date,
  l.dispatch_date,
  l.payment_status,
  l.cpr_number,
  o.customer_name,
  o.phone,
  o.city,
  (current_date - l.delivery_date)               as age_days
from online_logistics l
left join online_orders o
       on o.order_number = l.order_number
      and o.store_code   = l.store_code
where l.delivery_status = 'Delivered'
  and coalesce(l.payment_status, '') not in ('Paid', 'Received');

-- ---------------------------------------------------------------------------
-- 3. Counts for the header cards — computed here, never in the browser
--    No ORDER BY on the UNION ALL: that was rejected once already.
-- ---------------------------------------------------------------------------
create or replace function hub_returns_sections(
  p_store   text default null,
  p_courier text default null,
  p_from    date default null,
  p_to      date default null
)
returns table (section text, n bigint, value numeric, oldest_days integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select 'all_returns'::text,
         count(*)::bigint,
         coalesce(sum(cod_amount), 0)::numeric,
         coalesce(max(age_days), 0)::integer
    from v_returns_all
   where (p_store   is null or p_store = 'ALL' or store_code = p_store)
     and (p_courier is null or p_courier = 'All couriers' or courier = p_courier)
     and (p_from    is null or return_date >= p_from)
     and (p_to      is null or return_date <= p_to)

  union all

  select 'pending_returns'::text,
         count(*)::bigint,
         coalesce(sum(cod_amount), 0)::numeric,
         coalesce(max(age_days), 0)::integer
    from v_returns_all
   where received = false
     and (p_store   is null or p_store = 'ALL' or store_code = p_store)
     and (p_courier is null or p_courier = 'All couriers' or courier = p_courier)
     and (p_from    is null or return_date >= p_from)
     and (p_to      is null or return_date <= p_to)

  union all

  select 'delivered_unpaid'::text,
         count(*)::bigint,
         coalesce(sum(cod_amount), 0)::numeric,
         coalesce(max(age_days), 0)::integer
    from v_delivered_unpaid
   where (p_store   is null or p_store = 'ALL' or store_code = p_store)
     and (p_courier is null or p_courier = 'All couriers' or courier = p_courier)
     and (p_from    is null or delivery_date >= p_from)
     and (p_to      is null or delivery_date <= p_to);
$function$;

grant select  on v_returns_all, v_delivered_unpaid       to authenticated;
grant execute on function hub_returns_sections(text, text, date, date) to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- select * from hub_returns_sections('ALL', null, null, null);
--   -> all_returns / pending_returns / delivered_unpaid with counts and value
--
-- select stage, count(*) from v_returns_all group by 1;
-- select count(*), sum(cod_amount) from v_delivered_unpaid;
