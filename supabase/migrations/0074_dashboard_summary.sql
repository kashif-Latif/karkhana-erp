-- 0074_dashboard_summary.sql
--
-- THE BUG
--   The Dashboard read online_orders with .limit(5000) and counted the array in
--   the browser. PostgREST caps a response at 1,000 rows whatever .limit() asks
--   for, so "Total orders" read exactly 1,000 on every range — and every figure
--   derived from it was wrong by the same amount.
--
--   Third page with this fault: Logistics (0051), Orders (0066), now Dashboard.
--   Anything counted in the browser is capped. Counting belongs here.
--
-- WHAT IT RETURNS
--   One row. Orders and money from online_orders; delivery and COD from
--   online_logistics, because a courier owns where a parcel is and whether the
--   money arrived — an order never does.
--
-- Safe to run more than once.

begin;

create or replace function hub_dashboard_summary(
  p_from  date default null,
  p_to    date default null,
  p_store text default null
)
returns table (
  total_orders     bigint,
  pending          bigint,
  returned_cancel  bigint,
  delivered        bigint,
  in_transit       bigint,
  order_value      numeric,
  avg_order        numeric,
  delivery_rate    numeric,
  cod_received     numeric,
  cod_receivable   numeric,
  receivable_count bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with f as (
    select o.order_number, o.store_code, o.status, o.amount,
           l.delivery_status, l.cod_amount, l.payment_status
      from online_orders o
      left join online_logistics l
             on l.order_number = o.order_number
            and l.store_code   = o.store_code
     where (p_from  is null or o.order_date >= p_from)
       and (p_to    is null or o.order_date <= p_to)
       and (p_store is null or p_store = 'ALL' or o.store_code = p_store)
  ), d as (
    -- one row per order: an order with two parcels must not count twice
    select order_number, store_code,
           max(status) as status,
           max(amount) as amount,
           max(case when delivery_status = 'Delivered' then 1 else 0 end)          as is_delivered,
           max(case when delivery_status in ('Returned','RTS') then 1 else 0 end)  as is_returned,
           max(case when delivery_status = 'In Transit' then 1 else 0 end)         as is_transit,
           max(case when delivery_status is null then 1 else 0 end)                as no_parcel,
           sum(case when delivery_status = 'Delivered'
                     and coalesce(payment_status,'') in ('Paid','Received')
                    then cod_amount else 0 end)                                    as cod_in,
           sum(case when delivery_status = 'Delivered'
                     and coalesce(payment_status,'') not in ('Paid','Received')
                    then cod_amount else 0 end)                                    as cod_out,
           max(case when delivery_status = 'Delivered'
                     and coalesce(payment_status,'') not in ('Paid','Received')
                    then 1 else 0 end)                                             as owes_money
      from f group by order_number, store_code
  )
  select
    count(*)::bigint                                                     as total_orders,
    -- pending: no parcel yet and not cancelled — nothing has shipped
    count(*) filter (where no_parcel = 1 and status <> 'Cancelled')::bigint as pending,
    count(*) filter (where is_returned = 1 or status = 'Cancelled')::bigint as returned_cancel,
    count(*) filter (where is_delivered = 1)::bigint                      as delivered,
    count(*) filter (where is_transit = 1)::bigint                        as in_transit,
    coalesce(sum(amount), 0)::numeric                                     as order_value,
    case when count(*) > 0
         then round(coalesce(sum(amount),0)::numeric / count(*), 0) else 0 end as avg_order,
    -- of parcels that actually finished, how many arrived
    case when count(*) filter (where is_delivered = 1 or is_returned = 1) > 0
         then round(count(*) filter (where is_delivered = 1)::numeric * 100
                  / count(*) filter (where is_delivered = 1 or is_returned = 1), 1)
         else 0 end                                                       as delivery_rate,
    coalesce(sum(cod_in), 0)::numeric                                     as cod_received,
    coalesce(sum(cod_out), 0)::numeric                                    as cod_receivable,
    count(*) filter (where owes_money = 1)::bigint                        as receivable_count
  from d;
$function$;

grant execute on function hub_dashboard_summary(date, date, text) to authenticated;

commit;

-- ===========================================================================
-- VERIFY — total_orders must now differ between ranges. If every range still
-- says exactly 1,000, the page is not calling this function.
-- ===========================================================================
-- select * from hub_dashboard_summary(current_date - 29, current_date, 'ALL');
-- select * from hub_dashboard_summary(null, null, 'ALL');
