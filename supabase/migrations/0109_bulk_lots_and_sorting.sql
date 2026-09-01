-- =====================================================================
-- KARKHANA — Migration 0109: bulk lots and sorting
--
-- THE REALITY THIS MODELS
--   A broker delivers 500 kg of fabric in sealed cartons. It is paid for
--   on the spot. Nobody knows the colour breakdown yet, because opening
--   the cartons at the gate is not how it works. Days later a supervisor
--   and his workers open them, weigh each colour, and only then does the
--   store know what it actually has.
--
--   Until now the system could not express any of that. The receive form
--   demands a colour for fabric, and there is no operation that turns one
--   pile of stock into several. Doing it by hand — an adjustment out
--   followed by adjustments in — reads in the ledger as stock destroyed
--   and stock conjured, with nothing linking the two and the purchase
--   rate lost on the way. That is indistinguishable from theft, which is
--   why it is not an acceptable workaround.
--
-- WHAT THIS ADDS
--   A LOT is a receipt line of material that arrived without an attribute
--   its own material requires. It is created automatically — receive
--   fabric with the colour left blank and a lot appears.
--
--   A SORT JOB is one session of opening cartons. A lot takes as many as
--   it needs. Each records who was responsible, what came out, and what
--   was lost.
--
--   THE GUARD is the one that makes the courier settlements reconcile:
--   nothing is written unless the numbers add up. Output plus variance
--   must equal what is drawn, and may never exceed what the lot has left.
--   A gain is impossible by construction — 500 kg cannot yield 502.
--
-- COST
--   Every kilo that leaves a lot carries the lot's own purchase rate, and
--   the variance is costed separately at that same rate rather than being
--   spread over the survivors. So 500 kg at Rs 780 that yields 497 kg
--   gives 497 kg still valued at Rs 780 and a visible Rs 2,340 of loss,
--   instead of 497 kg quietly repriced to Rs 784.71 — a number that
--   matches no document anyone could produce.
--
--   To spread it instead, change one line: the unit_rate expression in
--   post_sort_job. Marked in place below.
--
-- Safe to run more than once.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Permission
--
-- Not inventory.adjust. Sorting is routine work done by a storekeeper on
-- an ordinary morning; adjust is the privileged escape hatch reserved for
-- an administrator. Putting them together would mean anyone who can sort
-- fabric can also silently rewrite any balance in the factory.
-- ---------------------------------------------------------------------
insert into permissions (code, module, description)
values ('inventory.sort','inventory','Sort bulk material into its colours and categories')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.code in ('super_admin','admin','inventory_manager','storekeeper')
  and p.code = 'inventory.sort'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- The lot
