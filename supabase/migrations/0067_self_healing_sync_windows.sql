-- 0067_self_healing_sync_windows.sql
--
-- THE DESIGN FAULT THIS FIXES
--   sync_postex_orders pulls a 3-day window every 30 minutes. That keeps today
--   current, but it can only ever see the last 3 days — so a parcel missed for
--   ANY reason (an outage, a courier delay in publishing it, a window that
--   straddled midnight) is missed permanently. The only cure was a person
--   pressing "Fetch orders", which is not automation, it is a chore.
--
--   Measured today: PostEx holds 3,798 parcels, we hold 3,724. Seventy-four
--   parcels invisible to us, and no scheduled job could ever find them.
--
-- THE SHAPE OF THE FIX
--   Two windows instead of one, which is how any sync that must not lose rows
--   is built:
--     * FAST  — 3 days, every 30 minutes. Keeps today live.
--     * DEEP  — 45 days, once nightly. Sweeps up anything the fast window
--               dropped. Runs at 02:40 PKT when nobody is looking.
--   Upserts key on tracking_id, so re-reading the same parcel a hundred times
--   costs nothing and changes nothing. Overlap is the point, not waste.
--
--   The same applies to Shopify: 3 days hourly, 30 days nightly.
--
-- COST ON THE FREE TIER
--   Two extra invocations a day. The nightly deep pulls are one request each
--   with a wider date range, not more requests.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- PostEx: nightly deep sweep
-- ---------------------------------------------------------------------------
select cron.unschedule('sync_postex_orders_deep')
 where exists (select 1 from cron.job where jobname = 'sync_postex_orders_deep');

select cron.schedule('sync_postex_orders_deep', '40 21 * * *',
  $$select call_sync('postex-sync', '{"action":"postex_pull","days":45}'::jsonb)$$);

-- ---------------------------------------------------------------------------
-- Shopify: nightly deep sweep for orders and for tracking numbers
-- dry_run is explicit — shopify-sync defaults to preview mode and would
-- otherwise run and write nothing.
-- ---------------------------------------------------------------------------
select cron.unschedule('sync_shopify_orders_deep')
 where exists (select 1 from cron.job where jobname = 'sync_shopify_orders_deep');

select cron.schedule('sync_shopify_orders_deep', '50 21 * * *',
  $$select call_sync('shopify-sync', '{"action":"pull_orders","days":30,"pages":20,"dry_run":false,"max_seconds":110}'::jsonb)$$);

select cron.unschedule('sync_shopify_tracking_deep')
 where exists (select 1 from cron.job where jobname = 'sync_shopify_tracking_deep');

select cron.schedule('sync_shopify_tracking_deep', '5 22 * * *',
  $$select call_sync('shopify-sync', '{"action":"pull_fulfillments","days":30,"pages":20,"dry_run":false,"max_seconds":110}'::jsonb)$$);

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- select jobname, schedule, active from cron.job order by jobname;
--
-- -- THE ONLY FAIR COMPARISON WITH THE APP.
-- -- A plain group-by on delivery_status will NOT match the cards: the cards
-- -- combine Returned + RTS into one bucket, then split "still coming back" out
-- -- of it by raw_status. This function is what the cards actually call.
-- select * from hub_logistics_summary(null, null, 'ALL', 'PostEx');
-- select * from hub_logistics_summary(null, null, 'ALL', 'OwnEx');
