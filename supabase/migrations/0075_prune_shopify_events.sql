-- 0075_prune_shopify_events.sql
--
-- THE GROWTH PROBLEM
--   online_shopify_events stores the FULL JSON payload of every webhook. A
--   Shopify order payload is 8–15 KB and roughly 666 events arrive a day across
--   three stores — about 8 MB/day, 240 MB/month. The free tier is 500 MB in
--   total and the database is already at 69 MB, so this alone would fill it in
--   about seven weeks.
--
-- WHY THE PAYLOAD IS THERE AT ALL, AND WHY IT CAN GO
--   Two jobs, with very different lifespans:
--
--     IDEMPOTENCY  the unique index on webhook_id stops Shopify's retries being
--                  processed twice. Shopify retries for at most 48 HOURS, so
--                  beyond that the row still matters but the payload does not.
--
--     AUDIT        when a figure looks wrong, the raw payload shows exactly what
--                  Shopify sent. Worth days, not months.
--
--   So: keep every ROW (tiny — an id, a topic, a timestamp), and drop the
--   PAYLOAD after 7 days. Idempotency survives untouched, recent debugging
--   survives, and the bulk stops accumulating.
--
--   Rows themselves are deleted after 90 days, by which point neither job applies.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Clear payloads already past the window
-- ---------------------------------------------------------------------------
update online_shopify_events
   set payload = null,
       note = coalesce(note || ' · ', '') || 'payload pruned'
 where payload is not null
   and received_at < now() - interval '7 days';

-- 2. And drop rows old enough that neither idempotency nor audit applies
delete from online_shopify_events
 where received_at < now() - interval '90 days';

-- ---------------------------------------------------------------------------
-- 3. Keep it capped, nightly at 03:45 UTC
-- ---------------------------------------------------------------------------
select cron.unschedule('prune_shopify_events')
 where exists (select 1 from cron.job where jobname = 'prune_shopify_events');

select cron.schedule(
  'prune_shopify_events',
  '45 3 * * *',
  $$
    update online_shopify_events set payload = null
     where payload is not null and received_at < now() - interval '7 days';
    delete from online_shopify_events
     where received_at < now() - interval '90 days';
  $$
);

-- ---------------------------------------------------------------------------
-- 4. Reclaim the space.
--    DELETE and UPDATE only mark rows dead; the file does not shrink until
--    vacuum runs. Autovacuum will get there eventually, but not today — and
--    today is when you want the number to move.
--    Cannot run inside a transaction block, so it sits at the end alone.
-- ---------------------------------------------------------------------------
vacuum full online_shopify_events;
vacuum full online_courier_events;

-- ===========================================================================
-- VERIFY — run before and after; the difference is what you reclaimed.
-- ===========================================================================
-- select pg_size_pretty(pg_database_size(current_database())) as db_size;
--
-- select relname as table,
--        pg_size_pretty(pg_total_relation_size(c.oid)) as size
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relkind = 'r'
--  order by pg_total_relation_size(c.oid) desc limit 10;
--
-- select count(*) as rows,
--        count(*) filter (where payload is not null) as still_holding_payload
--   from online_shopify_events;
