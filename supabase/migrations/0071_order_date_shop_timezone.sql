-- 0071_order_date_shop_timezone.sql
--
-- THE BUG
--   order_date was Shopify's created_at cut to its first ten characters — a
--   UTC date. The shop trades in Asia/Karachi, UTC+5. An order placed at 02:00
--   local is 21:00 UTC the day BEFORE, so it was filed to yesterday.
--
--   Every window inherited the error. Measured on Little Minors, last 7 days:
--       by UTC date          183
--       by Karachi date      190
--       by rolling 168h      212
--       Shopify's dashboard  231
--   The spread inside our own data was larger than the gap to Shopify, which is
--   why no window ever agreed with the store.
--
--   Both edge functions now compute the date in Asia/Karachi. This corrects the
--   rows already written.
--
-- SCOPE
--   Only rows that carry shopify_created_at can be recomputed — that is the
--   only trustworthy source. Rows from Smart import have no such timestamp and
--   are left exactly as they are, because inventing one would be worse than an
--   imperfect date.
--
-- Safe to run more than once: the second run finds nothing to change.

begin;

update online_orders
   set order_date = (shopify_created_at at time zone 'Asia/Karachi')::date
 where shopify_created_at is not null
   and order_date is distinct from (shopify_created_at at time zone 'Asia/Karachi')::date;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- must return 0
-- select count(*) as should_be_zero
--   from online_orders
--  where shopify_created_at is not null
--    and order_date <> (shopify_created_at at time zone 'Asia/Karachi')::date;
--
-- -- how many rows still have no Shopify timestamp at all. These predate the
-- -- current sync; "Fetch all history" is what fills them.
-- select store_code,
--        count(*) filter (where shopify_created_at is null) as never_synced,
--        count(*)                                            as total
--   from online_orders group by 1 order by 1;
--
-- -- and the page's own figures, now on shop-local days
-- select * from hub_orders_summary(current_date - 6, current_date, 'LM');
