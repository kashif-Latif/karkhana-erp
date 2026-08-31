-- 0108_fix_ownex_gross_totals.sql
--
-- OWNEX SETTLEMENTS STORED THE NET IN THE GROSS COLUMN.
--
--   Total          Rs 258,315
--   Shipping        (26,340)
--   GST              (5,268)
--   Net Total      Rs 258,315   <- identical, with 31,608 of deductions between
--
-- The importer read `gross` from the invoice's COD total and `net` from its
-- grand total. On an OwnEx invoice those are the SAME figure — the amount
-- actually paid — so both columns received the net and the deductions listed
-- between them visibly changed nothing.
--
-- The parser is fixed, but a parser fix only reaches settlements imported
-- afterwards. The 18 OwnEx invoices already in the table keep the wrong figure
-- until it is corrected here.
--
-- PostEx was never affected: a CPR states its gross and its net separately, so
-- both columns were read from their own line.
--
-- NO MONEY MOVES. gross_total is a display figure on the settlement header;
-- every payment, every match and every receivable is computed from net_total
-- and the per-parcel rows, none of which are touched. This makes a column that
-- is read top to bottom actually add up.
--
--   corrected gross = net + shipping + gst
--   258,315 + 26,340 + 5,268 = 289,923
--
-- Only rows where the two are still identical are touched, so running it twice
-- changes nothing the second time.

begin;

update online_cpr
   set gross_total = round(
         coalesce(net_total, 0)
         + coalesce(shipping_charges, 0)
         + coalesce(gst, 0), 2)
 where courier = 'OwnEx'
   and net_total is not null
   and gross_total = net_total
   and (coalesce(shipping_charges, 0) + coalesce(gst, 0)) > 0;

commit;

-- ===========================================================================
-- VERIFY — every OwnEx settlement should now read gross = net + charges.
-- ===========================================================================
-- select cpr_number, cpr_date,
--        gross_total, shipping_charges, gst, net_total,
--        round(gross_total - shipping_charges - gst - net_total, 2) as should_be_zero
--   from online_cpr
--  where courier = 'OwnEx'
--  order by cpr_date desc;
--
-- -- INV-20250013 should read 289,923 gross against 258,315 net.
-- -- INV-20250019 should read 734,795 gross against 641,891 net.
--
-- -- And nothing PostEx moved:
-- select count(*) as postex_rows_where_gross_equals_net
--   from online_cpr where courier = 'PostEx' and gross_total = net_total;
--
-- ===========================================================================
-- UNDO
-- ===========================================================================
-- update online_cpr set gross_total = net_total
--  where courier = 'OwnEx'
--    and gross_total = round(net_total + coalesce(shipping_charges,0) + coalesce(gst,0), 2);
-- ===========================================================================
