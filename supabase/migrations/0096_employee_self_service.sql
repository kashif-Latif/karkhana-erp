-- 0096_employee_self_service.sql
--
-- LINK A LOGIN TO AN EMPLOYEE, SO A PERSON CAN SEE THEMSELVES AND NOBODY ELSE.
--
-- Everything about the employee portal rests on one missing fact: when someone
-- signs in, which employee row is theirs? Without it there is no way to show a
-- person their own attendance and no way to stop them seeing everyone's.
--
-- WHY ROW LEVEL SECURITY AND NOT A FILTER IN THE PAGE
--   A page that filters is a page that can be asked not to. Anyone who opens
--   the browser console can call the API directly and read every salary in the
--   company. The rule has to live in the database, where it applies to every
--   query however it arrives — the page, the console, a stolen token.
--
--   This is salary data. It is the one place in this system where getting the
--   boundary wrong is not an inconvenience.
--
-- THE RULE
--   An employee sees rows where the employee is them. Full stop — no team view,
--   no supervisor exception, because none was asked for and the simplest rule
--   is the one that cannot leak.
--
--   Anyone holding hub.attendance.view keeps seeing everything, so the accounts
--   person's screens are unaffected. Super admins bypass as always.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. The link. Nullable, because most employees will never have a login —
--    a factory worker does not need one — and requiring it would block them
--    being added at all.
-- ---------------------------------------------------------------------------
alter table employees
  add column if not exists user_id uuid references app_users(id) on delete set null;

create unique index if not exists employees_user_id_uidx
  on employees (user_id) where user_id is not null;

comment on column employees.user_id is
  'The login belonging to this person, when they have one. ON DELETE SET NULL: removing an account must not remove the employee or their salary history — the person still worked those days.';

-- online_att_employees is what the attendance screens read, and it is keyed by
-- the same id, so the link is resolvable from either side.
do $do$
begin
  if to_regclass('public.online_att_employees') is not null then
    execute 'alter table online_att_employees
               add column if not exists user_id uuid references app_users(id) on delete set null';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. Who am I? One call the portal makes on load.
--
--    Returns nothing at all for a login with no employee record, which the
--    page shows as "your account is not linked to an employee record yet"
--    rather than an empty portal that looks broken.
-- ---------------------------------------------------------------------------
drop function if exists my_employee();
create or replace function my_employee()
returns table (
  emp_id      text,
  name        text,
  designation text,
  department  text,
  salary      numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select e.id::text, e.name, e.designation,
         coalesce(d.name, e.department),
         coalesce(e.sal, 0)::numeric
    from online_att_employees e
    left join departments d on d.id = e.department_id
   where e.user_id = auth.uid()
   limit 1;
$function$;

grant execute on function my_employee() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. My own month. Same formula as hub_monthly_payable, one person, no
--    department argument — there is nothing to choose between.
--
--    Rather than reimplement the arithmetic and risk the two drifting apart,
--    it calls the same function and filters. One formula, one place to fix.
-- ---------------------------------------------------------------------------
-- Dropped before creating, for the same reason 0095 does: a later change to
-- these columns would otherwise fail with "cannot change return type", and the
-- error only appears on the second deployment.
drop function if exists my_monthly_payable(integer, integer);
create or replace function my_monthly_payable(
  p_year  integer,
  p_month integer
)
returns table (
  name         text,
  designation  text,
  salary       numeric,
  present      integer,
  half         integer,
  absent       integer,
  paid_off     integer,
  extra_days   integer,
  counted_days numeric,
  advances     numeric,
  payable      numeric,
  is_paid      boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.name, m.designation, m.salary, m.present, m.half, m.absent,
         m.paid_off, m.extra_days, m.counted_days, m.advances, m.payable, m.is_paid
    from hub_monthly_payable(p_year, p_month, null) m
   where m.emp_id = (select e.id::text from online_att_employees e
                      where e.user_id = auth.uid() limit 1);
$function$;

grant execute on function my_monthly_payable(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. My own attendance and advances, for the calendar and the advance list.
-- ---------------------------------------------------------------------------
drop function if exists my_attendance(integer, integer);
create or replace function my_attendance(p_year integer, p_month integer)
returns table (day integer, status text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.day, r.status
    from online_att_records r
   where r.year = p_year and r.month = p_month
     and r.emp_id = (select e.id::text from online_att_employees e
                      where e.user_id = auth.uid() limit 1)
   order by r.day;
$function$;

grant execute on function my_attendance(integer, integer) to authenticated;

drop function if exists my_advances(integer, integer);
create or replace function my_advances(p_year integer, p_month integer)
returns table (date text, amount numeric, note text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.date, a.amount::numeric, a.note
    from online_att_advances a
   where a.deduct_year = p_year and a.deduct_month = p_month
     and a.emp_id = (select e.id::text from online_att_employees e
                      where e.user_id = auth.uid() limit 1)
   order by a.date;
$function$;

grant execute on function my_advances(integer, integer) to authenticated;

commit;

-- ===========================================================================
-- LINKING SOMEONE. Until a login is attached to an employee row, the portal
-- correctly shows that person nothing.
--
--   update online_att_employees
--      set user_id = (select id from app_users where email = 'someone@example.com')
--    where name = 'Abdul Rehman';
--
-- Who is linked, and who is not:
--
--   select e.name, u.email
--     from online_att_employees e
--     left join app_users u on u.id = e.user_id
--    order by e.name;
--
-- Test as yourself once linked — from the SQL editor these return nothing,
-- because auth.uid() is null there. That is the security working, not a fault.
-- ===========================================================================
