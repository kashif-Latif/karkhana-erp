-- =====================================================================
-- KARKHANA — Migration 0111: undo a sort job
--
-- 0109 shipped without a way back, and that leaves a dead end.
--
--   Somebody types Blue where it should have said Red. The stock is now
--   wrong. They cannot delete the receipt — "stock from this receipt has
--   already been used". They cannot void it, same check. They cannot edit
--   it, because 0109's own guard refuses to edit a sorted receipt. The
--   lot is wrong permanently, and the only escape is an adjustment, which
--   is exactly the untraceable manual fiddling 0109 existed to prevent.
--
-- Every other destructive action in this system has a way back: void_grn,
-- void_movement, delete_payment. Sorting had none. This adds it.
--
-- HOW IT WORKS
--   Reverse, never delete. The job stays in the history marked voided,
--   with a reason and who did it, and three sets of ledger rows put the
--   material back where it came from. Afterwards the lot reads exactly as
--   it did before that session, and the person can enter it again
--   correctly.
--
-- THE GUARD
--   Fabric that has already been cut cannot be un-sorted. If any of the
--   colours this job produced has since been issued, this refuses and
--   names the material — the same rule void_movement has applied since
--   0021 and void_grn since 0108.
--
-- Safe to run more than once.
-- =====================================================================

begin;

alter table sort_jobs
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references auth.users(id),
  add column if not exists void_reason text;

-- ---------------------------------------------------------------------
-- The views must stop counting a voided job, or the lot would still
-- believe that material left it.
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
              where j.voided_at is null
              group by j.lot_id) o on o.lot_id = l.id
  left join (select lot_id, sum(variance_qty) as var_qty, sum(labour_cost) as labour
               from sort_jobs where voided_at is null group by lot_id) v on v.lot_id = l.id
  left join (select lot_id, count(*) as jobs from sort_jobs
              where voided_at is null group by lot_id) j on j.lot_id = l.id
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
 where j.voided_at is null
   and has_permission('inventory.view')
 group by e.id, e.name;

-- ---------------------------------------------------------------------
-- void_sort_job
-- ---------------------------------------------------------------------
create or replace function void_sort_job(p_job_id uuid, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_job   record;
  v_lot   record;
  r       record;
  v_label text;
  v_back  numeric(16,3) := 0;
begin
  if not has_permission('inventory.sort') then
    raise exception 'You do not have permission to undo a sorting session.';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'Give a reason — this moves stock back.';
  end if;

  select * into v_job from sort_jobs where id = p_job_id for update;
  if not found then raise exception 'That sorting session was not found.'; end if;
  if v_job.voided_at is not null then raise exception 'That session is already undone.'; end if;

  select * into v_lot from stock_lots where id = v_job.lot_id for update;

  /* Whatever this session produced has to still be on the shelf. Fabric
     already cut cannot be un-sorted — the pieces exist and pretending the
     kilos went back would put the balance below zero, which is the exact
     failure 0108 spent a migration closing. */
  for r in select item_id, sum(quantity) as qty from sort_job_lines
            where job_id = p_job_id group by item_id
  loop
    if r.qty > coalesce((select sum(qty_change) from stock_ledger where item_id = r.item_id), 0) then
      select concat_ws(' · ', mg.name, mc.name, c.name, s.name) into v_label
        from material_items mi
        join material_groups mg on mg.id = mi.group_id
        left join material_categories mc on mc.id = mi.category_id
        left join colors c on c.id = mi.color_id
        left join sizes  s on s.id = mi.size_id
       where mi.id = r.item_id;
      raise exception
        'Cannot undo — % from this session has already been issued. Only % is left on the shelf. Record a wastage or an adjustment instead.',
        coalesce(v_label,'material'),
        coalesce((select sum(qty_change) from stock_ledger where item_id = r.item_id), 0);
    end if;
  end loop;

  -- take the sorted colours back off the shelf
  for r in select item_id, sum(quantity) as qty from sort_job_lines
            where job_id = p_job_id group by item_id
  loop
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (r.item_id, -r.qty, 'sort_in_void', 'sort_jobs', p_job_id,
            'Undo ' || v_job.job_number || ': ' || p_reason, v_uid);
    v_back := v_back + r.qty;
  end loop;

  -- and put the same quantity, plus whatever was written off as lost,
  -- back into the unsorted lot
  if v_back > 0 then
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (v_lot.item_id, v_back, 'sort_out_void', 'sort_jobs', p_job_id,
            'Undo ' || v_job.job_number, v_uid);
  end if;
  if v_job.variance_qty > 0 then
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (v_lot.item_id, v_job.variance_qty, 'sort_variance_void', 'sort_jobs', p_job_id,
            'Undo ' || v_job.job_number || ': loss reversed', v_uid);
  end if;

  update sort_jobs
     set voided_at = now(), voided_by = v_uid, void_reason = p_reason
   where id = p_job_id;

  /* If this session was the one that closed the lot, the lot opens again
     — there is material in it now that nobody has accounted for. */
  if v_lot.closed_at is not null then
    update stock_lots set closed_at = null, closed_by = null, close_reason = null
     where id = v_lot.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'job', v_job.job_number, 'lot', v_lot.lot_number,
    'returned_to_lot', v_back + v_job.variance_qty,
    'lot_remaining', (select remaining_qty from v_stock_lots where id = v_lot.id),
    'lot_reopened', v_lot.closed_at is not null);
end;
$$;

grant execute on function void_sort_job(uuid, text) to authenticated;

commit;

-- =====================================================================
-- UNDO
--   drop function if exists void_sort_job(uuid, text);
--   alter table sort_jobs drop column if exists voided_at,
--                         drop column if exists voided_by,
--                         drop column if exists void_reason;
--   -- then re-run 0109 to restore the two views.
-- =====================================================================
