-- ===========================================================================
-- KARKHANA — HUB DEPARTMENT HEALTH CHECK   (rev 26 Aug 2026)
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
--
-- WHAT CHANGED IN THIS REVISION
--   * check 4 now asks whether returns have a REAL reason, counting the
--     courier's own wording (migration 0076) rather than accepting tags as an
--     explanation. It will look WORSE than the old version. That is the point:
--     the old test passed on noise.
--   * check 11 reads hub_finance_summary() instead of the money the browser
--     could see, so the receivable is the true one (migration 0077).
--   * ages over 24 hours now print as hours, not as a wrapped clock time.
--     to_char(interval,'HH24:MI') showed a 30-hour gap as "06:00".
--
-- REQUIRES migrations 0076 and 0077. If either is not applied yet, the two
-- checks that need them will error — apply them, or delete those two blocks.
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
         coalesce(round(extract(epoch from max(age)) / 3600.0, 1)::text || 'h', '—') || ' ago' as detail
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
         coalesce(round(extract(epoch from max(age)) / 3600.0, 1)::text || 'h', '—') || ' ago' as detail
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

-- 4. Do returns actually explain themselves?
--
--    THE OLD TEST WAS TOO GENEROUS. It counted a return as explained if it had
--    "an agent note OR a tag", and tags are noise — "Order Confirmed" explains
--    nothing about why a parcel came back. It passed on rows that told you
--    nothing.
--
--    A REAL reason is one of two things:
--      * a sentence a human typed          (cancel_staff_note)
--      * the courier's own finding         (courier_reason_text — "UNTRACEABLE
--        ADDRESS", "REFUSED TO RECEIVE")
--
--    Not the courier's STATUS. "Verifying Reason" is the courier saying it has
--    not decided yet: the absence of a reason, which is why raw_status does not
--    count here.
--
--    Expect this to read worse than it used to, and to improve over the days
--    after ownex-sync and postex-sync are redeployed.
reasons as (
  select 'Returns · have a REAL reason' as check,
         case when count(*) = 0 then 'OK'
              when count(*) filter (where has_real) * 100 / greatest(count(*),1) >= 60 then 'OK'
              when count(*) filter (where has_real) * 100 / greatest(count(*),1) >= 25 then 'WATCH'
              else 'FAIL' end as verdict,
         count(*) filter (where has_real) || ' of ' || count(*) ||
         ' explained · ' ||
         count(*) filter (where agent_note is not null)        || ' by agent, ' ||
         count(*) filter (where agent_note is null
                            and courier_reason_text is not null) || ' by courier, ' ||
         count(*) filter (where not has_real
                            and coalesce(array_length(order_tags,1),0) > 0) ||
         ' tag-only (does not count)' as detail
    from (select agent_note, courier_reason_text, order_tags,
                 (agent_note is not null or courier_reason_text is not null) as has_real
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

-- 11. THE MONEY. Not a pass/fail — the number you are actually running.
--
--     Read from hub_finance_summary(), not from anything the browser counted.
--     The Finance page had two faults at once: the 1,000-row cap, and a date
--     filter on payment_date that is NULL on every unpaid parcel and therefore
--     removed the pending rows entirely. This figure has neither.
money as (
  select 'MONEY · COD delivered but unpaid' as check,
         case when pending_count = 0 then 'OK' else 'WATCH' end as verdict,
         'Rs ' || to_char(pending_value, 'FM999,999,999') ||
         ' across ' || pending_count || ' parcels · oldest ' ||
         oldest_pending_days || ' days' as detail
    from hub_finance_summary(null, null, 'ALL', null)
),

-- 12. Gross, cost, net — the three figures Finance shows, side by side, so the
--     revenue question always has a number attached to it.
margin as (
  select 'MONEY · gross vs courier charges' as check,
         'OK' as verdict,
         'gross Rs ' || to_char(gross_cod, 'FM999,999,999') ||
         ' · charges Rs ' || to_char(courier_fees, 'FM999,999,999') ||
         ' · net Rs ' || to_char(net_expected, 'FM999,999,999') as detail
    from hub_finance_summary(null, null, 'ALL', null)
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
union all select * from money
union all select * from margin;
