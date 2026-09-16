"use client";
/* ADVANCE REPAYMENTS — collecting the money back, a little at a time.
 *
 * WHY THIS IS NOT JUST THE LEDGER SCREEN
 *   The ledger answers "what happened". This answers "who do I collect from
 *   today, and how much". It is used standing up, by somebody with a cash box,
 *   going down a list of names — so every row already knows the amount before
 *   it is asked, and the only decision left is whether the person actually
 *   paid.
 *
 * THE PLAN IS PRE-FILLED ON PURPOSE
 *   repay_freq / repay_amount on retail_employees are the agreement: 200 a day,
 *   1,500 a week. The box arrives holding that number so the person collecting
 *   does not have to remember twenty different arrangements, and so the number
 *   that gets typed is the number that was agreed. It stays editable, because
 *   some days somebody pays less.
 *
 * source = 'repayment' — THE ONE FIELD THAT CANNOT BE WRONG
 *   Every row written here carries source='repayment', never 'manual'.
 *   "Collected this month" is defined as the sum of `paid` on rows where
 *   source='repayment', so the tag is the only thing separating a collection
 *   from a salary deduction or an imported row that also happens to have a
 *   `paid` figure. Write 'manual' instead and the money is still on the
 *   balance — the debt is right — but it vanishes from the collection total,
 *   and there is nothing in the row to tell it apart afterwards. That is
 *   unrecoverable without asking a human what each row actually was.
 *
 * WHY OUTSTANDING IS SUMMED EVERY TIME
 *   outstanding = Σ (advance + purchase_credit − paid), all time, never stored.
 *   A stored balance and a list of entries WILL disagree eventually, and when
 *   they do nobody can tell which one is lying.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, HandCoins, Users, CalendarClock, Trash2, Check } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, BranchPicker, MonthPicker,
  PreviewNote, SourceNote, fetchAll, useEmployees, isHeadOffice,
  money, num, text, today, monthKey, monthBounds, monthLabel,
  type Row, type Col, type Employee,
} from "@/components/retail/kit";

type Scope = "shops" | "ho";

/** The agreement, as the employee row stores it. 'none' is the default and
 *  means there is no arrangement — the person pays when they pay. */
const FREQS = [
  { key: "none", label: "No plan", unit: "" },
  { key: "daily", label: "Daily", unit: "day" },
  { key: "weekly", label: "Weekly", unit: "week" },
  { key: "monthly", label: "Monthly", unit: "month" },
] as const;

const unitOf = (f?: string | null) => FREQS.find((x) => x.key === (f ?? "none"))?.unit ?? "";
const hasPlan = (e: Employee) => (e.repay_freq ?? "none") !== "none" && num(e.repay_amount) > 0;

/** A balance is "settled" below a rupee. Floating point makes an exactly-repaid
 *  advance land on 0.0000001 often enough that == 0 would strand rows on the
 *  list forever, so the whole screen tests against 0.001. */
const OPEN = 0.001;

