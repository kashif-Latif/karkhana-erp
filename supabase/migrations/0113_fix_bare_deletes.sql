-- =====================================================================
-- KARKHANA — Migration 0113: fix "DELETE requires a WHERE clause"
--
-- MY BUG, from 0108 and 0109.
--
-- Supabase loads the `safeupdate` extension for the `authenticated` role.
-- It refuses any DELETE that has no WHERE clause, so that a mistake in the
-- API can never empty a table. It is a good protection and it is on by
-- default.
--
-- Both of my functions clear a temporary table between calls, and both did
-- it with a bare DELETE:
--
--     delete from _edit_lines;     -- edit_grn      (0108)
--     delete from _sort_lines;     -- post_sort_job (0109)
--
-- Inside a SECURITY DEFINER function the effective user changes but the
-- session setting does not, so safeupdate still applies. The result:
--
--   * Edit GRN fails with "DELETE requires a WHERE clause"
--   * Sorting fails the same way as soon as Check or Record is pressed
--
-- WHY I DID NOT CATCH IT
--   I tested everything as `postgres`, where safeupdate is not enabled, and
--   0110 ran clean in the SQL editor for the same reason. Neither of those
--   is the role the application runs as. A test that does not run as the
--   real user is not a test — the same lesson as the circular payroll check.
--
-- THE FIX
--   `where true` satisfies safeupdate and deletes exactly the same rows.
--   Nothing else in either function changes. Both are recreated in full
--   below rather than patched, so what you run is what you get.
--
-- Run this on its own. No app deploy is needed for it.
-- =====================================================================

