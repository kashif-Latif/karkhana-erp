-- =====================================================================
-- KARKHANA — Migration 0108: ledger safety
--
-- Three ways the stock ledger can currently be corrupted without anyone
-- being told. All three were reproduced against a copy of this schema
-- before this file was written.
--
--   1. void_grn reverses a receipt without checking whether the stock
--      has already been used. Receive 500, issue 400, void the GRN and
--      the balance sits at MINUS 400. No error.
--      void_movement has had this check since 0021. void_grn never did.
--
--   2. edit_grn DELETES rows from stock_ledger and inserts replacements.
--      The ledger is supposed to be append-only — every other correction
--      in this system is a new row. Editing 500 down to 300 after 400 has
--      been issued leaves MINUS 100, and because there is no audit trigger
--      on stock_ledger the deleted rows leave no trace anywhere.
--
--   3. post_grn (the original, superseded by post_grn_smart in 0014)
--      writes ref_table = 'grn'. Void, edit and delete all look for
--      'grns'. Nothing calls it, but it is still granted to authenticated
--      and reachable through PostgREST. Anything posted through it would
--      produce stock that can never be reversed or removed.
--
-- Nothing here changes behaviour for correct usage. Every change either
-- refuses an operation that would have silently corrupted a balance, or
-- records something that was previously invisible.
--
-- Safe to run more than once.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The ledger gets an audit trail of its own.
--
-- 0012 attached audit triggers to grns and supplier_ledger but not to
-- stock_ledger, which is the one table where a missing row changes a
-- number. If anything ever removes a ledger row again, this records it.
-- ---------------------------------------------------------------------
drop trigger if exists trg_audit_stock_ledger on stock_ledger;
create trigger trg_audit_stock_ledger
  after insert or update or delete on stock_ledger
  for each row execute function audit_row_change();

-- ---------------------------------------------------------------------
-- 2. void_grn — refuse if the stock has already been used.
--
-- Same rule void_movement has applied since 0021, phrased the same way:
-- name the material, give the number, refuse.
-- ---------------------------------------------------------------------
create or replace function void_grn(p_grn_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_uid      uuid := auth.uid();
  v_supplier uuid;
  v_total    numeric(16,2);
  v_status   text;
  r          record;
  v_label    text;
begin
  if not has_permission('inventory.adjust') then
    raise exception 'You do not have permission to void a GRN.';
  end if;

  select supplier_id, total, status into v_supplier, v_total, v_status
    from grns where id = p_grn_id;
  if not found then raise exception 'GRN not found.'; end if;
  if v_status = 'voided' then raise exception 'This GRN is already voided.'; end if;

  /* Check every item BEFORE writing anything. A receipt of 500 that has
     had 400 issued cannot be taken back — the 400 is gone, and pretending
     otherwise puts the balance below zero and leaves nobody able to say
     which number is the true one. */
  for r in
    select item_id, sum(qty_change) as received
      from stock_ledger
     where ref_table = 'grns' and ref_id = p_grn_id and movement_type = 'receipt'
     group by item_id
  loop
    if r.received > coalesce((select sum(qty_change) from stock_ledger where item_id = r.item_id), 0) then
      select concat_ws(' · ', mg.name, mc.name, c.name, s.name) into v_label
        from material_items mi
        join material_groups mg on mg.id = mi.group_id
        left join material_categories mc on mc.id = mi.category_id
        left join colors c on c.id = mi.color_id
        left join sizes  s on s.id = mi.size_id
       where mi.id = r.item_id;
      raise exception
        'Cannot void — % of this receipt has already been used. Only % remains in stock. Record a wastage or a return instead.',
        coalesce(v_label, 'material'),
        coalesce((select sum(qty_change) from stock_ledger where item_id = r.item_id), 0);
    end if;
  end loop;

  for r in
    select item_id, qty_change from stock_ledger
     where ref_table = 'grns' and ref_id = p_grn_id and movement_type = 'receipt'
  loop
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (r.item_id, -r.qty_change, 'grn_void', 'grns', p_grn_id, nullif(p_reason,''), v_uid);
  end loop;

  insert into supplier_ledger (supplier_id, entry_type, amount, ref_table, ref_id, note, created_by)
  values (v_supplier, 'purchase', -v_total, 'grns', p_grn_id,
          case when nullif(p_reason,'') is not null then 'GRN void: ' || p_reason else 'GRN voided' end, v_uid);

  update grns
     set status = 'voided',
         note = coalesce(note,'') || case when nullif(p_reason,'') is not null
                                          then ' [VOID: ' || p_reason || ']' else ' [VOIDED]' end
   where id = p_grn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. edit_grn — reverse and re-post instead of deleting.
--
-- The correction becomes visible history: the original receipt, a
-- reversal, and the corrected receipt. Three rows where there used to be
-- one silently rewritten row. The balance is identical; the difference is
-- that afterwards you can still see what was originally received.
--
-- The same used-stock check as void_grn applies, computed on the NET
-- change per item, so raising a quantity is always allowed and only a
-- reduction below what has already been consumed is refused.
-- ---------------------------------------------------------------------
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
  delete from _edit_lines where true;   -- Supabase safeupdate refuses a bare DELETE (see 0113)

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

-- ---------------------------------------------------------------------
-- 4. delete_grn — remove every ledger row for the GRN, not only receipts.
--
-- It deleted by ref_table/ref_id, which is right, but a GRN that had been
-- edited or voided also carries reversal rows. Those matched the filter,
-- so this was already correct — the change is that it now also refuses
-- when the stock is gone, for the same reason void does.
-- ---------------------------------------------------------------------
create or replace function delete_grn(p_grn_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare r record;
begin
  if not is_super_admin() then
    raise exception 'Only a Super Admin can permanently delete a GRN. Use Void instead.';
  end if;
  if not exists (select 1 from grns where id = p_grn_id) then
    raise exception 'GRN not found.';
  end if;

  for r in
    select item_id, sum(qty_change) as net
      from stock_ledger where ref_table = 'grns' and ref_id = p_grn_id
     group by item_id
  loop
    if r.net > coalesce((select sum(qty_change) from stock_ledger where item_id = r.item_id), 0) then
      raise exception 'Cannot delete — stock from this receipt has already been used. Void it instead.';
    end if;
  end loop;

  delete from stock_ledger    where ref_table = 'grns' and ref_id = p_grn_id;
  delete from supplier_ledger where ref_table = 'grns' and ref_id = p_grn_id;
  delete from grn_lines       where grn_id = p_grn_id;
  delete from grns            where id = p_grn_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Retire post_grn.
--
-- Superseded by post_grn_smart in 0014 and never called by the app. It
-- writes ref_table = 'grn' where everything else expects 'grns', so any
-- receipt it created would be permanently un-voidable.
-- ---------------------------------------------------------------------
drop function if exists post_grn(uuid, timestamptz, numeric, numeric, text, jsonb);

grant execute on function void_grn(uuid, text) to authenticated;
grant execute on function edit_grn(uuid, uuid, timestamptz, numeric, numeric, text, jsonb) to authenticated;
grant execute on function delete_grn(uuid) to authenticated;

commit;

-- =====================================================================
-- UNDO (paste into the SQL editor if this needs reversing)
--
--   drop trigger if exists trg_audit_stock_ledger on stock_ledger;
--
-- The three functions are replaced, not dropped — re-running 0015, 0016
-- and 0018 in that order restores the previous versions exactly.
-- Nothing in this migration writes data, so there is nothing else to undo.
-- =====================================================================
