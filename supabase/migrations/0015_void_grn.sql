-- =====================================================================
-- HEAD OFFICE ERP — Migration 0015: Void a GRN (safe delete)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0012.
--
-- Admins can VOID a goods receipt. Instead of deleting the row (which
-- would leave stock & payables wrong and erase history), void_grn()
-- REVERSES the receipt atomically:
--   • cancels the stock it added (opposite ledger entries)
--   • cancels the supplier payable it created
--   • marks the GRN 'voided' and records why
-- The full history stays intact and balances remain correct.
-- Gated by 'inventory.adjust' (Admin + Super Admin only).
-- =====================================================================

alter table grns add column if not exists status text not null default 'posted';

create or replace function void_grn(p_grn_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_uid      uuid := auth.uid();
  v_supplier uuid;
  v_total    numeric(16,2);
  v_status   text;
  r          record;
begin
  if not has_permission('inventory.adjust') then
    raise exception 'You do not have permission to void a GRN.';
  end if;

  select supplier_id, total, status into v_supplier, v_total, v_status from grns where id = p_grn_id;
  if not found then raise exception 'GRN not found.'; end if;
  if v_status = 'voided' then raise exception 'This GRN is already voided.'; end if;

  -- reverse the stock this GRN added
  for r in
    select item_id, qty_change from stock_ledger
    where ref_table = 'grns' and ref_id = p_grn_id and movement_type = 'receipt'
  loop
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (r.item_id, -r.qty_change, 'grn_void', 'grns', p_grn_id, nullif(p_reason,''), v_uid);
  end loop;

  -- reverse the payable (a negative purchase entry cancels the original)
  insert into supplier_ledger (supplier_id, entry_type, amount, ref_table, ref_id, note, created_by)
  values (v_supplier, 'purchase', -v_total, 'grns', p_grn_id,
          case when nullif(p_reason,'') is not null then 'GRN void: ' || p_reason else 'GRN voided' end, v_uid);

  update grns
     set status = 'voided',
         note = coalesce(note,'') || case when nullif(p_reason,'') is not null then ' [VOID: ' || p_reason || ']' else ' [VOIDED]' end
   where id = p_grn_id;
end;
$$;

grant execute on function void_grn(uuid, text) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0015 (idempotent)
-- =====================================================================
