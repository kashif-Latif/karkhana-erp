-- =====================================================================
-- HEAD OFFICE ERP — Migration 0009: my_permissions() (idempotent)
-- Returns the CURRENT user's permission codes as a text array, so the
-- app can show each person only the menus/pages they're allowed to use.
-- Super admins get every permission. (Security is still enforced in the
-- database by RLS/RPCs — this only tailors what the UI shows.)
-- =====================================================================

create or replace function my_permissions()
returns text[] language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct code), '{}')::text[]
  from (
    -- permissions granted through the user's role(s)
    select p.code
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
    union
    -- super admins implicitly have everything
    select p.code
    from permissions p
    where exists (select 1 from app_users u where u.id = auth.uid() and u.is_super_admin)
  ) x;
$$;

grant execute on function my_permissions() to authenticated;

-- =====================================================================
-- END OF MIGRATION 0009 (idempotent)
-- =====================================================================
