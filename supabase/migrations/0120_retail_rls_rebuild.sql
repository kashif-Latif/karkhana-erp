-- 0120_retail_rls_rebuild.sql
--
-- FS TRADERS: re-point every retail policy at the permission set from 0119.
--
-- WHAT IS THERE NOW
--   Fifteen tables, two policies each, all reading has_permission('retail.access').
--   One grant opens salaries, staff advances and the bank. The ten new tables
--   from 0118 have RLS off and NO policies at all, which in PostgREST terms
--   means they are readable by anyone holding the anon key. That is the exact
--   hole the Grohub export flagged as critical, arriving here by a different
--   route.
--
-- THE TWO HELPERS
--   retail_can(code)  — that permission, OR the retail.access umbrella. Writing
--                       the umbrella into the helper rather than into forty
--                       policies is what makes this migration reversible and
--                       makes "take the umbrella away" a one-line change later.
--   retail_any()      — holds ANY retail permission. Used only for the two
--                       reference tables (branches, expense categories) that
--                       every screen has to read to render a dropdown. Gating
--                       those on a specific permission would leave the expenses
--                       page unable to name the shop the expense belongs to.
--
-- BOTH ARE security definer WITH search_path PINNED. Without the pin a
-- SECURITY DEFINER function is a privilege-escalation path.
--
-- Safe to run more than once.

begin;

create or replace function retail_can(p_code text)
returns boolean language sql stable security definer set search_path to 'public','pg_temp'
as $$ select has_permission(p_code) or has_permission('retail.access') $$;

create or replace function retail_any()
returns boolean language sql stable security definer set search_path to 'public','pg_temp'
as $$ select exists (select 1 from unnest(my_permissions()) c where c like 'retail.%') $$;

comment on function retail_can(text) is
  'FS Traders gate: the named permission, or the retail.access umbrella. Every retail policy is built from this.';
comment on function retail_any() is
  'True when the caller holds any retail.* permission. For reference tables every FS screen must read to render.';

-- ---------------------------------------------------------------------------
-- Rebuild. Each table gets exactly two policies: <t>_select and <t>_write.
-- Old ones are dropped by name first so re-running is clean.
-- ---------------------------------------------------------------------------
do $do$
declare
  r record;
  spec text[][] := array[
    -- table                        read permission              write permission
    ['retail_branches',             'ANY',                       'retail.branches.manage'],
    ['retail_expense_categories',   'ANY',                       'retail.expenses.manage'],
    ['retail_upload_log',           'ANY',                       'retail.import.run'],

    ['retail_sale_lines',           'retail.sales.view',         'retail.import.run'],
    ['retail_import_batches',       'retail.sales.view',         'retail.import.run'],

    ['retail_daily_book',           'retail.cashbook.view',      'retail.cashbook.manage'],
    ['retail_bank_settlements',     'retail.cashbook.view',      'retail.cashbook.manage'],

    ['retail_expenses',             'retail.expenses.view',      'retail.expenses.manage'],

    ['retail_ho_cashflow',          'retail.ho.view',            'retail.ho.manage'],
    ['retail_cash_count',           'retail.ho.view',            'retail.ho.manage'],
    ['retail_bank_credits',         'retail.ho.view',            'retail.ho.manage'],

    ['retail_commission_master',    'retail.commissions.view',   'retail.commissions.manage'],
    ['retail_commission_config',    'retail.commissions.view',   'retail.commissions.manage'],
    ['retail_fc_dha_comm',          'retail.commissions.view',   'retail.commissions.manage'],

    ['retail_employees',            'retail.employees.view',     'retail.employees.manage'],
    ['retail_attendance',           'retail.employees.view',     'retail.employees.manage'],

    ['retail_employee_ledger',      'retail.payroll.view',       'retail.payroll.manage'],
    ['retail_salary_payments',      'retail.payroll.view',       'retail.payroll.manage'],
    ['retail_wage_payments',        'retail.payroll.view',       'retail.payroll.manage'],

    ['retail_card_slip_files',      'retail.cards.view',         'retail.cards.manage'],
    ['retail_card_settlements',     'retail.cards.view',         'retail.cards.manage'],

    ['retail_bank_accounts',        'retail.bank.view',          'retail.bank.manage'],
    ['retail_bank_txns',            'retail.bank.view',          'retail.bank.manage'],
    ['retail_stmt_files',           'retail.bank.view',          'retail.bank.manage'],
    ['retail_ref_rules',            'retail.bank.view',          'retail.bank.manage']
  ];
  i int;
  tbl text; rd text; wr text; rd_expr text; wr_expr text;
begin
  for i in 1 .. array_length(spec, 1) loop
    tbl := spec[i][1]; rd := spec[i][2]; wr := spec[i][3];
    if to_regclass('public.' || tbl) is null then
      raise notice '0120: % not present, skipped', tbl;
      continue;
    end if;

    rd_expr := case when rd = 'ANY' then 'retail_any()' else format('retail_can(%L)', rd) end;
    wr_expr := format('retail_can(%L)', wr);

    execute format('alter table %I enable row level security', tbl);

    -- Drop anything already there, whatever it was called. A leftover
    -- permissive policy would OR itself back in and quietly undo this file.
    for r in select polname from pg_policy p join pg_class c on c.oid = p.polrelid
              where c.relname = tbl loop
      execute format('drop policy if exists %I on %I', r.polname, tbl);
    end loop;

    execute format(
      'create policy %I on %I for select to authenticated using (%s)',
      tbl || '_select', tbl, rd_expr);

    execute format(
      'create policy %I on %I for all to authenticated using (%s) with check (%s)',
      tbl || '_write', tbl, wr_expr, wr_expr);
  end loop;
end $do$;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- Every retail table: RLS on, exactly 2 policies, and what they check.
-- select c.relname, c.relrowsecurity as rls, p.polname,
--        pg_get_expr(p.polqual, p.polrelid) as gate
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
--   left join pg_policy p on p.polrelid = c.oid
--  where c.relkind='r' and c.relname like 'retail%'
--  order by c.relname, p.polname;
--
-- -- Nothing should come back: a retail table with RLS off is a public table.
-- select c.relname from pg_class c
--   join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
--  where c.relkind='r' and c.relname like 'retail%' and not c.relrowsecurity;
-- ===========================================================================
