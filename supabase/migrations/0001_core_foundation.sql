-- =====================================================================
-- HEAD OFFICE ERP — PHASE 1: CORE FOUNDATION
-- Migration 0001 : identity, RBAC, departments, audit, numbering
-- Target       : PostgreSQL 15+ (Supabase)
-- Principle    : security lives in the DATABASE. The browser never
--                writes balances or bypasses rules. Every rule below
--                is enforced by Row Level Security + SECURITY DEFINER
--                functions, so it holds no matter who calls it.
-- Time         : stored in UTC (timestamptz); displayed Asia/Karachi.
-- =====================================================================

-- ---- Extensions -----------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---- Utility: keep updated_at fresh ---------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- DEPARTMENTS
-- Needed early: users belong to a department, and the Department
-- Supervisor role is scoped to one. Hierarchy via parent_id, not code.
-- =====================================================================
create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  parent_id   uuid references departments(id),
  is_active   boolean not null default true,     -- soft-disable, never delete
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
create index if not exists idx_departments_parent on departments(parent_id);
create trigger trg_departments_updated
  before update on departments
  for each row execute function set_updated_at();

-- =====================================================================
-- APP USERS  (login profile, 1:1 with Supabase auth.users)
-- Accounts are created by admins only — there is no public signup.
-- =====================================================================
create table if not exists app_users (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  email          text,
  phone          text,
  department_id  uuid references departments(id),
  status         text not null default 'active'
                 check (status in ('active','inactive','suspended')),
  is_super_admin boolean not null default false,   -- fast path for full access
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);
create index if not exists idx_app_users_department on app_users(department_id);
create index if not exists idx_app_users_status     on app_users(status);
create trigger trg_app_users_updated
  before update on app_users
  for each row execute function set_updated_at();

-- =====================================================================
-- RBAC : roles, permissions, and the two mapping tables
-- =====================================================================
create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  description text,
  is_system   boolean not null default false,     -- system roles are protected
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_roles_updated
  before update on roles
  for each row execute function set_updated_at();

create table if not exists permissions (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,               -- e.g. 'grn.approve'
  module      text not null,                       -- e.g. 'inventory'
  description text
);

create table if not exists role_permissions (
  role_id       uuid not null references roles(id)       on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists user_roles (
  user_id     uuid not null references app_users(id) on delete cascade,
  role_id     uuid not null references roles(id)     on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id),
  primary key (user_id, role_id)
);
create index if not exists idx_user_roles_role on user_roles(role_id);

-- =====================================================================
-- AUTHORIZATION : one source of truth.
-- has_permission() is used by RLS policies here AND by every write-RPC
-- in later phases. SECURITY DEFINER so it can read the RBAC tables
-- regardless of the caller's own RLS (no recursion — owner bypasses RLS).
-- =====================================================================
create or replace function has_permission(p_permission_code text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from app_users u
    where u.id = auth.uid() and u.is_super_admin = true
  )
  or exists (
    select 1
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p       on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and p.code = p_permission_code
  );
$$;

create or replace function is_super_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from app_users u where u.id = auth.uid() and u.is_super_admin = true
  );
$$;

-- =====================================================================
-- AUDIT LOG  (append-only; never updated or deleted through the app)
-- =====================================================================
create table if not exists audit_logs (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id     uuid references auth.users(id),
  user_email  text,
  action      text not null,           -- insert | update | delete | approve | ...
  table_name  text,
  record_id   text,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  ip_address  inet,
  user_agent  text
);
create index if not exists idx_audit_time          on audit_logs(occurred_at desc);
create index if not exists idx_audit_table_record  on audit_logs(table_name, record_id);
create index if not exists idx_audit_user          on audit_logs(user_id);

