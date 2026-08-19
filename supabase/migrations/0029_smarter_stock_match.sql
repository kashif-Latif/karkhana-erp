-- =====================================================================
-- HEAD OFFICE ERP — Migration 0029: Smarter recipe → stock matching
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0027.
--
-- FIX: a recipe line that names only the material ("Fabric", no sub-type)
-- must match ALL stock in that material group (Cotton, Lycra, any colour),
-- not require an exact category/size match. A recipe line that DOES name a
-- variant (Sticker → Kids, Zip → 8 inch) still matches only that variant.
-- Rule: if the recipe leaves category/size blank, don't filter by it.
-- =====================================================================

drop function if exists get_order_requirements(uuid, numeric);
create or replace function get_order_requirements(p_article_id uuid, p_quantity numeric)
returns table(material_label text, required numeric, unit_symbol text, available numeric, enough boolean)
language sql security definer set search_path = public, pg_temp as $$
  select concat_ws(' · ', mg.name, mc.name, sz.name) as material_label,
         (b.quantity * p_quantity)::numeric(16,3) as required,
         u.symbol,
         coalesce((select sum(sl.qty_change) from stock_ledger sl join material_items mi on mi.id = sl.item_id
                   where mi.group_id = b.group_id and mi.unit_id = b.unit_id
                     and (b.category_id is null or mi.category_id = b.category_id)
                     and (b.size_id     is null or mi.size_id     = b.size_id)), 0)::numeric(16,3) as available,
         coalesce((select sum(sl.qty_change) from stock_ledger sl join material_items mi on mi.id = sl.item_id
                   where mi.group_id = b.group_id and mi.unit_id = b.unit_id
                     and (b.category_id is null or mi.category_id = b.category_id)
                     and (b.size_id     is null or mi.size_id     = b.size_id)), 0) >= (b.quantity * p_quantity) as enough
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
-- END OF MIGRATION 0029 (idempotent)
-- =====================================================================
