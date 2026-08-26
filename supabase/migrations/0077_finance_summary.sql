-- 0077_finance_summary.sql
--
-- TWO BUGS ON THE FINANCE PAGE, NOT ONE.
--
-- BUG 1 — the row cap, again
--   app/online/finance/page.tsx counted a PostgREST response in the browser:
--
--       const pending = rowsF.filter((r) => !isPaid(r.payment_status));
--
--   PostgREST caps a response at 1,000 rows whatever .limit() asks for, so the
--   receivable could never exceed the COD of 1,000 parcels no matter how many
--   were outstanding. Fourth page with this fault: Logistics (0051),
--   Orders (0066), Dashboard (0074), now Finance.
--
-- BUG 2 — the date filter deletes the very rows the page is about  ← worse
--   The Payments tab filtered on payment_date:
--
--       if (from) q = q.gte("payment_date", from);
--
--   An UNPAID parcel has payment_date NULL, and NULL fails every comparison. So
--   the moment any range was selected — and "30 days" is the default — every
--   pending parcel vanished from the query before the cap was even reached.
--   The "Pending payment" card was reading the pending subset of PAID rows.
--
--   The fix is not a wider limit. It is dating each row by the event that
--   actually happened to it:
--       paid rows    -> payment_date   (when the money arrived)
--       unpaid rows  -> delivery_date  (when the money became owed)
--   That is what v_finance_payments.finance_date is.
--
-- GROSS OR NET — ANSWERED HERE, BOTH ARE RETURNED
--   Zeeshan asked which figure Finance should call revenue. It returns all
--   three, because they answer three different questions and collapsing them
--   loses one:
--       gross_cod    what the customer handed over        <- this is revenue
--       courier_fees what the courier kept                <- this is a cost
--       net_expected what will actually land in the bank  <- reconciles the CPR
--   Netting silently would hide a Rs 531,727 expense inside a revenue number and
--   make delivery margin invisible. Showing gross alone would leave the CPR
--   impossible to tie out. So: revenue is GROSS, fees are a line of their own,
--   net is shown beside them.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- The payments ledger, with one honest date per row.
--
-- Scope: parcels where money is or was in play — delivered, or already paid.
-- An In Transit parcel is not a receivable yet, and a Returned one never will
-- be; including either would inflate the figure the team chases.
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

  -- The date this row belongs to. Never null for a delivered parcel, which is
  -- the whole point: a range filter must not be able to hide a receivable.
  coalesce(l.payment_date, l.delivery_date, l.dispatch_date)  as finance_date,

  -- How long the money has been outstanding. Null once paid.
  case when coalesce(l.payment_status, '') in ('Paid', 'Received') then null
       else current_date - coalesce(l.delivery_date, l.dispatch_date) end
                                                              as age_days
from online_logistics l
where l.delivery_status = 'Delivered'
   or coalesce(l.payment_status, '') in ('Paid', 'Received');

grant select on v_finance_payments to authenticated;

-- ---------------------------------------------------------------------------
-- The cards. Counted here, never in the browser.
-- ---------------------------------------------------------------------------
create or replace function hub_finance_summary(
  p_from    date default null,
  p_to      date default null,
  p_store   text default null,
  p_courier text default null
)
returns table (
  pending_value       numeric,
  pending_count       bigint,
  oldest_pending_days integer,
  received_gross      numeric,
  received_net        numeric,
  received_count      bigint,
  gross_cod           numeric,
  courier_fees        numeric,
  net_expected        numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with f as (
    select *
      from v_finance_payments
     where (p_from    is null or finance_date >= p_from)
       and (p_to      is null or finance_date <= p_to)
       and (p_store   is null or p_store   = 'ALL'          or store_code = p_store)
       and (p_courier is null or p_courier = 'All couriers' or courier    = p_courier)
  )
  select
    coalesce(sum(cod_amount) filter (where not is_paid), 0)::numeric   as pending_value,
    count(*) filter (where not is_paid)::bigint                        as pending_count,
    coalesce(max(age_days) filter (where not is_paid), 0)::integer     as oldest_pending_days,

    coalesce(sum(cod_amount) filter (where is_paid), 0)::numeric       as received_gross,
    -- cpr_net_amount is only known once a CPR has been imported. Until then the
    -- honest fallback is gross, and the two columns being equal is itself the
    -- signal that no settlement file has landed for those parcels yet.
    coalesce(sum(coalesce(cpr_net_amount, cod_amount)) filter (where is_paid), 0)::numeric
                                                                       as received_net,
    count(*) filter (where is_paid)::bigint                            as received_count,

    coalesce(sum(cod_amount), 0)::numeric                              as gross_cod,
    coalesce(sum(coalesce(courier_fee, 0) + coalesce(courier_tax, 0)), 0)::numeric
                                                                       as courier_fees,
    coalesce(sum(cod_amount)
             - sum(coalesce(courier_fee, 0) + coalesce(courier_tax, 0)), 0)::numeric
                                                                       as net_expected
  from f;
$function$;

grant execute on function hub_finance_summary(date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The same money, split by courier.
--
-- The handoff already tracks PostEx and OwnEx separately for a reason: OwnEx has
-- no payment API at all, so its share of the receivable can only ever move by
-- import or by hand. A single blended number hides which half is automatable.
-- ---------------------------------------------------------------------------
create or replace function hub_finance_by_courier(
  p_from  date default null,
  p_to    date default null,
  p_store text default null
)
returns table (
  courier             text,
  pending_value       numeric,
  pending_count       bigint,
  oldest_pending_days integer,
  received_gross      numeric,
  courier_fees        numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    coalesce(courier, 'Unassigned')::text,
    coalesce(sum(cod_amount) filter (where not is_paid), 0)::numeric,
    count(*) filter (where not is_paid)::bigint,
    coalesce(max(age_days) filter (where not is_paid), 0)::integer,
    coalesce(sum(cod_amount) filter (where is_paid), 0)::numeric,
    coalesce(sum(coalesce(courier_fee, 0) + coalesce(courier_tax, 0)), 0)::numeric
  from v_finance_payments
 where (p_from  is null or finance_date >= p_from)
   and (p_to    is null or finance_date <= p_to)
   and (p_store is null or p_store = 'ALL' or store_code = p_store)
 group by coalesce(courier, 'Unassigned')
 order by 2 desc;
$function$;

grant execute on function hub_finance_by_courier(date, date, text) to authenticated;

commit;

-- ===========================================================================
-- VERIFY — run these BEFORE redeploying the page, so you can see the size of
-- the error rather than take my word for it.
-- ===========================================================================
-- -- 1. The true receivable, all time. Compare with the Rs 1,433,781 the page
-- --    has been showing. If it is larger, the cap was hiding the difference.
-- select * from hub_finance_summary(null, null, 'ALL', null);
--
-- -- 2. Bug 2 on its own. The default range is 30 days; the old query filtered
-- --    pending rows on a NULL payment_date, so this pair should differ wildly.
-- select count(*) as pending_all_time
--   from v_finance_payments where not is_paid;
-- select count(*) as pending_the_old_way
--   from online_logistics
--  where delivery_status = 'Delivered'
--    and coalesce(payment_status,'') not in ('Paid','Received')
--    and payment_date >= current_date - 29;   -- NULL fails this: expect 0
--
-- -- 3. Which courier owes what.
-- select * from hub_finance_by_courier(null, null, 'ALL');
--
-- -- 4. Gross vs net, so the revenue question has a number attached.
-- select gross_cod, courier_fees, net_expected
--   from hub_finance_summary(null, null, 'ALL', null);
