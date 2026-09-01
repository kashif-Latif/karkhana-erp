-- =====================================================================
-- KARKHANA — Migration 0115: cartons, and finding what you already have
--
-- TWO THINGS
--
-- 1. PACKAGES ON A RECEIPT LINE
--    Fabric does not arrive as "500 kg". It arrives as eleven than, or
--    four cartons that weigh 500 kg between them. The weight is what the
--    ledger cares about; the count is what the storekeeper counts at the
--    gate and what the sorter works through one at a time.
--
--    Optional on every line. Nothing computes from it and nothing breaks
--    without it — it is there so that "4 cartons, 500 kg" can be recorded
--    as it actually happened, and so Sorting can say three cartons down,
--    one to go.
--
-- 2. FINDING AN ITEM YOU HAVE RECEIVED BEFORE
--    Every material item already carries a code from the trigger in 0005.
--    What was missing is a way to see them when receiving: type "fleece",
--    get the code, the full description, what it cost last time and how
--    much is on the shelf right now — then add to it instead of building
--    the same thing again from four dropdowns.
--
--    v_material_items_stock is that list. It is a view, so the stock
--    figure can never drift from the ledger.
--
-- Safe to run more than once.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Packages
-- ---------------------------------------------------------------------
alter table grn_lines  add column if not exists packages integer;
alter table grn_lines  add column if not exists package_unit text;
alter table stock_lots add column if not exists packages integer;
alter table stock_lots add column if not exists package_unit text;

comment on column grn_lines.packages is
  'How many physical pieces arrived — cartons, than, rolls, bags. Optional, never used in a calculation.';
comment on column grn_lines.package_unit is
  'What those pieces are called: carton, than, roll, bag, bale.';

-- Carry it onto the batch, so Sorting can show what is left to open.
create or replace function grn_line_make_lot()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_group uuid; v_unit uuid;
  v_cat uuid; v_col uuid; v_size uuid;
  v_has_cat boolean; v_has_col boolean; v_has_size boolean;
  v_needs boolean;
  v_received timestamptz;
