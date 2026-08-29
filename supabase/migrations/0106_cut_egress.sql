-- 0106_cut_egress.sql
--
-- 600 MB OF EGRESS AGAINST AN OLD SYSTEM THAT USED 131.
--
-- The database itself is fine — 63 MB against the old system's 161, on 2.6x the
-- data. Egress is the problem, and almost all of it is self-inflicted.
--
-- WHERE IT GOES
--   PostEx is polled every 5 minutes and OwnEx every 5 minutes. That is 288
--   runs each per day, 576 in total, every one of them reading a few hundred
--   parcels out of the database and sending them to an edge function.
--
--   A parcel's courier status does not change in five minutes. It changes a
--   handful of times over several days. Polling twelve times an hour to catch
--   an event that happens twice a week is asking the same question 500 times to
--   hear a different answer twice.
--
-- WHAT CHANGES
--   Status polling drops from every 5 minutes to every 15 — a third of the
--   traffic, and the slowest anyone will ever see a status change is fifteen
--   minutes instead of five. Nobody is watching a parcel that closely.
--
--   OwnEx's stale_minutes goes from 10 to 25 to match. That setting is what
--   stops a run re-reading parcels it already checked; left at 10 with a
--   15-minute schedule, every run would re-read everything and the saving would
--   be lost.
--
--   Shopify webhooks still arrive in seconds and are untouched. New PostEx
--   parcels are still picked up every 15 minutes. Nothing about how fast an
--   ORDER appears changes; only how often a courier is re-asked about a parcel
--   it already answered on.
--
--   online_shopify_events doubled in a day — 1,691 rows to 3,298, 8 MB to 15 —
--   because every webhook body is stored whole, about 5 KB each. 0075 prunes
--   payloads after 7 days; 2 is plenty. The body is only ever read while
--   debugging a webhook that arrived today.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. Poll a third as often.
-- ---------------------------------------------------------------------------
select cron.unschedule('sync_postex_status') where exists (
  select 1 from cron.job where jobname = 'sync_postex_status');
select cron.unschedule('sync_ownex_status') where exists (
  select 1 from cron.job where jobname = 'sync_ownex_status');

-- Offset by a few minutes so the two couriers never run in the same second and
-- compete for the same connection pool.
-- The helper is call_sync, and the bodies are copied verbatim from 0069 with
-- only the schedule changed. Inventing a simpler-looking call would drop the
-- limit, max_seconds and stale_minutes that actually control what each run does
-- — stale_minutes in particular is what stops OwnEx re-reading parcels it
-- checked moments ago, and it is raised to match the new interval.
select cron.schedule('sync_postex_status', '*/15 * * * *',
  $$select call_sync('postex-sync', '{"action":"postex_track","limit":250}'::jsonb)$$);

select cron.schedule('sync_ownex_status', '7-59/15 * * * *',
  $$select call_sync('ownex-sync', '{"action":"track","limit":300,"max_seconds":120,"stale_minutes":25}'::jsonb)$$);

-- ---------------------------------------------------------------------------
-- 2. Keep webhook bodies for 2 days, not 7.
--    The row stays — what arrived, when, for which order. Only the payload
--    goes, and that is only ever read while debugging something from today.
-- ---------------------------------------------------------------------------
create or replace function prune_shopify_events()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update online_shopify_events
     set payload = null
   where payload is not null
     and received_at < now() - interval '2 days';

  delete from online_shopify_events
   where received_at < now() - interval '30 days';
$function$;

-- Clear the backlog now rather than waiting for tonight.
select prune_shopify_events();

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- The two status jobs should now read */15 and 7-59/15.
-- select jobname, schedule, active from cron.job order by jobname;
--
-- -- online_shopify_events should have dropped sharply.
-- select count(*) as rows, count(payload) as still_holding_a_body,
--        pg_size_pretty(pg_total_relation_size('online_shopify_events')) as size
--   from online_shopify_events;
--
-- -- Then reclaim the space. NEW EMPTY TAB, on its own — vacuum cannot run
-- -- inside a transaction:
-- --   vacuum full online_shopify_events;
-- --   vacuum full online_orders;
-- ===========================================================================
--
-- WHAT THIS SHOULD DO TO THE BILL
--   sync egress          ~40 MB/day -> ~13 MB/day
--   shopify_events        15 MB -> about 4 MB after vacuuming
--   the rest of today's 600 MB was diagnostics, deploys and one-off imports,
--   none of which repeats.
-- ===========================================================================
