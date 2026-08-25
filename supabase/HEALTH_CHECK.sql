-- ===========================================================================
-- KARKHANA — HUB DEPARTMENT HEALTH CHECK
--
-- Paste the whole thing and run. One result set. Read the `verdict` column:
--   OK      nothing to do
--   WATCH   working, but worth knowing
--   FAIL    broken, act on it
--
-- Written to be re-run any time. It reads only — nothing here writes.
--
-- WHY IT EXISTS
--   Every sync in this project has, at some point, reported success while doing
--   nothing: cron jobs logging `succeeded` over 401s, postex_track returning
--   ok:true with `updated: 0` and its failures buried in an errors array. A
--   green tick from the thing being tested is not evidence. These checks look
--   at outcomes — did rows actually change, did events actually arrive.
-- ===========================================================================

with

-- 1. Are the scheduled jobs reaching their functions AT ALL?
sync as (
  select 'sync · ' || fn as check,
         case when last_status between 200 and 299 then 'OK' else 'FAIL' end as verdict,
         'last ' || to_char(last_called, 'HH24:MI') || ' · ' ||
         coalesce(ok_24h, 0) || ' ok / ' || coalesce(failed_24h, 0) || ' failed in 24h' as detail
    from v_sync_health_summary
),

-- 2. Is PostEx status actually being refreshed, or just called?
--    `oldest` is the parcel that has gone longest without a check. If it drifts
--    past an hour the rotation has stalled.
postex as (
  select 'PostEx · open parcels refreshing' as check,
         case when max(age) < interval '1 hour'  then 'OK'
              when max(age) < interval '6 hours' then 'WATCH'
              else 'FAIL' end as verdict,
         count(*) || ' open · oldest checked ' ||
         coalesce(to_char(max(age), 'HH24:MI'), '—') || ' ago' as detail
    from (select now() - updated_at as age
            from online_logistics
           where courier = 'PostEx'
             and delivery_status not in ('Delivered','Returned','Cancelled')) t
),

ownex as (
  select 'OwnEx · open parcels refreshing' as check,
         case when max(age) < interval '1 hour'  then 'OK'
              when max(age) < interval '6 hours' then 'WATCH'
              else 'FAIL' end as verdict,
         count(*) || ' open · oldest checked ' ||
         coalesce(to_char(max(age), 'HH24:MI'), '—') || ' ago' as detail
    from (select now() - updated_at as age
            from online_logistics
           where courier = 'OwnEx'
             and delivery_status not in ('Delivered','Returned','Cancelled')) t
),

-- 3. Are Shopify webhooks pushing? Silence for hours during trading means the
--    subscription died — Shopify deletes one after 8 consecutive failures.
hooks as (
  select 'Shopify webhook · ' || store_code as check,
         case when max(received_at) > now() - interval '6 hours' then 'OK'
              when max(received_at) > now() - interval '24 hours' then 'WATCH'
              else 'FAIL' end as verdict,
         count(*) || ' events 24h · last ' || to_char(max(received_at), 'HH24:MI') as detail
    from online_shopify_events
   where received_at > now() - interval '24 hours'
   group by store_code
),

-- 4. Do returns actually explain themselves? The courier saying "Verifying
--    Reason" is the ABSENCE of a reason, so it does not count.
reasons as (
  select 'Returns · have a real reason' as check,
         case when count(*) = 0 then 'OK'
              when count(*) filter (where has_reason) * 100 / greatest(count(*),1) >= 50 then 'OK'
              else 'WATCH' end as verdict,
         count(*) filter (where has_reason) || ' of ' || count(*) ||
         ' returns explained by agent note or tag' as detail
    from (select (agent_note is not null
                  or shopify_reason is not null
                  or coalesce(array_length(order_tags,1),0) > 0) as has_reason
            from v_returns_all) t
),

-- 5. Delivered parcels with no order behind them. Each one is COD that cannot
--    be tied to a customer.
orphans as (
  select 'Delivered parcels with no order' as check,
         case when count(*) = 0 then 'OK'
              when count(*) < 50 then 'WATCH' else 'FAIL' end as verdict,
         count(*) || ' parcels · Rs ' || to_char(coalesce(sum(l.cod_amount),0), 'FM999,999,999') ||
         ' unattributable' as detail
    from online_logistics l
    left join online_orders o
           on o.order_number = l.order_number and o.store_code = l.store_code
   where l.delivery_status = 'Delivered' and o.order_number is null
),

-- 6. Statuses a courier sent that we do not understand. Flagged, never guessed.
unknown as (
  select 'Courier statuses not understood' as check,
         case when count(*) = 0 then 'OK' else 'WATCH' end as verdict,
         count(*) || ' parcels flagged for review' as detail
    from online_logistics where needs_review = true
),

-- 7. The UNFULFILLED substring bug. /FULFILLED/.test("UNFULFILLED") was true,
--    so every unfulfilled order was filed as Dispatched. Must stay at zero.
unful as (
  select 'Orders · UNFULFILLED filed as Dispatched' as check,
         case when count(*) = 0 then 'OK' else 'FAIL' end as verdict,
         count(*) || ' rows (must be 0)' as detail
    from online_orders
   where upper(fulfillment_status) = 'UNFULFILLED' and status = 'Dispatched'
),

-- 8. order_date must be the SHOP's day, not UTC. An order at 02:00 Karachi is
--    21:00 UTC the day before; getting this wrong shifted every window.
tz as (
  select 'Orders · date in shop timezone' as check,
         case when count(*) = 0 then 'OK' else 'FAIL' end as verdict,
         count(*) || ' rows on the wrong day (must be 0)' as detail
    from online_orders
   where shopify_created_at is not null
     and order_date <> (shopify_created_at at time zone 'Asia/Karachi')::date
),

-- 9. Orders Shopify has never told us about. These are invisible to any date
--    filter and are what "Fetch all history" exists to fix.
nosync as (
  select 'Orders · never seen by Shopify sync' as check,
         case when count(*) = 0 then 'OK'
              when count(*) < 200 then 'WATCH' else 'FAIL' end as verdict,
         count(*) || ' rows have no Shopify timestamp' as detail
    from online_orders where shopify_created_at is null
),

-- 10. Free tier is 500 MB in total.
size as (
  select 'Database size (free tier 500 MB)' as check,
         case when pg_database_size(current_database()) < 300*1024*1024 then 'OK'
              when pg_database_size(current_database()) < 450*1024*1024 then 'WATCH'
              else 'FAIL' end as verdict,
         pg_size_pretty(pg_database_size(current_database())) ||
         ' · events ' || (select count(*) from online_courier_events) || ' rows' as detail
),

-- 11. The money. Not a pass/fail — the number you are actually running.
money as (
  select 'MONEY · COD delivered but unpaid' as check,
         case when count(*) = 0 then 'OK' else 'WATCH' end as verdict,
         'Rs ' || to_char(coalesce(sum(cod_amount),0), 'FM999,999,999') ||
         ' across ' || count(*) || ' parcels' as detail
    from v_delivered_unpaid
)

select * from sync
union all select * from postex
union all select * from ownex
union all select * from hooks
union all select * from reasons
union all select * from orphans
union all select * from unknown
union all select * from unful
union all select * from tz
union all select * from nosync
union all select * from size
union all select * from money;
