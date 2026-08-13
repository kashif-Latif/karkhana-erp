-- =====================================================================
-- HEAD OFFICE ERP — Migration 0002: keep-alive health check
-- Purpose: a lightweight endpoint an external scheduler can ping so the
-- free Supabase project registers activity and never auto-pauses.
-- Safe to run once in the SQL editor (like 0001).
-- =====================================================================

-- Tiny heartbeat log (kept trimmed to the latest ~100 rows).
create table if not exists heartbeats (
  id         bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  source     text
);
alter table heartbeats enable row level security;
-- No policies → the table is only ever touched by the SECURITY DEFINER
-- function below, never directly by clients.

-- Health check: writes a heartbeat, trims old rows, returns a small status.
-- SECURITY DEFINER so it can write despite RLS; callable by anon so an
-- external cron can hit it with the public anon key.
create or replace function health_check()
returns json language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_beats bigint;
begin
  insert into heartbeats(source) values ('keepalive');
  -- keep the table small
  delete from heartbeats
   where id < (select max(id) - 100 from heartbeats);
  select count(*) into v_beats from heartbeats;
  return json_build_object('ok', true, 'time', now(), 'beats', v_beats);
end;
$$;

grant execute on function health_check() to anon, authenticated;

-- =====================================================================
-- END OF MIGRATION 0002
-- =====================================================================
