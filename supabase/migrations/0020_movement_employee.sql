-- =====================================================================
-- HEAD OFFICE ERP — Migration 0020: Assign an employee to a movement
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0006, 0019.
--
-- When material is issued to (or returned from) a department, the operator
-- can now assign it to a specific employee in that department — e.g. this
-- fabric was handed to this cutter. This is the first link in the piece-
-- rate chain (that employee will cut it into pieces and be paid per piece).
-- =====================================================================

alter table stock_movements add column if not exists employee_id uuid references employees(id);

drop function if exists post_stock_movement(text, uuid, text, timestamptz, text, jsonb);

create or replace function post_stock_movement(
  p_type          text,
  p_department_id uuid,
  p_employee_id   uuid,
  p_reason        text,
  p_moved_at      timestamptz,
  p_direction     text,       -- only used for adjustment: 'add' | 'remove'
  p_lines         jsonb
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_dir     smallint;
  v_perm    text;
  v_prefix  text;
  v_mv_id   uuid;
  v_line    jsonb;
  v_item    uuid;
  v_qty     numeric(16,3);
  v_balance numeric(16,3);
  v_label   text;
  v_uid     uuid := auth.uid();
begin
  if p_type = 'issue' then      v_dir := -1; v_perm := 'inventory.issue';  v_prefix := 'ISS';
  elsif p_type = 'return' then  v_dir :=  1; v_perm := 'inventory.return'; v_prefix := 'RET';
  elsif p_type = 'wastage' then v_dir := -1; v_perm := 'inventory.adjust'; v_prefix := 'WST';
  elsif p_type = 'adjustment' then
    v_perm := 'inventory.adjust'; v_prefix := 'ADJ';
    v_dir := case when p_direction = 'remove' then -1 else 1 end;
  else raise exception 'Unknown movement type.';
  end if;

  if not has_permission(v_perm) then
    raise exception 'You do not have permission for this movement.';
  end if;
  if p_type in ('issue','return') and (p_department_id is null or not exists (select 1 from departments where id = p_department_id)) then
    raise exception 'Please choose a department.';
  end if;
  if p_employee_id is not null and not exists (select 1 from employees where id = p_employee_id) then
    raise exception 'Invalid employee.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item line.';
  end if;

  insert into stock_movements (movement_number, type, direction, department_id, employee_id, reason, moved_at, created_by)
  values (next_document_number(v_prefix, v_prefix), p_type, v_dir,
          case when p_type in ('issue','return') then p_department_id else null end,
          case when p_type in ('issue','return') then p_employee_id else null end,
          nullif(p_reason,''), coalesce(p_moved_at, now()), v_uid)
  returning id into v_mv_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item := (v_line->>'item_id')::uuid;
    v_qty  := (v_line->>'quantity')::numeric;
    if v_item is null or not exists (select 1 from material_items where id = v_item) then
      raise exception 'A line has an invalid item.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Each line needs a quantity greater than zero.';
    end if;

    if v_dir = -1 then
      select coalesce(sum(qty_change), 0) into v_balance from stock_ledger where item_id = v_item;
      if v_qty > v_balance then
        select concat_ws(' · ', mg.name, mc.name, c.name, s.name) into v_label
        from material_items mi
        join material_groups mg on mg.id = mi.group_id
        left join material_categories mc on mc.id = mi.category_id
        left join colors c on c.id = mi.color_id
        left join sizes s on s.id = mi.size_id
        where mi.id = v_item;
        raise exception 'Not enough stock of % — only % available.', coalesce(v_label,'item'), v_balance;
      end if;
    end if;

    insert into stock_movement_lines (movement_id, item_id, quantity) values (v_mv_id, v_item, v_qty);
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (v_item, v_dir * v_qty, p_type, 'stock_movements', v_mv_id, nullif(p_reason,''), v_uid);
  end loop;

  return v_mv_id;
end;
$$;

grant execute on function post_stock_movement(text, uuid, uuid, text, timestamptz, text, jsonb) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0020 (idempotent)
-- =====================================================================