begin
  select mi.group_id, mi.unit_id, mi.category_id, mi.color_id, mi.size_id,
         mg.has_category, mg.has_color, mg.has_size
    into v_group, v_unit, v_cat, v_col, v_size, v_has_cat, v_has_col, v_has_size
    from material_items mi join material_groups mg on mg.id = mi.group_id
   where mi.id = new.item_id;

  v_needs := (v_has_cat  and v_cat  is null)
          or (v_has_col  and v_col  is null)
          or (v_has_size and v_size is null);

  select received_at into v_received from grns where id = new.grn_id;

  insert into stock_lots (lot_number, grn_id, grn_line_id, item_id, group_id, unit_id,
                          received_qty, rate, received_at, needs_sorting,
                          packages, package_unit)
  values (next_document_number('LOT','LOT'), new.grn_id, new.id, new.item_id, v_group, v_unit,
          new.quantity, new.rate, coalesce(v_received, now()), v_needs,
          new.packages, new.package_unit)
  on conflict (grn_line_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. The item picker
--
-- One row per material item that has ever been received or defined, with
-- its code, a readable label, the unit, what is on the shelf now, and the
-- last rate paid. Everything derived — the balance is summed from the
-- ledger on read, never stored.
-- ---------------------------------------------------------------------
create or replace view v_material_items_stock with (security_invoker = true) as
select mi.id,
       mi.code,
       mi.group_id,
       mg.code as group_code,
       mg.name as material,
       mi.category_id, mi.color_id, mi.size_id,
       mi.unit_id,
       u.symbol as unit,
       concat_ws(' · ', mg.name, mc.name, c.name, sz.name) as label,
       coalesce(b.qty, 0)      as in_stock,
       lr.rate                 as last_rate,
       lr.received_at          as last_received_at,
       /* An item is "incomplete" when its material says it has an
          attribute and this item does not name one. Those are the bulk
          buckets — useful to receive into again, never a real colour. */
       ((mg.has_category and mi.category_id is null)
     or (mg.has_color    and mi.color_id    is null)
     or (mg.has_size     and mi.size_id     is null)) as is_bulk
  from material_items mi
  join material_groups mg on mg.id = mi.group_id
  join units u            on u.id = mi.unit_id
  left join material_categories mc on mc.id = mi.category_id
  left join colors c      on c.id = mi.color_id
  left join sizes sz      on sz.id = mi.size_id
  left join (select item_id, sum(qty_change) as qty from stock_ledger group by item_id) b
         on b.item_id = mi.id
  left join lateral (
        select gl.rate, g.received_at
          from grn_lines gl join grns g on g.id = gl.grn_id
         where gl.item_id = mi.id and g.status <> 'voided'
         order by g.received_at desc limit 1) lr on true
 where mi.is_active
   and has_permission('inventory.view');

grant select on v_material_items_stock to authenticated;

-- ---------------------------------------------------------------------
-- 3. Both receive paths must carry the count through, or the field on the
--    form would look like it worked and quietly record nothing.
-- ---------------------------------------------------------------------
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
  v_pkgs       integer;
  v_pkgu       text;
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
    v_pkgs  := nullif(v_line->>'packages','')::integer;
    v_pkgu  := nullif(v_line->>'package_unit','');
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

    insert into grn_lines (grn_id, item_id, quantity, rate, line_total, packages, package_unit)
    values (v_grn_id, v_item, v_qty, v_rate, v_line_total, v_pkgs, v_pkgu);

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
  v_old_total  numeric(16,2);
  v_line       jsonb;
  v_item       uuid;
  v_qty        numeric(16,3);
  v_rate       numeric(14,2);
  v_line_total numeric(16,2);
  v_pkgs       integer;
  v_pkgu       text;
  v_group      uuid; v_cat uuid; v_col uuid; v_size uuid; v_unit uuid;
  v_has_cat boolean; v_has_col boolean; v_has_size boolean;
  v_uid        uuid := auth.uid();
  r            record;
  v_label      text;
begin
  if not has_permission('inventory.adjust') then
    raise exception 'You do not have permission to edit a GRN.';
  end if;
  select status, total into v_status, v_old_total from grns where id = p_grn_id;
  if not found then raise exception 'GRN not found.'; end if;
  if v_status = 'voided' then raise exception 'A voided GRN cannot be edited.'; end if;
  if p_supplier_id is null or not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Please choose a valid supplier.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item line.';
  end if;

  /* Resolve the incoming lines to items FIRST, into a scratch table, so the
     net change per item can be checked before a single row is written. */
  create temporary table if not exists _edit_lines (
    item_id uuid, quantity numeric(16,3), rate numeric(14,2),
    packages integer, package_unit text
  ) on commit drop;
  delete from _edit_lines where true;   -- safeupdate: a bare DELETE is refused

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_group := nullif(v_line->>'group_id','')::uuid;
    v_cat   := nullif(v_line->>'category_id','')::uuid;
    v_col   := nullif(v_line->>'color_id','')::uuid;
    v_size  := nullif(v_line->>'size_id','')::uuid;
    v_unit  := nullif(v_line->>'unit_id','')::uuid;
    v_qty   := (v_line->>'quantity')::numeric;
    v_rate  := (v_line->>'rate')::numeric;
    v_pkgs  := nullif(v_line->>'packages','')::integer;
    v_pkgu  := nullif(v_line->>'package_unit','');

    if v_group is null then raise exception 'A line is missing its material.'; end if;
    select has_category, has_color, has_size into v_has_cat, v_has_col, v_has_size
      from material_groups where id = v_group;
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

    insert into _edit_lines (item_id, quantity, rate, packages, package_unit)
    values (v_item, v_qty, v_rate, v_pkgs, v_pkgu);
  end loop;

  /* The check. old = what this receipt currently contributes for an item,
     new = what it would contribute after the edit. A balance may not end
     up below zero. */
  for r in
    select coalesce(o.item_id, n.item_id) as item_id,
           coalesce(o.qty, 0) as old_qty,
           coalesce(n.qty, 0) as new_qty
      from (select item_id, sum(qty_change) as qty from stock_ledger
             where ref_table = 'grns' and ref_id = p_grn_id and movement_type = 'receipt'
             group by item_id) o
      full outer join (select item_id, sum(quantity) as qty from _edit_lines group by item_id) n
        on n.item_id = o.item_id
  loop
    if coalesce((select sum(qty_change) from stock_ledger where item_id = r.item_id), 0)
       - r.old_qty + r.new_qty < 0 then
      select concat_ws(' · ', mg.name, mc.name, c.name, s.name) into v_label
        from material_items mi
        join material_groups mg on mg.id = mi.group_id
        left join material_categories mc on mc.id = mi.category_id
        left join colors c on c.id = mi.color_id
        left join sizes  s on s.id = mi.size_id
       where mi.id = r.item_id;
      raise exception
        'Cannot reduce this receipt — more % has already been used than the corrected quantity would leave. Record a wastage instead.',
        coalesce(v_label, 'material');
    end if;
  end loop;

  /* Reverse the old receipt rather than deleting it. */
  for r in
    select item_id, qty_change from stock_ledger
     where ref_table = 'grns' and ref_id = p_grn_id and movement_type = 'receipt'
  loop
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (r.item_id, -r.qty_change, 'grn_edit_reversal', 'grns', p_grn_id, 'Superseded by an edit', v_uid);
  end loop;

  insert into supplier_ledger (supplier_id, entry_type, amount, ref_table, ref_id, note, created_by)
  values (p_supplier_id, 'purchase', -v_old_total, 'grns', p_grn_id, 'GRN edit: original reversed', v_uid);

  /* grn_lines is the document, not the ledger — it is replaced, and the
     ledger above keeps the history of what actually moved. */
  delete from grn_lines where grn_id = p_grn_id;

  for r in select item_id, quantity, rate, packages, package_unit from _edit_lines loop
    v_line_total := round(r.quantity * r.rate, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into grn_lines (grn_id, item_id, quantity, rate, line_total, packages, package_unit)
    values (p_grn_id, r.item_id, r.quantity, r.rate, v_line_total, r.packages, r.package_unit);
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (r.item_id, r.quantity, 'receipt', 'grns', p_grn_id, 'GRN (edited)', v_uid);
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

grant execute on function post_grn_smart(uuid, timestamptz, numeric, numeric, text, jsonb) to authenticated;
grant execute on function edit_grn(uuid, uuid, timestamptz, numeric, numeric, text, jsonb) to authenticated;

commit;

-- =====================================================================
-- UNDO
--   drop view if exists v_material_items_stock;
--   alter table grn_lines  drop column if exists packages, drop column if exists package_unit;
--   alter table stock_lots drop column if exists packages, drop column if exists package_unit;
--   -- then re-run 0114 to restore grn_line_make_lot.
-- =====================================================================
