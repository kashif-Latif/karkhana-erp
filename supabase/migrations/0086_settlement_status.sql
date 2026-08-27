-- 0086_settlement_status.sql
--
-- A SETTLEMENT BEING ISSUED IS NOT THE SAME AS BEING PAID.
--
-- Both courier portals track this and we were ignoring it:
--
--     PostEx   NEW  /  CLOSED  /  Special Request
--     OwnEx    Unpaid  /  Paid
--
-- and right now two of them say the money has not moved:
--
--     CPR-Z1MBL992391   NEW      Rs 300,607.57
--     INV-20250019      Unpaid   Rs 548,987.00
--
-- hub_cpr_import marked every parcel in a settlement 'Paid' the moment it was
-- imported, so roughly Rs 850,000 still sitting with the couriers was being
-- counted as money received. That is the same class of error as the 588
-- returned-but-paid parcels 0084 cleared, arriving from the other direction.
--
-- TWO EVENTS, NOT ONE
--   issued  the courier has decided the parcel was delivered and named the
--           amount. Delivery is confirmed; the net is known.
--   paid    the money actually left the courier.
--
--   Everything a CPR tells us about DELIVERY is trustworthy the moment it is
--   issued. Everything it implies about CASH is only true once the courier
--   marks it Closed or Paid.
--
-- WHAT CHANGES
--   online_cpr.settlement_status   the courier's own word: Paid or Awaiting
--   A settlement marked Awaiting leaves its parcels Delivered, with the correct
--   net and charges recorded, but NOT marked paid — so they stay in the
--   receivable where they belong until the courier actually settles.
--
--   'Settled - awaiting payment' is used rather than null, because null cannot
--   tell the difference between "no CPR has covered this yet" and "a CPR covers
--   it and the courier has not paid". v_finance_payments treats anything other
--   than Paid/Received as unpaid, so it counts correctly either way.
--
-- Safe to run more than once. Requires 0080-0083.

begin;

alter table online_cpr add column if not exists settlement_status text;

comment on column online_cpr.settlement_status is
  'The courier''s own settlement state — Paid (PostEx CLOSED / OwnEx Paid) or Awaiting (PostEx NEW / OwnEx Unpaid). Awaiting means the parcels are confirmed delivered but the money has not arrived.';

-- Everything imported so far was assumed paid, because there was nowhere to
-- record otherwise. Say so explicitly rather than leaving it null and unknown.
update online_cpr set settlement_status = 'Paid' where settlement_status is null;

-- ---------------------------------------------------------------------------
-- Flip a settlement between Paid and Awaiting, and move its parcels with it.
--
-- Delivery status is never touched. A courier that has not yet paid has still
-- delivered the parcel, and un-delivering it would be false.
-- ---------------------------------------------------------------------------
create or replace function hub_cpr_set_status(
  p_courier    text,
  p_cpr_number text,
  p_status     text          -- 'Paid' or 'Awaiting'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_paid    boolean := (p_status = 'Paid');
  v_parcels integer;
  v_value   numeric;
begin
  if p_status not in ('Paid', 'Awaiting') then
    return jsonb_build_object('ok', false, 'error', 'status must be Paid or Awaiting');
  end if;

  update online_cpr
     set settlement_status = p_status
   where courier = p_courier and cpr_number = p_cpr_number;

  -- Only parcels the courier DELIVERED move. A return in the same settlement
  -- was never going to be paid for, so its state is unaffected by whether the
  -- courier has transferred the money.
  update online_logistics
     set payment_status = case when v_paid then 'Paid' else 'Settled - awaiting payment' end,
         payment_date   = case when v_paid then coalesce(payment_date, current_date) else null end,
         updated_at     = now()
   where cpr_number = p_cpr_number
     and courier = p_courier
     and delivery_status = 'Delivered';

  get diagnostics v_parcels = row_count;

  select coalesce(sum(coalesce(cpr_net_amount, cod_amount)), 0) into v_value
    from online_logistics
   where cpr_number = p_cpr_number and courier = p_courier and delivery_status = 'Delivered';

  return jsonb_build_object(
    'ok', true, 'cpr_number', p_cpr_number, 'status', p_status,
    'parcels_moved', v_parcels, 'value', v_value,
    'report', v_parcels || ' parcels now ' ||
              case when v_paid then 'counted as received' else 'back in the receivable' end);
end;
$function$;

grant execute on function hub_cpr_set_status(text, text, text) to authenticated;

commit;

-- ===========================================================================
-- MARK THE TWO THAT HAVE NOT PAID YOU
--
--   PostEx portal says NEW, OwnEx says Unpaid. Run these and roughly
--   Rs 850,000 moves out of "received" and back into the receivable, where the
--   couriers themselves say it belongs.
-- ===========================================================================
-- select hub_cpr_set_status('PostEx', 'CPR-Z1MBL992391', 'Awaiting');
-- select hub_cpr_set_status('OwnEx',  'INV-20250019',    'Awaiting');
--
-- -- and when they do pay:
-- -- select hub_cpr_set_status('PostEx', 'CPR-Z1MBL992391', 'Paid');
--
-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- select settlement_status, count(*),
--        to_char(sum(net_total), 'FM999,999,999') as value
--   from online_cpr group by 1;
--
-- -- money the courier has confirmed but not yet sent:
-- select courier, count(*) as parcels,
--        to_char(sum(coalesce(cpr_net_amount, cod_amount)), 'FM999,999,999') as awaiting
--   from online_logistics
--  where payment_status = 'Settled - awaiting payment'
--  group by courier;
-- ===========================================================================
