-- =====================================================================
-- HEAD OFFICE ERP — Migration 0021: Void movement + Department holdings
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0019, 0020.
--
-- (1) void_movement(): admins can safely reverse a wrong issue/return/
--     adjust/wastage — it posts opposite ledger entries and marks the
--     movement 'voided'. Blocked if reversing would drive stock negative.
-- (2) department_holdings: a live view of what each department is
--     currently holding (issued − returned), per item — the backbone of
--     the CEO's reconciliation. Voided movements are excluded.
-- =====================================================================

alter table stock_movements add column if not exists status text not null default 'posted';

-- ---------- void a movement ----------
create or replace function void_movement(p_movement_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_dir    smallint;
  v_status text;
  v_bal    numeric(16,3);
  r        record;
  v_uid    uuid := auth.uid();
begin
  if not has_permission('inventory.adjust') then
    raise exception 'You do not have permission to void a movement.';
  end if;
  select direction, status into v_dir, v_status from stock_movements where id = p_movement_id;
  if not found then raise exception 'Movement not found.'; end if;
  if v_status = 'voided' then raise exception 'This movement is already voided.'; end if;

  -- if the original ADDED stock (return / adjustment-add), reversing removes
  -- it — make sure it hasn't already been used
  if v_dir = 1 then
    for r in select item_id, quantity from stock_movement_lines where movement_id = p_movement_id loop
      select coalesce(sum(qty_change), 0) into v_bal from stock_ledger where item_id = r.item_id;
      if r.quantity > v_bal then
        raise exception 'Cannot void — that stock has already been used elsewhere.';
      end if;
    end loop;
  end if;

  for r in select item_id, quantity from stock_movement_lines where movement_id = p_movement_id loop
    insert into stock_ledger (item_id, qty_change, movement_type, ref_table, ref_id, note, created_by)
    values (r.item_id, (-v_dir) * r.quantity, 'movement_void', 'stock_movements', p_movement_id, nullif(p_reason,''), v_uid);
  end loop;

  update stock_movements
     set status = 'voided',
         reason = coalesce(reason,'') || case when nullif(p_reason,'') is not null then ' [VOID: ' || p_reason || ']' else ' [VOIDED]' end
   where id = p_movement_id;
end;
$$;

grant execute on function void_movement(uuid, text) to authenticated;

-- ---------- what each department is currently holding ----------
create or replace view department_holdings with (security_invoker = true) as
select sm.department_id,
       d.name as department_name,
       sml.item_id,
       concat_ws(' · ', mg.name, mc.name, c.name, s.name) as item_label,
       u.symbol as unit,
       sum(case when sm.type = 'issue' then sml.quantity when sm.type = 'return' then -sml.quantity else 0 end) as qty
from stock_movements sm
join stock_movement_lines sml on sml.movement_id = sm.id
join departments d on d.id = sm.department_id
join material_items mi on mi.id = sml.item_id
join material_groups mg on mg.id = mi.group_id
left join material_categories mc on mc.id = mi.category_id
left join colors c on c.id = mi.color_id
left join sizes s on s.id = mi.size_id
join units u on u.id = mi.unit_id
where sm.type in ('issue','return') and coalesce(sm.status,'posted') <> 'voided'
group by sm.department_id, d.name, sml.item_id, mg.name, mc.name, c.name, s.name, u.symbol
having sum(case when sm.type = 'issue' then sml.quantity when sm.type = 'return' then -sml.quantity else 0 end) <> 0;

-- =====================================================================
-- END OF MIGRATION 0021 (idempotent)
-- =====================================================================
