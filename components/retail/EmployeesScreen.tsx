"use client";
/* Employees — shop floor and head office.
 *
 * ONE COMPONENT, TWO SCREENS. The old app had a separate Employees page under
 * Head Office and another under the shops, and they drifted: one grew a pay
 * type and the other did not. They are the same table and the same job, so the
 * only thing that differs here is which branches are in scope.
 *
 * WHY "ADVANCE OWED" AND "NET TO PAY" ARE ON THIS TABLE
 *   This is the screen the shop manager has open on payday. The salary is one
 *   half of the answer and what the person already took is the other, and the
 *   original (renderStaff / renderShopAdvance / renderHOAdvance) has always
 *   shown both side by side with the subtraction done. Sending somebody to a
 *   second screen to find out what to actually hand over is how the wrong
 *   amount gets handed over.
 *
 *     advance owed = Σ (advance + purchase_credit − paid), all time, floored at 0
 *     net to pay   = salary − advance owed
 *
 *   Floored at zero because a person in credit — repaid more than they took —
 *   is money the business owes them, and letting a negative balance inflate
 *   their own net pay would quietly pay that credit twice. It is settled as its
 *   own entry on the Ledger screen, not by a bigger salary here.
 *
 *   The balance is never stored. A stored balance and a list of entries WILL
 *   disagree eventually, and when they do nobody can tell which is lying.
 *
 * SALARY IS NOT ONE FORMULA
 *   Monthly staff earn the full monthly_salary, flat — days present do not
 *   scale it. Hourly staff earn hourly_rate × the hours actually recorded this
 *   month, so an hourly person with no times in retail_attendance earns
 *   nothing, which is the honest answer rather than a guess with money on it.
 *
 * LEAVERS STAY LISTED
 *   This is the admin screen, so it reads `allEmployees` — the list that still
 *   includes people who have left. Everywhere else takes the active list: a
 *   leaver in a payroll total is a wrong number. Here, somebody who left last
 *   month may still owe an advance, and a person you cannot find is a person
 *   whose record gets typed in a second time.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, UserPlus, Pencil, Wallet, Store, Scale } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, Select, PreviewNote, SourceNote,
  useEmployees, isHeadOffice, isHourly, attHours, money, num, text,
  monthKey, monthBounds, monthLabel, fetchAll,
  type Employee, type Col, type Row,
} from "@/components/retail/kit";
import { EmployeeStatement, balancesByEmployee } from "@/components/retail/LedgerScreen";

type Scope = "shops" | "ho";

const BLANK = {
  name: "", branch_id: "", designation: "Sales Person", phone: "",
  monthly_salary: "", pay_type: "monthly", hourly_rate: "", active: true,
};

/** Hours to "7h 30m", so a figure that pays money is readable at a glance. */
const hm = (h: number) => `${Math.floor(h)}h ${Math.round((h - Math.floor(h)) * 60)}m`;

