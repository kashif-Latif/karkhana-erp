-- =====================================================================
-- KARKHANA — Migration 0114: a batch on every receipt
--
-- WHAT CHANGES
--   0109 gave a lot number only to material that arrived without knowing
--   its colour. Everything else — 500 kg of Cotton Blue, a carton of 8"
--   zips — went into stock with no identity of its own, so two receipts
--   of the same material at different rates became one indistinguishable
--   pile the moment they landed.
--
--   Now EVERY receipt line gets a batch number. LOT-2026-000001 is a
--   specific 500 kg from a specific supplier on a specific day at a
--   specific rate, and it stays that way.
--
-- WHY THAT MATTERS MORE THAN A TIDY NUMBER
--   A rate lives on a GRN line and nothing downstream ever reads it. With
--   a batch on every line, cost has something to travel on: this shirt was
--   cut from LOT-2026-000042, which cost Rs 780 a kilo, from fareed, on
--   14 August. Without it, cost per garment can only ever be an average.
--
-- THE ONE DISTINCTION
--   A batch that is missing an attribute its material requires still needs
--   somebody to open the cartons. A batch of Cotton Blue does not. That is
--   the new `needs_sorting` flag, and it is what the Sorting screen filters
--   on — so Sorting keeps showing only real work, not every receipt ever
--   made.
--
-- NOTHING IS RECOMPUTED. Existing lots keep their numbers and their sort
-- history exactly as they are.
--
-- Safe to run more than once.
-- =====================================================================

begin;

alter table stock_lots
  add column if not exists needs_sorting boolean not null default false;

-- Everything 0109 created was, by definition, waiting to be sorted.
update stock_lots set needs_sorting = true where needs_sorting = false;

create index if not exists idx_stock_lots_needs_sorting
  on stock_lots(needs_sorting) where needs_sorting and closed_at is null;

-- ---------------------------------------------------------------------
-- Every receipt line becomes a batch.
--
-- The only judgement the trigger makes is whether the batch also needs
-- somebody to open it: true when the material's own rules say it has a
-- colour, category or size and this line did not name one.
-- ---------------------------------------------------------------------
create or replace function grn_line_make_lot()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_group uuid; v_unit uuid;
  v_cat uuid; v_col uuid; v_size uuid;
  v_has_cat boolean; v_has_col boolean; v_has_size boolean;
  v_needs boolean;
  v_received timestamptz;
begin
  select mi.group_id, mi.unit_id, mi.category_id, mi.color_id, mi.size_id,
         mg.has_category, mg.has_color, mg.has_size
    into v_group, v_unit, v_cat, v_col, v_size, v_has_cat, v_has_col, v_has_size
    from material_items mi join material_groups mg on mg.id = mi.group_id
   where mi.id = new.item_id;

  v_needs := (v_has_cat  and v_cat  is null)
          or (v_has_col  and v_col  is null)
          or (v_has_size and v_size is null);

  select received_at into v_received from grns where id = new.grn_id;

  insert into stock_lots (lot_number, grn_id, grn_line_id, item_id, group_id, unit_id,
                          received_qty, rate, received_at, needs_sorting)
  values (next_document_number('LOT','LOT'), new.grn_id, new.id, new.item_id, v_group, v_unit,
          new.quantity, new.rate, coalesce(v_received, now()), v_needs)
  on conflict (grn_line_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Backfill: give a batch to every receipt line that predates this.
-- ---------------------------------------------------------------------
insert into stock_lots (lot_number, grn_id, grn_line_id, item_id, group_id, unit_id,
                        received_qty, rate, received_at, needs_sorting, closed_at, close_reason)
select next_document_number('LOT','LOT'), gl.grn_id, gl.id, gl.item_id,
       mi.group_id, mi.unit_id, gl.quantity, gl.rate, g.received_at,
       false,
       g.received_at,                       -- a known batch needs no sorting,
       'received fully identified'          -- so it is closed on arrival
  from grn_lines gl
  join grns g            on g.id = gl.grn_id
  join material_items mi on mi.id = gl.item_id
  join material_groups mg on mg.id = mi.group_id
 where not exists (select 1 from stock_lots l where l.grn_line_id = gl.id)
   and not ((mg.has_category and mi.category_id is null)
         or (mg.has_color    and mi.color_id    is null)
         or (mg.has_size     and mi.size_id     is null));

-- ---------------------------------------------------------------------
-- The view. A batch that needs no sorting says so plainly rather than
-- claiming to be "awaiting sorting" forever.
-- ---------------------------------------------------------------------
/* CREATE OR REPLACE VIEW can only append a column, never insert one in
   the middle — same rule as CREATE OR REPLACE FUNCTION and a return type.
   Adding needs_sorting after unit_id shifts everything, so the view is
   dropped and rebuilt. post_sort_job reads it at run time, not as a
   declared dependency, so nothing else needs dropping with it. */
drop view if exists v_stock_lots;
create view v_stock_lots with (security_invoker = true) as
select l.id, l.lot_number, l.grn_id, l.item_id, l.group_id, l.unit_id,
       l.needs_sorting,
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
       case when not l.needs_sorting then 'identified'
            when l.closed_at is not null then 'closed'
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

commit;

-- =====================================================================
-- UNDO
--   delete from stock_lots where needs_sorting = false;
--   alter table stock_lots drop column if exists needs_sorting;
--   -- then re-run 0109 (for grn_line_make_lot) and 0111 (for the view).
-- =====================================================================
