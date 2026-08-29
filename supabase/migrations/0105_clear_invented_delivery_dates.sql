-- 0105_clear_invented_delivery_dates.sql
--
-- A PARCEL CANNOT BE DELIVERED BEFORE IT WAS DISPATCHED, AND IT IS RARELY
-- DELIVERED TWENTY-ONE MONTHS AFTER.
--
--   #1491   ordered 24 Nov 2024   dispatched 25 Nov 2024   "delivered" 25 Aug 2026
--   #4715   dispatched 30 May 2025                         "delivered" 25 Aug 2026
--   #10230  dispatched 26 Feb 2026                         "delivered" 25 Aug 2026
--
-- postex-sync did this. When PostEx returned no delivery date it fell back to
-- `new Date()`:
--
--     upd.delivery_date = day(t.orderDeliveryDate) ?? today
--
-- PostEx drops that field on older parcels, so everything it reported on 25
-- August was stamped 25 August. Twenty Little Minors parcels share that date
-- for no reason other than that being the day we asked.
--
-- WHY IT MATTERS MORE THAN A WRONG DATE ON A SCREEN
--   delivery_date drives the age column, the position in the returns list, and
--   any rule that judges by age. The nine-day rule in 0104 would have treated a
--   parcel from November 2024 as four days old and protected it from closure,
--   while closing genuinely recent ones around it.
--
-- THE FIX IS TO REMOVE THE GUESS, NOT TO REPLACE IT
--   A missing date is missing. Nulling it lets the returns page fall back to
--   dispatch_date, which is real and which the parcel has always carried. An
--   invented date is worse than none, because nothing downstream can tell it
--   was invented.
--
--   The sync is fixed too, so this does not come back. Redeploy postex-sync
--   BEFORE running this, or the next poll writes the same dates again.
--
-- WHAT COUNTS AS INVENTED
--   delivery_date earlier than dispatch_date — impossible, or
--   delivery_date more than 90 days after dispatch. PostEx delivers within days.
--   Three months later is not a slow delivery, it is a date from somewhere else.
--
-- REVERSIBLE. Old values go to online_payment_corrections first.
-- Safe to run more than once.

begin;

insert into online_payment_corrections (
    tracking_id, courier, delivery_status, old_payment_status,
    old_cpr_number, cod_amount, cpr_net_amount, reason)
select l.tracking_id, l.courier, l.delivery_status, l.payment_status,
       l.cpr_number, l.cod_amount, l.cpr_net_amount,
       '0105: delivery_date ' || l.delivery_date || ' was stamped by the sync, not sent by PostEx (dispatched ' || l.dispatch_date || ')'
  from online_logistics l
 where l.courier = 'PostEx'
   and l.delivery_date is not null
   and l.dispatch_date is not null
   and (l.delivery_date < l.dispatch_date
        or l.delivery_date > l.dispatch_date + 90)
   and not exists (
     select 1 from online_payment_corrections c
      where c.tracking_id = l.tracking_id and c.reason like '0105:%');

update online_logistics l
   set delivery_date = null,
       updated_at    = now()
 where l.courier = 'PostEx'
   and l.delivery_date is not null
   and l.dispatch_date is not null
   and (l.delivery_date < l.dispatch_date
        or l.delivery_date > l.dispatch_date + 90);

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- 1. How many were cleared, and what they looked like.
-- select count(*) as cleared from online_payment_corrections where reason like '0105:%';
--
-- -- 2. No impossible dates left. Must be 0.
-- select count(*) from online_logistics
--  where delivery_date is not null and dispatch_date is not null
--    and (delivery_date < dispatch_date or delivery_date > dispatch_date + 90);
--
-- -- 3. The returns list now judges those parcels on dispatch_date, which is
-- --    real — so the old ones should look old again.
-- select l.order_number, l.store_code, l.dispatch_date, l.delivery_date,
--        current_date - coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date) as age_days
--   from online_logistics l
--  where l.order_number in ('#1491','#4715','#10230','#1607')
--  order by age_days desc;
--
-- ===========================================================================
-- UNDO
-- ===========================================================================
-- There is nothing to restore: the values removed were never real. If the dates
-- are wanted back, they are recorded in the reason text of
-- online_payment_corrections where reason like '0105:%'.
-- ===========================================================================