export default function RepaymentScreen({ scope }: { scope: Scope }) {
  const { employees, branches, reloadEmployees } = useEmployees(scope);
  const [month, setMonth] = useState(monthKey());
  const [branch, setBranch] = useState("");
  const [ledger, setLedger] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState<number | "del" | null>(null);

  /** What the collector has typed into a row, before it is saved. Keyed by
   *  employee so two open rows cannot overwrite each other. */
  const [drafts, setDrafts] = useState<Record<number, { amount?: string; date?: string }>>({});
  /** Same idea for the plan amount, which is edited in place in its cell. */
  const [planDrafts, setPlanDrafts] = useState<Record<number, string>>({});
  const [delFor, setDelFor] = useState<Row | null>(null);

  /* Head office staff sit on the head office branch, shop staff on everything
     else. The picker only offers the branches this screen is responsible for. */
  const pickable = useMemo(
    () => branches.filter((b) => (scope === "ho" ? isHeadOffice(b) : !isHeadOffice(b))),
    [branches, scope]
  );
  const branchName = useCallback(
    (id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—",
    [branches]
  );
  const empName = useCallback(
    (id: unknown) => employees.find((e) => e.id === Number(id))?.name ?? "—",
    [employees]
  );

  const people = useMemo(
    () => employees.filter((e) => !branch || String(e.branch_id) === branch),
    [employees, branch]
  );
  const ids = useMemo(() => people.map((p) => p.id), [people]);

  /* ── load ──────────────────────────────────────────────────────────────
   * All-time, and paged. PostgREST caps a plain response at 1000 rows and
   * does not say so; a truncated ledger would report someone as owing less
   * than they do, and the collector would stop asking. fetchAll pages.
   */
  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    if (ids.length === 0) { setLedger([]); setLoading(false); return; }
    setLoading(true); setErr("");
    const { rows, error } = await fetchAll<Row>((a, b) =>
      supabase!.from("retail_employee_ledger")
        .select("id,employee_id,entry_date,advance,purchase_credit,paid,purchase_details,source")
        .in("employee_id", ids)
        .order("entry_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(a, b));
    if (error) setErr(error);
    setLedger(rows);
    setLoading(false);
  }, [ids]);
  useEffect(() => { load(); }, [load]);

  /* ── the numbers ───────────────────────────────────────────────────────── */

  const owedBy = useMemo(() => {
    const m: Record<number, number> = {};
    ledger.forEach((l) => {
      const id = Number(l.employee_id);
      m[id] = (m[id] ?? 0) + num(l.advance) + num(l.purchase_credit) - num(l.paid);
    });
    return m;
  }, [ledger]);

  /** Rows tagged as collections — the definition "collected this month" and the
   *  recent list both rest on. Nothing else in the ledger counts, however much
   *  it looks like a repayment. */
  const repayments = useMemo(
    () => ledger.filter((l) => String(l.source) === "repayment"),
    [ledger]
  );

  const collected = useMemo(() => {
    const [from, to] = monthBounds(month);
    return repayments.reduce((t, l) => {
      const d = String(l.entry_date ?? "");
      return d >= from && d <= to ? t + num(l.paid) : t;
    }, 0);
  }, [repayments, month]);

  const totalOutstanding = useMemo(
    () => Object.values(owedBy).reduce((t, v) => t + Math.max(0, v), 0),
    [owedBy]
  );

  /* Somebody belongs on this list if they still owe money, or if there is a
     plan running against them — a plan with a zero balance is worth seeing,
     because it means the arrangement should probably be closed. */
  const due = useMemo(
    () => people.filter((e) => (owedBy[e.id] ?? 0) > OPEN || hasPlan(e)),
    [people, owedBy]
  );

  const recent = useMemo(() => repayments.slice(0, 60), [repayments]);

  const stats = [
    { label: "Total outstanding", value: money(totalOutstanding), Icon: Coins },
    { label: `Collected in ${monthLabel(month)}`, value: money(collected), Icon: HandCoins },
    { label: "People owing", value: String(people.filter((e) => (owedBy[e.id] ?? 0) > OPEN).length), Icon: Users },
    { label: "Plans running", value: String(people.filter(hasPlan).length), Icon: CalendarClock },
  ];

  /* ── writing ───────────────────────────────────────────────────────────── */

  const amountFor = (e: Employee) =>
    drafts[e.id]?.amount ?? (hasPlan(e) ? String(Math.round(num(e.repay_amount))) : "");
  const dateFor = (e: Employee) => drafts[e.id]?.date ?? today();
  const setDraft = (id: number, patch: { amount?: string; date?: string }) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  async function record(e: Employee) {
    if (!supabase) return;
    const amt = num(amountFor(e));
    if (amt <= 0) { setErr(`Enter an amount for ${e.name}.`); return; }
    setSaving(e.id); setErr("");
    const { error } = await supabase.from("retail_employee_ledger").insert({
      employee_id: e.id,
      entry_date: dateFor(e) || today(),
      advance: 0,
      purchase_credit: 0,
      paid: amt,
      purchase_details: "advance deduction",
      /* MUST be 'repayment'. See the note at the top of this file — this tag is
         the only thing that makes "collected this month" possible, and there is
         no way to work out afterwards what a mistagged row was meant to be. */
      source: "repayment",
    });
    setSaving(null);
    if (error) { setErr(error.message); return; }
    /* Clear the row's draft so it goes back to showing the plan amount for the
       next collection rather than the one just taken. */
    setDrafts((d) => { const c = { ...d }; delete c[e.id]; return c; });
    load();
  }

  async function removeRepayment() {
    if (!delFor || !supabase) return;
    setSaving("del"); setErr("");
    const { error } = await supabase.from("retail_employee_ledger").delete().eq("id", Number(delFor.id));
    setSaving(null);
    if (error) { setErr(error.message); return; }
    setDelFor(null); load();
  }

  /** The plan amount as the cell should show it: what is being typed, or what
   *  the employee row already holds. */
  const planAmountFor = (e: Employee) =>
    planDrafts[e.id] ?? (e.repay_amount == null ? "" : String(Math.round(num(e.repay_amount))));

  /** The plan is edited in place, in its own cell — changing the frequency
   *  saves at once, the amount saves when the box is left. The agreement is
   *  usually changed in the same breath as collecting ("make it 300 from
   *  Monday"), so sending that through a dialog would put a click between the
   *  conversation and the record of it. */
  async function savePlan(e: Employee, patch: { freq?: string; amount?: string }) {
    if (!supabase) return;
    const freq = patch.freq ?? e.repay_freq ?? "none";
    const raw = patch.amount ?? planAmountFor(e);
    /* 'none' clears the amount too. A frequency of none with an amount still
       sitting behind it is an arrangement that looks cancelled and is not, and
       the next person to turn the plan back on gets a figure nobody agreed. */
    const repay_amount = freq === "none" || raw === "" ? null : Number(raw);
    if (freq === (e.repay_freq ?? "none") && repay_amount === (e.repay_amount ?? null)) return; // nothing changed
    setSaving(e.id); setErr("");
    const { error } = await supabase.from("retail_employees")
      .update({ repay_freq: freq, repay_amount }).eq("id", e.id);
    setSaving(null);
    if (error) { setErr(error.message); return; }
    setPlanDrafts((d) => { const c = { ...d }; delete c[e.id]; return c; });
    reloadEmployees();
  }

  /* ── tables ────────────────────────────────────────────────────────────── */

  const showBranch = pickable.length > 1 && !branch;

  const cols: Col<Employee>[] = [
    { head: "Employee", bold: true, cell: (e) => e.name },
    ...(showBranch ? [{ head: "Branch", muted: true, cell: (e: Employee) => branchName(e.branch_id) }] : []),
    { head: "Outstanding", right: true, cell: (e) => {
        const out = owedBy[e.id] ?? 0;
        /* Below a rupee there is nothing to collect — saying "Rs 0" next to a
           Record button invites somebody to collect it anyway. */
        if (out <= OPEN) return <Pill tone="good">Settled</Pill>;
        return <span className="font-bold text-danger">{money(out)}</span>;
      } },
    { head: "Plan", cell: (e) => {
        const freq = e.repay_freq ?? "none";
        return (
          <div className="flex items-center gap-1.5">
            <select value={freq} onChange={(ev) => savePlan(e, { freq: ev.target.value })}
              aria-label={`Repayment frequency for ${e.name}`}
              className="rounded-xl2 border border-line bg-canvas px-2 py-1.5 text-[12px] font-semibold text-ink outline-none transition focus:border-ink/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
              {FREQS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <input type="number" inputMode="numeric" value={planAmountFor(e)} disabled={freq === "none"}
              aria-label={`Repayment amount for ${e.name}`}
              onChange={(ev) => setPlanDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
              /* Saved on blur rather than on every keystroke — "200" typed one
                 digit at a time would otherwise write a plan of 2, then 20. */
              onBlur={() => savePlan(e, { amount: planAmountFor(e) })}
              onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur(); }}
              placeholder={freq === "none" ? "—" : "200"}
              className="w-[74px] rounded-xl2 border border-line bg-canvas px-2 py-1.5 text-right text-[12.5px] tabular-nums text-ink outline-none transition focus:border-ink/30 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-white" />
            {freq !== "none" && <span className="text-[11.5px] text-muted dark:text-[#a89f93]">/{unitOf(freq)}</span>}
          </div>
        );
      } },
    { head: "Amount", cell: (e) => (
        <input type="number" inputMode="numeric" value={amountFor(e)}
          onChange={(ev) => setDraft(e.id, { amount: ev.target.value })}
          placeholder="e.g. 200"
          className="w-[110px] rounded-xl2 border border-line bg-canvas px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none transition focus:border-ink/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-white" />
      ) },
    { head: "Date", cell: (e) => (
        <input type="date" value={dateFor(e)} max={today()}
          onChange={(ev) => setDraft(e.id, { date: ev.target.value })}
          className="w-[148px] rounded-xl2 border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-ink/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-white" />
      ) },
    { head: "", right: true, cell: (e) => (
        <button onClick={() => record(e)} disabled={saving === e.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-[#141414]">
          <Check size={13} /> {saving === e.id ? "Saving…" : "Record"}
        </button>
      ) },
  ];

  const recentCols: Col<Row>[] = [
    { head: "Date", muted: true, cell: (l) => text(l.entry_date) },
    { head: "Employee", bold: true, cell: (l) => empName(l.employee_id) },
    { head: "Details", muted: true, cell: (l) => text(l.purchase_details, "advance deduction") },
    { head: "Collected", right: true, bold: true, cell: (l) => money(l.paid) },
    { head: "", right: true, cell: (l) => (
        <button onClick={() => { setErr(""); setDelFor(l); }} aria-label="Delete repayment"
          className="rounded-full p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger dark:text-[#a89f93] dark:hover:bg-white/[0.06]">
          <Trash2 size={15} />
        </button>
      ) },
  ];

  return (
    <Shell>
      <PageHeader
        title={scope === "ho" ? "Head Office Repayments" : "Advance Repayments"}
        subtitle="Collect advances back, daily or weekly. Each entry drops what the person still owes."
        onRefresh={load} loading={loading}
      >
        <MonthPicker value={month} onChange={setMonth} />
        {pickable.length > 1 && <BranchPicker branches={pickable} value={branch} onChange={setBranch} />}
      </PageHeader>

      <StatCards stats={stats} loading={loading} />

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}

      <h2 className="mt-7 text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Collect today</h2>
      <DataTable cols={cols} rows={due} loading={loading} minWidth={showBranch ? 1140 : 1000}
        empty="Nobody owes anything and no plan is running. People appear here the moment an advance is given on the Ledger screen." />

      <h2 className="mt-8 text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Recent repayments</h2>
      <DataTable cols={recentCols} rows={recent} loading={loading} minWidth={720}
        empty="No repayments recorded yet." />

      <SourceNote>
        Outstanding is <strong>(advances + purchase credit) − repaid</strong> across the whole ledger,
        summed every time this screen loads, so it can never drift from the entries it is made of.
        The amount box arrives holding the agreed <strong>plan</strong> so the same figure is collected
        each time without anyone having to remember it. Every entry saved here is tagged
        {" "}<strong>repayment</strong> — that tag, and nothing else, is what lets the month&apos;s
        collection be counted separately from salary deductions and imported rows.
      </SourceNote>

      {/* ── delete ─────────────────────────────────────────────────────── */}
      <Modal open={!!delFor} onClose={() => setDelFor(null)} title="Delete this repayment?"
        subtitle="The amount goes straight back onto what the person owes.">
        <div className="space-y-3.5">
          {delFor && (
            <p className="rounded-xl2 bg-panel/60 px-3.5 py-2.5 text-[12.5px] text-ink dark:bg-white/[0.04] dark:text-[#e7e2d8]">
              <strong>{empName(delFor.employee_id)}</strong> · {text(delFor.entry_date)} · <strong>{money(delFor.paid)}</strong>
            </p>
          )}
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setDelFor(null)} className={btnGhost}>Keep it</button>
            <button onClick={removeRepayment} disabled={saving === "del"} className={btnPrimary}>{saving === "del" ? "Deleting…" : "Delete"}</button>
          </div>
        </div>
      </Modal>

      <PreviewNote />
    </Shell>
  );
}
