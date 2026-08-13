-- =====================================================================
-- HEAD OFFICE ERP — Migration 0006: Employees + Designations (Day 2)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0001.
-- Departments already exist & are seeded by 0001.
-- Authorization: view for any signed-in user, edit for 'employees.manage'
-- (super admin + admin) — all other employees view-only.
-- =====================================================================

-- ---- Designations (job titles: Tailor, Cutting Master, Helper, …) ----
create table if not exists designations (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---- Employees ----
create table if not exists employees (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                     -- auto: EMP-YYYY-000001
  name           text not null,
  department_id  uuid references departments(id),
  designation_id uuid references designations(id),
  phone          text,
  cnic           text,                             -- national ID (optional)
  join_date      date,
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);
create index if not exists idx_employees_department  on employees(department_id);
create index if not exists idx_employees_designation on employees(designation_id);
create index if not exists idx_employees_active      on employees(is_active);

-- ---- auto-code for employees ----
create or replace function set_employee_code()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.code is null or new.code = '' then
    new.code := next_document_number('EMP', 'EMP');
  end if;
  return new;
end;
$$;

-- ---- triggers (idempotent) ----
drop trigger if exists trg_designations_updated on designations;
drop trigger if exists trg_audit_designations   on designations;
create trigger trg_designations_updated before update on designations for each row execute function set_updated_at();
create trigger trg_audit_designations   after insert or update or delete on designations for each row execute function audit_row_change();

drop trigger if exists trg_employees_updated on employees;
drop trigger if exists trg_audit_employees   on employees;
drop trigger if exists trg_employees_code     on employees;
create trigger trg_employees_updated before update on employees for each row execute function set_updated_at();
create trigger trg_audit_employees   after insert or update or delete on employees for each row execute function audit_row_change();
create trigger trg_employees_code     before insert on employees for each row execute function set_employee_code();

-- ---- RLS (idempotent) ----
alter table designations enable row level security;
alter table employees    enable row level security;

drop policy if exists designations_read  on designations;
drop policy if exists designations_write on designations;
create policy designations_read  on designations for select using (auth.uid() is not null);
create policy designations_write on designations for all
  using (has_permission('employees.manage')) with check (has_permission('employees.manage'));

drop policy if exists employees_read  on employees;
drop policy if exists employees_write on employees;
create policy employees_read  on employees for select using (auth.uid() is not null);
create policy employees_write on employees for all
  using (has_permission('employees.manage')) with check (has_permission('employees.manage'));

-- ---- starter designations (all editable) ----
insert into designations (name) values
  ('Cutting Master'), ('Tailor'), ('Helper'), ('Iron Man'), ('QC Inspector'), ('Packer')
on conflict (name) do nothing;

-- =====================================================================
-- END OF MIGRATION 0006 (idempotent)
-- =====================================================================
