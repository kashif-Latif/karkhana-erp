-- =====================================================================
-- HEAD OFFICE ERP — Migration 0003: Suppliers master (Day 1)
-- Depends on 0001 (set_updated_at, audit_row_change, has_permission,
-- next_document_number). Safe to run once in the SQL editor.
-- Authorization is enforced by RLS: anyone signed in can VIEW suppliers;
-- only users with 'suppliers.manage' can add / edit them.
-- =====================================================================

create table if not exists suppliers (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                    -- auto-filled: SUP-YYYY-000001
  company_name   text not null,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  tax_number     text,                            -- NTN / tax id
  notes          text,
  is_active      boolean not null default true,   -- soft-disable, never deleted
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);
create index if not exists idx_suppliers_active on suppliers(is_active);
create index if not exists idx_suppliers_name   on suppliers(company_name);

-- keep updated_at fresh
create trigger trg_suppliers_updated
  before update on suppliers
  for each row execute function set_updated_at();

-- auto-generate a human-readable code when none is supplied
create or replace function set_supplier_code()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.code is null or new.code = '' then
    new.code := next_document_number('SUP', 'SUP');
  end if;
  return new;
end;
$$;
create trigger trg_suppliers_code
  before insert on suppliers
  for each row execute function set_supplier_code();

-- audit every change
create trigger trg_audit_suppliers
  after insert or update or delete on suppliers
  for each row execute function audit_row_change();

-- ---- Row Level Security ----
alter table suppliers enable row level security;

create policy suppliers_read on suppliers
  for select using (auth.uid() is not null);

create policy suppliers_write on suppliers
  for all
  using (has_permission('suppliers.manage'))
  with check (has_permission('suppliers.manage'));

-- =====================================================================
-- END OF MIGRATION 0003
-- =====================================================================
