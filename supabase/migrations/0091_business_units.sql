-- 0091_business_units.sql
--
-- STEP A. Rows for the three businesses, so an employee can belong to one.
--
-- WHAT IS THERE NOW
--   departments holds CUT, STITCH, CLIP, IRON, QAQC — the factory floors of
--   Karkhana. There is no row for Hub, no row for Inventory, no row for
--   FS Traders, so nobody can be assigned to a business at all. Every screen
--   that filters by business needs these to exist first.
--
-- WHY THEY GO IN THE SAME TABLE AS THE FACTORY FLOORS
--   Because a business unit and a factory floor are the same shape: a place a
--   person belongs to. Splitting them would mean two tables, two joins on every
--   employee query, and a decision to make every time somebody is hired.
--   A `kind` column tells them apart, which is all that was ever needed.
--
--   Cutting stays under Karkhana. Hub, Inventory and FS Traders sit at the top.
--   When FS Traders adds its eight shops they become rows here too, with
--   FST as their parent, and nothing else changes.
--
-- WHAT THIS DOES NOT DO
--   Does not gate a single route. Does not move any employee. Does not touch
--   attendance, payroll or advances. It only creates rows and two columns.
--
-- Safe to run more than once.

begin;

alter table departments
  add column if not exists kind      text default 'section',
  add column if not exists parent_id uuid references departments(id),
  add column if not exists sort_order integer default 100;

comment on column departments.kind is
  'business_unit for Karkhana, Hub, Inventory and FS Traders; section for a floor or shop inside one. Lets a single table hold both without a second join.';

-- The four top-level businesses.
insert into departments (code, name) values
  ('KARKHANA', 'Karkhana'),
  ('HUB',      'Hub Department'),
  ('INV',      'Inventory'),
  ('FST',      'FS Traders')
on conflict (code) do nothing;

update departments
   set kind = 'business_unit',
       sort_order = case code when 'KARKHANA' then 10 when 'HUB' then 20
                              when 'INV' then 30 when 'FST' then 40 end
 where code in ('KARKHANA', 'HUB', 'INV', 'FST');

-- The existing factory floors belong under Karkhana. They were top-level only
-- because there was nothing above them to point at.
update departments d
   set kind = 'section',
       parent_id = (select id from departments where code = 'KARKHANA')
 where d.code in ('CUT', 'STITCH', 'CLIP', 'IRON', 'QAQC')
   and d.parent_id is null;

-- ---------------------------------------------------------------------------
-- The Hub's own attendance employees predate these migrations — they were
-- created outside them, so nothing here assumes their shape beyond adding one
-- nullable column. Existing rows are untouched and every screen keeps working.
-- ---------------------------------------------------------------------------
do $do$
begin
  if to_regclass('public.online_att_employees') is not null then
    execute 'alter table online_att_employees
               add column if not exists department_id uuid references departments(id)';
    -- Everyone already in the Hub attendance list belongs to the Hub.
    execute 'update online_att_employees
                set department_id = (select id from departments where code = ''HUB'')
              where department_id is null';
    raise notice '0091: online_att_employees linked to the Hub';
  else
    raise notice '0091: online_att_employees not present, skipped';
  end if;
end
$do$;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- The four businesses, with the factory floors nested underneath.
-- select coalesce(p.name, d.name) as business,
--        case when d.parent_id is null then '' else d.name end as section,
--        d.code, d.kind
--   from departments d
--   left join departments p on p.id = d.parent_id
--  order by coalesce(p.sort_order, d.sort_order), d.parent_id nulls first, d.name;
--
-- -- Every Hub attendance employee should now carry the Hub.
-- select d.name as department, count(*) as employees
--   from online_att_employees e
--   left join departments d on d.id = e.department_id
--  group by d.name;
-- ===========================================================================
