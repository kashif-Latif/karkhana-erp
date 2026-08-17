-- =====================================================================
-- HEAD OFFICE ERP — Migration 0022: Add & edit materials (groups)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0001, 0005.
--
-- Lets a materials manager CREATE a brand-new material (e.g. Elastic Band)
-- and EDIT an existing one — its name, which attributes it carries
-- (Category / Colour / Size), and which units it is received in.
-- A short code is generated automatically from the name.
-- =====================================================================

create or replace function create_material_group(
  p_name text, p_has_category boolean, p_has_color boolean, p_has_size boolean, p_unit_ids uuid[]
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_final text; v_n int := 1; v_id uuid; v_u uuid;
begin
  if not has_permission('materials.manage') then raise exception 'You do not have permission to manage materials.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter a material name.'; end if;
  if p_unit_ids is null or array_length(p_unit_ids,1) is null then raise exception 'Choose at least one unit this material is received in.'; end if;
  if exists (select 1 from material_groups where lower(name) = lower(trim(p_name)) and is_active) then raise exception 'A material with this name already exists.'; end if;

  v_code := upper(left(regexp_replace(p_name,'[^a-zA-Z]','','g'), 3));
  if v_code = '' then v_code := 'MTG'; end if;
  v_final := v_code;
  while exists (select 1 from material_groups where code = v_final) loop v_n := v_n + 1; v_final := v_code || v_n::text; end loop;

  insert into material_groups (code, name, is_active, has_category, has_color, has_size, created_by)
  values (v_final, trim(p_name), true, coalesce(p_has_category,false), coalesce(p_has_color,false), coalesce(p_has_size,false), auth.uid())
  returning id into v_id;

  foreach v_u in array p_unit_ids loop
    if exists (select 1 from units where id = v_u) then
      insert into group_units (group_id, unit_id) values (v_id, v_u) on conflict do nothing;
    end if;
  end loop;
  return v_id;
end; $$;
grant execute on function create_material_group(text,boolean,boolean,boolean,uuid[]) to authenticated;

create or replace function update_material_group(
  p_id uuid, p_name text, p_has_category boolean, p_has_color boolean, p_has_size boolean, p_unit_ids uuid[]
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u uuid;
begin
  if not has_permission('materials.manage') then raise exception 'You do not have permission to manage materials.'; end if;
  if not exists (select 1 from material_groups where id = p_id) then raise exception 'Material not found.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter a material name.'; end if;
  if p_unit_ids is null or array_length(p_unit_ids,1) is null then raise exception 'Choose at least one unit.'; end if;

  update material_groups
     set name = trim(p_name), has_category = coalesce(p_has_category,false),
         has_color = coalesce(p_has_color,false), has_size = coalesce(p_has_size,false), updated_at = now()
   where id = p_id;

  delete from group_units where group_id = p_id;
  foreach v_u in array p_unit_ids loop
    if exists (select 1 from units where id = v_u) then
      insert into group_units (group_id, unit_id) values (p_id, v_u) on conflict do nothing;
    end if;
  end loop;
end; $$;
grant execute on function update_material_group(uuid,text,boolean,boolean,boolean,uuid[]) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0022 (idempotent)
-- =====================================================================
