-- =====================================================================
-- HEAD OFFICE ERP — Migration 0008: User Management support (idempotent)
-- 1) auto-create an app_users profile when a new login is created
-- 2) a safe, admin-only function to set a user's role
-- Depends on 0001.
-- =====================================================================

-- ---- 1. new login  ->  app_users profile ----
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into app_users (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1), new.email),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---- 2. set a user's role (replaces existing) — admin only, atomic ----
create or replace function set_user_role(p_user_id uuid, p_role_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not has_permission('users.manage') then
    raise exception 'You do not have permission to manage users.';
  end if;
  -- prevent accidental self-lockout (super admins keep full access via their flag)
  if p_user_id = auth.uid() and not is_super_admin() then
    raise exception 'You cannot change your own role.';
  end if;

  delete from user_roles where user_id = p_user_id;
  if p_role_id is not null then
    insert into user_roles (user_id, role_id, assigned_by)
    values (p_user_id, p_role_id, auth.uid());
  end if;
end;
$$;

grant execute on function set_user_role(uuid, uuid) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0008 (idempotent)
-- =====================================================================
