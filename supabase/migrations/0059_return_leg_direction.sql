-- 0059_return_leg_direction.sql
--
-- PART A ONLY — additive, no classifier changes.
--
-- Why this exists: OwnEx reuses `transit-received` and `in-transit` on BOTH the
-- outbound and the return leg. Verified on parcel 312010001714, which shows
-- transit-received at Karachi (08 Aug, outbound) and transit-received at Lahore
-- (22 Aug, return) — same code, opposite direction. Each poll overwrites
-- raw_status, so the current status alone can never tell you which way a parcel
-- is pointing. Direction has to become a stored fact.
--
-- Part B (is_returning() rewrite + the 34 ambiguous parcels) is held back until
-- the current function definitions are confirmed.

begin;

-- ---------------------------------------------------------------------------
-- 1. Direction as a stored fact. Set once, never cleared.
-- ---------------------------------------------------------------------------
alter table online_logistics
  add column if not exists return_leg_started_at timestamptz,
  add column if not exists return_leg_source     text;

comment on column online_logistics.return_leg_started_at is
  'First time the courier put this parcel on the return leg. Set once, never cleared. '
  'OwnEx reuses transit-received / in-transit on both legs, so current status cannot tell direction.';

comment on column online_logistics.return_leg_source is
  'How direction was learned: history (movement log) | status (unambiguous current status) | manual.';

create index if not exists idx_ol_return_leg
  on online_logistics (return_leg_started_at)
  where return_leg_started_at is not null;

-- ---------------------------------------------------------------------------
-- 2. One spelling for cancelled (was CANCELED 3 / Cancelled 24)
-- ---------------------------------------------------------------------------
update online_logistics
   set raw_status = 'Cancelled'
 where raw_status = 'CANCELED';

-- ---------------------------------------------------------------------------
-- 3. Seed direction from statuses that are ALREADY unambiguous.
--    No API call needed for these 25. The timestamp is approximate
--    (updated_at, not the courier's own event time) — flagged as source='status'
--    so the history backfill can overwrite it with the real one later.
-- ---------------------------------------------------------------------------
update online_logistics
   set return_leg_started_at = coalesce(updated_at, created_at),
       return_leg_source     = 'status'
 where courier = 'OwnEx'
   and return_leg_started_at is null
   and raw_status in ('Return Requested', 'Return In Progress', 'Return Initiated');

-- ---------------------------------------------------------------------------
-- 4. Junk test row (tracking_id 11111). Guarded: only if it carries no money.
-- ---------------------------------------------------------------------------
delete from online_logistics
 where tracking_id = '11111'
   and coalesce(cod_amount, 0) = 0;

commit;

-- ===========================================================================
-- VERIFY — run after commit. Expect ~25 rows stamped, all on return statuses,
-- and the 34 'Transit Received' rows still showing 0 (they need the history
-- backfill in Part B).
-- ===========================================================================
-- select raw_status,
--        delivery_status,
--        count(*)                                                    as n,
--        count(*) filter (where return_leg_started_at is not null)    as on_return_leg
--   from online_logistics
--  where courier = 'OwnEx'
--  group by 1, 2
--  order by n desc;
