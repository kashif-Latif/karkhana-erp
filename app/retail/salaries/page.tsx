"use client";
/* MONTH-END PAYROLL — the screen where money actually leaves the business.
 *
 * WHAT THIS REPLACED
 *   A read-only viewer. It listed retail_salary_payments rows and could not
 *   create one, so payroll was run somewhere else and typed in later — which
 *   means the advance deductions were done by hand, on paper, by memory.
 *
 * THE THREE RULES THAT MATTER, IN ORDER
 *
 *   1. SALARY
 *        hourly  → round(hourly_rate × hours actually worked this month)
 *        monthly → the flat monthly_salary, whatever the attendance says
 *      An hourly person with no time in / time out recorded earns nothing.
 *      That is not a bug: a clocked-in-never-out row is an incomplete record,
 *      and guessing the hours would be putting money on a guess.
 *
 *   2. OWED is all-time, not this month
 *        owed = Σ (advance + purchase_credit − paid) over EVERY ledger row
 *      An advance given in March is still owed in September. Scoping this to
 *      the month would quietly forgive every older advance.
 *
 *   3. THE CAP — advToDeduct = Math.min(owed, salary)
 *      Never deduct more than the person earned. Without the cap, somebody who
 *      owes 40,000 against a 30,000 salary is handed a negative payslip and
 *      told to bring 10,000 to work. The debt does not vanish — it stays in the
 *      ledger and comes off next month's salary, and the month after that.
 *      A cap is the difference between a deduction and a confiscation.
 *
 * HOW THE DEDUCTION IS RECORDED — READ THIS BEFORE CHANGING ANYTHING
 *   Paying somebody does NOT delete or zero the advance rows they are settling.
 *   It INSERTS a new ledger row whose `paid` equals the amount deducted.
 *   Because outstanding is computed as Σ(advance + purchase_credit − paid) and
 *   never stored, that one insert drops the balance by exactly the deducted
 *   amount. So:
 *     · the same advance can never be deducted twice — the balance already fell
 *     · the history stays intact — you can still see the advance AND the day it
 *       was settled, which is what an employee asks about when they disagree
 *   Editing the original rows instead would destroy the second property and
 *   still be no safer about the first.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Wallet, HandCoins, Banknote, CheckCircle2, Printer, Undo2, Plus } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, Tabs, Pill, BranchPicker, MonthPicker,
  PreviewNote, SourceNote, fetchAll, useEmployees,
  isHourly, attHours, isSunday, money, num, text, today, monthKey, monthBounds, monthLabel,
  type Row, type Col, type Employee,
} from "@/components/retail/kit";

type Tab = "payroll" | "wages";

/** One employee's month, fully costed. Everything the row, the pay dialog and
 *  the slip need, computed once so the three of them cannot disagree. */
type PayRow = {
  e: Employee;
  hours: number;
  salary: number;
  owed: number;
  advToDeduct: number;
  netPayable: number;
  /** The retail_salary_payments row, if this month has already been paid. */
  rec: Row | null;
};

const BLANK_PAY = { salary: "", adv: "", net: "", paid_on: today(), note: "" };
const BLANK_WAGE = { employee_id: "", pay_date: today(), amount: "", adv: "", note: "" };

