-- =====================================================================
-- HEAD OFFICE ERP — Migration 0010: first-login password change (idempotent)
-- New accounts get a temporary password from the admin. On first login the
-- user is forced to set their OWN password. This flag drives that, and is
-- set automatically for every new login (so no function redeploy needed).
-- =====================================================================

alter table app_users
  add column if not exists must_change_password boolean not null default false;

-- Every NEW login must set its own password on first sign-in.
-- (Redefines the existing new-user trigger function to set the flag = true.)
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into app_users (id, full_name, email, must_change_password)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1), new.email),
    new.email,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Let a signed-in user clear their OWN flag after choosing a new password.
-- (Regular users can't write app_users directly, so this SECURITY DEFINER
--  RPC gives them exactly this one safe action — for their own row only.)
create or replace function clear_must_change_password()
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  update app_users set must_change_password = false where id = auth.uid();
end;
$$;

grant execute on function clear_must_change_password() to authenticated;

-- =====================================================================
-- END OF MIGRATION 0010 (idempotent)
-- =====================================================================
