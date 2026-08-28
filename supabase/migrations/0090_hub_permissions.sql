-- 0090_hub_permissions.sql
--
-- STEP 1 OF 4. THIS GATES NOTHING AND CANNOT LOCK ANYONE OUT.
--
-- It only creates permission rows and grants them. Every /online/* route stays
-- exactly as open as it is today. The gating happens in a later step, after you
-- have confirmed you can still get in.
--
-- THAT ORDER IS THE WHOLE POINT
--   The moment a route is gated it starts being CHECKED, and anyone without the
--   matching permission is refused — including whoever is doing the gating, if
--   the rows do not exist yet. Creating and granting first makes that
--   impossible.
--
-- WHY THE HUB HAS NO PERMISSIONS AT ALL RIGHT NOW
--   lib/access.ts maps /inventory, /production, /employees and the rest, and
--   not one /online/* path. So anyone who can log in sees Finance, Logistics,
--   Orders and everything else. There is currently no way to give somebody
--   less, which is what blocks handing Finance to one person.
--
-- THE SHAPE OF IT
--   One permission per Hub area, split into view and manage, because "can look
--   at the money" and "can change the money" are different jobs:
--
--       hub.dashboard.view    the department overview
--       hub.orders.view       see orders            .manage  edit them
--       hub.logistics.view    see parcels           .manage  edit, mark returns
--       hub.finance.view      see money             .manage  import settlements,
--                                                            correct payments
--       hub.attendance.view   see attendance        .manage  record it
--
--   Granting hub.finance.view alone gives exactly the person you described:
--   somebody who runs Finance and cannot touch anything else.
--
-- Safe to run more than once.

begin;

insert into permissions (code, module, description) values
  ('hub.dashboard.view',  'hub', 'View the Hub department dashboard'),
  ('hub.orders.view',     'hub', 'View online orders'),
  ('hub.orders.manage',   'hub', 'Add, edit and import online orders'),
  ('hub.logistics.view',  'hub', 'View parcels, couriers and returns'),
  ('hub.logistics.manage','hub', 'Edit parcels, confirm returns, run courier syncs'),
  ('hub.finance.view',    'hub', 'View COD payments, settlements and charges'),
  ('hub.finance.manage',  'hub', 'Import settlements and correct payments'),
  ('hub.attendance.view', 'hub', 'View Hub attendance'),
  ('hub.attendance.manage','hub','Record and edit Hub attendance')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Grant every one of them to any role that can already manage users or roles.
--
-- That is the safety net: whoever administers this system keeps full access the
-- instant gating is switched on, without anyone having to remember to grant it.
-- ---------------------------------------------------------------------------
insert into role_permissions (role_id, permission_id)
select r.id, p.id
  from roles r
  cross join permissions p
 where p.module = 'hub'
   and exists (
     select 1 from role_permissions rp
       join permissions ap on ap.id = rp.permission_id
      where rp.role_id = r.id
        and ap.code in ('users.manage', 'roles.manage')
   )
on conflict do nothing;

commit;

-- ===========================================================================
-- BEFORE GOING ANY FURTHER, CHECK YOU WILL NOT BE LOCKED OUT
-- ===========================================================================
--
-- 1. Are you a super admin? A super admin bypasses every permission check, so
--    if this says true you cannot be locked out of anything, ever.
--
-- select id, full_name, email, is_super_admin from users order by created_at;
--
-- 2. Who now holds the Hub permissions?
--
-- select r.name as role, count(*) as hub_permissions
--   from role_permissions rp
--   join permissions p on p.id = rp.permission_id
--   join roles r on r.id = rp.role_id
--  where p.module = 'hub'
--  group by r.name order by 2 desc;
--
-- 3. And your own account specifically — this is the one that matters:
--
-- select u.email, u.is_super_admin,
--        coalesce(string_agg(p.code, ', ' order by p.code), '(none)') as hub_permissions
--   from users u
--   left join user_roles ur       on ur.user_id = u.id
--   left join role_permissions rp on rp.role_id = ur.role_id
--   left join permissions p       on p.id = rp.permission_id and p.module = 'hub'
--  group by u.email, u.is_super_admin;
--
-- ===========================================================================
-- DO NOT PROCEED TO STEP 2 UNTIL (3) SHOWS EITHER is_super_admin = true
-- OR all nine hub.* permissions against your own email.
-- ===========================================================================
