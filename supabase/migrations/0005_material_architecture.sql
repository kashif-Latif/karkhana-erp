-- =====================================================================
-- HEAD OFFICE ERP — Migration 0005: attribute-driven material architecture
-- SAFE TO RUN MULTIPLE TIMES (idempotent). If you hit a transient
-- "deadlock detected", just run this whole script again.
-- Depends on 0001 + 0004.
-- =====================================================================

-- ---- 1. per-material attribute rules ----
alter table material_groups
  add column if not exists has_category boolean not null default false,
  add column if not exists has_color    boolean not null default false,
  add column if not exists has_size     boolean not null default false;

update material_groups set has_category=true,  has_color=true,  has_size=false where code='FAB';
update material_groups set has_category=false, has_color=true,  has_size=false where code='THR';
update material_groups set has_category=false, has_color=false, has_size=true  where code='ZIP';
update material_groups set has_category=false, has_color=false, has_size=false where code='STK';
update material_groups set has_category=false, has_color=false, has_size=false where code='PKG';

-- ---- 2. which units each material may be received in ----
create table if not exists group_units (
  group_id uuid not null references material_groups(id) on delete cascade,
  unit_id  uuid not null references units(id),
  primary key (group_id, unit_id)
);
alter table group_units enable row level security;
drop policy if exists group_units_read  on group_units;
drop policy if exists group_units_write on group_units;
create policy group_units_read  on group_units for select using (auth.uid() is not null);
create policy group_units_write on group_units for all
  using (has_permission('materials.manage')) with check (has_permission('materials.manage'));

insert into group_units (group_id, unit_id)
select g.id, u.id
from material_groups g join units u on true
where (g.code='FAB' and u.name='Kilogram')
   or (g.code='THR' and u.name in ('Kilogram','Pieces'))
   or (g.code='ZIP' and u.name='Pieces')
   or (g.code='STK' and u.name='Kilogram')
   or (g.code='PKG' and u.name='Kilogram')
on conflict do nothing;

-- ---- 3. material items (the actual variants) ----
create table if not exists material_items (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  group_id    uuid not null references material_groups(id),
  category_id uuid references material_categories(id),
  color_id    uuid references colors(id),
  size_id     uuid references sizes(id),
  unit_id     uuid not null references units(id),
  name        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
create index if not exists idx_material_items_group on material_items(group_id);

create or replace function set_material_item_code()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.code is null or new.code = '' then
    new.code := next_document_number('MAT', 'MAT');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_material_items_updated on material_items;
drop trigger if exists trg_audit_material_items   on material_items;
drop trigger if exists trg_material_items_code     on material_items;
create trigger trg_material_items_updated before update on material_items for each row execute function set_updated_at();
create trigger trg_audit_material_items   after insert or update or delete on material_items for each row execute function audit_row_change();
create trigger trg_material_items_code     before insert on material_items for each row execute function set_material_item_code();

alter table material_items enable row level security;
drop policy if exists material_items_read  on material_items;
drop policy if exists material_items_write on material_items;
create policy material_items_read  on material_items for select using (auth.uid() is not null);
create policy material_items_write on material_items for all
  using (has_permission('materials.manage')) with check (has_permission('materials.manage'));

-- ---- 4. starter data (all editable) ----
insert into colors (name) values ('Blue'),('Red'),('Black'),('White'),('Green')
on conflict (name) do nothing;
insert into sizes (name, sort_order)
select n::text, n from generate_series(1, 10) as n
on conflict (name) do nothing;

-- =====================================================================
-- END OF MIGRATION 0005 (idempotent)
-- =====================================================================
