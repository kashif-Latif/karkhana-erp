-- 0104_postex_returns_nine_days.sql
--
-- POSTEX RETURNS STOP BEING CHASED AFTER NINE DAYS. OWNEX IS UNTOUCHED.
--
-- A PostEx parcel that started coming back more than nine days ago is either
-- back in the warehouse or it is not coming. Either way nobody is still
-- pursuing it, and a chase list only works if every row on it is a box somebody
-- intends to find. Rows nobody will act on teach people to skim — and then the
-- ones that matter get skimmed too.
--
-- WHY THIS IS A SCHEDULED JOB AND NOT A ONE-OFF UPDATE
--   A cutoff written into a migration is true on the day it runs and wrong
--   every day after. 0085 closed at four months, 0101 at 1 July, and each
--   needed doing again as the line moved. Nine days from *today* has to be
--   recalculated daily or it is just another fixed date with a friendlier name.
--
-- WHY POSTEX ONLY
--   OwnEx settles returns differently and its volumes are small enough to work
--   through by hand. Applying one courier's rule to the other because it is
--   convenient is how a rule stops meaning anything.
--
-- WHICH DATE IT JUDGES
--   coalesce(return_leg_started_at, delivery_date, dispatch_date) — the same
--   expression the returns page displays, so a parcel is never closed on a date
--   different from the one shown next to it.
--
--   PostEx never populates return_leg_started_at: all 101 open returns had it
--   empty, so in practice this reads delivery_date, the day PostEx attempted
--   delivery. Those dates spread naturally across July and August, which is how
--   we know they are real rather than the 2026-06-01 backfill placeholder that
--   the older history rows carry.
--
-- CLOSED MEANS STOP ASKING, NOT WE GOT IT BACK. return_closed_reason records
-- which, so a parcel closed by this job is never mistaken for one somebody
-- physically received. No money moves: these were returns, never paid.
--
-- Safe to run more than once.

begin;

create or replace function hub_close_aged_postex_returns(p_days integer default 9)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cutoff date := current_date - p_days;
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
         'auto: PostEx return older than ' || p_days || ' days'
    from online_logistics l
   where l.courier = 'PostEx'
     and l.delivery_status in ('Returned', 'RTS')
     and l.return_received_at is null
     and coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date) < v_cutoff;

  update online_logistics l
     set return_received_at   = now(),
         return_closed_reason = 'aged: PostEx return over ' || p_days || ' days, closed automatically',
         updated_at           = now()
   where l.courier = 'PostEx'
     and l.delivery_status in ('Returned', 'RTS')
     and l.return_received_at is null
     and coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date) < v_cutoff;

  get diagnostics v_closed = row_count;

  select count(*) into v_left
    from online_logistics l
    left join online_orders o on o.order_number = l.order_number
                             and o.store_code   = l.store_code
   where l.delivery_status in ('Returned', 'RTS')
     and l.return_received_at is null
     and o.cancelled_at is null;

  return jsonb_build_object(
    'ok', true, 'cutoff', v_cutoff, 'closed', v_closed, 'still_chasing', v_left,
    'report', v_closed || ' PostEx returns older than ' || p_days ||
              ' days closed; ' || v_left || ' still being chased');
end;
$function$;

grant execute on function hub_close_aged_postex_returns(integer) to authenticated;

-- Run it once now for everything already past nine days.
select hub_close_aged_postex_returns(9);

commit;

-- ===========================================================================
-- SCHEDULE IT. Without this the rule is true today and stale tomorrow.
-- Runs at 03:20, before the morning's first attendance and after the courier
-- syncs have settled overnight.
-- ===========================================================================
select cron.schedule(
  'close_aged_postex_returns',
  '20 3 * * *',
  $cron$ select hub_close_aged_postex_returns(9); $cron$
);

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- Nothing PostEx older than nine days left in the chase list. Must be 0.
-- select count(*) from online_logistics l
--   left join online_orders o on o.order_number = l.order_number
--                            and o.store_code   = l.store_code
--  where l.courier = 'PostEx' and l.delivery_status in ('Returned','RTS')
--    and l.return_received_at is null and o.cancelled_at is null
--    and coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date)
--        < current_date - 9;
--
-- -- What is left, by courier. OwnEx must be unchanged.
-- select l.courier, count(*),
--        min(coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date)) as oldest
--   from online_logistics l
--   left join online_orders o on o.order_number = l.order_number
--                            and o.store_code   = l.store_code
--  where l.delivery_status in ('Returned','RTS')
--    and l.return_received_at is null and o.cancelled_at is null
--  group by l.courier;
--
-- -- Closed automatically versus physically received — these must stay apart.
-- select coalesce(return_closed_reason, 'physically received') as how, count(*)
--   from online_logistics
--  where delivery_status in ('Returned','RTS') and return_received_at is not null
--  group by 1;
--
-- ===========================================================================
-- UNDO — reopens everything this job closed
-- ===========================================================================
-- update online_logistics l
--    set return_received_at = c.old_return_received_at, return_closed_reason = null
--   from online_return_closures c
--  where c.tracking_id = l.tracking_id and c.reason like 'auto: PostEx return%';
--
-- -- and stop it happening again:
-- select cron.unschedule('close_aged_postex_returns');
-- ===========================================================================
