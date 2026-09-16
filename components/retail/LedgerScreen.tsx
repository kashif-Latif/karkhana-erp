"use client";
/* Employee ledger — advances, purchase credit (udhaar), and repayments.
 *
 * WHAT THE THREE COLUMNS MEAN
 *   advance         cash handed over before payday
 *   purchase_credit goods taken from the shop and not paid for
 *   paid            money coming back, either handed in or cut from salary
 *
 * The balance is (advance + purchase_credit) - paid, per person, running from
 * the beginning. It is deliberately not stored anywhere: a stored balance and
 * a list of entries WILL disagree eventually, and when they do nobody can tell
 * which one is lying. Summing the entries every time is slower and correct.
 *
 * Rows imported from Nimbus carry source='nimbus' and a dedupe_key; they are
 * shown but not editable here, because the next import would overwrite the
 * edit and the person who made it would never be told.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { NotebookPen, Plus, HandCoins, ShoppingBag, Scale } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, Select, PreviewNote, SourceNote,
  useEmployees, money, num, text, today, type Row, type Col,
} from "@/components/retail/kit";

type Scope = "shops" | "ho";

export default function LedgerScreen({ scope }: { scope: Scope }) {
  const { employees } = useEmployees(scope);
  const [employeeId, setEmployeeId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employee_id: "", entry_date: today(), kind: "advance", amount: "", details: "", note: "" });

  const ids = useMemo(() => employees.map((e) => e.id), [employees]);
  const empName = (id: unknown) => employees.find((e) => e.id === Number(id))?.name ?? "—";

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    if (ids.length === 0) { setRows([]); setLoading(false); return; }
    setLoading(true); setErr("");
    let q = supabase.from("retail_employee_ledger")
      .select("id,employee_id,entry_date,advance,purchase_credit,purchase_details,paid,note,source")
      .in("employee_id", employeeId ? [Number(employeeId)] : ids)
      .order("entry_date", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (employeeId) q = q.eq("employee_id", Number(employeeId));
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [ids, employeeId]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const adv = rows.reduce((t, r) => t + num(r.advance), 0);
    const cr = rows.reduce((t, r) => t + num(r.purchase_credit), 0);
    const paid = rows.reduce((t, r) => t + num(r.paid), 0);
    return { adv, cr, paid, bal: adv + cr - paid };
  }, [rows]);

  const stats = [
    { label: "Advances", value: money(totals.adv), Icon: HandCoins },
    { label: "Purchase credit", value: money(totals.cr), Icon: ShoppingBag },
    { label: "Repaid", value: money(totals.paid), Icon: NotebookPen },
    { label: "Outstanding", value: money(totals.bal), Icon: Scale },
  ];

  async function save() {
    if (!form.employee_id) { setErr("Pick an employee."); return; }
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { setErr("Enter an amount above zero."); return; }
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("retail_employee_ledger").insert({
      employee_id: Number(form.employee_id),
      entry_date: form.entry_date,
      advance: form.kind === "advance" ? amt : 0,
      purchase_credit: form.kind === "credit" ? amt : 0,
      paid: form.kind === "repay" ? amt : 0,
      purchase_details: form.kind === "credit" ? (form.details.trim() || null) : null,
      note: form.note.trim() || null,
      source: "manual",
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setOpen(false);
    setForm({ employee_id: "", entry_date: today(), kind: "advance", amount: "", details: "", note: "" });
    load();
  }

  const cols: Col<Row>[] = [
    { head: "Date", muted: true, cell: (r) => text(r.entry_date) },
    { head: "Employee", bold: true, cell: (r) => empName(r.employee_id) },
    { head: "Advance", right: true, cell: (r) => (num(r.advance) ? money(r.advance) : "—") },
    { head: "Purchase credit", right: true, cell: (r) => (num(r.purchase_credit) ? money(r.purchase_credit) : "—") },
    { head: "Repaid", right: true, cell: (r) => (num(r.paid) ? money(r.paid) : "—") },
    { head: "Details", muted: true, cell: (r) => text(r.purchase_details ?? r.note) },
    { head: "Source", cell: (r) => (String(r.source) === "nimbus" ? <Pill tone="info">Nimbus</Pill> : <Pill>Manual</Pill>) },
  ];

  return (
    <Shell>
      <PageHeader
        title={scope === "ho" ? "Head Office Ledger" : "Employee Ledger"}
        subtitle="Advances given, goods taken on credit, and what has come back."
        onRefresh={load} loading={loading}
      >
        <Select value={employeeId} onChange={setEmployeeId}>
          <option value="">Everyone</option>
          {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
        </Select>
        <button onClick={() => { setForm((f) => ({ ...f, employee_id: employeeId })); setErr(""); setOpen(true); }} className={btnPrimary}>
          <Plus size={15} /> New entry
        </button>
      </PageHeader>

      <StatCards stats={stats} loading={loading} />

      <DataTable cols={cols} rows={rows} loading={loading} err={err} minWidth={860}
        empty="No ledger entries — advances and purchase credit will appear here."
        footer={
          <tr className="text-ink dark:text-[#f4f1ea]">
            <td className="px-4 py-3 font-bold" colSpan={2}>Outstanding</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{money(totals.adv)}</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{money(totals.cr)}</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{money(totals.paid)}</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums" colSpan={2}>{money(totals.bal)}</td>
          </tr>
        } />

      <SourceNote>
        Outstanding is <strong>(advances + purchase credit) − repaid</strong>, summed from the
        entries above every time this loads. It is never stored, so it cannot drift away from
        the rows it is made of. Nimbus rows are read-only here: the next import would overwrite
        an edit made on this screen without telling anyone.
      </SourceNote>

      <Modal open={open} onClose={() => setOpen(false)} title="New ledger entry"
        subtitle="One entry, one kind. Recording an advance and a repayment together hides which is which.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employee">
              <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className={inputCls}>
                <option value="">Pick someone</option>
                {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Kind">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputCls}>
              <option value="advance">Advance — cash given before payday</option>
              <option value="credit">Purchase credit — goods taken, unpaid</option>
              <option value="repay">Repayment — money coming back</option>
            </select>
          </Field>
          <Field label="Amount"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} autoFocus /></Field>
          {form.kind === "credit" && (
            <Field label="What was taken"><input value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} className={inputCls} placeholder="e.g. 2 shirts, 1 trouser" /></Field>
          )}
          <Field label="Note"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputCls} placeholder="Optional" /></Field>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Add entry"}</button>
          </div>
        </div>
      </Modal>

      <PreviewNote />
    </Shell>
  );
}
