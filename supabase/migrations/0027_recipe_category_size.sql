-- =====================================================================
-- HEAD OFFICE ERP — Migration 0027: Recipe supports Category + Size
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0023, 0024.
--
-- Real recipes reference specific variants — Sticker (Men) vs Sticker
-- (Kids), Zip (6 inch) vs Zip (8 inch). This adds optional category + size
-- to each recipe line, updates set_article_bom to accept them, and makes
-- the order auto-calculation match stock at the exact variant level.
-- =====================================================================

alter table article_bom add column if not exists category_id uuid references material_categories(id);
alter table article_bom add column if not exists size_id     uuid references sizes(id);

-- ---------- set recipe (now with category + size per line) ----------
create or replace function set_article_bom(p_article_id uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_line jsonb; v_group uuid; v_unit uuid; v_qty numeric; v_cat uuid; v_size uuid;
begin
  if not has_permission('production.manage') then raise exception 'You do not have permission to manage recipes.'; end if;
  if not exists (select 1 from articles where id = p_article_id) then raise exception 'Article not found.'; end if;

  delete from article_bom where article_id = p_article_id;
  if p_lines is null then return; end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_group := (v_line->>'group_id')::uuid;
    v_unit  := (v_line->>'unit_id')::uuid;
    v_qty   := (v_line->>'quantity')::numeric;
    v_cat   := nullif(v_line->>'category_id','')::uuid;
    v_size  := nullif(v_line->>'size_id','')::uuid;
    if v_group is null or not exists (select 1 from material_groups where id = v_group) then raise exception 'A recipe line has an invalid material.'; end if;
    if v_unit is null or not exists (select 1 from units where id = v_unit) then raise exception 'A recipe line has an invalid unit.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Each recipe line needs a quantity greater than zero.'; end if;
    if v_cat is not null and not exists (select 1 from material_categories where id = v_cat and group_id = v_group) then raise exception 'A recipe line has a category that does not belong to its material.'; end if;
    if v_size is not null and not exists (select 1 from sizes where id = v_size) then raise exception 'A recipe line has an invalid size.'; end if;

    insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id, note)
    values (p_article_id, v_group, v_cat, v_size, v_qty, v_unit, nullif(v_line->>'note',''));
  end loop;
end; $$;
grant execute on function set_article_bom(uuid, jsonb) to authenticated;

-- ---------- auto-calc now matches the exact variant (group + category + size + unit) ----------
drop function if exists get_order_requirements(uuid, numeric);
create or replace function get_order_requirements(p_article_id uuid, p_quantity numeric)
returns table(material_label text, required numeric, unit_symbol text, available numeric, enough boolean)
language sql security definer set search_path = public, pg_temp as $$
  select concat_ws(' · ', mg.name, mc.name, sz.name) as material_label,
         (b.quantity * p_quantity)::numeric(16,3) as required,
         u.symbol,
         coalesce((select sum(sl.qty_change) from stock_ledger sl join material_items mi on mi.id = sl.item_id
                   where mi.group_id = b.group_id and mi.unit_id = b.unit_id
                     and mi.category_id is not distinct from b.category_id
                     and mi.size_id is not distinct from b.size_id), 0)::numeric(16,3) as available,
         coalesce((select sum(sl.qty_change) from stock_ledger sl join material_items mi on mi.id = sl.item_id
                   where mi.group_id = b.group_id and mi.unit_id = b.unit_id
                     and mi.category_id is not distinct from b.category_id
                     and mi.size_id is not distinct from b.size_id), 0) >= (b.quantity * p_quantity) as enough
  from article_bom b
  join material_groups mg on mg.id = b.group_id
  left join material_categories mc on mc.id = b.category_id
  left join sizes sz on sz.id = b.size_id
  join units u on u.id = b.unit_id
  where b.article_id = p_article_id and has_permission('production.view')
  order by mg.name;
$$;
grant execute on function get_order_requirements(uuid, numeric) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0027 (idempotent)
-- =====================================================================
