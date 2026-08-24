-- 0066_orders_summary_and_real_schedules.sql
--
-- TWO FAULTS, BOTH SILENT.
--
-- 1. THE ORDERS PAGE ALWAYS SAYS 1,000
--    It selects with .limit(5000) and counts the returned array in the browser.
--    PostgREST caps a response at 1,000 rows whatever .limit() asks for, so
--    every range — 30 days, 60 days, this month, all time — fetched 1,000 rows
--    and reported 1,000 orders. The figures were not wrong by a little; they
--    were the size of the page. Same fault as migration 0051, different page.
--    hub_orders_summary() counts in the database instead.
--
--    It also reports Delivered as 0, because delivery is not a property of an
--    order — the courier owns it, in online_logistics. The function joins it.
--
-- 2. NOTHING AUTOMATICALLY FETCHES NEW PARCELS OR ORDERS
--    The existing jobs are sync_postex_status, sync_ownex_status,
--    sync_postex_payments, sync_shopify_orders, sync_shopify_tracking. Every one
--    of them REFRESHES things already in the table. `postex_pull` — the action
--    that brings in parcels we have never seen — is on no schedule at all.
--    That is why the numbers only ever became correct after pressing a button.
--
--    shopify-sync also defaults to dry_run = true (`body.dry_run !== false`), so
--    any scheduled call that omits it runs and writes nothing. Both jobs below
--    pass it explicitly.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- Order totals, counted where the rows actually live
-- ---------------------------------------------------------------------------
create or replace function hub_orders_summary(
  p_from  date default null,
  p_to    date default null,
  p_store text default null
)
returns table (
  total bigint, pending bigint, dispatched bigint, cancelled bigint,
  delivered bigint, returned bigint, in_transit bigint,
  value numeric, avg_value numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with f as (
    select o.order_number, o.store_code, o.status, o.amount,
           l.delivery_status
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
           max(status)                                      as status,
           max(amount)                                      as amount,
           max(case when delivery_status = 'Delivered' then 1 else 0 end) as is_delivered,
           max(case when delivery_status in ('Returned','RTS') then 1 else 0 end) as is_returned,
           max(case when delivery_status = 'In Transit' then 1 else 0 end) as is_transit
      from f group by order_number, store_code
  )
  select
    count(*)::bigint                                                as total,
    count(*) filter (where status = 'Pending')::bigint              as pending,
    count(*) filter (where status = 'Dispatched')::bigint           as dispatched,
    count(*) filter (where status = 'Cancelled')::bigint            as cancelled,
    count(*) filter (where is_delivered = 1)::bigint                as delivered,
    count(*) filter (where is_returned = 1)::bigint                 as returned,
    count(*) filter (where is_transit = 1)::bigint                  as in_transit,
    coalesce(sum(amount), 0)::numeric                               as value,
    case when count(*) > 0
         then round(coalesce(sum(amount), 0)::numeric / count(*), 0)
         else 0 end                                                 as avg_value
  from d;
$function$;

grant execute on function hub_orders_summary(date, date, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Schedules that actually bring new data in.
-- Outside the transaction: cron.schedule does not roll back cleanly.
--
-- Cost check against the free tier: 48 + 24 + 24 = 96 extra invocations a day,
-- about 2,900 a month against a 500,000 limit. Not a concern.
-- ---------------------------------------------------------------------------

-- NEW: pull PostEx parcels we have never seen. Three days of overlap so a
-- missed run cannot leave a permanent hole — upserts key on tracking_id, so
-- re-reading the same parcel costs nothing.
select cron.unschedule('sync_postex_orders')
 where exists (select 1 from cron.job where jobname = 'sync_postex_orders');
select cron.schedule('sync_postex_orders', '*/30 * * * *',
  $$select call_sync('postex-sync', '{"action":"postex_pull","days":3}'::jsonb)$$);

-- REPLACED: hourly instead of once at 21:00, and dry_run made explicit. Without
-- dry_run:false shopify-sync runs in preview mode and writes nothing.
select cron.unschedule('sync_shopify_orders')
 where exists (select 1 from cron.job where jobname = 'sync_shopify_orders');
select cron.schedule('sync_shopify_orders', '15 * * * *',
  $$select call_sync('shopify-sync', '{"action":"pull_orders","days":3,"pages":6,"dry_run":false,"max_seconds":90}'::jsonb)$$);

select cron.unschedule('sync_shopify_tracking')
 where exists (select 1 from cron.job where jobname = 'sync_shopify_tracking');
select cron.schedule('sync_shopify_tracking', '35 * * * *',
  $$select call_sync('shopify-sync', '{"action":"pull_fulfillments","days":3,"pages":6,"dry_run":false,"max_seconds":90}'::jsonb)$$);

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- select jobname, schedule, active from cron.job order by jobname;
--
-- -- should now match the Orders page exactly, on every range
-- select * from hub_orders_summary(null, null, 'ALL');
-- select * from hub_orders_summary(current_date - 29, current_date, 'ALL');
--
-- -- and within the hour, every reply should be 200
-- select * from v_sync_health_summary;
