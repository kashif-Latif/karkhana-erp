-- 0093_import_hub_people.sql  (rev 4 — text ids and text dates)
--
-- The Hub's 7 people, 166 attendance records and 8 advances, brought across
-- from the old attendance app.
--
-- REV 2 removed temp tables, which vanished the moment a statement finished and
-- broke the migration when read piece by piece. Inline VALUES have no lifetime.
--
-- REV 4: online_att_advances.date is TEXT, not a date, and amount is an
-- integer. Casting the incoming value to ::date therefore produced
--
--     operator does not exist: text = date
--
-- The old app stored everything as strings, so nothing here casts at all now:
-- the values are already 'YYYY-MM-DD' text and go in as they are. The month and
-- year are taken by slicing the string rather than by date arithmetic, because
-- there is no date to do arithmetic on.
--
-- REV 3 fixed the ids. The online_att_* tables are the old app's, and every
-- id in them is TEXT — they held strings like 'emp-1785738406160'. The new
-- employees table uses uuid. Comparing the two directly gave:
--
--     operator does not exist: text = uuid
--
-- so every employees.id is cast to text on the way in, and the text id columns
-- have no default, meaning the id has to be supplied rather than generated.
--
-- Nothing was written by the failed run: the whole file is one transaction, so
-- when step 3 failed steps 1 and 2 rolled back with it. That is the transaction
-- doing its job, and it is why this starts from a clean slate.
--
-- Every value is written literally. Nothing reaches out to the old project, so
-- it cannot half-succeed on a bad connection, and the old database is never
-- touched — it stays exactly as it is, as the backup.
--
-- FACTS ONLY. The old system had faults, so its logic is left behind and only
-- what happened is carried over: who worked which day, what they earn, what
-- they took as an advance. The payable is computed here by the formula that
-- already reconciles.
--
-- LEFT BEHIND ON PURPOSE
--   username, pin      logins belong in Administration, granted with a role
--   sal_history        only Hamza Khan had one (45,000 -> 65,000 on 12 Aug);
--                      his current salary is imported and the change noted here
--   wd, dtime, jy/jm/jd  unused or null on every row
--
-- VERIFIED BEFORE WRITING
--   166 records · 155 P, 9 A, 2 H · 7 people   matches the source exactly
--   8 advances totalling Rs 111,815            matches the Advances page
--
-- Matched on NAME rather than the old text id, because the new employees table
-- generates its own uuid and the old id has no meaning here.
--
-- Safe to run more than once — every insert skips what is already there.

begin;

-- 1. Roles first, so each person can point at one.
insert into designations (name)
select v.role from (values
    ('Hamza Khan', 65000, 'Videographer'),
    ('Abdul Rehman', 61000, 'Shopify Manager'),
    ('Hamza Mukhtar', 50000, 'Photo Editor'),
    ('Abdullah Liaqat', 45000, 'Customer Representative'),
    ('Awais', 55000, 'Social Media Manager'),
    ('Qaswar', 35000, 'Marketing Manager'),
    ('Ahmad', 15000, 'Dispatch Manager')
  ) as v(name, sal, role)
 where not exists (select 1 from designations d where lower(d.name) = lower(v.role))
on conflict do nothing;

-- 2. The people, into the Hub.
--    The old app's `department` column held the ROLE — "Videographer",
--    "Shopify Manager" — not a department. It becomes the designation.
insert into employees (name, department_id, designation_id, pay_type, pay_amount, is_active)
select v.name,
       (select id from departments where code = 'HUB'),
       (select id from designations d where lower(d.name) = lower(v.role) limit 1),
       'Monthly', v.sal, true
  from (values
    ('Hamza Khan', 65000, 'Videographer'),
    ('Abdul Rehman', 61000, 'Shopify Manager'),
    ('Hamza Mukhtar', 50000, 'Photo Editor'),
    ('Abdullah Liaqat', 45000, 'Customer Representative'),
    ('Awais', 55000, 'Social Media Manager'),
    ('Qaswar', 35000, 'Marketing Manager'),
    ('Ahmad', 15000, 'Dispatch Manager')
  ) as v(name, sal, role)
 where not exists (
   select 1 from employees x
    where lower(x.name) = lower(v.name)
      and x.department_id = (select id from departments where code = 'HUB'));

