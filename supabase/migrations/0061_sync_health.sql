-- 0061_sync_health.sql
--
-- THE PROBLEM THIS SOLVES
--   Every cron job reported `succeeded` while every single HTTP call returned
--   401. pg_net dispatches asynchronously, so cron records only that the request
--   was HANDED OVER — never what came back. Two syncs were dead for months and
--   nothing anywhere said so:
--     * ownex-sync   — the vault held the literal placeholder PUT_YOUR_SYNC_KEY_HERE
--     * postex-sync  — Verify JWT was on, and it read the key from the body
--                      while call_sync sends it as a header
--
--   Both are fixed. This makes the NEXT one impossible to miss: the request id
--   is recorded when the call goes out, joined to the reply when it arrives, and
--   surfaced so the app can show it.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. Record every scheduled call, so a reply can be traced back to its function
-- ---------------------------------------------------------------------------
create table if not exists hub_sync_calls (
  id         bigserial primary key,
  fn         text        not null,
  request_id bigint      not null,
  payload    jsonb,
  called_at  timestamptz not null default now()
);

create index if not exists idx_hub_sync_calls_req  on hub_sync_calls (request_id);
create index if not exists idx_hub_sync_calls_when on hub_sync_calls (called_at desc);

comment on table hub_sync_calls is
  'One row per scheduled edge-function call. pg_net only returns a request id and '
  'resolves the reply later, so without this there is no way to tell which function '
  'a given net._http_response row belongs to.';

-- ---------------------------------------------------------------------------
-- 2. call_sync now logs what it dispatched. Header unchanged — x-sync-key is
--    correct; the fault was the vault value and postex-sync reading the body.
-- ---------------------------------------------------------------------------
create or replace function public.call_sync(fn text, payload jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
  v_id  bigint;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'sync_key';
  if v_key is null then
    raise exception 'sync_key is not in the vault — see step 1 of migration 0050';
  end if;

  -- A placeholder in the vault is worse than a missing one: it authenticates
  -- against nothing and fails quietly on every call. Refuse it outright.
  if v_key like 'PUT_%' or length(v_key) < 12 then
    raise exception 'sync_key in the vault is still a placeholder (%) — set the real key with vault.update_secret', left(v_key, 6);
  end if;

  select net.http_post(
    url     := 'https://ozkhkhlwjblzgwmjbdde.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := payload,
    timeout_milliseconds := 120000
  ) into v_id;

  insert into hub_sync_calls (fn, request_id, payload) values (fn, v_id, payload);

  return v_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. What actually came back, per function
--    Views run with the owner's rights by default, so the app can read this
--    without being granted access to the net schema itself.
-- ---------------------------------------------------------------------------
create or replace view v_sync_health as
select
  c.fn,
  c.called_at,
  r.status_code,
  r.timed_out,
  left(coalesce(r.error_msg, r.content), 200) as reply,
  case
    when r.status_code is null      then 'no reply recorded'
    when r.status_code between 200 and 299 then 'ok'
    when r.status_code in (401, 403) then 'AUTH FAILED — key or Verify JWT'
    else 'HTTP ' || r.status_code
  end as verdict
from hub_sync_calls c
left join net._http_response r on r.id = c.request_id
order by c.called_at desc;

-- The one row the dashboard needs: is each sync healthy right now?
create or replace view v_sync_health_summary as
select
  fn,
  max(called_at)                                                as last_called,
  (array_agg(status_code order by called_at desc))[1]           as last_status,
  (array_agg(verdict     order by called_at desc))[1]           as last_verdict,
  count(*) filter (where status_code between 200 and 299
                     and called_at > now() - interval '24 hours') as ok_24h,
  count(*) filter (where (status_code is null
                          or status_code not between 200 and 299)
                     and called_at > now() - interval '24 hours') as failed_24h
from v_sync_health
group by fn;

grant select on v_sync_health, v_sync_health_summary to authenticated;

commit;

-- ===========================================================================
-- VERIFY — nothing appears until the next scheduled run (within 10 minutes).
-- Every row should read 'ok'. Anything saying AUTH FAILED means that function
-- still has Verify JWT on, or is reading the key from the wrong place.
-- ===========================================================================
-- select * from v_sync_health_summary;
-- select * from v_sync_health limit 20;
