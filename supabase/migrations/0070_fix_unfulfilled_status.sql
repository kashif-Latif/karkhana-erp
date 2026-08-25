-- 0070_fix_unfulfilled_status.sql
--
-- THE BUG
--   shopify-sync decided an order was dispatched with a substring test:
--
--       /FULFILLED/.test(displayFulfillmentStatus)
--
--   "UNFULFILLED" CONTAINS "FULFILLED", so the test returned true for every
--   unfulfilled order. All of them were written as Dispatched.
--
--   Measured: this project reported 3,316 dispatched and 3 pending, while the
--   old Grohub system showed 1,290 pending over the same window. The figures
--   were not drifting apart — they were inverted.
--
--   The edge function is fixed to compare exactly. This repairs the rows it
--   already wrote, and closes the same hole in the trigger.
--
-- WHY THE TRIGGER ALSO NEEDED CHANGING
--   online_orders_derive_status() from 0062 only set `status` when it was NULL,
--   so an incoming wrong value survived untouched. Since fulfillment_status,
--   financial_status and cancelled_at together fully determine the legacy
--   column, the trigger should own it outright rather than defer to whatever
--   the caller supplied.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. The trigger now derives `status`, rather than accepting one
-- ---------------------------------------------------------------------------
create or replace function online_orders_derive_status()
returns trigger
language plpgsql
as $$
begin
  -- Only take over when Shopify has actually told us something. Rows imported
  -- from CSV have no fulfillment_status and must keep the status they came with.
  if new.fulfillment_status is null and new.cancelled_at is null then
    if new.status is null then new.status := 'Pending'; end if;
    return new;
  end if;

  if new.cancelled_at is not null then
    new.status := 'Cancelled';
  elsif upper(coalesce(new.fulfillment_status, '')) in ('FULFILLED', 'PARTIALLY_FULFILLED') then
    new.status := 'Dispatched';
  elsif upper(coalesce(new.financial_status, '')) in ('REFUNDED', 'VOIDED') then
    new.status := 'Cancelled';
  else
    -- UNFULFILLED, ON_HOLD, SCHEDULED, RESTOCKED — none of these are dispatched
    new.status := 'Pending';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Repair what the bug already wrote
--    Touches only rows where Shopify gave us a fulfilment status, so anything
--    that arrived through Smart import is left exactly as it is.
-- ---------------------------------------------------------------------------
update online_orders
   set status = case
     when cancelled_at is not null then 'Cancelled'
     when upper(coalesce(fulfillment_status, '')) in ('FULFILLED', 'PARTIALLY_FULFILLED') then 'Dispatched'
     when upper(coalesce(financial_status, '')) in ('REFUNDED', 'VOIDED') then 'Cancelled'
     else 'Pending'
   end
 where fulfillment_status is not null
   and status is distinct from (case
     when cancelled_at is not null then 'Cancelled'
     when upper(coalesce(fulfillment_status, '')) in ('FULFILLED', 'PARTIALLY_FULFILLED') then 'Dispatched'
     when upper(coalesce(financial_status, '')) in ('REFUNDED', 'VOIDED') then 'Cancelled'
     else 'Pending'
   end);

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- Pending should now be a large number, not 3. Cross-check the split against
-- -- what Shopify itself reports for the same window.
-- select fulfillment_status, status, count(*)
--   from online_orders
--  where fulfillment_status is not null
--  group by 1, 2 order by 3 desc;
--
-- -- and the page's own figures
-- select * from hub_orders_summary(null, null, 'ALL');
--
-- -- nothing should remain in this list: UNFULFILLED can never be Dispatched
-- select count(*) as should_be_zero
--   from online_orders
--  where upper(fulfillment_status) = 'UNFULFILLED' and status = 'Dispatched';
