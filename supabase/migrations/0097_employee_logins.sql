-- 0097_employee_logins.sql
--
-- GIVE THE SEVEN A LOGIN THAT REACHES NOTHING BUT THEIR OWN WAGES.
--
-- Two pieces are missing before an employee can be handed a password.
--
-- 1. A ROLE THAT GRANTS NOTHING
--    Every existing role grants something — Auditor reads ledgers, HR/Payroll
--    sees earnings across the company. An employee needs neither. They need a
--    login that opens /me and is refused everywhere else.
--
--    The temptation is to give them "no role". That works today only because
--    nothing checks, and the day somebody grants a permission to "everyone" it
--    would quietly reach them too. An explicit role with an empty permission set
--    says out loud that this person is meant to reach nothing, and stays true
--    when the permissions around it change.
--
-- 2. A FIRST LOGIN THAT FORCES A NEW PASSWORD
--    The plan is a shared default — 1234 — handed out when the account is made.
--    That is fine for one login and unacceptable for seven: whoever created the
--    accounts knows every password, and nobody can tell one person's actions
--    from another's afterwards.
--
--    must_change_password makes the default a one-time key. It opens the door
--    once and then has to be replaced. Until it is, the account can reach
--    nothing — not even the portal — so the step cannot be skipped by ignoring
--    the prompt.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. The flag. Default false, so nobody already using the system is locked out
--    by this migration; it is set explicitly when an account is created.
-- ---------------------------------------------------------------------------
alter table app_users
  add column if not exists must_change_password boolean not null default false;

comment on column app_users.must_change_password is
  'Set when an account is created with a shared default password. Until the person sets their own, every page is refused — a temporary password that is never replaced is a permanent shared one.';

-- ---------------------------------------------------------------------------
-- 2. The role that grants nothing, deliberately.
-- ---------------------------------------------------------------------------
insert into roles (code, name, description, is_system) values
  ('employee', 'Employee',
   'Sees only their own attendance, advances and salary. No department access.',
   true)
on conflict (code) do nothing;

-- No role_permissions rows. That is the point, and it is worth stating rather
-- than leaving as an absence somebody later reads as an oversight.

-- ---------------------------------------------------------------------------
-- 3. Attach a login to a person, in one call, so it cannot be half done.
--
--    Creating the auth user itself needs the service key and stays in the
--    create-user edge function. This links what already exists and puts them in
--    the Employee role — the two steps that were previously manual and easy to
--    forget, leaving an account that can sign in and see nothing, or an
--    employee nobody can find.
-- ---------------------------------------------------------------------------
create or replace function hub_link_employee_login(
  p_employee_name text,
  p_email         text,
  p_department    text default 'HUB'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user  uuid;
  v_emp   text;
  v_role  uuid;
begin
  select id into v_user from app_users where lower(email) = lower(p_email);
  if v_user is null then
    return jsonb_build_object('ok', false,
      'error', 'No account with that email. Create the login first, then link it.');
  end if;

  select e.id::text into v_emp
    from online_att_employees e
   where lower(e.name) = lower(p_employee_name)
     and e.department_id = (select id from departments where code = p_department);
  if v_emp is null then
    return jsonb_build_object('ok', false,
      'error', 'No employee by that name in ' || p_department || '.');
  end if;

  -- One login belongs to one person. Silently moving it would leave the
  -- previous holder able to sign in and see somebody else's wages.
  if exists (select 1 from online_att_employees
              where user_id = v_user and id::text <> v_emp) then
    return jsonb_build_object('ok', false,
      'error', 'That login is already attached to a different employee.');
  end if;

  update online_att_employees set user_id = v_user where id::text = v_emp;
  update employees set user_id = v_user
   where lower(name) = lower(p_employee_name)
     and department_id = (select id from departments where code = p_department);

  select id into v_role from roles where code = 'employee';
  insert into user_roles (user_id, role_id) values (v_user, v_role)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'employee', p_employee_name, 'email', p_email,
    'report', p_employee_name || ' can now sign in and see only their own record.');
end;
$function$;

grant execute on function hub_link_employee_login(text, text, text) to authenticated;

commit;

-- ===========================================================================
-- HOW TO GIVE SOMEBODY A LOGIN
--
--   1. Administration -> Users -> Add account. Their real email, and the
--      shared default password. Tick nothing else.
--   2. Link it:
--        select hub_link_employee_login('Abdul Rehman', 'rehman@example.com');
--   3. Mark the password as temporary, so the first sign-in forces a new one:
--        update app_users set must_change_password = true
--         where lower(email) = 'rehman@example.com';
--
-- Who is linked and who is not:
--
--   select e.name, u.email,
--          case when u.must_change_password then 'must change password'
--               when u.id is null then 'no login yet' else 'active' end as state
--     from online_att_employees e
--     left join app_users u on u.id = e.user_id
--    order by e.name;
-- ===========================================================================
