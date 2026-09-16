-- 0123_retail_function_hardening.sql
--
-- Two findings from Supabase's security advisor after 0118-0122, both on
-- objects those migrations created. Neither leaks data today; both are the
-- kind of thing that is free to fix now and expensive to find later.
--
-- 1. retail_sale_lines_reject_billwise had a MUTABLE search_path.
--
--    A function without a pinned search_path resolves its names against
--    whatever the caller's search_path happens to be. For a SECURITY DEFINER
--    function that is a straightforward privilege-escalation path: create a
--    schema earlier in the path holding your own md5() or your own table, and
--    the function runs your code with the definer's rights.
--
--    This one is SECURITY INVOKER, so it is not escalation — but it is a
--    trigger that fires on every inserted sale line, and a trigger that can be
--    made to resolve differently depending on who is inserting is a guard that
--    can be walked around. Pinned.
--
-- 2. retail_can() and retail_any() were executable by `anon`.
--
--    Both are SECURITY DEFINER and both were reachable unauthenticated at
--    /rest/v1/rpc/retail_can. Calling them without a session returns false —
--    auth.uid() is null, so has_permission() finds nothing — so nothing leaks.
--    But a permission-check function is not something the logged-out world
--    needs to be able to call, and leaving it open invites somebody to probe
--    permission codes one string at a time.
--
--    CAREFUL: these two are used INSIDE every retail RLS policy, and a policy
--    expression is evaluated with the privileges of the querying role. Revoke
--    EXECUTE from `authenticated` and every retail table starts answering
--    "permission denied for function retail_can" instead of returning rows.
--    So: revoke from public (which is what reaches anon), then grant back to
--    authenticated explicitly. Every retail policy is `to authenticated`, so
--    anon never evaluates one and never needs the function.
--
-- Safe to run more than once.

begin;

-- 1. Pin the trigger function's search_path.
create or replace function retail_sale_lines_reject_billwise()
returns trigger language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(new.item_code,'') = '' then
    raise exception
      'Wrong Nimbus report: this file has no item codes, which means it is the BILL-WISE sale report. Upload the ITEM-WISE sale report instead — commissions are calculated per item and cannot be built from bill-wise data.'
      using errcode = 'check_violation',
            hint = 'In Nimbus choose the item-wise (line-item) sale export, not the bill-wise (per-receipt) one.';
  end if;
  return new;
end;
$function$;

-- 2. Close the two gates to anon, keep them open to signed-in users.
revoke all on function retail_can(text) from public;
revoke all on function retail_any()    from public;
grant execute on function retail_can(text) to authenticated;
grant execute on function retail_any()     to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- Both should be false for anon, true for authenticated.
-- select has_function_privilege('anon',          'public.retail_can(text)', 'execute') as anon_can,
--        has_function_privilege('authenticated', 'public.retail_can(text)', 'execute') as auth_can,
--        has_function_privilege('anon',          'public.retail_any()',     'execute') as anon_any,
--        has_function_privilege('authenticated', 'public.retail_any()',     'execute') as auth_any;
--
-- -- Every retail function should now show a pinned search_path.
-- select proname, proconfig from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
--  where proname like 'retail_%' order by 1;
--
-- -- And the tables must still be readable by a signed-in user with the
-- -- permission. If this migration broke the grant, this is where it shows.
-- ===========================================================================
