-- 0072_repair_all_order_status.sql
--
-- WHAT THE HEALTH CHECK FOUND
--   Among orders that Shopify says are CANCELLED (cancelled_at is not null):
--       fulfilled     343     <- lowercase; not a valid status here
--       unfulfilled   141     <- lowercase; not a valid status here
--       Cancelled     521     <- correct
--
--   So 484 cancelled orders were never marked cancelled, and were still being
--   counted as live. That is the "cancelled order stays in Pending" problem.
--
-- TWO CAUSES
--   1. A CSV import wrote Shopify's FULFILMENT column straight into `status`,
--      putting two different vocabularies in one column. `status` is meant to
--      hold Pending / Dispatched / Delivered / Cancelled / Returned — never
--      Shopify's own wording.
--   2. Migration 0070's repair was scoped `where fulfillment_status is not
--      null`. These rows have that column empty, so the repair skipped them.
--      My scope was too narrow; this one is not scoped.
--
-- THE RULE, ONCE, IN ONE PLACE
--   cancelled          -> Cancelled
--   fulfilled          -> Dispatched
--   refunded / voided  -> Cancelled
--   anything else      -> Pending
--   A courier outcome (delivered, returned) lives in online_logistics and is
--   never written here.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. The trigger now also rejects vocabulary it does not recognise.
--    Previously an unknown value like 'fulfilled' survived untouched, because
--    the trigger only stepped in when it had something better to say.
-- ---------------------------------------------------------------------------
create or replace function online_orders_derive_status()
returns trigger
language plpgsql
as $$
declare
  known constant text[] := array['Pending','Dispatched','Delivered','Cancelled','Returned'];
begin
  -- Cancellation is the strongest signal there is: a cancelled order is not
  -- pending, not dispatched, not anything else.
  if new.cancelled_at is not null then
    new.status := 'Cancelled';
    return new;
  end if;

  if upper(coalesce(new.fulfillment_status, '')) in ('FULFILLED', 'PARTIALLY_FULFILLED') then
    new.status := 'Dispatched';
    return new;
  end if;

  if upper(coalesce(new.financial_status, '')) in ('REFUNDED', 'VOIDED') then
    new.status := 'Cancelled';
    return new;
  end if;

  -- Shopify told us it is not fulfilled — that is Pending, whatever arrived.
  if new.fulfillment_status is not null then
    new.status := 'Pending';
    return new;
  end if;

  -- No Shopify signal at all (CSV import). Keep what came in ONLY if it is our
  -- own vocabulary; otherwise fall back rather than store a foreign word.
  if new.status is null or not (new.status = any(known)) then
    new.status := case
      when lower(coalesce(new.status,'')) like 'fulfil%'   then 'Dispatched'
      when lower(coalesce(new.status,'')) like 'unfulfil%' then 'Pending'
      when lower(coalesce(new.status,'')) like 'cancel%'   then 'Cancelled'
      when lower(coalesce(new.status,'')) like 'deliver%'  then 'Delivered'
      when lower(coalesce(new.status,'')) like 'return%'   then 'Returned'
      else 'Pending'
    end;
  end if;
  return new;
end $$;

-- Fire on status too, so a foreign value cannot be written by any path.
drop trigger if exists trg_online_orders_status on online_orders;
create trigger trg_online_orders_status
  before insert or update of financial_status, fulfillment_status, cancelled_at, status
  on online_orders
  for each row execute function online_orders_derive_status();

-- ---------------------------------------------------------------------------
-- 2. Repair every row. NOT scoped this time — that is what let 484 cancelled
--    orders slip through 0070.
-- ---------------------------------------------------------------------------
update online_orders
   set status = case
     when cancelled_at is not null then 'Cancelled'
     when upper(coalesce(fulfillment_status,'')) in ('FULFILLED','PARTIALLY_FULFILLED') then 'Dispatched'
     when upper(coalesce(financial_status,'')) in ('REFUNDED','VOIDED') then 'Cancelled'
     when fulfillment_status is not null then 'Pending'
     when lower(coalesce(status,'')) like 'fulfil%'   then 'Dispatched'
     when lower(coalesce(status,'')) like 'unfulfil%' then 'Pending'
     when lower(coalesce(status,'')) like 'cancel%'   then 'Cancelled'
     when lower(coalesce(status,'')) like 'deliver%'  then 'Delivered'
     when lower(coalesce(status,'')) like 'return%'   then 'Returned'
     when status in ('Pending','Dispatched','Delivered','Cancelled','Returned') then status
     else 'Pending'
   end;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- must be Cancelled only
-- select status, count(*) from online_orders where cancelled_at is not null group by 1;
--
-- -- must return only our five words
-- select distinct status from online_orders order by 1;
--
-- -- and the page's figures, which will shift as 484 orders leave Pending
-- select * from hub_orders_summary(null, null, 'ALL');
