-- =====================================================================
-- HEAD OFFICE ERP — Migration 0011: login by email OR phone (idempotent)
-- No SMS/OTP. A user can sign in with their email (if they have one) or
-- their phone number — both with a password. This function maps whatever
-- they typed to the email the auth system logs in with. Phone-only users
-- are created with an internal email (…@karkhana.local) behind the scenes.
-- =====================================================================

create or replace function resolve_login_email(p_identifier text)
returns text language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_id     text;
  v_digits text;
  v_email  text;
begin
  v_id := trim(coalesce(p_identifier, ''));
  if v_id = '' then return null; end if;

  -- Looks like an email → use it as-is.
  if position('@' in v_id) > 0 then
    return lower(v_id);
  end if;

  -- Otherwise treat it as a phone number (compare digits only, so spaces
  -- and dashes don't matter).
  v_digits := regexp_replace(v_id, '\D', '', 'g');
  if v_digits = '' then return null; end if;

  select email into v_email
  from app_users
  where email is not null
    and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
  limit 1;

  return v_email;
end;
$$;

grant execute on function resolve_login_email(text) to anon, authenticated;

-- =====================================================================
-- END OF MIGRATION 0011 (idempotent)
-- =====================================================================
