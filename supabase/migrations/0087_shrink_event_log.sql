-- 0087_shrink_event_log.sql
--
-- 63% OF THE EVENT LOG SAYS NOTHING.
--
--     online_courier_events   70,325 rows   14 MB   biggest table in the database
--     redundant               44,137 rows   the same parcel and the same status,
--                                           written again and again
--
-- Database growth was 10-20 MB a day against an expected 1-2, which puts the
-- 500 MB free-tier ceiling about three weeks away rather than four months.
--
-- WHERE THE ROWS CAME FROM — both were mine
--   ownex-sync logged an event BEFORE checking whether anything had changed, so
--   a parcel sitting in transit wrote one every five minutes, forever.
--   postex-sync's pull inserted up to 500 rows on every run, 96 runs a day, for
--   parcels whose status is already on the parcel with updated_at beside it.
--
--   Both are fixed in the functions. Redeploy them or this backlog rebuilds.
--
-- AN EVENT LOG IS A RECORD OF CHANGE. A parcel that has not moved is not an
-- event; it is the absence of one. What is worth keeping is the first time a
-- parcel entered each status — that is the movement history the return-leg
-- detection actually reads. Every repeat after that is noise.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- Keep the EARLIEST event per parcel per status — the moment it first entered
-- that state. Drop every later repeat.
--
-- Earliest rather than latest on purpose: "when did this parcel first go RTS"
-- is a question the system asks; "when did we last notice it was still RTS" is
-- not a question anyone has.
-- ---------------------------------------------------------------------------
delete from online_courier_events e
 where exists (
   select 1 from online_courier_events k
    where k.tracking_id = e.tracking_id
      and k.courier     = e.courier
      and coalesce(k.raw_status, '') = coalesce(e.raw_status, '')
      and (k.id < e.id)
 );

-- ---------------------------------------------------------------------------
-- Stop it happening again at the database level too, not only in the functions.
-- A repeat insert now hits this index and is discarded rather than stored.
--
-- Belt and braces deliberately: the functions are the real fix, but they are
-- deployed by hand and a missed redeploy would quietly refill the table.
-- ---------------------------------------------------------------------------
create unique index if not exists online_courier_events_uniq
  on online_courier_events (courier, tracking_id, coalesce(raw_status, ''));

commit;

-- ===========================================================================
-- VACUUM CANNOT RUN INSIDE A TRANSACTION, so it is not in this file.
-- Deleting rows frees nothing on disk until the space is reclaimed.
--
-- Open a NEW, EMPTY query tab and run this on its own:
--
--     vacuum full online_courier_events;
--
-- It briefly locks the table; the syncs will retry, so run it when you are not
-- mid-import. Expect the 14 MB to drop to roughly 5.
-- ===========================================================================

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- select count(*) as rows_left,
--        count(*) - count(distinct (courier, tracking_id, raw_status)) as still_redundant
--   from online_courier_events;   -- still_redundant must be 0
--
-- select relname, to_char(n_live_tup,'FM999,999,999') as rows,
--        pg_size_pretty(pg_total_relation_size(relid)) as size
--   from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 5;
--
-- -- Then watch it for a day. Growth should fall to a few hundred rows, not
-- -- tens of thousands:
-- select count(*) from online_courier_events;
-- ===========================================================================
