-- 0119_retail_permissions.sql
--
-- FS TRADERS: a real permission set, and the two bugs it fixes.
--
-- BUG 1 — THE DEPARTMENT BOX IS INVISIBLE
--   app/page.tsx gates the FS Traders box on ["retail.view","retail.manage"].
--   Neither permission exists. The permissions table has exactly one retail
--   row: retail.access. So can() returns false for every normal user and the
--   box only ever appeared for super admins, who bypass the check entirely.
--   Nobody noticed because the only people who opened the page were admins.
--
-- BUG 2 — ONE PERMISSION FOR EVERYTHING
--   retail.access gates all fifteen tables, read and write, in one grant. The
--   shop accounts person who types today's expenses therefore also reads the
--   bank statements, staff advances, and every salary in the company. That is
--   not a policy anyone chose; it is what happens when a department is wired
--   up with a single boolean.
--
--   Grohub itself had three tiers — owner, org user, staff — and kept bank
--   tables owner-only. This restores that shape in Karkhana's own vocabulary.
--
-- WHAT retail.access BECOMES
--   It stays, and it stays granted. Every role that has it today keeps working
--   tomorrow, because 0120 writes every policy as "the specific permission OR
--   retail.access". It becomes the umbrella an owner holds, not the only key
--   in the building. Once the finer grants are assigned in Administration you
--   can take the umbrella off individual roles; until then nothing breaks.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- The permission rows. `module` groups them in the Administration screen.
-- ---------------------------------------------------------------------------
insert into permissions (code, module, description) values
  ('retail.access',           'FS Traders', 'Umbrella access to the whole FS Traders department'),

  ('retail.dashboard.view',   'FS Traders', 'See the FS Traders dashboard'),
  ('retail.sales.view',       'FS Traders', 'See sales and sale lines'),
  ('retail.branches.view',    'FS Traders', 'See the branch list'),
  ('retail.branches.manage',  'FS Traders', 'Add, edit and deactivate branches'),

  ('retail.expenses.view',    'FS Traders', 'See shop expenses and income'),
  ('retail.expenses.manage',  'FS Traders', 'Enter and edit shop expenses and income'),

  ('retail.cashbook.view',    'FS Traders', 'See the daily cash book'),
  ('retail.cashbook.manage',  'FS Traders', 'Edit a day in the cash book'),

  ('retail.commissions.view',   'FS Traders', 'See commission earnings'),
  ('retail.commissions.manage', 'FS Traders', 'Edit commission rates and bonus settings'),

  ('retail.employees.view',   'FS Traders', 'See shop employees and attendance'),
  ('retail.employees.manage', 'FS Traders', 'Add and edit employees, mark attendance'),

  ('retail.payroll.view',     'FS Traders', 'See salaries, wages and advances'),
  ('retail.payroll.manage',   'FS Traders', 'Pay salaries and wages, record advances'),

  ('retail.ho.view',          'FS Traders', 'See Head Office cash flow and end of day'),
  ('retail.ho.manage',        'FS Traders', 'Enter Head Office cash flow and close the day'),

  -- Card reconciliation is an operational job, not an owner one: somebody
  -- matches today's card credits to today's shops. In Grohub it sat at org
  -- level for exactly that reason, so it gets its own pair rather than being
  -- swept under the bank permissions.
  ('retail.cards.view',       'FS Traders', 'See card settlements and matching'),
  ('retail.cards.manage',     'FS Traders', 'Upload card slips and match settlements to branches'),

  -- Owner tier. A bank statement carries the personal account movement sitting
  -- beside the shop money — Raast P2P, PREMIER PAYFAST, RAAST ONUS lines are
  -- not the business's. In Grohub bank_accounts and bank_txns were owner-only
  -- outright and that is the right default here too.
  ('retail.bank.view',        'FS Traders', 'See bank accounts and statement lines (owner tier)'),
  ('retail.bank.manage',      'FS Traders', 'Upload statements, name references, edit rules (owner tier)'),

  ('retail.import.run',       'FS Traders', 'Upload NimbusRMS exports')
on conflict (code) do update set module = excluded.module, description = excluded.description;

-- ---------------------------------------------------------------------------
-- Anyone who can already reach retail keeps reaching everything. This is the
-- no-regression clause: a role holding retail.access today is granted the full
-- new set, so the day this ships nobody loses a screen they were using.
-- Narrow the roles afterwards in Administration, deliberately, one at a time.
-- ---------------------------------------------------------------------------
insert into role_permissions (role_id, permission_id)
select ur.role_id, p.id
  from (select distinct rp.role_id
          from role_permissions rp
          join permissions pa on pa.id = rp.permission_id
         where pa.code = 'retail.access') ur
 cross join permissions p
 where p.code like 'retail.%'
on conflict do nothing;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- 21 retail permissions.
-- select code, description from permissions where code like 'retail.%' order by code;
--
-- -- Which roles hold what. Every role that had retail.access should now show 21.
-- select r.name, count(*) as retail_perms
--   from roles r
--   join role_permissions rp on rp.role_id = r.id
--   join permissions p on p.id = rp.permission_id and p.code like 'retail.%'
--  group by r.name order by 2 desc;
-- ===========================================================================
