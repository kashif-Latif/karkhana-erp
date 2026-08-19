-- =====================================================================
-- HEAD OFFICE ERP — Migration 0024: Production Orders
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0001, 0012, 0023.
--
-- production_orders = an instruction to make N pieces of an article.
-- get_order_requirements() = the AUTO-CALCULATION: given an article + qty,
--   it multiplies the article's recipe to return how much of each material
--   is needed, and compares it to current stock. Works the moment recipes
--   are filled in (returns nothing while a recipe is empty).
-- Create/edit gated by production.entry OR production.manage; read by production.view.
-- =====================================================================

create table if not exists production_orders (
  id           uuid primary key default gen_random_uuid(),
  order_number text unique,                 -- PO-YYYY-000001
  article_id   uuid not null references articles(id),
  quantity     integer not null,            -- pieces to make
  status       text not null default 'open',-- open | in_production | completed | cancelled
  target_date  date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
create index if not exists idx_po_article on production_orders(article_id);
create index if not exists idx_po_status on production_orders(status);

drop trigger if exists trg_audit_production_orders on production_orders;
create trigger trg_audit_production_orders after insert or update or delete on production_orders for each row execute function audit_row_change();

alter table production_orders enable row level security;
drop policy if exists po_read on production_orders;
create policy po_read on production_orders for select using (has_permission('production.view'));
grant select on production_orders to authenticated;

-- ---------- the auto-calculation ----------
create or replace function get_order_requirements(p_article_id uuid, p_quantity numeric)
returns table(group_id uuid, group_name text, required numeric, unit_symbol text, available numeric, enough boolean)
language sql security definer set search_path = public, pg_temp as $$
  select b.group_id,
         mg.name,
         (b.quantity * p_quantity)::numeric(16,3) as required,
         u.symbol,
         coalesce((select sum(sl.qty_change) from stock_ledger sl join material_items mi on mi.id = sl.item_id
                   where mi.group_id = b.group_id and mi.unit_id = b.unit_id), 0)::numeric(16,3) as available,
         coalesce((select sum(sl.qty_change) from stock_ledger sl join material_items mi on mi.id = sl.item_id
                   where mi.group_id = b.group_id and mi.unit_id = b.unit_id), 0) >= (b.quantity * p_quantity) as enough
  from article_bom b
  join material_groups mg on mg.id = b.group_id
  join units u on u.id = b.unit_id
  where b.article_id = p_article_id
    and has_permission('production.view')
  order by mg.name;
$$;
grant execute on function get_order_requirements(uuid, numeric) to authenticated;

-- ---------- create / update order ----------
create or replace function create_production_order(p_article_id uuid, p_quantity integer, p_target_date date, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not (has_permission('production.entry') or has_permission('production.manage')) then
    raise exception 'You do not have permission to create production orders.';
  end if;
  if p_article_id is null or not exists (select 1 from articles where id = p_article_id and is_active) then
    raise exception 'Choose a valid article.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero.'; end if;

  insert into production_orders (order_number, article_id, quantity, target_date, notes, created_by)
  values (next_document_number('PO','PO'), p_article_id, p_quantity, p_target_date, nullif(trim(p_notes),''), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function create_production_order(uuid, integer, date, text) to authenticated;

create or replace function update_production_order(p_id uuid, p_quantity integer, p_target_date date, p_notes text, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (has_permission('production.entry') or has_permission('production.manage')) then
    raise exception 'You do not have permission to edit production orders.';
  end if;
  if not exists (select 1 from production_orders where id = p_id) then raise exception 'Order not found.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero.'; end if;
  if coalesce(p_status,'open') not in ('open','in_production','completed','cancelled') then raise exception 'Invalid status.'; end if;

  update production_orders set
    quantity = p_quantity, target_date = p_target_date, notes = nullif(trim(p_notes),''),
    status = coalesce(p_status,'open'), updated_at = now()
  where id = p_id;
end; $$;
grant execute on function update_production_order(uuid, integer, date, text, text) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0024 (idempotent)
-- =====================================================================
