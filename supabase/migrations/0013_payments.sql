-- =====================================================================
-- HEAD OFFICE ERP — Migration 0013: Supplier Payments (Day 3 Part 2)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0001, 0003, 0012.
--
-- Pay suppliers against what you owe them. A payment does two things
-- atomically: records the payment (cash/bank/cheque) AND reduces the
-- supplier's outstanding balance (a 'payment' entry in supplier_ledger).
-- Only record_payment() can write these (checks 'payments.manage').
-- =====================================================================

-- ---------- new permission: record supplier payments ----------
insert into permissions (code, module, description)
values ('payments.manage', 'inventory', 'Record supplier payments')
on conflict (code) do nothing;

-- grant to Administrator + Inventory Manager (super admin has all via flag)
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p
where r.code in ('admin', 'inventory_manager') and p.code = 'payments.manage'
on conflict do nothing;

-- ---------- payments ----------
create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  payment_number text unique,                     -- auto PAY-YYYY-000001
  supplier_id    uuid not null references suppliers(id),
  amount         numeric(16,2) not null,
  method         text not null,                   -- cash / bank / cheque
  reference      text,                            -- cheque no, txn id, etc.
  paid_at        timestamptz not null default now(),
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);
create index if not exists idx_payments_supplier on payments(supplier_id);

drop trigger if exists trg_audit_payments on payments;
create trigger trg_audit_payments after insert or update or delete on payments for each row execute function audit_row_change();

alter table payments enable row level security;
drop policy if exists pay_read on payments;
create policy pay_read on payments for select using (has_permission('inventory.view'));

-- ---------- supplier dues (purchased / paid / outstanding, with names) ----------
create or replace view supplier_dues with (security_invoker = true) as
select s.id as supplier_id, s.company_name,
       coalesce(sum(case when se.entry_type = 'purchase' then se.amount else 0 end), 0) as purchased,
       coalesce(sum(case when se.entry_type = 'payment'  then se.amount else 0 end), 0) as paid,
       coalesce(sum(case when se.entry_type = 'purchase' then se.amount else -se.amount end), 0) as outstanding
from suppliers s
left join supplier_ledger se on se.supplier_id = s.id
group by s.id, s.company_name;

-- ---------- the atomic payment action ----------
create or replace function record_payment(
  p_supplier_id uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text,
  p_paid_at     timestamptz,
  p_note        text
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if not has_permission('payments.manage') then
    raise exception 'You do not have permission to record payments.';
  end if;
  if p_supplier_id is null or not exists (select 1 from suppliers where id = p_supplier_id) then
    raise exception 'Please choose a valid supplier.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if coalesce(p_method, '') not in ('cash', 'bank', 'cheque') then
    raise exception 'Choose a payment method (cash, bank, or cheque).';
  end if;

  insert into payments (payment_number, supplier_id, amount, method, reference, paid_at, note, created_by)
  values (next_document_number('PAY','PAY'), p_supplier_id, p_amount, p_method,
          nullif(p_reference,''), coalesce(p_paid_at, now()), nullif(p_note,''), v_uid)
  returning id into v_id;

  insert into supplier_ledger (supplier_id, entry_type, amount, ref_table, ref_id, note, created_by)
  values (p_supplier_id, 'payment', p_amount, 'payments', v_id, 'Payment', v_uid);

  return v_id;
end;
$$;

grant execute on function record_payment(uuid, numeric, text, text, timestamptz, text) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0013 (idempotent)
-- =====================================================================
