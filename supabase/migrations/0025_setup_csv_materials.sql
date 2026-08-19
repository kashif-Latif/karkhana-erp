-- =====================================================================
-- HEAD OFFICE ERP — Migration 0025: Set up materials from the CEO's file
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0005, 0022.
--
-- One-click setup of the raw materials in the purchase file:
--   • Elastic Band  (new material, received in Pcs)
--   • Sticker       → turn ON Category + add Kids / Men / Ladies
--   • Zip           → add sizes 6 inch and 8 inch
-- Everything is looked up by code/name (no hard-coded IDs) and guarded so
-- re-running never creates duplicates.
-- =====================================================================

-- 1) Elastic Band (Pcs)
do $$
declare v_pcs uuid; v_ela uuid;
begin
  select id into v_pcs from units where lower(symbol) = 'pcs' or lower(name) like 'piece%' limit 1;
  if not exists (select 1 from material_groups where lower(name) = 'elastic band') then
    insert into material_groups (code, name, is_active, has_category, has_color, has_size)
    values ('ELS', 'Elastic Band', true, false, false, false)
    returning id into v_ela;
    if v_pcs is not null then
      insert into group_units (group_id, unit_id) values (v_ela, v_pcs) on conflict do nothing;
    end if;
  end if;
end $$;

-- 2) Sticker → enable Category + add Kids / Men / Ladies
do $$
declare v_stk uuid;
begin
  select id into v_stk from material_groups where code = 'STK' or lower(name) = 'sticker' limit 1;
  if v_stk is not null then
    update material_groups set has_category = true, updated_at = now() where id = v_stk;
    insert into material_categories (name, group_id)
    select x.v, v_stk
    from (values ('Kids'), ('Men'), ('Ladies')) as x(v)
    where not exists (
      select 1 from material_categories mc where mc.group_id = v_stk and lower(mc.name) = lower(x.v)
    );
  end if;
end $$;

-- 3) Zip sizes → 6 inch and 8 inch
insert into sizes (name, sort_order)
select x.nm, x.so
from (values ('6 inch', 6), ('8 inch', 8)) as x(nm, so)
where not exists (select 1 from sizes s where lower(s.name) = lower(x.nm));

-- =====================================================================
-- END OF MIGRATION 0025 (idempotent)
-- =====================================================================
