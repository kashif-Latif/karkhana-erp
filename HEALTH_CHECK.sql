-- ===========================================================================
-- KARKHANA — HUB DEPARTMENT HEALTH CHECK   (rev 3 · 26 Aug 2026)
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
--
--    WHAT THE ok/failed SPLIT DOES *NOT* MEAN.
--    The previous revision printed "72 ok / 216 failed" and called it a
--    failure rate. It is not. pg_net DELETES rows from net._http_response
--    after a 6-hour TTL, so any call older than that has no status left to
--    read and scores as failed. Six hours out of twenty-four is 25%, which is
--    exactly the ratio all three functions showed. Nothing was wrong.
--
--    So the only trustworthy signal here is the MOST RECENT call, which is
--    still inside the TTL window. `retained` is shown so the number is never
--    mistaken for a failure count again — cross-check against cron itself:
--        select jobname, status, start_time from cron.job_run_details
--         order by start_time desc limit 40;
sync as (
  select 'sync · ' || fn as check,
         case when last_called < now() - interval '2 hours' then 'FAIL'
              when last_status between 200 and 299 then 'OK'
              else 'FAIL' end as verdict,
         'last call ' || to_char(last_called, 'HH24:MI') || ' → HTTP ' ||
         coalesce(last_status::text, 'no response retained') ||
         ' · ' || coalesce(ok_24h, 0) || ' of ' ||
         (coalesce(ok_24h,0) + coalesce(failed_24h,0)) ||
         ' responses still retained (pg_net keeps 6h — NOT a failure count)' as detail
    from v_sync_health_summary
),

-- 2 & 3. How long since each open parcel last CHANGED.
--
--    THE PREVIOUS REVISION READ THIS COLUMN WRONG. It called updated_at "when we
--    last checked" and failed anything over an hour — reporting FAIL on a
--    healthy system polling every five minutes.
--
--    updated_at changes when a row is WRITTEN. Both syncs deliberately skip the
--    write when a status has not moved; that is the whole point of the dedup
--    work in 0063, which stopped a Realtime event storm on every poll. So a
--    parcel sitting In Transit for a day shows a day-old updated_at having been
--    polled 288 times.
--
--    There is no "last checked" column and adding one would mean writing every
--    row on every poll — reintroducing exactly the churn 0063 removed. So this
--    now measures what the column can honestly answer: how long since the
--    parcel MOVED. Use check 1 for whether the sync is running.
postex as (
  select 'PostEx · open parcels moving' as check,
         -- A parcel that has not MOVED in 14 days is stuck and worth chasing.
         -- Anything shorter is normal: plenty of parcels sit for days.
         case when count(*) filter (where age > interval '14 days') = 0 then 'OK'
              when count(*) filter (where age > interval '30 days') = 0 then 'WATCH'
              else 'FAIL' end as verdict,
         count(*) || ' open · ' ||
         count(*) filter (where age > interval '14 days') || ' unmoved 14d+ · ' ||
         'oldest CHANGE ' ||
         coalesce(round(extract(epoch from max(age)) / 86400.0, 1)::text || 'd', '—') || ' ago' as detail
    from (select now() - updated_at as age
            from online_logistics
           where courier = 'PostEx'
             and delivery_status not in ('Delivered','Returned','Cancelled')) t
),

ownex as (
  select 'OwnEx · open parcels moving' as check,
         -- A parcel that has not MOVED in 14 days is stuck and worth chasing.
         -- Anything shorter is normal: plenty of parcels sit for days.
         case when count(*) filter (where age > interval '14 days') = 0 then 'OK'
              when count(*) filter (where age > interval '30 days') = 0 then 'WATCH'
              else 'FAIL' end as verdict,
         count(*) || ' open · ' ||
         count(*) filter (where age > interval '14 days') || ' unmoved 14d+ · ' ||
         'oldest CHANGE ' ||
         coalesce(round(extract(epoch from max(age)) / 86400.0, 1)::text || 'd', '—') || ' ago' as detail
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
--    THE PREVIOUS TWO REVISIONS BOTH SCORED THIS WRONG, in opposite directions.
--    The first accepted a tag as an explanation. The second accepted any agent
--    note — and reported "2,378 of 2,672 explained", 89%, on a page whose owner
--    was telling us it showed him nothing useful. He was right. Ten samples,
--    all ten identical:
--
--        order #8557 · agent_note "RTS" · tags "Call Confirmed · PostEx"
--
--    "RTS" restates the status. A test that passes on that is worse than no
--    test: it hid the exact complaint it existed to measure.
--
--    is_real_note() (0078) now demands a sentence — two words or more, and not
--    a status code. Expect this number to COLLAPSE. That is the correction
--    landing, not a regression.
reasons as (
  select 'Returns · have a REAL reason' as check,
         case when total = 0 then 'OK'
              when explained * 100 / greatest(total,1) >= 60 then 'OK'
              when explained * 100 / greatest(total,1) >= 25 then 'WATCH'
              else 'FAIL' end as verdict,
         explained || ' of ' || total || ' explained · ' ||
         sentences || ' agent sentence, ' || couriers || ' courier reason, ' ||
         codes || ' agent CODE only (does not count)' as detail
    from (
      select count(*)                                                    as total,
             count(*) filter (where is_real_note(agent_note)
                                 or courier_reason_text is not null)     as explained,
             count(*) filter (where is_real_note(agent_note))            as sentences,
             count(*) filter (where not is_real_note(agent_note)
                                 and courier_reason_text is not null)    as couriers,
             count(*) filter (where agent_note is not null
                                 and not is_real_note(agent_note))       as codes
        from v_returns_all
    ) t
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
-- 11. THE MONEY — but split, because the headline figure is not one number.
--
--     All-time it reads Rs 14.8M across 6,878 parcels. By age it is two
--     completely different things:
--
--        0-30 days   Rs 1.33M   <- real, chase this
--        over 90d    Rs 13.2M   ALL PostEx, zero OwnEx
--
--     PostEx settles weekly. 3,342 parcels unpaid for over a year is not debt,
--     it is settlement we never imported — online_cpr has 0 rows. Handing the
--     team Rs 14.8M as a chase list wastes their week on parcels that were paid
--     for long ago. The old page showed Rs 1.43M and was accidentally right,
--     for the wrong reason.
money as (
  select 'MONEY · unpaid, last 30 days (chase this)' as check,
         case when pending_count = 0 then 'OK' else 'WATCH' end as verdict,
         'Rs ' || to_char(pending_value, 'FM999,999,999') ||
         ' across ' || pending_count || ' parcels' as detail
    from hub_finance_summary(current_date - 30, current_date, 'ALL', null)
),

older as (
  select 'MONEY · unpaid over 90 days (likely unimported CPR)' as check,
         case when count(*) = 0 then 'OK' else 'WATCH' end as verdict,
         'Rs ' || to_char(coalesce(sum(cod_amount),0), 'FM999,999,999') ||
         ' across ' || count(*) || ' parcels · not a chase list until the ' ||
         'settlement files are imported' as detail
    from v_finance_payments
   where not is_paid and age_days > 90
),

-- 12. Gross, cost, net.
--
--     TREAT `net` AS PROVISIONAL. Charges of Rs 685,459 against Rs 27.1M gross
--     is 2.5%, while OwnEx alone is known to have taken Rs 531,727. courier_fee
--     is only populated on parcels a payments sync has touched, so net is gross
--     minus THE FEES WE HAPPEN TO KNOW ABOUT — not the real net. It becomes
--     true when the CPR import lands, and not before.
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
union all select * from older
union all select * from margin;