begin;

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
    item_id uuid, quantity numeric(16,3), rate numeric(14,2)
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

    insert into _edit_lines (item_id, quantity, rate) values (v_item, v_qty, v_rate);
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

  for r in select item_id, quantity, rate from _edit_lines loop
    v_line_total := round(r.quantity * r.rate, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into grn_lines (grn_id, item_id, quantity, rate, line_total)
    values (p_grn_id, r.item_id, r.quantity, r.rate, v_line_total);
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

create or replace function post_sort_job(
  p_lot_id      uuid,
  p_sorted_at   timestamptz,
  p_supervisor_employee_id uuid,
  p_worker_count integer,
  p_labour_cost numeric,
  p_variance_qty numeric,
  p_variance_reason text,
  p_note        text,
  p_lines       jsonb,
  p_dry_run     boolean default true
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_uid       uuid := auth.uid();
  v_lot       record;
  v_remaining numeric(16,3);
  v_out       numeric(16,3) := 0;
  v_var       numeric(16,3) := coalesce(p_variance_qty, 0);
  v_draw      numeric(16,3);
  v_line      jsonb;
  v_cat uuid; v_col uuid; v_size uuid; v_item uuid; v_qty numeric(16,3);
  v_has_cat boolean; v_has_col boolean; v_has_size boolean;
  v_src_cat uuid; v_src_col uuid; v_src_size uuid;
  v_job       uuid;
  v_num       text;
  v_preview   jsonb := '[]'::jsonb;
  r           record;
begin
  if not has_permission('inventory.sort') then
    raise exception 'You do not have permission to sort material.';
  end if;
  if v_var < 0 then
    raise exception 'Variance cannot be negative. If more came out than went in, the weighing is wrong.';
  end if;

  /* Lock the lot. Two people sorting the same cartons at the same time
     would otherwise both read the same remaining balance and both pass
     the guard. */
  select * into v_lot from stock_lots where id = p_lot_id for update;
  if not found then raise exception 'Lot not found.'; end if;
  if v_lot.closed_at is not null then raise exception 'That lot is closed.'; end if;

  select l.remaining_qty into v_remaining from v_stock_lots l where l.id = p_lot_id;

  select mi.category_id, mi.color_id, mi.size_id,
         mg.has_category, mg.has_color, mg.has_size
    into v_src_cat, v_src_col, v_src_size, v_has_cat, v_has_col, v_has_size
    from material_items mi join material_groups mg on mg.id = mi.group_id
   where mi.id = v_lot.item_id;

  create temporary table if not exists _sort_lines (
    item_id uuid, quantity numeric(16,3), label text
  ) on commit drop;
  delete from _sort_lines where true;   -- safeupdate: a bare DELETE is refused

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_cat  := nullif(v_line->>'category_id','')::uuid;
    v_col  := nullif(v_line->>'color_id','')::uuid;
    v_size := nullif(v_line->>'size_id','')::uuid;
    v_qty  := (v_line->>'quantity')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Each sorted line needs a quantity greater than zero.';
    end if;
    if not v_has_cat  then v_cat  := null; end if;
    if not v_has_col  then v_col  := null; end if;
    if not v_has_size then v_size := null; end if;

    /* Whatever the lot already knows carries down to every line out of it.
       A 500 kg lot of Lycra sorts into Lycra Blue and Lycra Red — the
       person entering it names only the colour, because the category was
       never in question. Omitting it means inherit, not unknown. */
    if v_cat  is null then v_cat  := v_src_cat;  end if;
    if v_col  is null then v_col  := v_src_col;  end if;
    if v_size is null then v_size := v_src_size; end if;

    /* A sort may only make the material MORE specific. Naming a DIFFERENT
       category is not sorting — it is quietly turning one material into
       another, and the ledger would show fabric that was never bought. */
    if v_src_cat is not null and v_cat <> v_src_cat then
      raise exception 'This lot is already a fixed category. A sorted line cannot change it.';
    end if;
    if v_src_col is not null and v_col <> v_src_col then
      raise exception 'This lot is already a fixed colour. A sorted line cannot change it.';
    end if;
    if v_src_size is not null and v_size <> v_src_size then
      raise exception 'This lot is already a fixed size. A sorted line cannot change it.';
    end if;
    if v_cat is not distinct from v_src_cat
       and v_col is not distinct from v_src_col
       and v_size is not distinct from v_src_size then
      raise exception 'A sorted line must name something the lot did not already know — a colour, a category or a size.';
    end if;
    if v_cat is not null and not exists (
         select 1 from material_categories where id = v_cat and group_id = v_lot.group_id) then
      raise exception 'A sorted line has a category that does not belong to this material.';
    end if;

    select id into v_item from material_items
     where group_id = v_lot.group_id
       and category_id is not distinct from v_cat
       and color_id    is not distinct from v_col
       and size_id     is not distinct from v_size
       and unit_id     = v_lot.unit_id
     limit 1;
    if v_item is null then
      if p_dry_run then
        v_item := null;                          -- nothing is created on a check
      else
        insert into material_items (group_id, category_id, color_id, size_id, unit_id, created_by)
        values (v_lot.group_id, v_cat, v_col, v_size, v_lot.unit_id, v_uid)
        returning id into v_item;
      end if;
    end if;

    insert into _sort_lines (item_id, quantity, label)
    values (v_item, v_qty,
            concat_ws(' · ',
              (select name from material_groups where id = v_lot.group_id),
              (select name from material_categories where id = v_cat),
              (select name from colors where id = v_col),
              (select name from sizes where id = v_size)));
    v_out := v_out + v_qty;
  end loop;

  v_draw := v_out + v_var;

  for r in select label, quantity from _sort_lines order by label loop
    v_preview := v_preview || jsonb_build_object('material', r.label, 'quantity', r.quantity);
  end loop;

  -- ---------------- THE GUARD ----------------
  if v_draw <= 0 then
    return jsonb_build_object('ok', false, 'guard', 'nothing to record',
      'wrote', 0, 'meaning', 'Add at least one sorted quantity, or a variance.');
  end if;
  if v_draw > v_remaining then
    return jsonb_build_object('ok', false, 'guard', 'more than the lot has left',
      'wrote', 0,
      'lot_remaining', v_remaining, 'you_entered', v_draw,
      'over_by', round(v_draw - v_remaining, 3),
      'meaning', 'Sorted quantity plus variance is larger than what is left in this lot. Re-weigh, or correct the receipt.');
  end if;

  if p_dry_run then
    return jsonb_build_object('ok', true, 'dry_run', true, 'wrote', 0,
      'lot', v_lot.lot_number, 'lot_remaining', v_remaining,
      'would_draw', v_draw, 'sorted', v_out, 'variance', v_var,
      'variance_pct', case when v_draw = 0 then 0 else round(100 * v_var / v_draw, 2) end,
      'rate', v_lot.rate,
      'sorted_value', round(v_out * v_lot.rate, 2),
      'variance_cost', round(v_var * v_lot.rate, 2),
      'remaining_after', round(v_remaining - v_draw, 3),
      'closes_lot', (v_remaining - v_draw) <= 0,
      'lines', v_preview);
  end if;

  v_num := next_document_number('SRT','SRT');
  insert into sort_jobs (job_number, lot_id, sorted_at, supervisor_employee_id, worker_count,
                         labour_cost, variance_qty, variance_reason, note, created_by)
  values (v_num, p_lot_id, coalesce(p_sorted_at, now()), p_supervisor_employee_id,
          p_worker_count, coalesce(p_labour_cost,0), v_var, nullif(p_variance_reason,''),
          nullif(p_note,''), v_uid)
  returning id into v_job;

  for r in select item_id, quantity from _sort_lines loop
    insert into sort_job_lines (job_id, item_id, quantity, unit_rate)
    -- ↓ THE COST RULE. Survivors keep the lot rate; the loss is costed
    --   separately. To spread the loss instead, replace v_lot.rate with
    --   (v_lot.rate * v_draw / nullif(v_out,0)).
    values (v_job, r.item_id, r.quantity, v_lot.rate);

    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (r.item_id, r.quantity, 'sort_in', 'sort_jobs', v_job, v_num || ' from ' || v_lot.lot_number, v_uid);
  end loop;

  if v_out > 0 then
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (v_lot.item_id, -v_out, 'sort_out', 'sort_jobs', v_job, v_num, v_uid);
  end if;

  if v_var > 0 then
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (v_lot.item_id, -v_var, 'sort_variance', 'sort_jobs', v_job,
            coalesce(nullif(p_variance_reason,''), 'Lost in sorting'), v_uid);
  end if;

  if (v_remaining - v_draw) <= 0 then
    update stock_lots set closed_at = now(), closed_by = v_uid,
                          close_reason = 'fully sorted'
     where id = p_lot_id;
  end if;

  return jsonb_build_object('ok', true, 'dry_run', false, 'wrote', 1,
    'job', v_num, 'lot', v_lot.lot_number,
    'sorted', v_out, 'variance', v_var,
    'variance_cost', round(v_var * v_lot.rate, 2),
    'remaining_after', round(v_remaining - v_draw, 3),
    'lot_closed', (v_remaining - v_draw) <= 0,
    'lines', v_preview);
end;
$$;

grant execute on function edit_grn(uuid, uuid, timestamptz, numeric, numeric, text, jsonb) to authenticated;
grant execute on function post_sort_job(uuid, timestamptz, uuid, integer, numeric, numeric, text, text, jsonb, boolean) to authenticated;

commit;

-- =====================================================================
-- UNDO: re-run 0108 then 0109. That restores the versions with the bug,
-- so there is no reason to.
-- =====================================================================
