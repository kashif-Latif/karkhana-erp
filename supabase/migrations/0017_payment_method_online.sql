-- =====================================================================
-- HEAD OFFICE ERP — Migration 0017: add 'online' payment method
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0013.
-- Redefines record_payment() to also accept method = 'online'
-- (cash / bank / cheque / online). Everything else is unchanged.
-- =====================================================================

create or replace function record_payment(
  p_supplier_id uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text,
  p_paid_at     timestamptz,
  p_note        text
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if not has_permission('payments.manage') then
    raise exception 'You do not have permission to record payments.';
  end if;
  if p_supplier_id is null or not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Please choose a valid supplier.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if coalesce(p_method, '') not in ('cash', 'bank', 'cheque', 'online') then
    raise exception 'Choose a payment method (cash, bank, cheque, or online).';
  end if;

  insert into payments (payment_number, supplier_id, amount, method, reference, paid_at, note, created_by)
  values (next_document_number('PAY','PAY'), p_supplier_id, p_amount, p_method,
          nullif(p_reference,''), coalesce(p_paid_at, now()), nullif(p_note,''), v_uid)
  returning id into v_id;

  insert into supplier_ledger (supplier_id, entry_type, amount, ref_table, ref_id, note, created_by)
  values (p_supplier_id, 'payment', p_amount, 'payments', v_id, 'Payment', v_uid);

  return v_id;
end;
$$;

grant execute on function record_payment(uuid, numeric, text, text, timestamptz, text) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0017 (idempotent)
-- =====================================================================
