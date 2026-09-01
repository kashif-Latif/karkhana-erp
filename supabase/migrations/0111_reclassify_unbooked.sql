-- 0111_reclassify_unbooked.sql
--
-- 93 PARCELS SAY "IN TRANSIT" WHILE THE COURIER SAYS NOBODY HAS COLLECTED THEM.
--
-- Two separate bugs put them there:
--
--   1. classify() lumped "unbooked" in with "in transit" — fixed in the sync.
--   2. The booking path wrote delivery_status: "In Transit" as a literal while
--      storing PostEx's real answer in the column beside it. That one is why
--      the count stayed at zero even after the classifier was corrected: these
--      rows were never read by the tracking sync, they were written here.
--
-- Both are fixed in postex-sync, but a sync only corrects rows it re-reads.
-- These already exist and carry the wrong status until it is set here.
--
-- WHY IT MATTERS
--   An unbooked parcel is sitting in the warehouse waiting for somebody to
--   chase the pickup. An in-transit one needs nothing. Calling the first the
--   second hides the only one that requires action — and hides it in the
--   direction that lets everyone do nothing.
--
-- The raw courier status is the authority here. It was correct all along;
-- only our interpretation of it was wrong.
--
-- REDEPLOY postex-sync BEFORE RUNNING THIS, or the next booking writes the
-- same wrong value again.
--
-- Safe to run more than once.

begin;

update online_logistics
   set delivery_status = 'Unbooked',
       updated_at      = now()
 where delivery_status = 'In Transit'
   and status is not null
   and lower(btrim(status)) ~ 'un-?booked';

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- What the couriers actually say, against what we store. Every row should
-- -- now agree; an "In Transit" row whose raw status reads unbooked is a leak.
-- select delivery_status, status as courier_says, count(*)
--   from online_logistics
--  where delivery_status in ('In Transit', 'Unbooked')
--  group by 1, 2 order by 1, 3 desc;
--
-- -- Must be 0:
-- select count(*) as still_wrong
--   from online_logistics
--  where delivery_status = 'In Transit'
--    and lower(btrim(coalesce(status, ''))) ~ 'un-?booked';
--
-- -- And the money sitting in the warehouse, which is the point of knowing:
-- select count(*) as parcels, sum(cod_amount) as cod_waiting_for_pickup
--   from online_logistics where delivery_status = 'Unbooked';
-- ===========================================================================
-- UNDO
-- ===========================================================================
-- update online_logistics set delivery_status = 'In Transit'
--  where delivery_status = 'Unbooked';
-- ===========================================================================
