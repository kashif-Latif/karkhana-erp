-- =====================================================================
-- HEAD OFFICE ERP — Migration 0031: Delete production order
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0024.
--
-- Permanently removes a production order. The deletion is recorded in the
-- audit log (audit trigger on production_orders). Gated by
-- production.entry OR production.manage (matches create/update).
-- =====================================================================

create or replace function delete_production_order(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (has_permission('production.entry') or has_permission('production.manage')) then
    raise exception 'You do not have permission to delete production orders.';
  end if;
  if not exists (select 1 from production_orders where id = p_id) then
    raise exception 'Order not found.';
  end if;

  delete from production_orders where id = p_id;
end; $$;
grant execute on function delete_production_order(uuid) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0031 (idempotent)
-- =====================================================================
