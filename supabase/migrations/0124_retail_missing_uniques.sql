-- 0124_retail_missing_uniques.sql
--
-- Three unique constraints the port dropped. Each one is load-bearing, and two
-- of them fail LOUDLY the first time somebody uses the screen — which is the
-- only reason they were found before the data migration rather than after.
--
-- HOW THEY WERE FOUND
--   By checking every `onConflict:` in the app against pg_constraint, after
--   0122 turned up the same class of omission on retail_sale_lines.line_hash.
--   The port created these tables with a plain `id` primary key and dropped the
--   natural key underneath. A plain PK makes rows insertable; it does not make
--   them correct.
--
-- WHAT BREAKS WITHOUT EACH ONE
--
--   retail_cash_count (location, count_date)
--     The End of Day screen upserts with onConflict "location,count_date".
--     Postgres has nothing to resolve that against and rejects the statement
--     outright: "there is no unique or exclusion constraint matching the ON
--     CONFLICT specification". The safe counts cannot be saved at all.
--
--   retail_salary_payments (employee_id, pay_month)
--     This one does NOT fail loudly, which makes it the dangerous one. Without
--     it the same person can be paid twice for the same month — two
--     salary_payments rows, two offsetting ledger rows, the advance cleared
--     twice. Nothing errors. The money is simply gone and the ledger says it
--     was owed.
--
--   retail_bank_settlements (branch_id, sale_date)
--     One agreed figure per shop per day is the entire meaning of the table.
--     Without the constraint a correction inserts a second row instead of
--     replacing the first, and the cash book's bank column silently doubles.
--
-- ON EXISTING DUPLICATES
--   All three tables are empty today, so this is free. It is written to survive
--   a non-empty table anyway: duplicates are collapsed to the lowest id first,
--   because a unique constraint cannot be built over rows that already violate
--   it, and failing with "could not create unique index" and no explanation is
--   a bad way to find that out.
--
-- Safe to run more than once.

begin;

-- ── retail_cash_count ──────────────────────────────────────────────────────
delete from retail_cash_count a using retail_cash_count b
 where a.location = b.location and a.count_date = b.count_date and a.id > b.id;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'retail_cash_count_location_count_date_key') then
    alter table retail_cash_count
      add constraint retail_cash_count_location_count_date_key unique (location, count_date);
  end if;
end $do$;

-- ── retail_salary_payments ─────────────────────────────────────────────────
-- Keeping the LOWEST id is deliberate: if a month was somehow paid twice, the
-- first record is the one the offsetting ledger row points at.
delete from retail_salary_payments a using retail_salary_payments b
 where a.employee_id = b.employee_id and a.pay_month = b.pay_month and a.id > b.id;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'retail_salary_payments_employee_id_pay_month_key') then
    alter table retail_salary_payments
      add constraint retail_salary_payments_employee_id_pay_month_key unique (employee_id, pay_month);
  end if;
end $do$;

-- ── retail_bank_settlements ────────────────────────────────────────────────
delete from retail_bank_settlements a using retail_bank_settlements b
 where a.branch_id is not distinct from b.branch_id and a.sale_date = b.sale_date and a.id > b.id;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'retail_bank_settlements_branch_id_sale_date_key') then
    alter table retail_bank_settlements
      add constraint retail_bank_settlements_branch_id_sale_date_key unique (branch_id, sale_date);
  end if;
end $do$;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- Should list all three, plus the ones that were already there.
-- select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid::regclass::text like 'retail%' and contype = 'u'
--  order by 1;
--
-- -- The End of Day save should now succeed rather than raising 42P10.
-- insert into retail_cash_count (location, count_date, denoms, total)
-- values ('head_office', current_date, '{"1000":1}'::jsonb, 1000)
-- on conflict (location, count_date) do update set total = excluded.total;
-- delete from retail_cash_count where count_date = current_date and total = 1000;
-- ===========================================================================
