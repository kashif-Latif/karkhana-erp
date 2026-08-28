-- 0101_returns_from_july.sql
--
-- CHASE ONLY WHAT IS STILL WORTH CHASING: RETURNS FROM 1 JULY ONWARDS.
--
-- 0085 drew the line four months back, at 27 April 2026, which was the right
-- call at the time. The line has moved: anything that started its way back
-- before 1 July is no longer being pursued, in Shopify or here, so leaving it
-- in Pending returns makes the list longer without making it more useful.
--
-- A chase list is only worth reading if every row on it is a box somebody
-- intends to go and find. Rows nobody will act on train people to skim, and
-- then the ones that matter get skimmed too.
--
-- WHAT CLOSED DOES AND DOES NOT MEAN
--   Closed here means "stop asking", not "we got it back". return_closed_reason
--   records which it was, so a parcel closed in bulk is never mistaken for one
--   somebody physically received and confirmed. That distinction is the whole
--   reason the column exists.
--
--   Money is untouched. These parcels were returns, they were never paid, and
--   closing the chase does not make them income.
--
-- REVERSIBLE. Every row's previous state goes to online_return_closures first,
-- and the undo is one update, at the bottom.
--
-- Safe to run more than once.

begin;

do $do$
declare
  -- The new line. Anything that started coming back before this is closed.
  p_cutoff date := date '2026-07-01';
  v_closed integer;
  v_left   integer;
begin

  insert into online_return_closures (
      tracking_id, courier, order_number, store_code, delivery_status,
      return_date, age_days, cod_amount, old_return_received_at, reason)
  select l.tracking_id, l.courier, l.order_number, l.store_code, l.delivery_status,
         coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date),
         current_date - coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date),
         l.cod_amount, l.return_received_at,
         '0101: return started before ' || p_cutoff || ', no longer chased'
    from online_logistics l
   where l.delivery_status in ('Returned', 'RTS')
     and l.return_received_at is null
     and coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date) < p_cutoff
     and not exists (
       select 1 from online_return_closures c
        where c.tracking_id = l.tracking_id and c.reason like '0101:%');

  update online_logistics l
     set return_received_at   = now(),
         return_closed_reason = 'aged: closed in bulk, not physically confirmed',
         updated_at           = now()
   where l.delivery_status in ('Returned', 'RTS')
     and l.return_received_at is null
     and coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date) < p_cutoff;

  get diagnostics v_closed = row_count;

  /* cancelled_at lives on online_orders, not on online_logistics — a parcel
     does not get cancelled, an order does. 0073 joins on order_number AND
     store_code together, because order numbers repeat across the three stores
     and matching on the number alone would pair a Little Minors return with a
     TopShop order. */
  select count(*) into v_left
    from online_logistics l
    left join online_orders o
           on o.order_number = l.order_number
          and o.store_code   = l.store_code
   where l.delivery_status in ('Returned', 'RTS')
     and l.return_received_at is null
     and o.cancelled_at is null;

  raise notice '0101: closed % returns older than %; % still being chased',
               v_closed, p_cutoff, v_left;
end
$do$;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- 1. Nothing left in the chase list from before 1 July. Must be 0.
-- select count(*) as still_pending_before_july
--   from online_logistics
--  where delivery_status in ('Returned','RTS')
--    and return_received_at is null
--    and coalesce(return_leg_started_at::date, delivery_date, dispatch_date) < date '2026-07-01';
--
-- -- 2. What is left, and how old the oldest one is.
-- select count(*) as chasing,
--        min(coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date)) as oldest,
--        current_date - min(coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date)) as days
--   from online_logistics l
--   left join online_orders o on o.order_number = l.order_number
--                            and o.store_code   = l.store_code
--  where l.delivery_status in ('Returned','RTS')
--    and l.return_received_at is null and o.cancelled_at is null;
--
-- -- 3. Closed in bulk versus genuinely received — these must stay separable.
-- select coalesce(return_closed_reason, 'physically received') as how, count(*)
--   from online_logistics
--  where delivery_status in ('Returned','RTS') and return_received_at is not null
--  group by 1;
--
-- ===========================================================================
-- UNDO
-- ===========================================================================
-- update online_logistics l
--    set return_received_at = c.old_return_received_at, return_closed_reason = null
--   from online_return_closures c
--  where c.tracking_id = l.tracking_id and c.reason like '0101:%';
-- ===========================================================================
