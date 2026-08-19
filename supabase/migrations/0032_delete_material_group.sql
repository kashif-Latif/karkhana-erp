-- =====================================================================
-- HEAD OFFICE ERP — Migration 0032: Delete material (group)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0005, 0022, 0023.
--
-- Removes a material (e.g. Elastic Band) along with its allowed-units and
-- categories config. Blocked when the material still has items/stock or is
-- used by any recipe, so nothing real is ever orphaned — in that case,
-- deactivate the material instead. Gated by materials.manage.
-- =====================================================================

create or replace function delete_material_group(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_permission('materials.manage') then
    raise exception 'You do not have permission to delete materials.';
  end if;
  if not exists (select 1 from material_groups where id = p_id) then
    raise exception 'Material not found.';
  end if;
  if exists (select 1 from material_items where group_id = p_id) then
    raise exception 'This material has items or stock, so it cannot be deleted. Deactivate it instead.';
  end if;
  if exists (select 1 from article_bom where group_id = p_id) then
    raise exception 'This material is used in one or more recipes, so it cannot be deleted.';
  end if;

  delete from group_units where group_id = p_id;
  delete from material_categories where group_id = p_id;
  delete from material_groups where id = p_id;
end; $$;
grant execute on function delete_material_group(uuid) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0032 (idempotent)
-- =====================================================================