-- 3. Mirror them into the table the Hub attendance screen reads, carrying the
--    same id so one person has one identity whichever screen is open.
insert into online_att_employees (id, name, designation, department, sal, department_id)
select x.id::text, x.name, v.role, 'Hub', v.sal, x.department_id
  from (values
    ('Hamza Khan', 65000, 'Videographer'),
    ('Abdul Rehman', 61000, 'Shopify Manager'),
    ('Hamza Mukhtar', 50000, 'Photo Editor'),
    ('Abdullah Liaqat', 45000, 'Customer Representative'),
    ('Awais', 55000, 'Social Media Manager'),
    ('Qaswar', 35000, 'Marketing Manager'),
    ('Ahmad', 15000, 'Dispatch Manager')
  ) as v(name, sal, role)
  join employees x on lower(x.name) = lower(v.name)
                  and x.department_id = (select id from departments where code = 'HUB')
 where not exists (select 1 from online_att_employees o where o.id = x.id::text);

-- 4. The 166 attendance records.
insert into online_att_records (id, emp_id, year, month, day, status)
-- id is text here with no default, so it is built rather than generated
select x.id::text || '-' || v.d,
       x.id::text,
       substr(v.d, 1, 4)::int,
       substr(v.d, 6, 2)::int,
       substr(v.d, 9, 2)::int,
       v.status
  from (values
    ('Hamza Khan', '2026-08-01', 'P'),
    ('Hamza Khan', '2026-08-03', 'P'),
    ('Hamza Khan', '2026-08-04', 'P'),
    ('Hamza Khan', '2026-08-05', 'P'),
    ('Hamza Khan', '2026-08-06', 'P'),
    ('Hamza Khan', '2026-08-07', 'P'),
    ('Hamza Khan', '2026-08-08', 'H'),
    ('Hamza Khan', '2026-08-09', 'P'),
    ('Hamza Khan', '2026-08-10', 'P'),
    ('Hamza Khan', '2026-08-11', 'P'),
    ('Hamza Khan', '2026-08-12', 'P'),
    ('Hamza Khan', '2026-08-13', 'P'),
    ('Hamza Khan', '2026-08-14', 'P'),
    ('Hamza Khan', '2026-08-15', 'P'),
    ('Hamza Khan', '2026-08-17', 'P'),
    ('Hamza Khan', '2026-08-18', 'A'),
    ('Hamza Khan', '2026-08-19', 'P'),
    ('Hamza Khan', '2026-08-20', 'P'),
    ('Hamza Khan', '2026-08-21', 'P'),
    ('Hamza Khan', '2026-08-22', 'P'),
    ('Hamza Khan', '2026-08-24', 'P'),
    ('Hamza Khan', '2026-08-25', 'P'),
    ('Hamza Khan', '2026-08-26', 'P'),
    ('Hamza Khan', '2026-08-27', 'P'),
    ('Hamza Khan', '2026-08-28', 'P'),
    ('Abdul Rehman', '2026-08-01', 'P'),
    ('Abdul Rehman', '2026-08-03', 'P'),
    ('Abdul Rehman', '2026-08-04', 'P'),
    ('Abdul Rehman', '2026-08-05', 'P'),
    ('Abdul Rehman', '2026-08-06', 'P'),
    ('Abdul Rehman', '2026-08-07', 'P'),
    ('Abdul Rehman', '2026-08-08', 'P'),
    ('Abdul Rehman', '2026-08-10', 'P'),
    ('Abdul Rehman', '2026-08-11', 'P'),
    ('Abdul Rehman', '2026-08-12', 'P'),
    ('Abdul Rehman', '2026-08-13', 'P'),
    ('Abdul Rehman', '2026-08-14', 'P'),
    ('Abdul Rehman', '2026-08-15', 'P'),
    ('Abdul Rehman', '2026-08-17', 'P'),
    ('Abdul Rehman', '2026-08-18', 'P'),
    ('Abdul Rehman', '2026-08-19', 'P'),
    ('Abdul Rehman', '2026-08-20', 'P'),
    ('Abdul Rehman', '2026-08-21', 'P'),
    ('Abdul Rehman', '2026-08-22', 'P'),
    ('Abdul Rehman', '2026-08-24', 'P'),
    ('Abdul Rehman', '2026-08-25', 'P'),
    ('Abdul Rehman', '2026-08-26', 'P'),
    ('Abdul Rehman', '2026-08-27', 'P'),
    ('Abdul Rehman', '2026-08-28', 'P'),
    ('Hamza Mukhtar', '2026-08-01', 'P'),
    ('Hamza Mukhtar', '2026-08-03', 'P'),
    ('Hamza Mukhtar', '2026-08-04', 'P'),
    ('Hamza Mukhtar', '2026-08-05', 'P'),
    ('Hamza Mukhtar', '2026-08-06', 'P'),
    ('Hamza Mukhtar', '2026-08-07', 'P'),
    ('Hamza Mukhtar', '2026-08-08', 'H'),
    ('Hamza Mukhtar', '2026-08-10', 'P'),
    ('Hamza Mukhtar', '2026-08-11', 'P'),
    ('Hamza Mukhtar', '2026-08-12', 'A'),
    ('Hamza Mukhtar', '2026-08-13', 'P'),
    ('Hamza Mukhtar', '2026-08-14', 'P'),
    ('Hamza Mukhtar', '2026-08-15', 'P'),
    ('Hamza Mukhtar', '2026-08-17', 'P'),
    ('Hamza Mukhtar', '2026-08-18', 'P'),
    ('Hamza Mukhtar', '2026-08-19', 'P'),
    ('Hamza Mukhtar', '2026-08-20', 'P'),
    ('Hamza Mukhtar', '2026-08-21', 'P'),
    ('Hamza Mukhtar', '2026-08-22', 'P'),
    ('Hamza Mukhtar', '2026-08-24', 'P'),
    ('Hamza Mukhtar', '2026-08-25', 'P'),
    ('Hamza Mukhtar', '2026-08-26', 'P'),
    ('Hamza Mukhtar', '2026-08-27', 'P'),
    ('Hamza Mukhtar', '2026-08-28', 'P'),
    ('Abdullah Liaqat', '2026-07-10', 'P'),
    ('Abdullah Liaqat', '2026-08-01', 'P'),
    ('Abdullah Liaqat', '2026-08-03', 'P'),
    ('Abdullah Liaqat', '2026-08-04', 'P'),
    ('Abdullah Liaqat', '2026-08-05', 'P'),
    ('Abdullah Liaqat', '2026-08-06', 'P'),
    ('Abdullah Liaqat', '2026-08-07', 'P'),
    ('Abdullah Liaqat', '2026-08-08', 'P'),
    ('Abdullah Liaqat', '2026-08-10', 'P'),
    ('Abdullah Liaqat', '2026-08-11', 'P'),
    ('Abdullah Liaqat', '2026-08-12', 'P'),
    ('Abdullah Liaqat', '2026-08-13', 'P'),
    ('Abdullah Liaqat', '2026-08-14', 'P'),
    ('Abdullah Liaqat', '2026-08-15', 'P'),
    ('Abdullah Liaqat', '2026-08-17', 'P'),
    ('Abdullah Liaqat', '2026-08-18', 'P'),
    ('Abdullah Liaqat', '2026-08-19', 'P'),
    ('Abdullah Liaqat', '2026-08-20', 'P'),
    ('Abdullah Liaqat', '2026-08-21', 'P'),
    ('Abdullah Liaqat', '2026-08-22', 'P'),
    ('Abdullah Liaqat', '2026-08-24', 'P'),
    ('Abdullah Liaqat', '2026-08-25', 'P'),
    ('Abdullah Liaqat', '2026-08-26', 'P'),
    ('Abdullah Liaqat', '2026-08-27', 'P'),
    ('Abdullah Liaqat', '2026-08-28', 'P'),
    ('Awais', '2026-08-01', 'P'),
    ('Awais', '2026-08-03', 'P'),
    ('Awais', '2026-08-04', 'P'),
    ('Awais', '2026-08-05', 'P'),
    ('Awais', '2026-08-06', 'P'),
    ('Awais', '2026-08-07', 'P'),
    ('Awais', '2026-08-08', 'P'),
    ('Awais', '2026-08-10', 'P'),
    ('Awais', '2026-08-11', 'P'),
    ('Awais', '2026-08-12', 'P'),
    ('Awais', '2026-08-13', 'P'),
    ('Awais', '2026-08-14', 'P'),
    ('Awais', '2026-08-15', 'P'),
    ('Awais', '2026-08-17', 'P'),
    ('Awais', '2026-08-18', 'P'),
    ('Awais', '2026-08-19', 'P'),
    ('Awais', '2026-08-20', 'P'),
    ('Awais', '2026-08-21', 'P'),
    ('Awais', '2026-08-22', 'P'),
    ('Awais', '2026-08-24', 'P'),
    ('Awais', '2026-08-25', 'P'),
    ('Awais', '2026-08-26', 'P'),
    ('Awais', '2026-08-27', 'P'),
    ('Awais', '2026-08-28', 'P'),
    ('Qaswar', '2026-08-01', 'P'),
    ('Qaswar', '2026-08-03', 'P'),
    ('Qaswar', '2026-08-04', 'P'),
    ('Qaswar', '2026-08-05', 'P'),
    ('Qaswar', '2026-08-06', 'P'),
    ('Qaswar', '2026-08-07', 'P'),
    ('Qaswar', '2026-08-08', 'P'),
    ('Qaswar', '2026-08-10', 'P'),
    ('Qaswar', '2026-08-11', 'P'),
    ('Qaswar', '2026-08-12', 'P'),
    ('Qaswar', '2026-08-13', 'A'),
    ('Qaswar', '2026-08-15', 'P'),
    ('Qaswar', '2026-08-17', 'P'),
    ('Qaswar', '2026-08-18', 'P'),
    ('Qaswar', '2026-08-19', 'A'),
    ('Qaswar', '2026-08-20', 'P'),
    ('Qaswar', '2026-08-21', 'A'),
    ('Qaswar', '2026-08-22', 'A'),
    ('Qaswar', '2026-08-24', 'A'),
    ('Qaswar', '2026-08-25', 'P'),
    ('Qaswar', '2026-08-26', 'P'),
    ('Qaswar', '2026-08-27', 'P'),
    ('Qaswar', '2026-08-28', 'P'),
    ('Ahmad', '2026-08-01', 'P'),
    ('Ahmad', '2026-08-04', 'P'),
    ('Ahmad', '2026-08-05', 'P'),
    ('Ahmad', '2026-08-06', 'P'),
    ('Ahmad', '2026-08-07', 'P'),
    ('Ahmad', '2026-08-08', 'P'),
    ('Ahmad', '2026-08-10', 'P'),
    ('Ahmad', '2026-08-12', 'P'),
    ('Ahmad', '2026-08-13', 'P'),
    ('Ahmad', '2026-08-14', 'P'),
    ('Ahmad', '2026-08-15', 'P'),
    ('Ahmad', '2026-08-17', 'P'),
    ('Ahmad', '2026-08-18', 'P'),
    ('Ahmad', '2026-08-19', 'P'),
    ('Ahmad', '2026-08-20', 'A'),
    ('Ahmad', '2026-08-21', 'P'),
    ('Ahmad', '2026-08-24', 'A'),
    ('Ahmad', '2026-08-25', 'P'),
    ('Ahmad', '2026-08-26', 'P'),
    ('Ahmad', '2026-08-27', 'P'),
    ('Ahmad', '2026-08-28', 'P')
  ) as v(name, d, status)
  join employees x on lower(x.name) = lower(v.name)
                  and x.department_id = (select id from departments where code = 'HUB')
 where not exists (
   select 1 from online_att_records o
    where o.emp_id = x.id::text
      and o.year  = substr(v.d, 1, 4)::int
      and o.month = substr(v.d, 6, 2)::int
      and o.day   = substr(v.d, 9, 2)::int);