-- Generic audit trigger: snapshots old/new row + the acting user.
-- (IP / user-agent are added by the app layer for auth events.)
create or replace function audit_row_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_email text;
begin
  select email into v_email from app_users where id = auth.uid();
  insert into audit_logs(user_id, user_email, action, table_name, record_id, old_value, new_value)
  values (
    auth.uid(), v_email, lower(tg_op), tg_table_name,
    coalesce(new.id::text, old.id::text),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

-- Attach to the id-bearing foundation tables. (role_permissions and
-- user_roles use composite keys and are audited via the admin RPC later.)
create trigger trg_audit_app_users after insert or update or delete on app_users
  for each row execute function audit_row_change();
create trigger trg_audit_roles after insert or update or delete on roles
  for each row execute function audit_row_change();
create trigger trg_audit_departments after insert or update or delete on departments
  for each row execute function audit_row_change();

-- =====================================================================
-- DOCUMENT NUMBERING  (concurrency-safe, human-readable references)
-- Format: PREFIX-YYYY-000001   e.g.  GRN-2026-000145
-- The ON CONFLICT ... DO UPDATE ... RETURNING is atomic and row-locks
-- the sequence, so two simultaneous callers can never collide.
-- =====================================================================
create table if not exists number_sequences (
  doc_type    text not null,
  year        int  not null,
  last_number bigint not null default 0,
  primary key (doc_type, year)
);

create or replace function next_document_number(p_doc_type text, p_prefix text)
returns text language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_year int := extract(year from (now() at time zone 'Asia/Karachi'))::int;
  v_next bigint;
begin
  insert into number_sequences(doc_type, year, last_number)
  values (p_doc_type, v_year, 1)
  on conflict (doc_type, year)
  do update set last_number = number_sequences.last_number + 1
  returning last_number into v_next;
  return p_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- =====================================================================
-- ROW LEVEL SECURITY  (deny by default; grant through permission checks)
-- =====================================================================
alter table departments      enable row level security;
alter table app_users        enable row level security;
alter table roles            enable row level security;
alter table permissions      enable row level security;
alter table role_permissions enable row level security;
alter table user_roles       enable row level security;
alter table audit_logs       enable row level security;
alter table number_sequences enable row level security;   -- no policies => definer-only

-- app_users: read own row; users.manage reads/writes everyone
create policy app_users_read on app_users
  for select using (id = auth.uid() or has_permission('users.manage'));
create policy app_users_write on app_users
  for all using (has_permission('users.manage'))
  with check (has_permission('users.manage'));

-- roles / permissions: any signed-in user may read (UI needs them);
-- only roles.manage may modify.
create policy roles_read  on roles       for select using (auth.uid() is not null);
create policy roles_write on roles       for all
  using (has_permission('roles.manage')) with check (has_permission('roles.manage'));
create policy perms_read  on permissions for select using (auth.uid() is not null);
create policy perms_write on permissions for all
  using (has_permission('roles.manage')) with check (has_permission('roles.manage'));
create policy rp_read     on role_permissions for select using (auth.uid() is not null);
create policy rp_write    on role_permissions for all
  using (has_permission('roles.manage')) with check (has_permission('roles.manage'));

-- user_roles: read own; users.manage manages all
create policy ur_read  on user_roles for select
  using (user_id = auth.uid() or has_permission('users.manage'));
create policy ur_write on user_roles for all
  using (has_permission('users.manage')) with check (has_permission('users.manage'));

-- departments: signed-in read; departments.manage modifies
create policy dept_read  on departments for select using (auth.uid() is not null);
create policy dept_write on departments for all
  using (has_permission('departments.manage'))
  with check (has_permission('departments.manage'));

-- audit_logs: readable only by audit.view; NO client writes at all
-- (only the SECURITY DEFINER trigger, which runs as owner, can insert).
create policy audit_read on audit_logs for select using (has_permission('audit.view'));

-- =====================================================================
-- FUNCTION EXECUTION LOCK-DOWN
-- =====================================================================
grant execute on function has_permission(text) to authenticated;
grant execute on function is_super_admin()      to authenticated;
revoke execute on function next_document_number(text, text) from public;  -- RPC-only

-- =====================================================================
-- SEED — system roles
-- =====================================================================
insert into roles (code, name, description, is_system) values
  ('super_admin','Super Administrator','Full unrestricted access', true),
  ('admin','Administrator','Manage materials, rates, employees, users, settings, reports', true),
  ('inventory_manager','Inventory Manager','Receive / issue / return / view stock and ledger', true),
  ('storekeeper','Storekeeper','Create GRN, issue material, create returns, view stock', true),
  ('dept_supervisor','Department Supervisor','Access limited to their assigned department', true),
  ('production_entry','Production Data Entry','Enter employee production figures', true),
  ('hr_payroll','HR / Payroll','View employee work and earnings', true),
  ('auditor','Auditor','Read-only: transactions, ledgers, audit, reports', true)
on conflict (code) do nothing;

-- =====================================================================
-- SEED — action-level permissions (grouped by module)
-- =====================================================================
insert into permissions (code, module, description) values
  ('users.manage','admin','Create/edit users and role assignments'),
  ('roles.manage','admin','Manage roles and permissions'),
  ('departments.manage','admin','Manage departments'),
  ('settings.manage','admin','Manage system settings'),
  ('audit.view','admin','View audit trail'),
  ('materials.manage','master','Manage materials, categories, colors, sizes, units'),
  ('suppliers.manage','master','Manage suppliers'),
  ('rates.manage','master','Manage purchase & piece rates'),
  ('employees.manage','master','Manage employees & designations'),
  ('inventory.view','inventory','View stock and ledger'),
  ('grn.create','inventory','Create goods receipt notes'),
  ('grn.approve','inventory','Approve goods receipt notes'),
  ('inventory.issue','inventory','Issue material to departments'),
  ('inventory.return','inventory','Record material returns'),
  ('inventory.transfer','inventory','Transfer material between locations'),
  ('inventory.adjust','inventory','Adjust stock / record wastage (privileged)'),
  ('inventory.approve','inventory','Approve inventory movements'),
  ('production.view','production','View production orders and WIP'),
  ('production.manage','production','Create/manage production orders'),
  ('production.entry','production','Enter daily production figures'),
  ('production.approve','production','Approve production entries'),
  ('payroll.view','payroll','View employee earnings & payroll'),
  ('payroll.manage','payroll','Manage payroll runs'),
  ('reports.view','reports','View reports'),
  ('reports.export','reports','Export reports')
on conflict (code) do nothing;

-- =====================================================================
-- SEED — role → permission grants
-- super_admin is handled by the is_super_admin flag (implicit ALL), but
-- we also grant it every permission explicitly for clarity in the UI.
-- =====================================================================
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.code = 'super_admin'
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  -- Administrator — broad management
  ('admin','users.manage'),('admin','roles.manage'),('admin','departments.manage'),
  ('admin','settings.manage'),('admin','audit.view'),('admin','materials.manage'),
  ('admin','suppliers.manage'),('admin','rates.manage'),('admin','employees.manage'),
  ('admin','inventory.view'),('admin','grn.create'),('admin','grn.approve'),
  ('admin','inventory.issue'),('admin','inventory.return'),('admin','inventory.transfer'),
  ('admin','inventory.adjust'),('admin','inventory.approve'),
  ('admin','production.view'),('admin','production.manage'),
  ('admin','production.entry'),('admin','production.approve'),
  ('admin','payroll.view'),('admin','payroll.manage'),
  ('admin','reports.view'),('admin','reports.export'),
  -- Inventory Manager
  ('inventory_manager','inventory.view'),('inventory_manager','grn.create'),
  ('inventory_manager','grn.approve'),('inventory_manager','inventory.issue'),
  ('inventory_manager','inventory.return'),('inventory_manager','inventory.transfer'),
  ('inventory_manager','inventory.approve'),('inventory_manager','reports.view'),
  -- Storekeeper
  ('storekeeper','inventory.view'),('storekeeper','grn.create'),
  ('storekeeper','inventory.issue'),('storekeeper','inventory.return'),
  ('storekeeper','reports.view'),
  -- Department Supervisor (department scoping enforced in later RPCs/RLS)
  ('dept_supervisor','production.view'),('dept_supervisor','production.entry'),
  ('dept_supervisor','inventory.view'),('dept_supervisor','reports.view'),
  -- Production Data Entry
  ('production_entry','production.view'),('production_entry','production.entry'),
  -- HR / Payroll
  ('hr_payroll','payroll.view'),('hr_payroll','production.view'),('hr_payroll','reports.view'),
  -- Auditor (all read-only)
  ('auditor','inventory.view'),('auditor','production.view'),('auditor','payroll.view'),
  ('auditor','audit.view'),('auditor','reports.view')
) as m(role_code, perm_code)
join roles r       on r.code = m.role_code
join permissions p on p.code = m.perm_code
on conflict do nothing;