export default function SalariesPage() {
  /* `employees` is active staff only — a leaver in a payroll total is a wrong
     number. `allEmployees` includes them, and is used only to put a name on a
     historic wage payout, because history has to stay readable after somebody
     leaves. */
  const { employees, allEmployees, branches } = useEmployees("all");
  const [tab, setTab] = useState<Tab>("payroll");
  const [month, setMonth] = useState(monthKey());
  const [branch, setBranch] = useState("");

  const [att, setAtt] = useState<Row[]>([]);
  const [ledger, setLedger] = useState<Row[]>([]);
  const [pays, setPays] = useState<Row[]>([]);
  const [wages, setWages] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [wagesLoading, setWagesLoading] = useState(true);
  const [err, setErr] = useState("");

  const [payFor, setPayFor] = useState<PayRow | null>(null);
  const [payForm, setPayForm] = useState({ ...BLANK_PAY });
  const [undoFor, setUndoFor] = useState<PayRow | null>(null);
  const [slipFor, setSlipFor] = useState<PayRow | null>(null);
  const [wageOpen, setWageOpen] = useState(false);
  const [wageForm, setWageForm] = useState({ ...BLANK_WAGE });
  const [saving, setSaving] = useState(false);

  const branchName = useCallback(
    (id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—",
    [branches]
  );
  const empName = useCallback(
    (id: unknown) => allEmployees.find((e) => e.id === Number(id))?.name ?? "—",
    [allEmployees]
  );

  /* Only people still working here, and only the chosen branch. A leaver in a
     payroll total is a wrong number; useEmployees has already dropped them. */
  const people = useMemo(
    () => employees.filter((e) => !branch || String(e.branch_id) === branch),
    [employees, branch]
  );
  const ids = useMemo(() => people.map((p) => p.id), [people]);

  /* ── load ──────────────────────────────────────────────────────────────
   * Three reads, and two of them page.
   *
   * PostgREST caps a plain response at 1000 rows. A truncated LEDGER would
   * under-state what somebody owes, so the run would hand over money that
   * should have been deducted — and nobody checks a payslip that looks
   * plausible. A truncated ATTENDANCE month would under-pay hourly staff for
   * the same silent reason. Both page through fetchAll.
   */
  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    if (ids.length === 0) { setAtt([]); setLedger([]); setPays([]); setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = monthBounds(month);

    const [attRes, ledRes, payRes] = await Promise.all([
      fetchAll<Row>((a, b) =>
        supabase!.from("retail_attendance")
          .select("employee_id,att_date,status,time_in,time_out")
          .in("employee_id", ids).gte("att_date", from).lte("att_date", to)
          .order("att_date", { ascending: true }).range(a, b)),
      /* ALL TIME on purpose — see rule 2 at the top of this file. */
      fetchAll<Row>((a, b) =>
        supabase!.from("retail_employee_ledger")
          .select("id,employee_id,entry_date,advance,purchase_credit,paid,purchase_details,source")
          .in("employee_id", ids)
          .order("entry_date", { ascending: true }).order("id", { ascending: true }).range(a, b)),
      supabase.from("retail_salary_payments")
        .select("id,employee_id,pay_month,salary_amount,advance_deducted,net_paid,paid_on,note,ledger_entry_id")
        .eq("pay_month", month).in("employee_id", ids),
    ]);

    const e = attRes.error || ledRes.error || payRes.error?.message || "";
    if (e) setErr(e);
    setAtt(attRes.rows);
    setLedger(ledRes.rows);
    setPays((payRes.data as Row[]) ?? []);
    setLoading(false);
  }, [ids, month]);
  useEffect(() => { load(); }, [load]);

  const loadWages = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setWagesLoading(false); return; }
    setWagesLoading(true);
    const { data, error } = await supabase.from("retail_wage_payments")
      .select("id,employee_id,pay_date,amount,note")
      .order("pay_date", { ascending: false, nullsFirst: false }).limit(500);
    setWagesLoading(false);
    if (error) { setErr(error.message); return; }
    setWages((data as Row[]) ?? []);
  }, []);
  useEffect(() => { if (tab === "wages") loadWages(); }, [tab, loadWages]);

  /* ── the numbers ───────────────────────────────────────────────────────── */

  /** Hours worked this month, per employee, from real time in / time out. */
  const hoursBy = useMemo(() => {
    const m: Record<number, number> = {};
    att.forEach((a) => {
      const id = Number(a.employee_id);
      m[id] = (m[id] ?? 0) + attHours(a.time_in as string, a.time_out as string);
    });
    return m;
  }, [att]);

  /** What each person still owes, all time. Never stored — a stored balance
   *  and a list of entries WILL disagree one day, and then nobody can tell
   *  which of the two is lying. */
  const owedBy = useMemo(() => {
    const m: Record<number, number> = {};
    ledger.forEach((l) => {
      const id = Number(l.employee_id);
      m[id] = (m[id] ?? 0) + num(l.advance) + num(l.purchase_credit) - num(l.paid);
    });
    return m;
  }, [ledger]);

  const payBy = useMemo(() => {
    const m: Record<number, Row> = {};
    pays.forEach((p) => { m[Number(p.employee_id)] = p; });
    return m;
  }, [pays]);

  const rows: PayRow[] = useMemo(() => people.map((e) => {
    const hours = hoursBy[e.id] ?? 0;
    const salary = isHourly(e) ? Math.round(num(e.hourly_rate) * hours) : num(e.monthly_salary);
    /* A negative balance means the person is in credit — they have handed back
       more than they took. There is nothing to deduct, so floor it at zero
       rather than paying them a bonus by accident. */
    const owed = Math.max(0, owedBy[e.id] ?? 0);
    const advToDeduct = Math.min(owed, salary); // THE CAP — rule 3.
    return { e, hours, salary, owed, advToDeduct, netPayable: salary - advToDeduct, rec: payBy[e.id] ?? null };
  }), [people, hoursBy, owedBy, payBy]);

  /* Once a month is paid the recorded figures win. The live calculation would
     drift the moment somebody adds a backdated advance, and a payslip that
     changes after it was handed over is not a payslip. */
  const totals = useMemo(() => rows.reduce((t, r) => ({
    salary: t.salary + r.salary,
    adv: t.adv + (r.rec ? num(r.rec.advance_deducted) : r.advToDeduct),
    net: t.net + (r.rec ? num(r.rec.net_paid) : r.netPayable),
    paid: t.paid + (r.rec ? num(r.rec.net_paid) : 0),
  }), { salary: 0, adv: 0, net: 0, paid: 0 }), [rows]);

  const stats = tab === "payroll"
    ? [
        { label: "Total salary", value: money(totals.salary), Icon: Wallet },
        { label: "Advances deducted", value: money(totals.adv), Icon: HandCoins },
        { label: "Net payable", value: money(totals.net), Icon: Banknote },
        { label: "Paid so far", value: money(totals.paid), Icon: CheckCircle2 },
      ]
    : [
        { label: "Wages paid", value: money(wages.reduce((t, w) => t + num(w.amount), 0)), Icon: HandCoins },
        { label: "Payouts", value: String(wages.length), Icon: Banknote },
        { label: "People paid", value: String(new Set(wages.map((w) => Number(w.employee_id))).size), Icon: Wallet },
        { label: "Latest", value: text(wages[0]?.pay_date), Icon: CheckCircle2 },
      ];

  /* ── paying somebody ───────────────────────────────────────────────────── */

  function startPay(r: PayRow) {
    setPayForm({
      salary: String(Math.round(r.salary)),
      adv: String(Math.round(r.advToDeduct)),
      net: String(Math.round(r.netPayable)),
      paid_on: today(),
      note: "",
    });
    setErr(""); setPayFor(r);
  }

  /** Net follows salary and advance as they are typed, and is clamped at zero —
   *  a negative net is a demand for money, not a payslip. */
  function recalc(next: { salary: string; adv: string }) {
    return String(Math.max(0, Math.round(num(next.salary) - num(next.adv))));
  }

  async function pay() {
    if (!payFor || !supabase) return;
    const sal = num(payForm.salary);
    const adv = num(payForm.adv);
    const net = num(payForm.net);
    const paid_on = payForm.paid_on || today();
    setSaving(true); setErr("");

    /* ── WRITE 1 of 2 — the offsetting ledger row ────────────────────────
     * `paid` = the amount deducted. This does NOT touch the advance rows it
     * settles. Because outstanding is Σ(advance + purchase_credit − paid),
     * this single insert drops the balance by exactly `adv`, so the same
     * advance can never be deducted again next month, and both the advance
     * and its settlement stay readable in the history.
     */
    let ledgerId: number | null = null;
    if (adv > 0) {
      const { data, error } = await supabase.from("retail_employee_ledger").insert({
        employee_id: payFor.e.id,
        entry_date: paid_on,
        advance: 0,
        purchase_credit: 0,
        paid: adv,
        purchase_details: `Deducted from ${monthLabel(month)} salary`,
        source: "salary",
      }).select("id").maybeSingle();
      if (error) { setSaving(false); setErr(error.message); return; }
      ledgerId = data ? Number((data as Row).id) : null;
    }

    /* ── WRITE 2 of 2 — the payslip record ───────────────────────────────
     * It carries ledger_entry_id so Undo knows which ledger row belongs to it.
     */
    const { error } = await supabase.from("retail_salary_payments").insert({
      employee_id: payFor.e.id,
      pay_month: month,
      salary_amount: sal,
      advance_deducted: adv,
      net_paid: net,
      paid_on,
      note: payForm.note.trim() || null,
      ledger_entry_id: ledgerId,
    });

    if (error) {
      /* ── MANUAL ROLLBACK — the whole reason the writes are in this order ──
       * There is no transaction across two PostgREST calls. If the payslip
       * fails and the ledger row is left behind, the employee's balance has
       * dropped by `adv` with no payment to account for it: the advance has
       * been silently forgiven and nobody will ever notice, because the only
       * evidence is a balance that looks slightly better than it should.
       * Deleting the ledger row puts the debt back. Doing the writes the other
       * way round would make this rollback impossible — the ledger insert
       * would be the one failing, after the payslip already said it happened.
       */
      if (ledgerId != null) await supabase.from("retail_employee_ledger").delete().eq("id", ledgerId);
      setSaving(false);
      setErr(error.message + " — nothing was deducted.");
      return;
    }
    setSaving(false); setPayFor(null); load();
  }

  /** Undo is the rollback, done on purpose: ledger row first, payslip second.
   *  Deleting the payslip first would strand the ledger row with nothing
   *  pointing at it, and the deduction would be permanent and untraceable. */
  async function undo() {
    if (!undoFor?.rec || !supabase) return;
    setSaving(true); setErr("");
    const rec = undoFor.rec;
    if (rec.ledger_entry_id != null) {
      const { error } = await supabase.from("retail_employee_ledger").delete().eq("id", Number(rec.ledger_entry_id));
      if (error) { setSaving(false); setErr(error.message); return; }
    }
    const { error } = await supabase.from("retail_salary_payments").delete().eq("id", Number(rec.id));
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setUndoFor(null); load();
  }

  /* ── wages ─────────────────────────────────────────────────────────────── */

  async function saveWage() {
    if (!supabase) return;
    const amt = num(wageForm.amount);
    if (!wageForm.employee_id) { setErr("Pick an employee."); return; }
    if (amt <= 0) { setErr("Enter a wage amount above zero."); return; }
    const empId = Number(wageForm.employee_id);
    const dt = wageForm.pay_date || today();
    /* Never cut more advance than the wage covers, for the same reason as the
       salary cap: a wage packet cannot be negative. */
    const advCut = Math.min(Math.max(0, num(wageForm.adv)), amt, Math.max(0, owedBy[empId] ?? 0));
    setSaving(true); setErr("");

    const { error } = await supabase.from("retail_wage_payments").insert({
      employee_id: empId, pay_date: dt, amount: amt, note: wageForm.note.trim() || null,
    });
    if (error) { setSaving(false); setErr(error.message); return; }

    /* The advance cut goes in second on purpose. If THIS fails the wage is
       still recorded and the advance simply has not been cut — the error runs
       in the direction of the employee still owing the money, which somebody
       will notice. The other order would forgive a debt on a failure. */
    if (advCut > 0) {
      const { error: e2 } = await supabase.from("retail_employee_ledger").insert({
        employee_id: empId, entry_date: dt, advance: 0, purchase_credit: 0, paid: advCut,
        purchase_details: "advance deducted from wages", source: "repayment",
      });
      if (e2) { setSaving(false); setErr("Wage saved, but the advance was not cut: " + e2.message); loadWages(); load(); return; }
    }
    setSaving(false); setWageOpen(false); setWageForm({ ...BLANK_WAGE }); loadWages(); load();
  }

  /* ── table ─────────────────────────────────────────────────────────────── */

  const cols: Col<PayRow>[] = [
    { head: "Name", bold: true, cell: (r) => (
        <div>
          <div>{r.e.name}</div>
          {isHourly(r.e) && (
            <div className="text-[11.5px] font-medium text-muted dark:text-[#a89f93]">
              {r.hours.toFixed(1)} h @ {money(r.e.hourly_rate)}/hr
            </div>
          )}
        </div>
      ) },
    { head: "Branch", muted: true, cell: (r) => branchName(r.e.branch_id) },
    { head: "Salary", right: true, cell: (r) => (r.salary ? money(r.salary) : "—") },
    { head: "Advances", right: true, cell: (r) => {
        const a = r.rec ? num(r.rec.advance_deducted) : r.advToDeduct;
        if (!a) return "—";
        return (
          <span className="font-semibold text-danger">
            −{money(a)}
            {/* A capped deduction is worth saying out loud: the rest is not
                forgiven, it comes off next month. */}
            {!r.rec && r.owed > r.salary && (
              <span className="block text-[11px] font-medium text-muted dark:text-[#a89f93]">
                capped · {money(r.owed - r.advToDeduct)} still owed
              </span>
            )}
          </span>
        );
      } },
    { head: "Net payable", right: true, bold: true, cell: (r) => money(r.rec ? num(r.rec.net_paid) : r.netPayable) },
    { head: "Status", cell: (r) => r.rec
        ? <Pill tone="good">Paid{r.rec.paid_on ? ` · ${String(r.rec.paid_on)}` : ""}</Pill>
        : <Pill>Unpaid</Pill> },
    { head: "", right: true, cell: (r) => (
        <div className="flex justify-end gap-1.5">
          {r.rec
            ? <button onClick={() => { setErr(""); setUndoFor(r); }} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]"><Undo2 size={13} className="inline" /> Undo</button>
            : <button onClick={() => startPay(r)} className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-[#141414]">Pay</button>}
          <button onClick={() => setSlipFor(r)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">Slip</button>
        </div>
      ) },
  ];

  const wageCols: Col<Row>[] = [
    { head: "Date", muted: true, cell: (w) => text(w.pay_date) },
    { head: "Employee", bold: true, cell: (w) => empName(w.employee_id) },
    { head: "Amount", right: true, bold: true, cell: (w) => money(w.amount) },
    { head: "Note", muted: true, cell: (w) => text(w.note) },
  ];

  return (
    <Shell>
      <PageHeader
        title="Salary"
        subtitle={tab === "payroll"
          ? "Run the month. Net payable = salary − advances already owed, capped at what was earned."
          : "Wage payouts — daily or a few days at a time, outside the monthly run."}
        onRefresh={() => { load(); if (tab === "wages") loadWages(); }} loading={loading}
      >
        {tab === "payroll" && <MonthPicker value={month} onChange={setMonth} />}
        {/* The branch filter shows on both tabs on purpose. It scopes the data
            this page loads — including the ledger the wage dialog reads an
            employee's outstanding advance from — so a filter that were active
            but invisible on the Wages tab would quietly narrow that list. */}
        {branches.length > 1 && <BranchPicker branches={branches} value={branch} onChange={setBranch} />}
        {tab === "wages" && (
          <button onClick={() => { setWageForm({ ...BLANK_WAGE }); setErr(""); setWageOpen(true); }} className={btnPrimary}>
            <Plus size={15} /> Record wage
          </button>
        )}
      </PageHeader>

      <Tabs tabs={[{ key: "payroll" as const, label: "Payroll run" }, { key: "wages" as const, label: "Wages" }]}
        value={tab} onChange={setTab} />

      <StatCards stats={stats} loading={loading} />

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}

      {tab === "payroll" ? (
        <DataTable cols={cols} rows={rows} loading={loading} minWidth={920}
          empty="No active staff here yet — add them under Employee ▸ Employees."
          footer={
            <tr className="text-ink dark:text-[#f4f1ea]">
              <td className="px-4 py-3 font-bold" colSpan={2}>Total · {rows.length} staff</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{money(totals.salary)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums text-danger">{totals.adv ? "−" + money(totals.adv) : "—"}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{money(totals.net)}</td>
              <td className="px-4 py-3" colSpan={2} />
            </tr>
          } />
      ) : (
        <DataTable cols={wageCols} rows={wages} loading={wagesLoading} minWidth={640}
          empty="No wage payouts recorded yet." />
      )}

      <SourceNote>
        Salary is <strong>hours × rate</strong> for hourly staff and the flat <strong>monthly salary</strong>
        {" "}for everyone else. <strong>Advances</strong> is everything still owed across the whole ledger — not
        just this month — capped at what was earned, so a payslip can never come out negative; anything above
        the cap stays owed and comes off next month. Recording a payment writes a matching <strong>paid</strong>
        {" "}row into the ledger rather than editing the advance, which is what stops the same advance being
        deducted twice while keeping both halves of the story visible.
      </SourceNote>

      {/* ── pay dialog ─────────────────────────────────────────────────── */}
      <Modal open={!!payFor} onClose={() => setPayFor(null)}
        title={payFor ? `Pay ${payFor.e.name}` : ""}
        subtitle={`${monthLabel(month)} · advances owed are deducted, the net is the cash to hand over.`}>
        {payFor && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Salary">
                <input type="number" value={payForm.salary} className={inputCls}
                  onChange={(e) => setPayForm((f) => {
                    const next = { ...f, salary: e.target.value };
                    return { ...next, net: recalc(next) };
                  })} />
              </Field>
              <Field label="Advance deducted">
                <input type="number" value={payForm.adv} className={inputCls}
                  onChange={(e) => setPayForm((f) => {
                    const next = { ...f, adv: e.target.value };
                    return { ...next, net: recalc(next) };
                  })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Net paid">
                <input type="number" value={payForm.net} className={inputCls}
                  onChange={(e) => setPayForm({ ...payForm, net: e.target.value })} />
              </Field>
              <Field label="Paid on">
                <input type="date" value={payForm.paid_on} className={inputCls}
                  onChange={(e) => setPayForm({ ...payForm, paid_on: e.target.value })} />
              </Field>
            </div>
            <Field label="Note">
              <input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} className={inputCls} placeholder="Optional" />
            </Field>

            <p className="rounded-xl2 bg-panel/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink dark:bg-white/[0.04] dark:text-[#e7e2d8]">
              Owes <strong>{money(payFor.owed)}</strong> in total.
              {payFor.owed > payFor.salary
                ? <> Only {money(payFor.advToDeduct)} can come off this month — the rest stays owed.</>
                : null}
              {" "}Hand over <strong>{money(num(payForm.net))}</strong>.
            </p>

            {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setPayFor(null)} className={btnGhost}>Cancel</button>
              <button onClick={pay} disabled={saving} className={btnPrimary}>{saving ? "Recording…" : "Record payment"}</button>
            </div>
            {!isSupabaseConfigured && <p className="text-center text-[12px] text-hint">Preview build — nothing will be saved.</p>}
          </div>
        )}
      </Modal>

      {/* ── undo dialog ────────────────────────────────────────────────── */}
      <Modal open={!!undoFor} onClose={() => setUndoFor(null)}
        title={undoFor ? `Undo ${undoFor.e.name}'s salary?` : ""}
        subtitle="The payslip is removed and the deducted advance goes back onto their balance.">
        <div className="space-y-3.5">
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setUndoFor(null)} className={btnGhost}>Keep it</button>
            <button onClick={undo} disabled={saving} className={btnPrimary}>{saving ? "Undoing…" : "Undo payment"}</button>
          </div>
        </div>
      </Modal>

      {/* ── wage dialog ────────────────────────────────────────────────── */}
      <Modal open={wageOpen} onClose={() => setWageOpen(false)} title="Record a wage payout"
        subtitle="A payout outside the monthly run — one day or several at once.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employee">
              {/* `people`, not every employee: the outstanding advance shown
                  below comes from the ledger this page loaded, which is scoped
                  to these ids. Offering somebody outside that scope would show
                  them as owing nothing. */}
              <select value={wageForm.employee_id} onChange={(e) => setWageForm({ ...wageForm, employee_id: e.target.value })} className={inputCls}>
                <option value="">Pick someone</option>
                {people.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={wageForm.pay_date} onChange={(e) => setWageForm({ ...wageForm, pay_date: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Wage amount">
              <input type="number" value={wageForm.amount} onChange={(e) => setWageForm({ ...wageForm, amount: e.target.value })} className={inputCls} placeholder="e.g. 1000" />
            </Field>
            <Field label="Cut from advance">
              <input type="number" value={wageForm.adv} onChange={(e) => setWageForm({ ...wageForm, adv: e.target.value })} className={inputCls} placeholder="0" />
            </Field>
          </div>
          {wageForm.employee_id && (owedBy[Number(wageForm.employee_id)] ?? 0) > 0 && (
            <p className="rounded-xl2 bg-panel/60 px-3.5 py-2.5 text-[12.5px] text-ink dark:bg-white/[0.04] dark:text-[#e7e2d8]">
              Owes <strong>{money(Math.max(0, owedBy[Number(wageForm.employee_id)] ?? 0))}</strong>. Anything cut here is
              settling an old loan, so only <strong>{money(Math.max(0, num(wageForm.amount) - Math.min(num(wageForm.adv), num(wageForm.amount))))}</strong> actually changes hands.
            </p>
          )}
          <Field label="Note">
            <input value={wageForm.note} onChange={(e) => setWageForm({ ...wageForm, note: e.target.value })} className={inputCls} placeholder="e.g. 3 days" />
          </Field>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setWageOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={saveWage} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Record payout"}</button>
          </div>
        </div>
      </Modal>

      {/* ── slip ───────────────────────────────────────────────────────── */}
      <Modal open={!!slipFor} onClose={() => setSlipFor(null)}
        title={slipFor ? `Salary slip — ${slipFor.e.name}` : ""} subtitle={monthLabel(month)} wide>
        {slipFor && (
          <Slip r={slipFor} month={month} att={att} ledger={ledger} branchName={branchName(slipFor.e.branch_id)}
            onClose={() => setSlipFor(null)} />
        )}
      </Modal>

      <PreviewNote />
    </Shell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE SLIP
 *
 * The thing an employee is handed and the thing they argue with. It has to
 * show the working, not the conclusion: every day of the month with what it
 * was counted as, and every advance with the balance after it. A slip that
 * only says "net 24,300" settles no argument.
 *
 * It reads the data the page already loaded rather than re-querying, so the
 * slip and the row it was opened from cannot show different numbers.
 *
 * WHY IT IS DRAWN TWICE
 *   Once inside the dialog, to look at, and once through a portal hung
 *   directly off <body>, to print. The dialog is a viewport-height box with
 *   its own scrollbar sitting inside a fixed overlay — print it in place and
 *   the browser hands you the first screenful and throws the rest away. The
 *   portalled copy has no such ancestors: it is a direct child of <body>, and
 *   the print rule simply hides every sibling. Same React element rendered in
 *   two places, so the two can never say different things.
 *
 * WHY IT IS ALWAYS A WHITE SHEET
 *   Deliberately no dark: variants anywhere below. A payslip is a piece of
 *   paper. In dark mode the app's near-white text would come out invisible on
 *   an actual page, and a "preview" that does not look like the print is not a
 *   preview — so the slip is a white sheet on screen too.
 * ═══════════════════════════════════════════════════════════════════════════ */

const PRINT_CSS = `
.rt-slip-print { display: none; }
@media print {
  body > *:not(.rt-slip-print) { display: none !important; }
  .rt-slip-print {
    display: block !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page { margin: 12mm; }
}
`;

function Slip({ r, month, att, ledger, branchName, onClose }: {
  r: PayRow; month: string; att: Row[]; ledger: Row[]; branchName: string; onClose: () => void;
}) {
  const hourly = isHourly(r.e);
  const [, to] = monthBounds(month);
  const last = Number(to.slice(8, 10));

  /* document.body does not exist while this renders on the server, so the
     print copy waits for the mount. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mine = useMemo(
    () => att.filter((a) => Number(a.employee_id) === r.e.id),
    [att, r.e.id]
  );
  const timed = useMemo(() => mine.filter((a) => a.time_in || a.time_out), [mine]);
  const byDate = useMemo(() => {
    const m: Record<string, Row> = {};
    mine.forEach((a) => { m[String(a.att_date)] = a; });
    return m;
  }, [mine]);

  const totHours = useMemo(
    () => mine.reduce((t, a) => t + attHours(a.time_in as string, a.time_out as string), 0),
    [mine]
  );

  /* Sundays only count up to today in the current month. Crediting the whole
     month's Sundays on the 3rd shows a person paid for days that have not
     happened yet, which is the sort of number that gets a screen distrusted. */
  const endDay = month === monthKey() ? Math.min(last, Number(today().slice(8, 10))) : last;

  const days = useMemo(() => {
    const out: { d: number; ds: string; label: string; tone: string }[] = [];
    for (let d = 1; d <= last; d++) {
      const ds = `${month}-${String(d).padStart(2, "0")}`;
      const st = String(byDate[ds]?.status ?? "");
      if (d > endDay && !st) continue; // a day that has not happened is not an absence
      const [label, tone] =
        st === "present" ? ["Present", "text-success"] :
        st === "half" ? ["Half", "text-amber-strong"] :
        st === "absent" ? ["Absent", "text-danger"] :
        isSunday(ds) ? ["Sunday · paid", "text-periwinkle-strong"] :
        ["—", "text-hint"];
      out.push({ d, ds, label, tone });
    }
    return out;
  }, [byDate, month, last, endDay]);

  const tally = useMemo(() => {
    let pres = 0, half = 0, abs = 0, sun = 0;
    for (let d = 1; d <= last; d++) {
      const ds = `${month}-${String(d).padStart(2, "0")}`;
      const st = String(byDate[ds]?.status ?? "");
      if (st === "present") pres++; else if (st === "half") half++; else if (st === "absent") abs++;
      if (isSunday(ds) && d <= endDay) sun++;
    }
    /* Counted days: a half day is half a day, and Sunday is paid without ever
       being marked. This is the figure a monthly person checks first. */
    return { pres, half, abs, sun, counted: Math.round((pres + 0.5 * half + sun) * 100) / 100 };
  }, [byDate, month, last, endDay]);

  /** The whole ledger for this person with a running balance — the column
   *  somebody points at when they say the deduction is wrong. */
  const ledRows = useMemo(() => {
    let bal = 0;
    return ledger.filter((l) => Number(l.employee_id) === r.e.id).map((l) => {
      bal += num(l.advance) + num(l.purchase_credit) - num(l.paid);
      return { l, bal };
    });
  }, [ledger, r.e.id]);

  /* A paid month shows what was actually paid, not what today's data would
     recompute — a payslip that changes after it was handed over is not one. */
  const earned = r.rec ? num(r.rec.salary_amount) : r.salary;
  const deducted = r.rec ? num(r.rec.advance_deducted) : r.advToDeduct;
  const net = r.rec ? num(r.rec.net_paid) : r.netPayable;

  const th = "px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted";
  const td = "px-3 py-1.5 text-[12px]";

  const sheet = (
    <div className="rounded-xl2 border border-line bg-white p-5 text-ink">
      <div className="border-b border-line pb-3">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted">Salary slip</div>
        <div className="mt-1 text-[19px] font-extrabold tracking-tight">{r.e.name}</div>
        <div className="text-[12.5px] text-muted">
          {[text(r.e.designation, ""), branchName, monthLabel(month)].filter(Boolean).join(" · ")}
        </div>
      </div>

      {/* ── the three figures ──────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <div className="rounded-xl2 border border-line bg-panel p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            {hourly ? "Earned (hrs × rate)" : "Monthly salary"}
          </div>
          <div className="mt-1 text-[17px] font-extrabold tabular-nums">{money(earned)}</div>
          {hourly && <div className="text-[11px] text-muted">{totHours.toFixed(1)} h × {money(r.e.hourly_rate)}/hr</div>}
        </div>
        <div className="rounded-xl2 border border-line bg-danger-soft p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-danger">Advance deducted</div>
          <div className="mt-1 text-[17px] font-extrabold tabular-nums">{money(deducted)}</div>
          {r.owed > deducted && <div className="text-[11px] text-muted">{money(r.owed - deducted)} still owed</div>}
        </div>
        <div className="rounded-xl2 border border-line bg-success-soft p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-success">Net {r.rec ? "paid" : "payable"}</div>
          <div className="mt-1 text-[19px] font-extrabold tabular-nums">{money(net)}</div>
          {r.rec?.paid_on ? <div className="text-[11px] text-muted">on {String(r.rec.paid_on)}</div> : null}
        </div>
      </div>

      {/* ── attendance ─────────────────────────────────────────────────── */}
      <h4 className="mt-5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
        Attendance — {monthLabel(month)}
      </h4>

      {hourly ? (
        <div className="mt-2 overflow-hidden rounded-xl2 border border-line">
          <table className="w-full">
            <thead className="border-b border-line bg-panel">
              <tr><th className={th}>Date</th><th className={th}>In</th><th className={th}>Out</th><th className={`${th} text-right`}>Hours</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {timed.map((a, i) => (
                <tr key={i}>
                  <td className={td}>{text(a.att_date)}</td>
                  <td className={td}>{text(a.time_in)}</td>
                  <td className={td}>{text(a.time_out)}</td>
                  <td className={`${td} text-right tabular-nums`}>{attHours(a.time_in as string, a.time_out as string).toFixed(2)}</td>
                </tr>
              ))}
              {timed.length === 0 && (
                <tr><td className={`${td} text-center text-muted`} colSpan={4}>No hours recorded this month — an hourly person with no times earns nothing.</td></tr>
              )}
            </tbody>
            <tfoot className="border-t-2 border-line">
              <tr className="font-bold">
                <td className={td} colSpan={3}>Total hours</td>
                <td className={`${td} text-right tabular-nums`}>{totHours.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[12px]">
            <strong className="text-success">Present {tally.pres}</strong>
            {" · "}<span className="text-amber-strong">Half {tally.half}</span>
            {" · "}<span className="text-danger">Absent {tally.abs}</span>
            {" · "}<span className="text-periwinkle-strong">Sundays {tally.sun}</span>
            {" · "}<strong>Counted {tally.counted} days</strong>
          </p>
          <div className="mt-2 overflow-hidden rounded-xl2 border border-line">
            <table className="w-full">
              <thead className="border-b border-line bg-panel">
                <tr><th className={th}>Date</th><th className={th}>Day</th><th className={th}>Status</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {days.map((d) => (
                  <tr key={d.d}>
                    <td className={td}>{String(d.d).padStart(2, "0")} {new Date(d.ds + "T00:00:00").toLocaleDateString("en-GB", { month: "short" })}</td>
                    <td className={`${td} text-muted`}>{new Date(d.ds + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" })}</td>
                    <td className={`${td} font-semibold ${d.tone}`}>{d.label}</td>
                  </tr>
                ))}
                {days.length === 0 && (
                  <tr><td className={`${td} text-center text-muted`} colSpan={3}>Nothing marked this month.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── ledger ─────────────────────────────────────────────────────── */}
      <h4 className="mt-5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
        Advance ledger · outstanding {money(r.owed)}
      </h4>
      <div className="mt-2 overflow-hidden rounded-xl2 border border-line">
        <table className="w-full">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className={th}>Date</th><th className={th}>Details</th>
              <th className={`${th} text-right`}>Advance</th><th className={`${th} text-right`}>Credit</th>
              <th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ledRows.map(({ l, bal }, i) => (
              <tr key={i}>
                <td className={td}>{text(l.entry_date)}</td>
                <td className={`${td} text-muted`}>{text(l.purchase_details, num(l.paid) > 0 ? "repayment" : "advance")}</td>
                <td className={`${td} text-right tabular-nums`}>{num(l.advance) ? money(l.advance) : "—"}</td>
                <td className={`${td} text-right tabular-nums`}>{num(l.purchase_credit) ? money(l.purchase_credit) : "—"}</td>
                <td className={`${td} text-right tabular-nums text-success`}>{num(l.paid) ? money(l.paid) : "—"}</td>
                <td className={`${td} text-right font-bold tabular-nums`}>{money(bal)}</td>
              </tr>
            ))}
            {ledRows.length === 0 && (
              <tr><td className={`${td} text-center text-muted`} colSpan={6}>No advances.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-hint">Generated {today()}</p>
    </div>
  );

  return (
    <>
      <style>{PRINT_CSS}</style>
      {sheet}
      {/* The print copy — hidden on screen, the only thing on the page in print. */}
      {mounted && createPortal(<div className="rt-slip-print">{sheet}</div>, document.body)}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className={btnGhost}>Close</button>
        <button onClick={() => window.print()} className={btnPrimary}><Printer size={15} /> Print</button>
      </div>
    </>
  );
}