--
-- Holds facts only: which receipt line, how much arrived, at what rate,
-- when. How much has been sorted is NOT stored — it is summed from the
-- jobs, so it can never disagree with them. Same rule as everywhere else
-- in this system.
-- ---------------------------------------------------------------------
create table if not exists stock_lots (
  id            uuid primary key default gen_random_uuid(),
  lot_number    text unique,
  grn_id        uuid not null references grns(id),
  grn_line_id   uuid not null unique references grn_lines(id) on delete cascade,
  item_id       uuid not null references material_items(id),
  group_id      uuid not null references material_groups(id),
  unit_id       uuid not null references units(id),
  received_qty  numeric(16,3) not null,
  rate          numeric(14,2) not null,
  received_at   timestamptz not null,
  closed_at     timestamptz,
  closed_by     uuid references auth.users(id),
  close_reason  text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_stock_lots_open on stock_lots(closed_at) where closed_at is null;
create index if not exists idx_stock_lots_item on stock_lots(item_id);

create table if not exists sort_jobs (
  id            uuid primary key default gen_random_uuid(),
  job_number    text unique,
  lot_id        uuid not null references stock_lots(id) on delete cascade,
  sorted_at     timestamptz not null default now(),
  supervisor_employee_id uuid references employees(id),
  worker_count  integer,
  labour_cost   numeric(16,2) not null default 0,
  variance_qty  numeric(16,3) not null default 0,
  variance_reason text,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);
create index if not exists idx_sort_jobs_lot on sort_jobs(lot_id);

create table if not exists sort_job_lines (
  id        uuid primary key default gen_random_uuid(),
  job_id    uuid not null references sort_jobs(id) on delete cascade,
  item_id   uuid not null references material_items(id),
  quantity  numeric(16,3) not null,
  unit_rate numeric(14,4) not null
);
create index if not exists idx_sort_job_lines_job on sort_job_lines(job_id);

drop trigger if exists trg_audit_stock_lots on stock_lots;
drop trigger if exists trg_audit_sort_jobs  on sort_jobs;
create trigger trg_audit_stock_lots after insert or update or delete on stock_lots
  for each row execute function audit_row_change();
create trigger trg_audit_sort_jobs  after insert or update or delete on sort_jobs
  for each row execute function audit_row_change();

-- ---------------------------------------------------------------------
-- A lot appears by itself when incomplete material is received.
--
-- "Incomplete" means the material's own rules say it has a colour (or a
-- category, or a size) and this receipt line did not name one. Packing
-- Shopper has no attributes at all, so it can never be incomplete and
-- never creates a lot.
-- ---------------------------------------------------------------------
create or replace function grn_line_make_lot()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_group uuid; v_unit uuid;
  v_cat uuid; v_col uuid; v_size uuid;
  v_has_cat boolean; v_has_col boolean; v_has_size boolean;
  v_received timestamptz;