-- =====================================================================
-- SEED — initial departments (all editable/disable-able later)
-- =====================================================================
insert into departments (code, name) values
  ('CUT','Cutting'),
  ('STITCH','Stitching'),
  ('CLIP','Clipping / Trimming'),
  ('IRON','Iron / Pressing'),
  ('QAQC','QA/QC & Packing')
on conflict (code) do nothing;

-- =====================================================================
-- BOOTSTRAP — promote your first Super Administrator (run ONCE).
--   1) Supabase Dashboard → Authentication → Add user (email + password).
--   2) In the SQL editor run:
--        select bootstrap_super_admin('owner@example.com', 'Owner Name');
-- Not exposed to the app; callable only from the SQL editor / service role.
-- =====================================================================
create or replace function bootstrap_super_admin(p_email text, p_full_name text)
returns text language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where email = lower(p_email);
  if v_uid is null then
    return 'No auth user found for ' || p_email ||
           '. Create them in Authentication first, then re-run.';
  end if;

  insert into app_users (id, full_name, email, is_super_admin, status)
  values (v_uid, p_full_name, lower(p_email), true, 'active')
  on conflict (id) do update
    set is_super_admin = true, status = 'active';

  insert into user_roles (user_id, role_id)
  select v_uid, id from roles where code = 'super_admin'
  on conflict do nothing;

  return 'Super admin ready: ' || p_email;
end;
$$;
revoke execute on function bootstrap_super_admin(text, text) from public;

-- =====================================================================
-- END OF MIGRATION 0001
-- =====================================================================
