-- =====================================================================
-- HEAD OFFICE ERP — Migration 0016: Permanent delete (Super Admin only)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0012, 0013.
--
-- VOID (0015) is the safe, auditable choice for real data.
-- DELETE (here) permanently removes a GRN or a payment — meant for
-- clearing TEST data or genuine mistakes during setup. Because it is
-- destructive, it is restricted to the Super Admin. It removes the
-- document AND every ledger entry it created, so stock and balances
-- stay correct. (The delete itself is still recorded in the audit log.)
-- =====================================================================

create or replace function delete_grn(p_grn_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not is_super_admin() then
    raise exception 'Only a Super Admin can permanently delete a GRN. Use Void instead.';
  end if;
  if not exists (select 1 from grns where id = p_grn_id) then
    raise exception 'GRN not found.';
  end if;
  delete from stock_ledger    where ref_table = 'grns' and ref_id = p_grn_id;
  delete from supplier_ledger where ref_table = 'grns' and ref_id = p_grn_id;
  delete from grn_lines       where grn_id = p_grn_id;
  delete from grns            where id = p_grn_id;
end;
$$;

create or replace function delete_payment(p_payment_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not is_super_admin() then
    raise exception 'Only a Super Admin can permanently delete a payment.';
  end if;
  if not exists (select 1 from payments where id = p_payment_id) then
    raise exception 'Payment not found.';
  end if;
  delete from supplier_ledger where ref_table = 'payments' and ref_id = p_payment_id;
  delete from payments        where id = p_payment_id;
end;
$$;

grant execute on function delete_grn(uuid)     to authenticated;
grant execute on function delete_payment(uuid) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0016 (idempotent)
-- =====================================================================
