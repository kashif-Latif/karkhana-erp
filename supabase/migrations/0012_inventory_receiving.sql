-- =====================================================================
-- HEAD OFFICE ERP — Migration 0012: Receiving → Inventory + Payables (Day 3)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0001, catalog, suppliers.
--
-- Core principles:
--  * Immutable stock ledger — every movement is an append-only row; balances
--    are DERIVED from it, never set by hand. Writes happen ONLY through the
--    post_grn() function (SECURITY DEFINER). No direct insert/update/delete.
--  * One posted GRN does two things atomically: (a) stock IN for each line,
--    (b) a supplier payable. They can never get out of sync.
--  * Money is numeric (PKR), rate is captured per line (full rate history).
-- =====================================================================

-- ---------------------------- STOCK LEDGER ----------------------------
create table if not exists stock_ledger (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references material_items(id),
  qty_change    numeric(16,3) not null,          -- + in, - out
  movement_type text not null,                    -- 'receipt' (more in Day 4)
  ref_table     text,
  ref_id        uuid,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);
create index if not exists idx_stock_ledger_item on stock_ledger(item_id);
create index if not exists idx_stock_ledger_ref  on stock_ledger(ref_table, ref_id);

-- ------------------------------- GRN ----------------------------------
create table if not exists grns (
  id           uuid primary key default gen_random_uuid(),
  grn_number   text unique,                       -- GRN-YYYY-000001
  supplier_id  uuid references suppliers(id),
  received_at  timestamptz not null default now(),
  freight      numeric(14,2) not null default 0,
  discount     numeric(14,2) not null default 0,
  subtotal     numeric(16,2) not null default 0,
  total        numeric(16,2) not null default 0,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
create index if not exists idx_grns_supplier on grns(supplier_id);

create table if not exists grn_lines (
  id         uuid primary key default gen_random_uuid(),
  grn_id     uuid not null references grns(id) on delete cascade,
  item_id    uuid not null references material_items(id),
  quantity   numeric(16,3) not null,
  rate       numeric(14,2) not null,
  line_total numeric(16,2) not null
);
create index if not exists idx_grn_lines_grn  on grn_lines(grn_id);
create index if not exists idx_grn_lines_item on grn_lines(item_id);

-- -------------------------- SUPPLIER LEDGER ---------------------------
create table if not exists supplier_ledger (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  entry_type  text not null,                      -- 'purchase' (+owed) / 'payment' (-owed)
  amount      numeric(16,2) not null,             -- always positive; sign by type
  ref_table   text,
  ref_id      uuid,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
create index if not exists idx_supplier_ledger_supplier on supplier_ledger(supplier_id);

-- ------------------------------ VIEWS ---------------------------------
-- security_invoker = the caller's RLS applies (so only inventory.view sees these)
create or replace view stock_balances with (security_invoker = true) as
  select item_id, sum(qty_change) as balance
  from stock_ledger group by item_id;

create or replace view supplier_balances with (security_invoker = true) as
  select supplier_id,
         sum(case when entry_type = 'purchase' then amount else -amount end) as outstanding
  from supplier_ledger group by supplier_id;

-- ------------------------ audit on the documents ----------------------
drop trigger if exists trg_audit_grns on grns;
drop trigger if exists trg_audit_supplier_ledger on supplier_ledger;
create trigger trg_audit_grns after insert or update or delete on grns for each row execute function audit_row_change();
create trigger trg_audit_supplier_ledger after insert or update or delete on supplier_ledger for each row execute function audit_row_change();

-- ------------------------------- RLS ----------------------------------
alter table stock_ledger    enable row level security;
alter table grns            enable row level security;
alter table grn_lines       enable row level security;
alter table supplier_ledger enable row level security;

-- READ = inventory.view. No write policies at all → the only way to write is
-- the SECURITY DEFINER function below. That is what makes the ledger immutable.
drop policy if exists stock_ledger_read    on stock_ledger;
drop policy if exists grns_read            on grns;
drop policy if exists grn_lines_read       on grn_lines;
drop policy if exists supplier_ledger_read on supplier_ledger;
create policy stock_ledger_read    on stock_ledger    for select using (has_permission('inventory.view'));
create policy grns_read            on grns            for select using (has_permission('inventory.view'));
create policy grn_lines_read       on grn_lines       for select using (has_permission('inventory.view'));
create policy supplier_ledger_read on supplier_ledger for select using (has_permission('inventory.view'));

-- ------------------------- post_grn() function ------------------------
-- Records a GRN + its lines, posts stock IN for every line, and creates the
-- supplier payable — all in one transaction. Requires 'grn.create'.
create or replace function post_grn(
  p_supplier_id uuid,
  p_received_at timestamptz,
  p_freight     numeric,
  p_discount    numeric,
  p_note        text,
  p_lines       jsonb
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_grn      uuid;
  v_num      text;
  v_subtotal numeric(16,2) := 0;
  v_total    numeric(16,2);
  v_line     jsonb;
  v_item     uuid;
  v_qty      numeric(16,3);
  v_rate     numeric(14,2);
  v_lt       numeric(16,2);
  v_count    int := 0;
begin
  if not has_permission('grn.create') then
    raise exception 'You do not have permission to receive stock.';
  end if;
  if p_supplier_id is null then
    raise exception 'A supplier is required.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item line.';
  end if;

  -- validate + total
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := (v_line->>'item_id')::uuid;
    v_qty  := (v_line->>'quantity')::numeric;
    v_rate := (v_line->>'rate')::numeric;
    if v_item is null then raise exception 'Each line needs a material item.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be greater than zero.'; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Rate cannot be negative.'; end if;
    v_subtotal := v_subtotal + (v_qty * v_rate);
    v_count := v_count + 1;
  end loop;

  v_total := v_subtotal + coalesce(p_freight, 0) - coalesce(p_discount, 0);
  v_num := next_document_number('GRN', 'GRN');

  insert into grns (grn_number, supplier_id, received_at, freight, discount, subtotal, total, note, created_by)
  values (v_num, p_supplier_id, coalesce(p_received_at, now()), coalesce(p_freight, 0), coalesce(p_discount, 0), v_subtotal, v_total, p_note, auth.uid())
  returning id into v_grn;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := (v_line->>'item_id')::uuid;
    v_qty  := (v_line->>'quantity')::numeric;
    v_rate := (v_line->>'rate')::numeric;
    v_lt   := v_qty * v_rate;
    insert into grn_lines (grn_id, item_id, quantity, rate, line_total)
      values (v_grn, v_item, v_qty, v_rate, v_lt);
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
      values (v_item, v_qty, 'receipt', 'grn', v_grn, 'GRN ' || v_num, auth.uid());
  end loop;

  -- the payable (what we now owe the supplier)
  insert into supplier_ledger (supplier_id, entry_type, amount, ref_table, ref_id, note, created_by)
    values (p_supplier_id, 'purchase', v_total, 'grn', v_grn, 'GRN ' || v_num, auth.uid());

  return v_grn;
end;
$$;

grant execute on function post_grn(uuid, timestamptz, numeric, numeric, text, jsonb) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0012 (idempotent)
-- =====================================================================
