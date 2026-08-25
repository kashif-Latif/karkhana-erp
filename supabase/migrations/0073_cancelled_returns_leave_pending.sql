-- 0073_cancelled_returns_leave_pending.sql
--
-- THE RULE
--   When an agent cancels the order in Shopify, that IS the acknowledgement
--   that the parcel is coming back and has been dealt with. It should stop
--   appearing under "Pending returns", because nobody needs to chase it.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   It does not mark the parcel physically received. Those are two different
--   facts and merging them would be expensive:
--
--     cancelled in Shopify  = the money is written off, the order is closed
--     received              = the box is on your shelf, stock is back,
--                             and any claim against the courier is closed
--
--   A courier can lose a parcel AFTER the order was cancelled. If cancelling
--   silently marked it received, that loss becomes invisible and unclaimable —
--   currently Rs 2.38M sits in pending returns, so the exposure is real.
--   Confirming receipt stays a human action.
--
--   So a cancelled return gets its own stage. It leaves the chase list, and it
--   is still visible under All returns with the reason the agent typed.
--
-- Safe to run more than once.

begin;

-- CREATE OR REPLACE cannot insert a column mid-list — only append. That is
-- exactly how migration 0058 failed. Drop first.
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

  -- Order matters. Physically received is the strongest fact; cancelled in
  -- Shopify is an acknowledgement, not a receipt.
  case
    when l.return_received_at is not null then 'Received'
    when o.cancelled_at is not null       then 'Cancelled in Shopify'
    when l.delivery_status = 'RTS'        then 'Coming back'
    else                                       'Awaiting receipt'
  end                                            as stage,

  l.rts_reason                                   as courier_reason,
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

  -- what the Pending tab filters on: still needs chasing by a human
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

-- ---------------------------------------------------------------------------
-- The Pending card must count the same set the Pending tab shows, or the
-- number and the list disagree — which is how nobody trusts either.
-- Return type is unchanged, so CREATE OR REPLACE is safe here.
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
  select 'all_returns'::text, count(*)::bigint,
         coalesce(sum(cod_amount), 0)::numeric,
         coalesce(max(age_days), 0)::integer
    from v_returns_all
   where (p_store   is null or p_store = 'ALL' or store_code = p_store)
     and (p_courier is null or p_courier = 'All couriers' or courier = p_courier)
     and (p_from    is null or return_date >= p_from)
     and (p_to      is null or return_date <= p_to)

  union all

  select 'pending_returns'::text, count(*)::bigint,
         coalesce(sum(cod_amount), 0)::numeric,
         coalesce(max(age_days), 0)::integer
    from v_returns_all
   where needs_chasing                       -- cancelled in Shopify drops out here
     and (p_store   is null or p_store = 'ALL' or store_code = p_store)
     and (p_courier is null or p_courier = 'All couriers' or courier = p_courier)
     and (p_from    is null or return_date >= p_from)
     and (p_to      is null or return_date <= p_to)

  union all

  select 'delivered_unpaid'::text, count(*)::bigint,
         coalesce(sum(cod_amount), 0)::numeric,
         coalesce(max(age_days), 0)::integer
    from v_delivered_unpaid
   where (p_store   is null or p_store = 'ALL' or store_code = p_store)
     and (p_courier is null or p_courier = 'All couriers' or courier = p_courier)
     and (p_from    is null or delivery_date >= p_from)
     and (p_to      is null or delivery_date <= p_to);
$function$;

grant select on v_returns_all to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- how the returns now split
-- select stage, count(*), to_char(sum(cod_amount),'FM999,999,999') as cod
--   from v_returns_all group by 1 order by 2 desc;
--
-- -- Pending should drop by however many are 'Cancelled in Shopify'
-- select * from hub_returns_sections('ALL', null, null, null);
