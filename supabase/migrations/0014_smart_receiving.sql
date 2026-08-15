-- =====================================================================
-- HEAD OFFICE ERP — Migration 0014: Smart receiving (Day 3 improvement)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0004, 0005, 0012.
--
-- Lets you receive by choosing the MATERIAL + its attributes (category /
-- colour / size) + unit, instead of pre-creating items. The matching
-- material_item is found-or-created automatically, then the GRN posts
-- exactly like before (stock IN + supplier payable, atomic, immutable).
-- The database enforces the 5-material rules: attributes that don't apply
-- to a group are ignored, and the unit must be allowed for that group.
-- =====================================================================

create or replace function post_grn_smart(
  p_supplier_id uuid,
  p_received_at timestamptz,
  p_freight     numeric,
  p_discount    numeric,
  p_note        text,
  p_lines       jsonb
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_grn_id     uuid;
  v_subtotal   numeric(16,2) := 0;
  v_total      numeric(16,2);
  v_line       jsonb;
  v_item       uuid;
  v_qty        numeric(16,3);
  v_rate       numeric(14,2);
  v_line_total numeric(16,2);
  v_group      uuid;
  v_cat        uuid;
  v_col        uuid;
  v_size       uuid;
  v_unit       uuid;
  v_has_cat    boolean;
  v_has_col    boolean;
  v_has_size   boolean;
  v_uid        uuid := auth.uid();
begin
  if not has_permission('grn.create') then
    raise exception 'You do not have permission to receive stock.';
  end if;
  if p_supplier_id is null or not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Please choose a valid supplier.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item line.';
  end if;

  insert into grns (grn_number, supplier_id, received_at, freight, discount, subtotal, total, note, created_by)
  values (next_document_number('GRN','GRN'), p_supplier_id, coalesce(p_received_at, now()),
          coalesce(p_freight,0), coalesce(p_discount,0), 0, 0, nullif(p_note,''), v_uid)
  returning id into v_grn_id;

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
    select has_category, has_color, has_size into v_has_cat, v_has_col, v_has_size
      from material_groups where id = v_group;
    if not found then raise exception 'A line has an invalid material.'; end if;

    -- normalise: drop attributes that don't apply to this material
    if not v_has_cat  then v_cat  := null; end if;
    if not v_has_col  then v_col  := null; end if;
    if not v_has_size then v_size := null; end if;

    if v_unit is null then raise exception 'A line is missing its unit.'; end if;
    if not exists (select 1 from group_units where group_id = v_group and unit_id = v_unit) then
      raise exception 'That unit is not allowed for this material.';
    end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Each line needs a quantity greater than zero.'; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Each line needs a valid rate (0 or more).'; end if;

    -- find the matching item (NULL-safe on the optional attributes) or create it
    select id into v_item from material_items
     where group_id = v_group
       and category_id is not distinct from v_cat
       and color_id    is not distinct from v_col
       and size_id     is not distinct from v_size
       and unit_id     = v_unit
     limit 1;
    if v_item is null then
      insert into material_items (group_id, category_id, color_id, size_id, unit_id)
      values (v_group, v_cat, v_col, v_size, v_unit)
      returning id into v_item;
    end if;

    v_line_total := round(v_qty * v_rate, 2);
    v_subtotal := v_subtotal + v_line_total;

    insert into grn_lines (grn_id, item_id, quantity, rate, line_total)
    values (v_grn_id, v_item, v_qty, v_rate, v_line_total);

    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, created_by)
    values (v_item, v_qty, 'receipt', 'grns', v_grn_id, v_uid);
  end loop;

  v_total := v_subtotal + coalesce(p_freight,0) - coalesce(p_discount,0);
  update grns set subtotal = v_subtotal, total = v_total where id = v_grn_id;

  insert into supplier_ledger (supplier_id, entry_type, amount, ref_table, ref_id, note, created_by)
  values (p_supplier_id, 'purchase', v_total, 'grns', v_grn_id, 'GRN', v_uid);

  return v_grn_id;
end;
$$;

grant execute on function post_grn_smart(uuid, timestamptz, numeric, numeric, text, jsonb) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0014 (idempotent)
-- =====================================================================
