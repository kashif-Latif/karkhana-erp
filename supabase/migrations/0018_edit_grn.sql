-- =====================================================================
-- HEAD OFFICE ERP — Migration 0018: Edit a GRN (Admin)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0014, 0015.
--
-- edit_grn() lets an admin correct a posted receipt IN PLACE — same GRN
-- number. In one transaction it clears the receipt's old stock & payable
-- entries and its lines, then re-applies the corrected lines (finding or
-- creating items), recomputes totals, and rebuilds the payable. Existing
-- payments to the supplier are untouched, so the outstanding balance just
-- recalculates. Gated by 'inventory.adjust' (Admin + Super Admin).
-- Voided receipts cannot be edited.
-- =====================================================================

create or replace function edit_grn(
  p_grn_id      uuid,
  p_supplier_id uuid,
  p_received_at timestamptz,
  p_freight     numeric,
  p_discount    numeric,
  p_note        text,
  p_lines       jsonb
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_status     text;
  v_subtotal   numeric(16,2) := 0;
  v_total      numeric(16,2);
  v_line       jsonb;
  v_item       uuid;
  v_qty        numeric(16,3);
  v_rate       numeric(14,2);
  v_line_total numeric(16,2);
  v_group      uuid; v_cat uuid; v_col uuid; v_size uuid; v_unit uuid;
  v_has_cat boolean; v_has_col boolean; v_has_size boolean;
  v_uid        uuid := auth.uid();
begin
  if not has_permission('inventory.adjust') then
    raise exception 'You do not have permission to edit a GRN.';
  end if;
  select status into v_status from grns where id = p_grn_id;
  if not found then raise exception 'GRN not found.'; end if;
  if v_status = 'voided' then raise exception 'A voided GRN cannot be edited.'; end if;
  if p_supplier_id is null or not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Please choose a valid supplier.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item line.';
  end if;

  -- clear the receipt's previous stock, payable and lines
  delete from stock_ledger    where ref_table = 'grns' and ref_id = p_grn_id;
  delete from supplier_ledger  where ref_table = 'grns' and ref_id = p_grn_id and entry_type = 'purchase';
  delete from grn_lines        where grn_id = p_grn_id;

  -- re-apply the corrected lines
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_group := nullif(v_line->>'group_id','')::uuid;
    v_cat   := nullif(v_line->>'category_id','')::uuid;
    v_col   := nullif(v_line->>'color_id','')::uuid;
    v_size  := nullif(v_line->>'size_id','')::uuid;
    v_unit  := nullif(v_line->>'unit_id','')::uuid;
    v_qty   := (v_line->>'quantity')::numeric;
    v_rate  := (v_line->>'rate')::numeric;

    if v_group is null then raise exception 'A line is missing its material.'; end if;
    select has_category, has_color, has_size into v_has_cat, v_has_col, v_has_size from material_groups where id = v_group;
    if not found then raise exception 'A line has an invalid material.'; end if;
    if not v_has_cat  then v_cat  := null; end if;
    if not v_has_col  then v_col  := null; end if;
    if not v_has_size then v_size := null; end if;
    if v_unit is null then raise exception 'A line is missing its unit.'; end if;
    if not exists (select 1 from group_units where group_id = v_group and unit_id = v_unit) then
      raise exception 'That unit is not allowed for this material.';
    end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Each line needs a quantity greater than zero.'; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Each line needs a valid rate.'; end if;

    select id into v_item from material_items
     where group_id = v_group
       and category_id is not distinct from v_cat
       and color_id    is not distinct from v_col
       and size_id     is not distinct from v_size
       and unit_id     = v_unit
     limit 1;
    if v_item is null then
      insert into material_items (group_id, category_id, color_id, size_id, unit_id)
      values (v_group, v_cat, v_col, v_size, v_unit) returning id into v_item;
    end if;

    v_line_total := round(v_qty * v_rate, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into grn_lines (grn_id, item_id, quantity, rate, line_total)
    values (p_grn_id, v_item, v_qty, v_rate, v_line_total);
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, created_by)
    values (v_item, v_qty, 'receipt', 'grns', p_grn_id, v_uid);
  end loop;

  v_total := v_subtotal + coalesce(p_freight,0) - coalesce(p_discount,0);
  update grns
     set supplier_id = p_supplier_id,
         received_at = coalesce(p_received_at, received_at),
         freight = coalesce(p_freight,0), discount = coalesce(p_discount,0),
         subtotal = v_subtotal, total = v_total, note = nullif(p_note,'')
   where id = p_grn_id;

  insert into supplier_ledger (supplier_id, entry_type, amount, ref_table, ref_id, note, created_by)
  values (p_supplier_id, 'purchase', v_total, 'grns', p_grn_id, 'GRN (edited)', v_uid);

  return p_grn_id;
end;
$$;

grant execute on function edit_grn(uuid, uuid, timestamptz, numeric, numeric, text, jsonb) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0018 (idempotent)
-- =====================================================================
