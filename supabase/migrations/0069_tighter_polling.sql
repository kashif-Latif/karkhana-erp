-- 0069_tighter_polling.sql   (OPTIONAL — read this before running it)
--
-- This halves the polling interval. Run it ONLY if the couriers' webhooks are
-- not going to be turned on, because a webhook makes all of this unnecessary:
-- pushed status arrives in about a second, and polling becomes a safety net
-- that could run every THIRTY minutes rather than every five.
--
-- WHAT IT COSTS
--   Supabase: nothing worth counting. Roughly 700 invocations a day against a
--   500,000/month free limit.
--
--   PostEx: this is the real cost. Their bulk tracking endpoint returns 405, so
--   postex_track makes ONE REQUEST PER PARCEL. At 250 parcels per run:
--       every 10 min  ->  ~36,000 requests/day
--       every  5 min  ->  ~72,000 requests/day
--   That is a lot of traffic into a merchant API with no published rate limit.
--   If PostEx starts refusing requests, this is why — put it back to */10.
--
-- WHY OWNEX ALSO NEEDS stale_minutes CHANGED
--   Its payload carries stale_minutes: 45 — a parcel checked within the last 45
--   minutes is skipped. That is the real freshness ceiling, NOT the cron
--   interval. Firing every 5 minutes without changing it only cycles the
--   backlog faster; nothing gets checked any sooner. Lowered to 10 below.
--
--   OwnEx is a public tracking endpoint with no key, so being polite matters:
--   concurrency stays low deliberately.
--
-- TO REVERSE: re-run 0066 and 0067, which set the original schedules.

-- ---------------------------------------------------------------------------
-- PostEx status: every 5 minutes
-- ---------------------------------------------------------------------------
select cron.unschedule('sync_postex_status')
 where exists (select 1 from cron.job where jobname = 'sync_postex_status');
select cron.schedule('sync_postex_status', '*/5 * * * *',
  $$select call_sync('postex-sync', '{"action":"postex_track","limit":250}'::jsonb)$$);

-- ---------------------------------------------------------------------------
-- OwnEx status: every 5 minutes AND a 10-minute staleness window, which is the
-- setting that actually controls freshness
-- ---------------------------------------------------------------------------
select cron.unschedule('sync_ownex_status')
 where exists (select 1 from cron.job where jobname = 'sync_ownex_status');
select cron.schedule('sync_ownex_status', '2-59/5 * * * *',
  $$select call_sync('ownex-sync', '{"action":"track","limit":300,"max_seconds":120,"stale_minutes":10}'::jsonb)$$);

-- ---------------------------------------------------------------------------
-- New PostEx parcels: every 15 minutes instead of 30
-- ---------------------------------------------------------------------------
select cron.unschedule('sync_postex_orders')
 where exists (select 1 from cron.job where jobname = 'sync_postex_orders');
select cron.schedule('sync_postex_orders', '*/15 * * * *',
  $$select call_sync('postex-sync', '{"action":"postex_pull","days":3}'::jsonb)$$);

-- ===========================================================================
-- VERIFY — and then WATCH THIS for a day.
-- ===========================================================================
-- select jobname, schedule, active from cron.job order by jobname;
--
-- -- If PostEx starts rate-limiting, it shows up here as non-200 replies or as
-- -- HTTP 429 inside the body. Check before assuming the tighter schedule is free.
-- select c.fn, c.called_at, r.status_code, left(r.content, 200) as reply
--   from hub_sync_calls c join net._http_response r on r.id = c.request_id
--  where c.fn = 'postex-sync'
--  order by c.called_at desc limit 20;
