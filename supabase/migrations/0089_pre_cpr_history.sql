-- 0089_pre_cpr_history.sql
--
-- 3,222 PARCELS, Rs 7,055,075, DELIVERED BETWEEN SEP 2024 AND AUG 2025, SITTING
-- IN THE RECEIVABLE AS THOUGH POSTEX STILL OWES THE MONEY.
--
-- WHAT THEY ACTUALLY ARE
--   Real parcels, really delivered. PostEx almost certainly paid for them at
--   the time — the business ran through that period on that cash. What is
--   missing is the RECEIPT: the PostEx portal holds 93 CPRs going back to
--   22 Aug 2025 and nothing before it.
--
--   The shape of the data says the same thing. There is a clean gap between
--   30 days and 12 months with not one parcel in it:
--
--       0-30 days          63 parcels     Rs   158,313   real, chase these
--       (nothing at all between)
--       12-18 months    1,545 parcels     Rs 3,730,943
--       over 18 months  1,677 parcels     Rs 3,324,132
--
--   Two populations, not one trailing off. The old block is a different thing
--   from the recent 63, and treating them as one number made both meaningless.
--
-- WHY THEY ARE NOT MARKED 'Paid'
--   That would add Rs 7,055,075 to received_gross — inventing revenue from an
--   assumption. It is precisely the error 0084 and 0088 spent today removing,
--   and doing it deliberately would be worse than doing it by accident.
--
--   They are neither pending nor received. They need a third state: out of the
--   receivable, out of income, and labelled so nobody has to guess later.
--
-- WHAT THIS DOES NOT DO
--   Does not touch delivery_status — they were delivered, and that is true.
--   Does not touch cod_amount — the order was worth what it was worth.
--   Does not touch the 63 recent parcels. Those are a real question for PostEx:
--   a settlement should exist for them and does not.
--   Does not touch hub_finance_summary. The view keeps every column it had, so
--   the function above it is unaffected.
--
-- IF POSTEX EVER PRODUCES OLDER CPRs
--   Import them as normal. hub_cpr_import matches on tracking number and will
--   mark these parcels properly paid, which is why they are excluded rather
--   than closed off — the door stays open.
--
-- REVERSIBLE. One update, at the bottom.
-- Safe to run more than once.

begin;

alter table online_logistics
  add column if not exists receivable_excluded_at timestamptz,
  add column if not exists receivable_excluded_reason text;

comment on column online_logistics.receivable_excluded_at is
  'Set when a parcel is neither collectable nor countable as income — delivered before our earliest CPR, so no receipt exists either way. Excluded from v_finance_payments entirely rather than being called paid.';

-- ---------------------------------------------------------------------------
-- 1. Mark them. Delivered, before the oldest CPR we hold, never settled.
-- ---------------------------------------------------------------------------
update online_logistics
   set receivable_excluded_at     = now(),
       receivable_excluded_reason = 'delivered before our earliest CPR (22 Aug 2025); PostEx retains no receipt for this period',
       updated_at                 = now()
 where courier = 'PostEx'
   and delivery_status = 'Delivered'
   and cpr_number is null
   and coalesce(payment_status, '') not in ('Paid', 'Received')
   and delivery_date < date '2025-08-22'
   and receivable_excluded_at is null;

-- ---------------------------------------------------------------------------
-- 2. Take them out of the ledger.
--
-- DROP first: CREATE OR REPLACE VIEW cannot change a definition that reorders
-- or removes anything, and 0058 was lost to exactly that. Every column below is
-- identical to 0077 — only the WHERE gains a condition — so hub_finance_summary
-- and hub_finance_by_courier read it unchanged.
-- ---------------------------------------------------------------------------
drop view if exists v_finance_payments;

create view v_finance_payments as
select
  l.id,
  l.tracking_id,
  l.order_number,
  l.store_code,
  l.courier,
  l.delivery_status,
  l.cod_amount,
  l.cpr_net_amount,
  l.courier_fee,
  l.courier_tax,
  l.cpr_number,
  l.payment_status,
  l.payment_date,
  l.delivery_date,
  (coalesce(l.payment_status, '') in ('Paid', 'Received'))    as is_paid,
  coalesce(l.payment_date, l.delivery_date, l.dispatch_date)  as finance_date,
  case when coalesce(l.payment_status, '') in ('Paid', 'Received') then null
       else current_date - coalesce(l.delivery_date, l.dispatch_date) end
                                                              as age_days
from online_logistics l
where (l.delivery_status = 'Delivered'
    or coalesce(l.payment_status, '') in ('Paid', 'Received'))
  -- history with no receipt on either side of it
  and l.receivable_excluded_at is null;

grant select on v_finance_payments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Somewhere to see what was set aside, so it is excluded and not hidden.
-- ---------------------------------------------------------------------------
create or replace view v_finance_excluded as
select courier, store_code, order_number, tracking_id, delivery_date,
       cod_amount, receivable_excluded_reason, receivable_excluded_at,
       current_date - delivery_date as age_days
  from online_logistics
 where receivable_excluded_at is not null;

grant select on v_finance_excluded to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- 1. What was set aside. Expect ~3,222 parcels, ~Rs 7,055,075.
-- select count(*) as excluded,
--        to_char(sum(cod_amount), 'FM999,999,999') as cod,
--        min(delivery_date) as earliest, max(delivery_date) as latest
--   from v_finance_excluded;
--
-- -- 2. The receivable should now be the 63 recent parcels and nothing else.
-- --    received_gross must NOT have moved — no revenue was invented.
-- select * from hub_finance_by_courier(null, null, 'ALL');
--
-- -- 3. Those 63 are a real question for PostEx: delivered inside the period the
-- --    CPRs cover, and still unsettled.
-- select order_number, tracking_id, delivery_date, cod_amount
--   from v_finance_payments
--  where not is_paid and courier = 'PostEx'
--  order by delivery_date;
--
-- ===========================================================================
-- UNDO
-- ===========================================================================
-- update online_logistics
--    set receivable_excluded_at = null, receivable_excluded_reason = null
--  where receivable_excluded_reason like 'delivered before our earliest CPR%';
-- ===========================================================================
