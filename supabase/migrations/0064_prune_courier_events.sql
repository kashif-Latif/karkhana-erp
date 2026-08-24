-- 0064_prune_courier_events.sql
--
-- 0063 guarded its pruning block behind a column check and correctly skipped,
-- because online_courier_events has no `created_at` — its timestamp column is
-- `received_at`. The guard did its job: it refused rather than erroring on an
-- assumed column name. This finishes it.
--
-- The dedup trigger from 0063 is already live and is doing the heavy lifting —
-- it stops ~2.4M identical rows a month ever being written. Pruning is the
-- second line: it caps how far back the CHANGE history is kept.

-- one-off cleanup of anything already past the window
delete from online_courier_events
 where received_at < now() - interval '120 days';

-- and keep it capped, nightly at 03:30
select cron.unschedule('prune_courier_events')
 where exists (select 1 from cron.job where jobname = 'prune_courier_events');

select cron.schedule(
  'prune_courier_events',
  '30 3 * * *',
  $$delete from online_courier_events where received_at < now() - interval '120 days'$$
);

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- select jobname, schedule, active from cron.job where jobname = 'prune_courier_events';
--
-- -- is the dedup trigger actually biting? with it on, this should be tens per
-- -- hour, not thousands
-- select date_trunc('hour', received_at) as hour, count(*)
--   from online_courier_events
--  where received_at > now() - interval '6 hours'
--  group by 1 order by 1 desc;
