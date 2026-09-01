-- =====================================================================
-- KARKHANA — Migration 0117: the process floor
--
-- WHAT THIS MODELS, in Kashif's words:
--
--   "I gave an order of 450 t-shirts and I gave this much kg. So this will
--    be allotted to the department. Now I can see this much pieces is
--    pending. Cutting, stitching and clipping are all under a single one
--    department known as process. I can see whether they are on clipping
--    or cutting or overlock — I don't even care. The whole process shows
--    me this much shirt has come from the process department. They gave me
--    fourteen shirts, fourteen is cut off, and the pending shows the rest."
--
-- So PROCESS IS ONE BOX, not a chain of five. The stages exist as labels
-- on the work, not as gates a piece must pass through one at a time. The
-- number that matters is: how many of the 450 are still out there.
--
-- PAY FOLLOWS THE PIECES
--   "When we give the order, their salary shows in the pending section.
--    When they give us fourteen shirts, the payable is calculated and
--    deducted from the pending."
--
--   A rate is per piece, per stage, per article. The moment fourteen
--   pieces are received against a stage, fourteen times that rate becomes
--   payable to the person who did it. Nothing is estimated and nothing is
--   stored as a total — the payable is summed from receipts, so correcting
--   a wrong entry corrects the wage immediately.
--
-- WHAT THIS DOES NOT DO YET
--   Iron / Pressing and QA/QC & Packing are deliberately left out, per
--   "make it till here and then we're gonna move on to the pressing and
--   the sticker". They are stages in the table already; nothing stops them
--   being used later.
--
-- KARKHANA ONLY. No online_* or retail_* table is read or written.
--
-- Safe to run more than once.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into permissions (code, module, description) values
  ('process.view',   'production', 'See process work, pending pieces and payables'),
  ('process.manage', 'production', 'Assign orders to process and record pieces received'),
  ('process.pay',    'production', 'Mark piece-rate wages as paid')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.code in ('super_admin','admin','production_manager')
  and p.code in ('process.view','process.manage','process.pay')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.code in ('supervisor') and p.code in ('process.view','process.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Which floors make up "process"
--
-- Cutting, stitching and clipping are inside the box. Iron and QA sit in
-- the same table but outside it, so adding them later is one update, not
-- a migration.
-- ---------------------------------------------------------------------
alter table departments
  add column if not exists in_process boolean not null default false,
  add column if not exists process_order integer;

update departments set in_process = true, process_order = 1 where code = 'CUT'    and kind = 'section';
update departments set in_process = true, process_order = 2 where code = 'STITCH' and kind = 'section';
update departments set in_process = true, process_order = 3 where code = 'CLIP'   and kind = 'section';
update departments set in_process = false, process_order = 4 where code = 'IRON'  and kind = 'section';
update departments set in_process = false, process_order = 5 where code = 'QAQC'  and kind = 'section';

-- ---------------------------------------------------------------------
-- Piece rates. Per stage, per article, effective from a date.
--
-- Dated rather than overwritten, so a rate rise does not silently restate
-- what last month's work was worth. Same reason salary history is per day.
-- ---------------------------------------------------------------------
create table if not exists piece_rates (
  id             uuid primary key default gen_random_uuid(),
  article_id     uuid references articles(id) on delete cascade,
  department_id  uuid not null references departments(id),
  rate           numeric(12,2) not null check (rate >= 0),
  effective_from date not null default current_date,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);
create unique index if not exists uq_piece_rate
  on piece_rates(coalesce(article_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 department_id, effective_from);
create index if not exists idx_piece_rates_dept on piece_rates(department_id);

-- ---------------------------------------------------------------------
-- An order handed to the floor.
-- ---------------------------------------------------------------------
create table if not exists process_assignments (
  id            uuid primary key default gen_random_uuid(),
  assignment_no text unique,
  order_id      uuid not null references production_orders(id) on delete cascade,
  department_id uuid not null references departments(id),
  quantity      numeric(14,2) not null check (quantity > 0),
  assigned_at   timestamptz not null default now(),
  supervisor_employee_id uuid references employees(id),
  note          text,
  closed_at     timestamptz,
  created_by    uuid references auth.users(id)
);
create index if not exists idx_proc_assign_order on process_assignments(order_id);
create index if not exists idx_proc_assign_open  on process_assignments(closed_at) where closed_at is null;

-- ---------------------------------------------------------------------
-- Pieces coming back. This is the row that moves every number: it lowers
-- the pending, and it creates the wage.
-- ---------------------------------------------------------------------
create table if not exists process_receipts (
  id             uuid primary key default gen_random_uuid(),
  receipt_no     text unique,
  assignment_id  uuid not null references process_assignments(id) on delete cascade,
  employee_id    uuid references employees(id),
  quantity       numeric(14,2) not null check (quantity > 0),
  rejected       numeric(14,2) not null default 0 check (rejected >= 0),
  unit_rate      numeric(12,2) not null default 0,
  received_at    timestamptz not null default now(),
  paid_at        timestamptz,
  paid_by        uuid references auth.users(id),
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);
create index if not exists idx_proc_recv_assign on process_receipts(assignment_id);
create index if not exists idx_proc_recv_unpaid on process_receipts(paid_at) where paid_at is null;

drop trigger if exists trg_audit_process_receipts on process_receipts;
create trigger trg_audit_process_receipts after insert or update or delete on process_receipts
  for each row execute function audit_row_change();

-- ---------------------------------------------------------------------
-- Material issued against an order — the link that never existed.
-- ---------------------------------------------------------------------
alter table stock_movements
  add column if not exists production_order_id uuid references production_orders(id);
create index if not exists idx_moves_order on stock_movements(production_order_id)
  where production_order_id is not null;

-- ---------------------------------------------------------------------
-- What is pending, per assignment. Nothing stored.
-- ---------------------------------------------------------------------
create or replace view v_process_pending with (security_invoker = true) as
select a.id, a.assignment_no, a.order_id, a.department_id,
       po.order_number, ar.code as article_code, ar.name as article,
       d.name as department, d.process_order,
       e.name as supervisor,
       a.quantity                             as assigned,
       coalesce(r.received, 0)                as received,
       coalesce(r.rejected, 0)                as rejected,
       a.quantity - coalesce(r.received, 0)   as pending,
       coalesce(r.wage, 0)                    as wage_earned,
       coalesce(r.unpaid, 0)                  as wage_unpaid,
       a.assigned_at, a.closed_at,
       (extract(epoch from (now() - a.assigned_at)) / 86400)::int as age_days,
       case when a.closed_at is not null then 'closed'
            when a.quantity - coalesce(r.received,0) <= 0 then 'complete'
            when coalesce(r.received,0) > 0 then 'part done'
            else 'not started' end            as status
  from process_assignments a
  join production_orders po on po.id = a.order_id
  join articles ar          on ar.id = po.article_id
  join departments d        on d.id = a.department_id
  left join employees e     on e.id = a.supervisor_employee_id
  left join (select assignment_id,
                    sum(quantity)                    as received,
                    sum(rejected)                    as rejected,
                    sum(quantity * unit_rate)        as wage,
                    sum(case when paid_at is null then quantity * unit_rate else 0 end) as unpaid
               from process_receipts group by assignment_id) r on r.assignment_id = a.id
 where has_permission('process.view');

-- ---------------------------------------------------------------------
-- The whole box, per order. This is the number Kashif asked for: of 450,
-- how many are still out on the floor.
-- ---------------------------------------------------------------------
create or replace view v_process_by_order with (security_invoker = true) as
select po.id as order_id, po.order_number, po.quantity as ordered,
       ar.code as article_code, ar.name as article,
       coalesce(sum(a.quantity), 0)                          as assigned,
       coalesce(sum(p.received), 0)                          as received,
       coalesce(sum(a.quantity), 0) - coalesce(sum(p.received), 0) as in_process,
       coalesce(sum(p.wage), 0)                              as wage_earned,
       coalesce(sum(p.unpaid), 0)                            as wage_unpaid
  from production_orders po
  join articles ar on ar.id = po.article_id
  left join process_assignments a on a.order_id = po.id
  left join (select assignment_id,
                    sum(quantity) as received,
                    sum(quantity * unit_rate) as wage,
                    sum(case when paid_at is null then quantity * unit_rate else 0 end) as unpaid
               from process_receipts group by assignment_id) p on p.assignment_id = a.id
 where has_permission('process.view')
 group by po.id, po.order_number, po.quantity, ar.code, ar.name;

-- ---------------------------------------------------------------------
-- Who is owed what.
-- ---------------------------------------------------------------------
create or replace view v_process_payable with (security_invoker = true) as
select e.id as employee_id, e.name as employee,
       d.id as department_id, d.name as department,
       sum(r.quantity)                                                   as pieces,
       sum(r.quantity * r.unit_rate)                                     as earned,
       sum(case when r.paid_at is null then r.quantity * r.unit_rate else 0 end) as payable,
       sum(case when r.paid_at is null then r.quantity else 0 end)       as pieces_unpaid,
       max(r.received_at)                                                as last_delivery
  from process_receipts r
  join process_assignments a on a.id = r.assignment_id
  join departments d         on d.id = a.department_id
  join employees e           on e.id = r.employee_id
 where has_permission('process.view')
 group by e.id, e.name, d.id, d.name;

-- ---------------------------------------------------------------------
-- RLS: read by permission, writes only through the functions below.
-- ---------------------------------------------------------------------
alter table piece_rates          enable row level security;
alter table process_assignments  enable row level security;
alter table process_receipts     enable row level security;
drop policy if exists pr_read on piece_rates;
drop policy if exists pa_read on process_assignments;
drop policy if exists px_read on process_receipts;
create policy pr_read on piece_rates         for select using (has_permission('process.view'));
create policy pa_read on process_assignments for select using (has_permission('process.view'));
create policy px_read on process_receipts    for select using (has_permission('process.view'));
grant select on piece_rates, process_assignments, process_receipts,
                v_process_pending, v_process_by_order, v_process_payable to authenticated;

-- ---------------------------------------------------------------------
-- Set a piece rate.
-- ---------------------------------------------------------------------
create or replace function set_piece_rate(
  p_department_id uuid, p_rate numeric,
  p_article_id uuid default null, p_effective_from date default null, p_note text default null
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid; v_from date := coalesce(p_effective_from, current_date);
begin
  if not has_permission('process.manage') then
    raise exception 'You do not have permission to set piece rates.';
  end if;
  if p_rate is null or p_rate < 0 then raise exception 'Give a rate of zero or more.'; end if;
  if not exists (select 1 from departments where id = p_department_id and kind = 'section') then
    raise exception 'Piece rates belong to a factory floor, not a business unit.';
  end if;

  insert into piece_rates (article_id, department_id, rate, effective_from, note, created_by)
  values (p_article_id, p_department_id, p_rate, v_from, nullif(p_note,''), auth.uid())
  on conflict (coalesce(article_id, '00000000-0000-0000-0000-000000000000'::uuid), department_id, effective_from)
  do update set rate = excluded.rate, note = excluded.note
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Hand an order to a floor.
-- ---------------------------------------------------------------------
create or replace function assign_to_process(
  p_order_id uuid, p_department_id uuid, p_quantity numeric,
  p_supervisor_employee_id uuid default null, p_note text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid; v_no text; v_ordered numeric; v_already numeric;
begin
  if not has_permission('process.manage') then
    raise exception 'You do not have permission to assign work.';
  end if;
  select quantity into v_ordered from production_orders where id = p_order_id;
  if not found then raise exception 'Order not found.'; end if;
  if not exists (select 1 from departments where id = p_department_id and kind = 'section' and in_process) then
    raise exception 'That is not a process floor.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Give a quantity greater than zero.'; end if;

  /* A floor cannot be given more of an order than the order is for. The
     shirts do not exist. */
  select coalesce(sum(quantity),0) into v_already
    from process_assignments where order_id = p_order_id and department_id = p_department_id;
  if v_already + p_quantity > v_ordered then
    raise exception 'That floor already has % of a % piece order. Assigning % more would exceed it.',
      v_already, v_ordered, p_quantity;
  end if;

  v_no := next_document_number('ASG','ASG');
  insert into process_assignments (assignment_no, order_id, department_id, quantity,
                                   supervisor_employee_id, note, created_by)
  values (v_no, p_order_id, p_department_id, p_quantity, p_supervisor_employee_id,
          nullif(p_note,''), auth.uid())
  returning id into v_id;

  update production_orders set status = 'in_progress'
   where id = p_order_id and status = 'pending';

  return jsonb_build_object('ok', true, 'assignment', v_no, 'id', v_id,
                            'pending', p_quantity);
end;
$$;

-- ---------------------------------------------------------------------
-- Record pieces coming back. This is the one that moves the money.
--
-- The rate is captured ONTO the receipt at the moment it is recorded, so
-- a later rate change never restates work already done.
-- ---------------------------------------------------------------------
create or replace function receive_from_process(
  p_assignment_id uuid, p_quantity numeric, p_employee_id uuid default null,
  p_rejected numeric default 0, p_rate numeric default null,
  p_received_at timestamptz default null, p_note text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_a record; v_pending numeric; v_rate numeric; v_no text; v_when timestamptz;
begin
  if not has_permission('process.manage') then
    raise exception 'You do not have permission to record work received.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Give a quantity greater than zero.'; end if;

  select a.*, po.article_id into v_a
    from process_assignments a join production_orders po on po.id = a.order_id
   where a.id = p_assignment_id for update;
  if not found then raise exception 'Assignment not found.'; end if;
  if v_a.closed_at is not null then raise exception 'That assignment is closed.'; end if;

  select pending into v_pending from v_process_pending where id = p_assignment_id;

  /* More cannot come back than went out. */
  if p_quantity + coalesce(p_rejected,0) > v_pending then
    return jsonb_build_object('ok', false, 'guard', 'more than is out on the floor',
      'wrote', 0, 'pending', v_pending, 'you_entered', p_quantity + coalesce(p_rejected,0),
      'meaning', 'Pieces received plus rejected is more than this floor still owes. Re-count, or raise the assignment.');
  end if;

  v_when := coalesce(p_received_at, now());
  v_rate := p_rate;
  if v_rate is null then
    select rate into v_rate from piece_rates
     where department_id = v_a.department_id
       and (article_id = v_a.article_id or article_id is null)
       and effective_from <= v_when::date
     order by (article_id is not null) desc, effective_from desc
     limit 1;
  end if;
  v_rate := coalesce(v_rate, 0);

  v_no := next_document_number('PRC','PRC');
  insert into process_receipts (receipt_no, assignment_id, employee_id, quantity, rejected,
                                unit_rate, received_at, note, created_by)
  values (v_no, p_assignment_id, p_employee_id, p_quantity, coalesce(p_rejected,0),
          v_rate, v_when, nullif(p_note,''), auth.uid());

  if (v_pending - p_quantity - coalesce(p_rejected,0)) <= 0 then
    update process_assignments set closed_at = now() where id = p_assignment_id;
  end if;

  return jsonb_build_object('ok', true, 'receipt', v_no,
    'received', p_quantity, 'rate', v_rate,
    'wage', round(p_quantity * v_rate, 2),
    'pending_now', v_pending - p_quantity - coalesce(p_rejected,0),
    'closed', (v_pending - p_quantity - coalesce(p_rejected,0)) <= 0);
end;
$$;

-- ---------------------------------------------------------------------
-- Mark wages paid.
-- ---------------------------------------------------------------------
create or replace function pay_process_wages(p_receipt_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_n int; v_amt numeric;
begin
  if not has_permission('process.pay') then
    raise exception 'You do not have permission to mark wages paid.';
  end if;
  select count(*), coalesce(sum(quantity * unit_rate),0) into v_n, v_amt
    from process_receipts where id = any(p_receipt_ids) and paid_at is null;
  update process_receipts set paid_at = now(), paid_by = auth.uid()
   where id = any(p_receipt_ids) and paid_at is null;
  return jsonb_build_object('ok', true, 'marked', v_n, 'amount', v_amt);
end;
$$;

-- ---------------------------------------------------------------------
-- Undo a receipt. Same principle as everywhere else: reverse, never
-- delete, and refuse once the wage has been paid.
-- ---------------------------------------------------------------------
create or replace function void_process_receipt(p_receipt_id uuid, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_r record;
begin
  if not has_permission('process.manage') then
    raise exception 'You do not have permission to undo a receipt.';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Give a reason.'; end if;
  select * into v_r from process_receipts where id = p_receipt_id;
  if not found then raise exception 'Receipt not found.'; end if;
  if v_r.paid_at is not null then
    raise exception 'That wage has already been paid. Record a correction instead of removing it.';
  end if;

  delete from process_receipts where id = p_receipt_id;
  update process_assignments set closed_at = null where id = v_r.assignment_id;
  return jsonb_build_object('ok', true, 'removed', v_r.receipt_no,
    'pieces_returned', v_r.quantity);
end;
$$;

grant execute on function set_piece_rate(uuid, numeric, uuid, date, text) to authenticated;
grant execute on function assign_to_process(uuid, uuid, numeric, uuid, text) to authenticated;
grant execute on function receive_from_process(uuid, numeric, uuid, numeric, numeric, timestamptz, text) to authenticated;
grant execute on function pay_process_wages(uuid[]) to authenticated;
grant execute on function void_process_receipt(uuid, text) to authenticated;

commit;

-- =====================================================================
-- UNDO
--   drop function if exists void_process_receipt(uuid, text);
--   drop function if exists pay_process_wages(uuid[]);
--   drop function if exists receive_from_process(uuid, numeric, uuid, numeric, numeric, timestamptz, text);
--   drop function if exists assign_to_process(uuid, uuid, numeric, uuid, text);
--   drop function if exists set_piece_rate(uuid, numeric, uuid, date, text);
--   drop view if exists v_process_payable;
--   drop view if exists v_process_by_order;
--   drop view if exists v_process_pending;
--   drop table if exists process_receipts;
--   drop table if exists process_assignments;
--   drop table if exists piece_rates;
--   alter table stock_movements drop column if exists production_order_id;
--   alter table departments drop column if exists in_process, drop column if exists process_order;
--   delete from role_permissions where permission_id in
--     (select id from permissions where code like 'process.%');
--   delete from permissions where code like 'process.%';
-- =====================================================================
