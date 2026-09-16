-- 0121_retail_functions.sql
--
-- FS TRADERS: the three pieces of database logic the port never carried over.
-- Each one exists because the thing it prevents already happened once.
--
--  1. retail_import_nimbus_expenses  — the atomic, idempotent expense+advance
--     import. The client-side version it replaces doubled every Head Office
--     expense on save: 19,770 -> 39,540 -> 59,310 -> 79,080.
--
--  2. retail_sale_lines_reject_billwise — refuses the Nimbus BILL-WISE report.
--     Bill-wise rows carry no item_code, so commissions cannot be built from
--     them, and uploading bill-wise after item-wise doubles the day's sales.
--
--  3. retail_fc_dha_stale_comm — FC DHA commission overrides for items that
--     have stopped selling, so the list can be pruned.
--
-- Safe to run more than once.

begin;

-- ===========================================================================
-- 1. THE NIMBUS IMPORT
--
-- WHY THIS SHAPE
--   The original scoped its DELETE to the caller's branch array and date range.
--   When the caller passed an empty or NULL branch array — or a range narrower
--   than the file — the DELETE was skipped but the INSERT still ran, so
--   re-uploading the same file silently doubled every expense.
--
--   Two independent defences now:
--     (a) the delete scope is derived FROM THE PAYLOAD, per branch, over that
--         branch's own date span, so it cannot be under-scoped by a bad caller;
--     (b) a unique index on dedupe_key makes doubling impossible regardless.
--
--   The row_number() inside the hash is deliberate. Two genuinely identical
--   expenses on the same day are two real expenses; without the ordinal they
--   would hash the same and the second would be dropped as a duplicate.
--
--   NOTE the dedupe_key includes the category. A row recategorised between
--   uploads hashes differently — that is what left 79 orphans on 3 Sep. The
--   payload-scoped delete in 1a is what clears them now.
-- ===========================================================================
create or replace function retail_import_nimbus_expenses(
  p_branch_ids bigint[],
  p_min_date   date,
  p_max_date   date,
  p_rows       jsonb,
  p_adv_rows   jsonb default '[]'::jsonb
) returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_inserted int := 0;
  v_adv      int := 0;
  v_del_exp  int := 0;
  v_del_adv  int := 0;
  v_tmp      int := 0;
begin
  if not retail_can('retail.import.run') then
    raise exception 'Not allowed to run the Nimbus import' using errcode = '42501';
  end if;

  create temp table _in_exp on commit drop as
  select
    nullif(r.v->>'branch_id','')::bigint               as branch_id,
    (r.v->>'expense_date')::date                       as expense_date,
    (r.v->>'amount')::numeric                          as amount,
    coalesce(nullif(r.v->>'txn_type',''), 'expense')   as txn_type,
    r.v->>'category'                                   as category,
    r.v->>'description'                                as description,
    coalesce(nullif(r.v->>'paid_via',''), 'cash')      as paid_via,
    r.ord                                              as ord
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) with ordinality as r(v, ord);

  delete from _in_exp where branch_id is null or expense_date is null or amount is null;

  -- 1a) Clear exactly the ground this import covers, per branch, per its own span.
  delete from retail_expenses e
  using (select branch_id, min(expense_date) dmin, max(expense_date) dmax
           from _in_exp group by branch_id) s
  where e.source = 'nimbus'
    and e.branch_id = s.branch_id
    and e.expense_date between s.dmin and s.dmax;
  get diagnostics v_del_exp = row_count;

  -- 1b) Honour the caller's declared scope too, so a branch whose expenses were
  --     all removed upstream still gets its stale rows cleared.
  if array_length(p_branch_ids,1) is not null and p_min_date is not null and p_max_date is not null then
    delete from retail_expenses e
     where e.source = 'nimbus'
       and e.branch_id = any(p_branch_ids)
       and e.expense_date between p_min_date and p_max_date;
    get diagnostics v_tmp = row_count;
    v_del_exp := v_del_exp + v_tmp;
  end if;

  insert into retail_expenses
    (branch_id, expense_date, amount, txn_type, category, description, paid_via, source, dedupe_key)
  select i.branch_id, i.expense_date, i.amount, i.txn_type, i.category, i.description, i.paid_via, 'nimbus',
    md5(
      i.branch_id::text||'|'||i.expense_date::text||'|'||coalesce(i.category,'')||'|'||
      coalesce(i.description,'')||'|'||to_char(i.amount,'FM9999999999990.00')||'|'||
      coalesce(i.paid_via,'')||'|'||coalesce(i.txn_type,'')||'|'||
      row_number() over (
        partition by i.branch_id, i.expense_date, coalesce(i.category,''),
                     coalesce(i.description,''), i.amount, coalesce(i.paid_via,''),
                     coalesce(i.txn_type,'')
        order by i.ord)::text
    )
  from _in_exp i
  on conflict (dedupe_key) where source = 'nimbus' do nothing;
  get diagnostics v_inserted = row_count;

  -- ── Advances ────────────────────────────────────────────────────────────
  create temp table _in_adv on commit drop as
  select
    (a.v->>'employee_id')::bigint                   as employee_id,
    (a.v->>'entry_date')::date                      as entry_date,
    coalesce((a.v->>'advance')::numeric, 0)         as advance,
    coalesce((a.v->>'purchase_credit')::numeric, 0) as purchase_credit,
    coalesce((a.v->>'paid')::numeric, 0)            as paid,
    a.v->>'purchase_details'                        as purchase_details,
    a.ord                                           as ord
  from jsonb_array_elements(coalesce(p_adv_rows,'[]'::jsonb)) with ordinality as a(v, ord);

  delete from _in_adv where employee_id is null or entry_date is null;

  delete from retail_employee_ledger el
  using (select employee_id, min(entry_date) dmin, max(entry_date) dmax
           from _in_adv group by employee_id) s
  where el.source = 'nimbus'
    and el.employee_id = s.employee_id
    and el.entry_date between s.dmin and s.dmax;
  get diagnostics v_del_adv = row_count;

  if array_length(p_branch_ids,1) is not null and p_min_date is not null and p_max_date is not null then
    delete from retail_employee_ledger el
     where el.source = 'nimbus'
       and el.entry_date between p_min_date and p_max_date
       and el.employee_id in (select id from retail_employees where branch_id = any(p_branch_ids));
    get diagnostics v_tmp = row_count;
    v_del_adv := v_del_adv + v_tmp;
  end if;

  insert into retail_employee_ledger
    (employee_id, entry_date, advance, purchase_credit, paid, purchase_details, source, dedupe_key)
  select a.employee_id, a.entry_date, a.advance, a.purchase_credit, a.paid, a.purchase_details, 'nimbus',
    md5(
      a.employee_id::text||'|'||a.entry_date::text||'|'||
      to_char(a.advance,'FM9999999999990.00')||'|'||
      to_char(a.purchase_credit,'FM9999999999990.00')||'|'||
      to_char(a.paid,'FM9999999999990.00')||'|'||
      coalesce(a.purchase_details,'')||'|'||
      row_number() over (
        partition by a.employee_id, a.entry_date, a.advance, a.purchase_credit,
                     a.paid, coalesce(a.purchase_details,'')
        order by a.ord)::text
    )
  from _in_adv a
  on conflict (dedupe_key) where source = 'nimbus' do nothing;
  get diagnostics v_adv = row_count;

  return json_build_object(
    'inserted', v_inserted,
    'advances', v_adv,
    'expenses_replaced', v_del_exp,
    'advances_replaced', v_del_adv
  );