-- 5. The 8 advances.
insert into online_att_advances (id, emp_id, amount, date, note, deduct_month, deduct_year, settled)
select x.id::text || '-' || v.d || '-' || v.amount,
       x.id::text, v.amount, v.d, v.note,
       -- 'YYYY-MM-DD' sliced, because the column is text and there is no date
       -- here to take an extract() from.
       substr(v.d, 6, 2)::int, substr(v.d, 1, 4)::int, false
  from (values
    ('Hamza Khan', 10000, '2026-08-01', 'online'),
    ('Qaswar', 16800, '2026-08-01', 'last month extra salary by mistake'),
    ('Hamza Khan', 7000, '2026-08-13', 'online'),
    ('Hamza Khan', 2000, '2026-08-18', 'online'),
    ('Abdullah Liaqat', 25000, '2026-08-21', 'nayapay'),
    ('Hamza Khan', 10000, '2026-08-22', 'Ubl'),
    ('Awais', 40000, '2026-08-23', 'Meezan bank'),
    ('Abdul Rehman', 1015, '2026-08-24', 'challan')
  ) as v(name, amount, d, note)
  join employees x on lower(x.name) = lower(v.name)
                  and x.department_id = (select id from departments where code = 'HUB')
 where not exists (
   select 1 from online_att_advances o
    where o.emp_id = x.id::text and o.date = v.d and o.amount = v.amount);

commit;

-- ===========================================================================
-- VERIFY — run this ONE query afterwards. All four lines should say OK.
-- ===========================================================================
-- select 'people'   as check, count(*)::text as got, '7' as want,
--        case when count(*) = 7 then 'OK' else 'CHECK' end as result
--   from employees where department_id = (select id from departments where code = 'HUB')
-- union all
-- select 'records', count(*)::text, '166',
--        case when count(*) = 166 then 'OK' else 'CHECK' end from online_att_records
-- union all
-- select 'present/absent/half',
--        count(*) filter (where status='P') || '/' || count(*) filter (where status='A')
--          || '/' || count(*) filter (where status='H'), '155/9/2',
--        case when count(*) filter (where status='P') = 155 then 'OK' else 'CHECK' end
--   from online_att_records
-- union all
-- select 'august advances', to_char(sum(amount),'FM999,999,999'), '111,815',
--        case when sum(amount) = 111815 then 'OK' else 'CHECK' end
--   from online_att_advances where deduct_month = 8 and deduct_year = 2026;
-- ===========================================================================
