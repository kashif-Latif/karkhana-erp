-- 0088_ownex_return_sign.sql
--
-- 153 OwnEx RETURNS ARE MARKED PAID, WORTH Rs 361,183 OF REVENUE THAT NEVER
-- ARRIVED. Both the cause and the reason 0084 missed them are the same bug.
--
-- THE BUG
--   OwnEx writes Net Total from its own point of view:
--
--       delivered   -3,349.00    negative — the courier owes YOU
--       returned      +150.00    positive — YOU owe the courier the shipping
--
--   The importer took the absolute value of that column so delivered parcels
--   would read as positive receipts. That was right for deliveries and wrong
--   for returns: a charge was stored as if it were money received.
--
-- WHY 0084 DID NOT CATCH IT
--   0084 cleared returned-but-paid parcels only where the recorded net was
--   <= 0, precisely so it would never touch a row that looked like a real
--   payment. These rows looked like real payments — because the sign had been
--   destroyed before they were written. The guard did its job on the
--   information it had; the information was wrong.
--
--   That is the more useful lesson: a safety rule can only be as honest as the
--   data it reads, so the data is fixed first here, and the clearing follows
--   from it rather than being applied on top.
--
-- ORDER OF OPERATIONS
--   1. restore the sign on OwnEx return rows — a charge becomes negative
--   2. clear the payment on returned parcels, now that 0084's rule can see
--      them properly
--
-- The parser is fixed too, so a re-import writes the correct sign. Nothing here
-- depends on that: it repairs what is already stored.
--
-- REVERSIBLE — old values go to online_payment_corrections first.
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. The sign. A return charge is a cost, and a cost is negative.
--    Only OwnEx: PostEx's CPR already carries its own signs correctly and its
--    return rows were stored negative from the start.
-- ---------------------------------------------------------------------------
update online_logistics
   set cpr_net_amount = -abs(cpr_net_amount),
       updated_at     = now()
 where courier = 'OwnEx'
   and delivery_status in ('Returned', 'RTS')
   and cpr_net_amount > 0;

-- ---------------------------------------------------------------------------
-- 2. Record what is about to change, then clear the false payments.
--    Same rule and same audit table as 0084 — it can now see these rows because
--    step 1 gave them an honest sign.
-- ---------------------------------------------------------------------------
insert into online_payment_corrections (
    tracking_id, courier, delivery_status, old_payment_status, old_payment_date,
    old_cpr_number, cod_amount, cpr_net_amount, reason)
select l.tracking_id, l.courier, l.delivery_status, l.payment_status, l.payment_date,
       l.cpr_number, l.cod_amount, l.cpr_net_amount,
       '0088: OwnEx return marked paid; net sign was inverted on import'
  from online_logistics l
 where l.courier = 'OwnEx'
   and l.delivery_status in ('Returned', 'RTS')
   and coalesce(l.payment_status, '') in ('Paid', 'Received')
   and not exists (
     select 1 from online_payment_corrections c
      where c.tracking_id = l.tracking_id and c.reason like '0088:%');

update online_logistics
   set payment_status = null,
       payment_date   = null,
       updated_at     = now()
 where courier = 'OwnEx'
   and delivery_status in ('Returned', 'RTS')
   and coalesce(payment_status, '') in ('Paid', 'Received');

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- 1. Must return no rows at all, for either courier.
-- select courier, count(*) as returned_but_paid
--   from online_logistics
--  where delivery_status in ('Returned','RTS')
--    and coalesce(payment_status,'') in ('Paid','Received')
--  group by courier;
--
-- -- 2. What this removed from revenue.
-- select count(*) as corrected,
--        to_char(sum(cod_amount), 'FM999,999,999') as cod_no_longer_counted
--   from online_payment_corrections where reason like '0088:%';
--
-- -- 3. received_gross for OwnEx should fall by roughly Rs 361,183.
-- select * from hub_finance_by_courier(null, null, 'ALL');
--
-- ===========================================================================
-- UNDO
-- ===========================================================================
-- update online_logistics l
--    set payment_status = c.old_payment_status, payment_date = c.old_payment_date
--   from online_payment_corrections c
--  where c.tracking_id = l.tracking_id and c.reason like '0088:%';
-- ===========================================================================
