-- =====================================================================
-- HEAD OFFICE ERP — Migration 0004: Catalog masters (Day 1, part 2)
-- Material groups, categories, units, colours, sizes.
-- Depends on 0001 (set_updated_at, audit_row_change, has_permission).
-- Authorization: anyone signed in can VIEW; only 'materials.manage' can edit.
-- =====================================================================

-- helper to attach the standard triggers + RLS to a simple master table
-- (done inline per table below for clarity).

-- ---- Material groups (the five; fixed but stored as data) ----
create table if not exists material_groups (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---- Units of measure ----
create table if not exists units (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,          -- Kilogram, Pieces, Meter
  symbol     text,                           -- KG, pcs, m
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---- Colours ----
create table if not exists colors (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---- Sizes ----
create table if not exists sizes (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---- Material categories (belong to a group) ----
create table if not exists material_categories (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references material_groups(id),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (group_id, name)
);
create index if not exists idx_material_categories_group on material_categories(group_id);

-- ---- triggers (updated_at + audit) for each table ----
do $$
declare t text;
begin
  foreach t in array array['material_groups','units','colors','sizes','material_categories']
  loop
    execute format('create trigger trg_%s_updated before update on %I for each row execute function set_updated_at();', t, t);
    execute format('create trigger trg_audit_%s after insert or update or delete on %I for each row execute function audit_row_change();', t, t);
  end loop;
end $$;

-- ---- RLS: read for any signed-in user, write for materials.manage ----
do $$
declare t text;
begin
  foreach t in array array['material_groups','units','colors','sizes','material_categories']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy %s_read on %I for select using (auth.uid() is not null);$p$, t, t);
    execute format($p$create policy %s_write on %I for all using (has_permission('materials.manage')) with check (has_permission('materials.manage'));$p$, t, t);
  end loop;
end $$;

-- ---- Seed: the five material groups ----
insert into material_groups (code, name) values
  ('FAB','Fabric'), ('THR','Thread'), ('ZIP','Zip'),
  ('STK','Sticker'), ('PKG','Packing Shopper')
on conflict (code) do nothing;

-- ---- Seed: common units ----
insert into units (name, symbol) values
  ('Kilogram','KG'), ('Pieces','pcs'), ('Meter','m')
on conflict (name) do nothing;

-- ---- Seed: a starter set of fabric categories (all editable) ----
insert into material_categories (group_id, name)
select g.id, c.name
from material_groups g
join (values ('Lycra'),('Jersey'),('Terry'),('Cotton')) as c(name) on true
where g.code = 'FAB'
on conflict (group_id, name) do nothing;

-- =====================================================================
-- END OF MIGRATION 0004
-- =====================================================================