export default function EmployeesScreen({ scope }: { scope: Scope }) {
  const { allEmployees, branches, reloadEmployees } = useEmployees(scope);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ledger, setLedger] = useState<Row[]>([]);
  const [att, setAtt] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountFor, setAccountFor] = useState<Employee | null>(null);

  const month = monthKey();

  /* Head office staff live on the Head Office branch; shop staff on everything
     else. The picker only offers the branches this screen is responsible for,
     so nobody accidentally files a shop salesman under Head Office. */
  const pickable = useMemo(
    () => branches.filter((b) => (scope === "ho" ? isHeadOffice(b) : !isHeadOffice(b))),
    [branches, scope]
  );
  const branchName = useCallback(
    (id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—",
    [branches]
  );

  const ids = useMemo(() => allEmployees.map((e) => e.id), [allEmployees]);

  /* ── load ──────────────────────────────────────────────────────────────
   * The ledger is read ALL-TIME, because an advance given in March is still
   * owed in September; the attendance is read for the current month, because
   * that is the month being paid. Both are paged — PostgREST caps a plain
   * response at 1000 rows without saying so, and a truncated ledger would
   * report somebody as owing less than they do.
   */
  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    if (ids.length === 0) { setLedger([]); setAtt([]); setLoading(false); return; }
    setLoading(true);
    const [from, to] = monthBounds(month);
    const [led, atn] = await Promise.all([
      fetchAll<Row>((a, b) =>
        supabase!.from("retail_employee_ledger")
          .select("employee_id,advance,purchase_credit,paid")
          .in("employee_id", ids).range(a, b)),
      fetchAll<Row>((a, b) =>
        supabase!.from("retail_attendance")
          .select("employee_id,att_date,time_in,time_out")
          .in("employee_id", ids).gte("att_date", from).lte("att_date", to).range(a, b)),
    ]);
    if (led.error || atn.error) setErr(led.error || atn.error);
    setLedger(led.rows);
    setAtt(atn.rows);
    setLoading(false);
  }, [ids, month]);
  useEffect(() => { load(); }, [load]);

  /** Hours worked this month, per person. Either time missing means no hours:
   *  somebody clocked in and never out has an incomplete record, not an
   *  unknown number of hours, and guessing one would put money on it. */
  const hours = useMemo(() => {
    const m: Record<number, number> = {};
    att.forEach((a) => {
      const id = Number(a.employee_id);
      m[id] = (m[id] ?? 0) + attHours(a.time_in as string, a.time_out as string);
    });
    return m;
  }, [att]);

  /** What each person owes. Raw — negatives are kept here and floored where
   *  they are used, so the two meanings stay visible to the reader. */
  const balances = useMemo(() => balancesByEmployee(ledger), [ledger]);

  /** The month's earnings. Ported from empEarned. */
  const earned = useCallback(
    (e: Employee) => (isHourly(e) ? Math.round(num(e.hourly_rate) * (hours[e.id] ?? 0)) : num(e.monthly_salary)),
    [hours]
  );
  /* Floored at zero — see the note at the top of this file. */
  const owed = useCallback((e: Employee) => Math.max(0, balances[e.id] ?? 0), [balances]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allEmployees
      .filter((e) => showInactive || e.active !== false)
      .filter((e) => !needle || e.name.toLowerCase().includes(needle) || (e.designation ?? "").toLowerCase().includes(needle));
  }, [allEmployees, q, showInactive]);

  const totals = useMemo(() => {
    const sal = rows.reduce((t, e) => t + earned(e), 0);
    const ow = rows.reduce((t, e) => t + owed(e), 0);
    return { sal, ow, net: sal - ow };
  }, [rows, earned, owed]);

  const stats = useMemo(() => {
    const active = allEmployees.filter((e) => e.active !== false);
    const monthly = active.filter((e) => !isHourly(e));
    return [
      { label: "On the books", value: String(active.length), Icon: Users },
      { label: "Monthly paid", value: String(monthly.length), Icon: Wallet },
      { label: "Monthly wage bill", value: money(monthly.reduce((t, e) => t + num(e.monthly_salary), 0)), Icon: Store },
      { label: "Advances owed", value: money(active.reduce((t, e) => t + owed(e), 0)), Icon: Scale },
    ];
  }, [allEmployees, owed]);

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
    { head: "Name", cell: (e) => (
        <div>
          <span className="font-semibold">{e.name}</span>
          {e.active === false && <span className="ml-2"><Pill>Left</Pill></span>}
          {isHourly(e) && (
            <div className="text-[11px] text-muted dark:text-[#a89f93]">
              {hm(hours[e.id] ?? 0)} @ {money(e.hourly_rate)}/hr
            </div>
          )}
        </div>
      ) },
    { head: "Designation", muted: true, cell: (e) => text(e.designation) },
    { head: scope === "ho" ? "Office" : "Branch", cell: (e) => branchName(e.branch_id) },
    { head: "Phone", muted: true, cell: (e) => text(e.phone) },
    { head: "Pay", cell: (e) => isHourly(e) ? <Pill tone="warn">Hourly</Pill> : <Pill tone="info">Monthly</Pill> },
    { head: "Rate", right: true, cell: (e) => isHourly(e)
        ? (e.hourly_rate == null ? "—" : money(e.hourly_rate) + " /hr")
        : money(e.monthly_salary) },
    /* The two figures payday actually needs. */
    { head: "Advance owed", right: true, cell: (e) => {
        const o = owed(e);
        return o > 0.001 ? <span className="font-semibold text-danger">{money(o)}</span> : <span className="text-muted dark:text-[#a89f93]">—</span>;
      } },
    { head: "Net to pay", right: true, bold: true, cell: (e) => money(earned(e) - owed(e)) },
    { head: "", right: true, cell: (e) => (
        <div className="flex justify-end gap-1.5">
          <button onClick={() => setAccountFor(e)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
            Account
          </button>
          <button onClick={() => startEdit(e)} className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white" aria-label={`Edit ${e.name}`}>
            <Pencil size={15} />
          </button>
        </div>
      ) },
  ];

  return (
    <Shell>
      <PageHeader
        title={scope === "ho" ? "Head Office Employees" : "Employees"}
        subtitle={scope === "ho" ? "The head office team, their pay type and what is left to pay them." : "Shop staff across the branches, their pay type and what is left to pay them."}
        onRefresh={load} loading={loading}
      >
        <button onClick={startAdd} className={btnPrimary}><UserPlus size={15} /> Add employee</button>
      </PageHeader>

      <StatCards stats={stats} loading={loading} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or designation"
          className="min-w-[200px] flex-1 rounded-full border border-line bg-surface px-4 py-2 text-[13px] text-ink outline-none transition focus:border-ink/30 dark:border-white/10 dark:bg-white/[0.06] dark:text-white sm:max-w-xs" />
        <Select value={showInactive ? "all" : "active"} onChange={(v) => setShowInactive(v === "all")}>
          <option value="active">Active only</option>
          <option value="all">Including left</option>
        </Select>
      </div>

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}

      <DataTable cols={cols} rows={rows} loading={loading} minWidth={1080}
        empty={`No ${scope === "ho" ? "head office" : "shop"} employees yet — add the first one above.`}
        footer={
          <tr className="text-ink dark:text-[#f4f1ea]">
            {/* The salary total is written into the label rather than under
                "Rate": adding up hourly rates and monthly salaries in one
                column would be a total of two different units. */}
            <td className="px-4 py-3 font-bold" colSpan={6}>
              Total · {rows.length} staff · salary {money(totals.sal)}
            </td>
            <td className="px-4 py-3 text-right font-bold tabular-nums text-danger">{money(totals.ow)}</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{money(totals.net)}</td>
            <td className="px-4 py-3" />
          </tr>
        } />

      <SourceNote>
        Pay type decides how a month is valued. <strong>Monthly</strong> pays the full salary, flat — days
        present do not scale it, and an absence is handled as a deduction in the ledger where somebody has
        to decide it. <strong>Hourly</strong> is rate × real hours for {monthLabel(month)}, added up from the
        time in and time out on each attendance row, so an hourly person with no times recorded earns
        nothing. <strong>Advance owed</strong> is (advances + purchase credit) − repaid across the whole
        ledger, floored at zero, and <strong>net to pay</strong> is the salary less that. Tap
        {" "}<strong>Account</strong> for the entries behind the figure.
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
                <option value="monthly">Monthly — full salary</option>
                <option value="hourly">Hourly — paid on real hours</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly salary"><input type="number" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} className={inputCls} /></Field>
            <Field label="Hourly rate"><input type="number" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} className={inputCls} placeholder="—" disabled={form.pay_type !== "hourly"} /></Field>
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

      {/* The same statement the Ledger screen opens — one implementation, so the
          two screens can never disagree about what somebody owes. */}
      {accountFor && (
        <EmployeeStatement
          employee={accountFor}
          branchName={branchName(accountFor.branch_id)}
          onClose={() => setAccountFor(null)}
          onSaved={load}
        />
      )}

      <PreviewNote />
    </Shell>
  );
}