end;
$function$;

revoke all on function retail_import_nimbus_expenses(bigint[], date, date, jsonb, jsonb) from public;
grant execute on function retail_import_nimbus_expenses(bigint[], date, date, jsonb, jsonb) to authenticated;

-- ===========================================================================
-- 2. THE BILL-WISE GUARD
--
--   A bill-wise export has one row per receipt and therefore no item_code.
--   Commissions are per item and cannot be rebuilt from it, and uploading it
--   on top of an item-wise day doubles that day's sales. The error message is
--   long on purpose: whoever hits this is standing in Nimbus with the wrong
--   report open and needs to be told which one to pick, not given a constraint
--   name.
-- ===========================================================================
create or replace function retail_sale_lines_reject_billwise()
returns trigger language plpgsql
as $function$
begin
  if coalesce(new.item_code,'') = '' then
    raise exception
      'Wrong Nimbus report: this file has no item codes, which means it is the BILL-WISE sale report. Upload the ITEM-WISE sale report instead — commissions are calculated per item and cannot be built from bill-wise data.'
      using errcode = 'check_violation',
            hint = 'In Nimbus choose the item-wise (line-item) sale export, not the bill-wise (per-receipt) one.';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_retail_sale_lines_reject_billwise on retail_sale_lines;
create trigger trg_retail_sale_lines_reject_billwise
  before insert on retail_sale_lines
  for each row execute function retail_sale_lines_reject_billwise();

-- ===========================================================================
-- 3. STALE FC DHA COMMISSION OVERRIDES
--
--   p_branch_id is a PARAMETER here. The original hardcoded branch_id = 11,
--   which was FC DHA's id in the old database and will not survive the data
--   migration into this one.
-- ===========================================================================
create or replace function retail_fc_dha_stale_comm(p_branch_id bigint, p_months integer default 2)
returns table(item_code text, commission numeric, last_sold date)
language sql stable security definer set search_path to 'public','pg_temp'
as $function$
  select c.item_code, c.commission, s.last_sold
    from retail_fc_dha_comm c
    left join (
      select sl.item_code, max(sl.sale_date) as last_sold
        from retail_sale_lines sl
       where sl.branch_id = p_branch_id
       group by sl.item_code
    ) s on s.item_code = c.item_code
   where retail_can('retail.commissions.view')
     and (s.last_sold is null or s.last_sold < (current_date - make_interval(months => p_months)))
   order by (s.last_sold is null) desc, s.last_sold asc nulls first, c.item_code;
$function$;

revoke all on function retail_fc_dha_stale_comm(bigint, integer) from public;
grant execute on function retail_fc_dha_stale_comm(bigint, integer) to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- The three functions and the trigger.
-- select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and proname like 'retail_%' order by 1;
-- select tgname from pg_trigger where tgname = 'trg_retail_sale_lines_reject_billwise';
--
-- -- The guard should refuse this and say why.
-- insert into retail_sale_lines (branch_id, sale_date, receipt_no, sales)
-- values (1, current_date, 'TEST', 100);
--
-- -- Idempotency: run the same payload twice. The second call must report
-- -- inserted = the same number and leave the table the same size.
-- select retail_import_nimbus_expenses(
--   null, null, null,
--   '[{"branch_id":1,"expense_date":"2026-09-01","amount":500,"category":"Tea & Food","description":"chai"}]'::jsonb);
-- select count(*) from retail_expenses where source='nimbus';
-- ===========================================================================