begin
  select mi.group_id, mi.unit_id, mi.category_id, mi.color_id, mi.size_id,
         mg.has_category, mg.has_color, mg.has_size
    into v_group, v_unit, v_cat, v_col, v_size, v_has_cat, v_has_col, v_has_size
    from material_items mi join material_groups mg on mg.id = mi.group_id
   where mi.id = new.item_id;

  if not ((v_has_cat and v_cat is null)
       or (v_has_col and v_col is null)
       or (v_has_size and v_size is null)) then
    return new;                                  -- fully specified, no lot
  end if;

  select received_at into v_received from grns where id = new.grn_id;

  insert into stock_lots (lot_number, grn_id, grn_line_id, item_id, group_id, unit_id,
                          received_qty, rate, received_at)
  values (next_document_number('LOT','LOT'), new.grn_id, new.id, new.item_id, v_group, v_unit,
          new.quantity, new.rate, coalesce(v_received, now()))
  on conflict (grn_line_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_grn_line_make_lot on grn_lines;
create trigger trg_grn_line_make_lot
  after insert on grn_lines
  for each row execute function grn_line_make_lot();

-- ---------------------------------------------------------------------
-- A receipt that has been sorted cannot be edited or deleted.
--
-- Once cartons are open and the fabric is on the floor as blue and red,
-- changing what the receipt said is no longer a correction — it is a
-- second, contradictory version of a physical event. Editing an UNSORTED
-- lot is still fine: the line goes, the lot goes with it, and a fresh one
-- appears for the corrected line.
-- ---------------------------------------------------------------------
create or replace function grn_line_guard_sorted()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_lot text;
begin
  select l.lot_number into v_lot
    from stock_lots l
   where l.grn_line_id = old.id
     and exists (select 1 from sort_jobs j where j.lot_id = l.id);
  if v_lot is not null then
    raise exception 'This receipt has already been sorted (%). Record a wastage or an adjustment instead of editing it.', v_lot;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_grn_line_guard_sorted on grn_lines;
create trigger trg_grn_line_guard_sorted
  before delete on grn_lines
  for each row execute function grn_line_guard_sorted();

-- ---------------------------------------------------------------------
-- Views. Everything derived, nothing stored.
-- ---------------------------------------------------------------------
/* drop first: CREATE OR REPLACE VIEW cannot add or remove a column in
   the middle, so re-running this after a later migration widened the view
   fails with "cannot drop columns from view". */
drop view if exists v_stock_lots;
create view v_stock_lots with (security_invoker = true) as
select l.id, l.lot_number, l.grn_id, l.item_id, l.group_id, l.unit_id,
       g.grn_number, s.company_name as supplier,
       mg.name as material,
       concat_ws(' · ', mg.name, mc.name, c.name, sz.name) as item_label,
       u.symbol as unit,
       l.received_qty, l.rate, l.received_at,
       coalesce(o.out_qty, 0)  as sorted_qty,
       coalesce(v.var_qty, 0)  as variance_qty,
       l.received_qty - coalesce(o.out_qty,0) - coalesce(v.var_qty,0) as remaining_qty,
       coalesce(v.labour, 0)   as labour_cost,
       coalesce(j.jobs, 0)     as job_count,
       case when l.closed_at is not null then 'closed'
            when l.received_qty - coalesce(o.out_qty,0) - coalesce(v.var_qty,0) <= 0 then 'closed'
            when coalesce(j.jobs,0) > 0 then 'part sorted'
            else 'awaiting sorting' end as status,
       (extract(epoch from (now() - l.received_at)) / 86400)::int as age_days,
       l.closed_at, l.close_reason
  from stock_lots l
  join grns g            on g.id = l.grn_id
  left join suppliers s  on s.id = g.supplier_id
  join material_items mi on mi.id = l.item_id
  join material_groups mg on mg.id = mi.group_id
  left join material_categories mc on mc.id = mi.category_id
  left join colors c     on c.id = mi.color_id
  left join sizes sz     on sz.id = mi.size_id
  join units u           on u.id = l.unit_id
  left join (select j.lot_id, sum(sl.quantity) as out_qty
               from sort_jobs j join sort_job_lines sl on sl.job_id = j.id
              group by j.lot_id) o on o.lot_id = l.id
  left join (select lot_id, sum(variance_qty) as var_qty, sum(labour_cost) as labour
               from sort_jobs group by lot_id) v on v.lot_id = l.id
  left join (select lot_id, count(*) as jobs from sort_jobs group by lot_id) j on j.lot_id = l.id
 where has_permission('inventory.view');

drop view if exists v_sort_by_supervisor;
create view v_sort_by_supervisor with (security_invoker = true) as
select e.id as employee_id, e.name as supervisor,
       count(distinct j.lot_id)              as lots_handled,
       count(*)                              as sessions,
       coalesce(sum(o.out_qty), 0)           as sorted_qty,
       coalesce(sum(j.variance_qty), 0)      as variance_qty,
       case when coalesce(sum(o.out_qty),0) + coalesce(sum(j.variance_qty),0) = 0 then 0
            else round(100 * coalesce(sum(j.variance_qty),0)
                 / (coalesce(sum(o.out_qty),0) + coalesce(sum(j.variance_qty),0)), 2) end as variance_pct,
       coalesce(sum(j.labour_cost), 0)       as labour_cost
  from sort_jobs j
  join employees e on e.id = j.supervisor_employee_id
  left join (select job_id, sum(quantity) as out_qty from sort_job_lines group by job_id) o
         on o.job_id = j.id
 where has_permission('inventory.view')
 group by e.id, e.name;

-- ---------------------------------------------------------------------
-- RLS. Read by permission; writes only through the RPC below.
-- ---------------------------------------------------------------------
alter table stock_lots     enable row level security;
alter table sort_jobs      enable row level security;
alter table sort_job_lines enable row level security;
drop policy if exists lots_read  on stock_lots;
drop policy if exists jobs_read  on sort_jobs;
drop policy if exists jlines_read on sort_job_lines;
create policy lots_read   on stock_lots     for select using (has_permission('inventory.view'));
create policy jobs_read   on sort_jobs      for select using (has_permission('inventory.view'));
create policy jlines_read on sort_job_lines for select using (has_permission('inventory.view'));
grant select on stock_lots, sort_jobs, sort_job_lines, v_stock_lots, v_sort_by_supervisor to authenticated;

-- ---------------------------------------------------------------------
-- post_sort_job — one session of opening cartons.
--
-- Returns jsonb rather than raising for the reconciliation guard, so the
-- screen can show a dry run before anything is written. Same shape as
-- hub_cpr_import, which is the pattern in this system that has earned
-- trust: check first, report the numbers, write only on a second call.
-- ---------------------------------------------------------------------
create or replace function post_sort_job(
  p_lot_id      uuid,
  p_sorted_at   timestamptz,
  p_supervisor_employee_id uuid,
  p_worker_count integer,
  p_labour_cost numeric,
  p_variance_qty numeric,
  p_variance_reason text,
  p_note        text,
  p_lines       jsonb,
  p_dry_run     boolean default true
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_uid       uuid := auth.uid();
  v_lot       record;
  v_remaining numeric(16,3);
  v_out       numeric(16,3) := 0;
  v_var       numeric(16,3) := coalesce(p_variance_qty, 0);
  v_draw      numeric(16,3);
  v_line      jsonb;
  v_cat uuid; v_col uuid; v_size uuid; v_item uuid; v_qty numeric(16,3);
  v_has_cat boolean; v_has_col boolean; v_has_size boolean;
  v_src_cat uuid; v_src_col uuid; v_src_size uuid;
  v_job       uuid;
  v_num       text;
  v_preview   jsonb := '[]'::jsonb;
  r           record;
begin
  if not has_permission('inventory.sort') then
    raise exception 'You do not have permission to sort material.';
  end if;
  if v_var < 0 then
    raise exception 'Variance cannot be negative. If more came out than went in, the weighing is wrong.';
  end if;

  /* Lock the lot. Two people sorting the same cartons at the same time
     would otherwise both read the same remaining balance and both pass
     the guard. */
  select * into v_lot from stock_lots where id = p_lot_id for update;
  if not found then raise exception 'Lot not found.'; end if;
  if v_lot.closed_at is not null then raise exception 'That lot is closed.'; end if;

  select l.remaining_qty into v_remaining from v_stock_lots l where l.id = p_lot_id;

  select mi.category_id, mi.color_id, mi.size_id,
         mg.has_category, mg.has_color, mg.has_size
    into v_src_cat, v_src_col, v_src_size, v_has_cat, v_has_col, v_has_size
    from material_items mi join material_groups mg on mg.id = mi.group_id
   where mi.id = v_lot.item_id;

  create temporary table if not exists _sort_lines (
    item_id uuid, quantity numeric(16,3), label text
  ) on commit drop;
  delete from _sort_lines where true;   -- Supabase safeupdate refuses a bare DELETE (see 0113)

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_cat  := nullif(v_line->>'category_id','')::uuid;
    v_col  := nullif(v_line->>'color_id','')::uuid;
    v_size := nullif(v_line->>'size_id','')::uuid;
    v_qty  := (v_line->>'quantity')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Each sorted line needs a quantity greater than zero.';
    end if;
    if not v_has_cat  then v_cat  := null; end if;
    if not v_has_col  then v_col  := null; end if;
    if not v_has_size then v_size := null; end if;

    /* Whatever the lot already knows carries down to every line out of it.
       A 500 kg lot of Lycra sorts into Lycra Blue and Lycra Red — the
       person entering it names only the colour, because the category was
       never in question. Omitting it means inherit, not unknown. */
    if v_cat  is null then v_cat  := v_src_cat;  end if;
    if v_col  is null then v_col  := v_src_col;  end if;
    if v_size is null then v_size := v_src_size; end if;

    /* A sort may only make the material MORE specific. Naming a DIFFERENT
       category is not sorting — it is quietly turning one material into
       another, and the ledger would show fabric that was never bought. */
    if v_src_cat is not null and v_cat <> v_src_cat then
      raise exception 'This lot is already a fixed category. A sorted line cannot change it.';
    end if;
    if v_src_col is not null and v_col <> v_src_col then
      raise exception 'This lot is already a fixed colour. A sorted line cannot change it.';
    end if;
    if v_src_size is not null and v_size <> v_src_size then
      raise exception 'This lot is already a fixed size. A sorted line cannot change it.';
    end if;
    if v_cat is not distinct from v_src_cat
       and v_col is not distinct from v_src_col
       and v_size is not distinct from v_src_size then
      raise exception 'A sorted line must name something the lot did not already know — a colour, a category or a size.';
    end if;
    if v_cat is not null and not exists (
         select 1 from material_categories where id = v_cat and group_id = v_lot.group_id) then
      raise exception 'A sorted line has a category that does not belong to this material.';
    end if;

    select id into v_item from material_items
     where group_id = v_lot.group_id
       and category_id is not distinct from v_cat
       and color_id    is not distinct from v_col
       and size_id     is not distinct from v_size
       and unit_id     = v_lot.unit_id
     limit 1;
    if v_item is null then
      if p_dry_run then
        v_item := null;                          -- nothing is created on a check
      else
        insert into material_items (group_id, category_id, color_id, size_id, unit_id, created_by)
        values (v_lot.group_id, v_cat, v_col, v_size, v_lot.unit_id, v_uid)
        returning id into v_item;
      end if;
    end if;

    insert into _sort_lines (item_id, quantity, label)
    values (v_item, v_qty,
            concat_ws(' · ',
              (select name from material_groups where id = v_lot.group_id),
              (select name from material_categories where id = v_cat),
              (select name from colors where id = v_col),
              (select name from sizes where id = v_size)));
    v_out := v_out + v_qty;
  end loop;

  v_draw := v_out + v_var;

  for r in select label, quantity from _sort_lines order by label loop
    v_preview := v_preview || jsonb_build_object('material', r.label, 'quantity', r.quantity);
  end loop;

  -- ---------------- THE GUARD ----------------
  if v_draw <= 0 then
    return jsonb_build_object('ok', false, 'guard', 'nothing to record',
      'wrote', 0, 'meaning', 'Add at least one sorted quantity, or a variance.');
  end if;
  if v_draw > v_remaining then
    return jsonb_build_object('ok', false, 'guard', 'more than the lot has left',
      'wrote', 0,
      'lot_remaining', v_remaining, 'you_entered', v_draw,
      'over_by', round(v_draw - v_remaining, 3),
      'meaning', 'Sorted quantity plus variance is larger than what is left in this lot. Re-weigh, or correct the receipt.');
  end if;

  if p_dry_run then
    return jsonb_build_object('ok', true, 'dry_run', true, 'wrote', 0,
      'lot', v_lot.lot_number, 'lot_remaining', v_remaining,
      'would_draw', v_draw, 'sorted', v_out, 'variance', v_var,
      'variance_pct', case when v_draw = 0 then 0 else round(100 * v_var / v_draw, 2) end,
      'rate', v_lot.rate,
      'sorted_value', round(v_out * v_lot.rate, 2),
      'variance_cost', round(v_var * v_lot.rate, 2),
      'remaining_after', round(v_remaining - v_draw, 3),
      'closes_lot', (v_remaining - v_draw) <= 0,
      'lines', v_preview);
  end if;

  v_num := next_document_number('SRT','SRT');
  insert into sort_jobs (job_number, lot_id, sorted_at, supervisor_employee_id, worker_count,
                         labour_cost, variance_qty, variance_reason, note, created_by)
  values (v_num, p_lot_id, coalesce(p_sorted_at, now()), p_supervisor_employee_id,
          p_worker_count, coalesce(p_labour_cost,0), v_var, nullif(p_variance_reason,''),
          nullif(p_note,''), v_uid)
  returning id into v_job;

  for r in select item_id, quantity from _sort_lines loop
    insert into sort_job_lines (job_id, item_id, quantity, unit_rate)
    -- ↓ THE COST RULE. Survivors keep the lot rate; the loss is costed
    --   separately. To spread the loss instead, replace v_lot.rate with
    --   (v_lot.rate * v_draw / nullif(v_out,0)).
    values (v_job, r.item_id, r.quantity, v_lot.rate);

    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (r.item_id, r.quantity, 'sort_in', 'sort_jobs', v_job, v_num || ' from ' || v_lot.lot_number, v_uid);
  end loop;

  if v_out > 0 then
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (v_lot.item_id, -v_out, 'sort_out', 'sort_jobs', v_job, v_num, v_uid);
  end if;

  if v_var > 0 then
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (v_lot.item_id, -v_var, 'sort_variance', 'sort_jobs', v_job,
            coalesce(nullif(p_variance_reason,''), 'Lost in sorting'), v_uid);
  end if;

  if (v_remaining - v_draw) <= 0 then
    update stock_lots set closed_at = now(), closed_by = v_uid,
                          close_reason = 'fully sorted'
     where id = p_lot_id;
  end if;

  return jsonb_build_object('ok', true, 'dry_run', false, 'wrote', 1,
    'job', v_num, 'lot', v_lot.lot_number,
    'sorted', v_out, 'variance', v_var,
    'variance_cost', round(v_var * v_lot.rate, 2),
    'remaining_after', round(v_remaining - v_draw, 3),
    'lot_closed', (v_remaining - v_draw) <= 0,
    'lines', v_preview);
end;
$$;

-- ---------------------------------------------------------------------
-- close_lot — the last carton was short. Book the remainder as loss.
--
-- Written as an ordinary sort job with no output so it appears in the
-- same history as every other session, rather than as a special case
-- somebody has to remember exists.
-- ---------------------------------------------------------------------
create or replace function close_lot(p_lot_id uuid, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_remaining numeric(16,3); v_closed timestamptz;
begin
  if not has_permission('inventory.sort') then
    raise exception 'You do not have permission to close a lot.';
  end if;
  select closed_at into v_closed from stock_lots where id = p_lot_id;
  if not found then raise exception 'Lot not found.'; end if;
  if v_closed is not null then raise exception 'That lot is already closed.'; end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'Give a reason — this writes off stock that was paid for.';
  end if;

  select remaining_qty into v_remaining from v_stock_lots where id = p_lot_id;
  if v_remaining <= 0 then
    update stock_lots set closed_at = now(), closed_by = auth.uid(), close_reason = p_reason
     where id = p_lot_id;
    return jsonb_build_object('ok', true, 'written_off', 0);
  end if;

  return post_sort_job(p_lot_id, now(), null, null, 0, v_remaining, p_reason,
                       'Lot closed with a shortfall', '[]'::jsonb, false);
end;
$$;

grant execute on function post_sort_job(uuid, timestamptz, uuid, integer, numeric, numeric, text, text, jsonb, boolean) to authenticated;
grant execute on function close_lot(uuid, text) to authenticated;

commit;

-- =====================================================================
-- UNDO
--
--   drop trigger if exists trg_grn_line_make_lot     on grn_lines;
--   drop trigger if exists trg_grn_line_guard_sorted on grn_lines;
--   drop function if exists close_lot(uuid, text);
--   drop function if exists post_sort_job(uuid, timestamptz, uuid, integer, numeric, numeric, text, text, jsonb, boolean);
--   drop view if exists v_sort_by_supervisor;
--   drop view if exists v_stock_lots;
--   delete from stock_ledger where ref_table = 'sort_jobs';
--   drop table if exists sort_job_lines;
--   drop table if exists sort_jobs;
--   drop table if exists stock_lots;
--   drop function if exists grn_line_make_lot();
--   drop function if exists grn_line_guard_sorted();
--   delete from role_permissions where permission_id =
--     (select id from permissions where code = 'inventory.sort');
--   delete from permissions where code = 'inventory.sort';
-- =====================================================================
