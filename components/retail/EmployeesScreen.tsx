"use client";
/* Employees — shop floor and head office.
 *
 * ONE COMPONENT, TWO SCREENS. The old app had a separate Employees page under
 * Head Office and another under the shops, and they drifted: one grew a pay
 * type and the other did not. They are the same table and the same job, so the
 * only thing that differs here is which branches are in scope.
 */
import { useMemo, useState } from "react";
import { Users, UserPlus, Pencil, Wallet, Store } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, Select, PreviewNote, SourceNote,
  useEmployees, isHeadOffice, money, num, text, type Employee, type Col,
} from "@/components/retail/kit";

type Scope = "shops" | "ho";

const BLANK = {
  name: "", branch_id: "", designation: "Sales Person", phone: "",
  monthly_salary: "", pay_type: "monthly", hourly_rate: "", active: true,
};

export default function EmployeesScreen({ scope }: { scope: Scope }) {
  const { employees, branches, reloadEmployees } = useEmployees(scope);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  /* Head office staff live on the Head Office branch; shop staff on everything
     else. The picker only offers the branches this screen is responsible for,
     so nobody accidentally files a shop salesman under Head Office. */
  const pickable = useMemo(
    () => branches.filter((b) => (scope === "ho" ? isHeadOffice(b) : !isHeadOffice(b))),
    [branches, scope]
  );
  const branchName = (id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—";

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees
      .filter((e) => showInactive || e.active !== false)
      .filter((e) => !needle || e.name.toLowerCase().includes(needle) || (e.designation ?? "").toLowerCase().includes(needle));
  }, [employees, q, showInactive]);

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.active !== false);
    const monthly = active.filter((e) => (e.pay_type ?? "monthly") === "monthly");
    return [
      { label: "On the books", value: String(active.length), Icon: Users },
      { label: "Monthly paid", value: String(monthly.length), Icon: Wallet },
      { label: "Daily / hourly", value: String(active.length - monthly.length), Icon: Wallet },
      { label: "Monthly wage bill", value: money(monthly.reduce((t, e) => t + num(e.monthly_salary), 0)), Icon: Store },
    ];
  }, [employees]);

  function startAdd() {
    setEditing(null);
    setForm({ ...BLANK, branch_id: pickable[0] ? String(pickable[0].id) : "" });
    setErr(""); setOpen(true);
  }
  function startEdit(e: Employee) {
    setEditing(e);
    setForm({
      name: e.name ?? "", branch_id: e.branch_id == null ? "" : String(e.branch_id),
      designation: e.designation ?? "", phone: e.phone ?? "",
      monthly_salary: e.monthly_salary == null ? "" : String(e.monthly_salary),
      pay_type: e.pay_type ?? "monthly",
      hourly_rate: e.hourly_rate == null ? "" : String(e.hourly_rate),
      active: e.active !== false,
    });
    setErr(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setErr("A name is required."); return; }
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const payload = {
      name: form.name.trim(),
      branch_id: form.branch_id ? Number(form.branch_id) : null,
      designation: form.designation.trim() || null,
      phone: form.phone.trim() || null,
      monthly_salary: form.monthly_salary === "" ? 0 : Number(form.monthly_salary),
      pay_type: form.pay_type,
      /* Blank, not zero. An hourly rate of zero is a claim that the person
         works for nothing; a blank one says nobody has set it yet. */
      hourly_rate: form.hourly_rate === "" ? null : Number(form.hourly_rate),
      active: form.active,
    };
    const { error } = editing
      ? await supabase.from("retail_employees").update(payload).eq("id", editing.id)
      : await supabase.from("retail_employees").insert(payload);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setOpen(false); reloadEmployees();
  }

  const cols: Col<Employee>[] = [
    { head: "Name", bold: true, cell: (e) => e.name },
    { head: "Designation", muted: true, cell: (e) => text(e.designation) },
    { head: scope === "ho" ? "Office" : "Branch", cell: (e) => branchName(e.branch_id) },
    { head: "Phone", muted: true, cell: (e) => text(e.phone) },
    { head: "Pay", cell: (e) => (e.pay_type ?? "monthly") === "monthly"
        ? <Pill tone="info">Monthly</Pill>
        : <Pill tone="warn">{e.pay_type === "hourly" ? "Hourly" : "Daily"}</Pill> },
    { head: "Rate", right: true, cell: (e) => (e.pay_type ?? "monthly") === "monthly"
        ? money(e.monthly_salary)
        : e.hourly_rate == null ? "—" : money(e.hourly_rate) + " /hr" },
    { head: "", right: true, cell: (e) => (
        <button onClick={() => startEdit(e)} className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white" aria-label={`Edit ${e.name}`}>
          <Pencil size={15} />
        </button>
      ) },
  ];

  return (
    <Shell>
      <PageHeader
        title={scope === "ho" ? "Head Office Employees" : "Employees"}
        subtitle={scope === "ho" ? "The head office team, their pay type and rate." : "Shop staff across the branches, their pay type and rate."}
      >
        <button onClick={startAdd} className={btnPrimary}><UserPlus size={15} /> Add employee</button>
      </PageHeader>

      <StatCards stats={stats} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or designation"
          className="min-w-[200px] flex-1 rounded-full border border-line bg-surface px-4 py-2 text-[13px] text-ink outline-none transition focus:border-ink/30 dark:border-white/10 dark:bg-white/[0.06] dark:text-white sm:max-w-xs" />
        <Select value={showInactive ? "all" : "active"} onChange={(v) => setShowInactive(v === "all")}>
          <option value="active">Active only</option>
          <option value="all">Including left</option>
        </Select>
      </div>

      <DataTable cols={cols} rows={rows} minWidth={760}
        empty={`No ${scope === "ho" ? "head office" : "shop"} employees yet — add the first one above.`} />

      <SourceNote>
        Pay type decides how a month is valued. <strong>Monthly</strong> pays the full salary
        and divides by the days in that month for a part month. <strong>Daily</strong> and{" "}
        <strong>hourly</strong> are counted from attendance, so a person on either must be
        marked present to be paid.
      </SourceNote>

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : "Add employee"}
        subtitle={editing ? "Changes apply from now on — months already paid are not recalculated." : undefined}>
        <div className="space-y-3.5">
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={scope === "ho" ? "Office" : "Branch"}>
              <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className={inputCls}>
                <option value="">—</option>
                {pickable.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Designation"><input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} /></Field>
            <Field label="Pay type">
              <select value={form.pay_type} onChange={(e) => setForm({ ...form, pay_type: e.target.value })} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
                <option value="hourly">Hourly</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly salary"><input type="number" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} className={inputCls} /></Field>
            <Field label="Hourly / daily rate"><input type="number" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} className={inputCls} placeholder="—" /></Field>
          </div>
          <label className="flex items-center gap-2.5 text-[13px] font-semibold text-ink dark:text-[#e7e2d8]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-[#141414] dark:accent-white" />
            Still working here
          </label>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : editing ? "Save changes" : "Add employee"}</button>
          </div>
          {!isSupabaseConfigured && <p className="text-center text-[12px] text-hint">Preview build — nothing will be saved.</p>}
        </div>
      </Modal>

      <PreviewNote />
    </Shell>
  );
}
