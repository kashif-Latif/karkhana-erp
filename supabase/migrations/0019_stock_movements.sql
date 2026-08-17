-- =====================================================================
-- HEAD OFFICE ERP — Migration 0019: Stock Movements (Day 4)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0001, 0012.
--
-- Four movement types, all posted immediately (no approval flow), all on
-- the same immutable stock_ledger:
--   • issue      → material out to a department  (needs inventory.issue)
--   • return     → material back from a department (needs inventory.return)
--   • adjustment → correct stock up/down          (needs inventory.adjust)
--   • wastage    → record wasted material (out)    (needs inventory.adjust)
-- Outgoing movements are blocked if there isn't enough stock, so the
-- balance can never go negative by mistake.
-- =====================================================================

create table if not exists stock_movements (
  id              uuid primary key default gen_random_uuid(),
  movement_number text unique,                 -- ISS-/RET-/ADJ-/WST-YYYY-000001
  type            text not null,               -- issue | return | adjustment | wastage
  direction       smallint not null,           -- +1 in, -1 out
  department_id   uuid references departments(id),
  reason          text,
  moved_at        timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);
create index if not exists idx_stock_movements_dept on stock_movements(department_id);

create table if not exists stock_movement_lines (
  id          uuid primary key default gen_random_uuid(),
  movement_id uuid not null references stock_movements(id) on delete cascade,
  item_id     uuid not null references material_items(id),
  quantity    numeric(16,3) not null            -- always positive; sign from direction
);
create index if not exists idx_sml_movement on stock_movement_lines(movement_id);

drop trigger if exists trg_audit_stock_movements on stock_movements;
create trigger trg_audit_stock_movements after insert or update or delete on stock_movements for each row execute function audit_row_change();

alter table stock_movements      enable row level security;
alter table stock_movement_lines enable row level security;
drop policy if exists sm_read  on stock_movements;
drop policy if exists sml_read on stock_movement_lines;
create policy sm_read  on stock_movements      for select using (has_permission('inventory.view'));
create policy sml_read on stock_movement_lines for select using (has_permission('inventory.view'));

create or replace function post_stock_movement(
  p_type          text,
  p_department_id uuid,
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
  -- resolve type → direction, permission, number prefix
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
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item line.';
  end if;

  insert into stock_movements (movement_number, type, direction, department_id, reason, moved_at, created_by)
  values (next_document_number(v_prefix, v_prefix), p_type, v_dir,
          case when p_type in ('issue','return') then p_department_id else null end,
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

    -- outgoing cannot exceed available stock
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

grant execute on function post_stock_movement(text, uuid, text, timestamptz, text, jsonb) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0019 (idempotent)
-- =====================================================================
