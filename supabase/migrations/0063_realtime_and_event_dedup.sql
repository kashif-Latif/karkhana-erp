-- 0063_realtime_and_event_dedup.sql
--
-- TWO THINGS, BOTH REQUIRED FOR LIVE UPDATES ON A FREE PROJECT
--
-- 1. REALTIME
--    A webhook writing to the database in one second is only half the job — the
--    browser still shows yesterday's numbers until someone presses Refresh.
--    Publishing these tables lets the app subscribe and repaint itself.
--
-- 2. STOP THE EVENT LOG EATING THE DISK
--    ownex-sync and postex-sync insert one row into online_courier_events for
--    EVERY parcel checked on EVERY run, whether or not anything changed:
--
--        OwnEx   250 parcels x 144 runs/day  = 36,000 rows/day
--        PostEx  300 parcels x 144 runs/day  = 43,200 rows/day
--                                            ~ 2.4M rows/month, ~290 MB
--
--    The free tier is 500 MB in total. That fills the database in under two
--    months, and almost all of it is the same status recorded again. Polling any
--    faster multiplies it. The trigger below keeps a row only when the status
--    actually changed, which is what the log was for in the first place.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. Publish the live tables to Realtime
--    Realtime respects RLS, so a subscriber still only sees rows they could
--    have selected. Adding a table twice raises duplicate_object, hence the
--    guard — this file must stay re-runnable.
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table online_logistics;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table online_orders;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Only log a courier event when something actually changed
--    A BEFORE INSERT trigger returning NULL silently drops the row, which is
--    exactly what we want: the sync code needs no change, and the log becomes
--    a history of CHANGES rather than a history of polls.
-- ---------------------------------------------------------------------------
create index if not exists idx_courier_events_tracking_latest
  on online_courier_events (tracking_id, id desc);

create or replace function online_courier_events_dedup()
returns trigger
language plpgsql
as $$
declare
  prev text;
begin
  if new.tracking_id is null then
    return new;                       -- unmatched events are always worth keeping
  end if;

  select raw_status into prev
    from online_courier_events
   where tracking_id = new.tracking_id
   order by id desc
   limit 1;

  -- `is not distinct from` so two NULLs count as the same, which a plain
  -- equality test would not catch
  if prev is not distinct from new.raw_status then
    return null;                      -- nothing changed — do not store a copy
  end if;

  return new;
end $$;

drop trigger if exists trg_courier_events_dedup on online_courier_events;
create trigger trg_courier_events_dedup
  before insert on online_courier_events
  for each row execute function online_courier_events_dedup();

comment on function online_courier_events_dedup() is
  'Drops an incoming event whose status matches the last one recorded for that '
  'tracking id. Without it the syncs write ~2.4M identical rows a month, which '
  'fills a 500 MB project in under two months.';

commit;

-- ---------------------------------------------------------------------------
-- 3. Prune the history that is already there, and keep pruning
--    Done outside the transaction because cron.schedule cannot be rolled back
--    cleanly, and guarded because the timestamp column name must be verified
--    rather than assumed.
-- ---------------------------------------------------------------------------
do $$
declare
  ts_col text;
begin
  select column_name into ts_col
    from information_schema.columns
   where table_schema = 'public'
     and table_name  = 'online_courier_events'
     and column_name in ('created_at', 'received_at', 'inserted_at')
   order by case column_name
              when 'created_at'  then 1
              when 'received_at' then 2
              else 3
            end
   limit 1;

  if ts_col is null then
    raise notice 'online_courier_events has no timestamp column — pruning not scheduled';
    return;
  end if;

  -- one-off cleanup of what has already accumulated
  execute format(
    'delete from online_courier_events where %I < now() - interval ''120 days''',
    ts_col);

  perform cron.unschedule('prune_courier_events')
    where exists (select 1 from cron.job where jobname = 'prune_courier_events');

  perform cron.schedule(
    'prune_courier_events',
    '30 3 * * *',
    format('delete from online_courier_events where %I < now() - interval ''120 days''', ts_col));

  raise notice 'pruning scheduled on column %', ts_col;
end $$;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- both tables should be listed
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime';
--
-- -- how much the log is actually growing now
-- select pg_size_pretty(pg_total_relation_size('online_courier_events')) as event_log,
--        count(*) as rows
--   from online_courier_events;
--
-- -- whole database against the 500 MB free limit
-- select pg_size_pretty(pg_database_size(current_database())) as db_size;
