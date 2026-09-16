"use client";
/* HEAD OFFICE DAILY CASH FLOW — a month-scoped ledger with a running balance.
 *
 * WHAT THIS IS
 *   Money moving in and out of the office itself, separate from any shop. Cash
 *   sent up from a branch arrives here as an "in"; the boss taking cash out is
 *   an "out". The shops' own cash books never see either.
 *
 * WHY THERE IS A BALANCE ON THIS SCREEN NOW
 *   The office cash POSITION — opening, closing, and the running balance beside
 *   every row — is the number the End of Day count is checked against. End of
 *   Day computes it as Σ(in) − Σ(out) over this table up to the chosen day, and
 *   reports the difference against the physical count of the safe. Until now
 *   that figure appeared nowhere on the screen that owns the rows behind it, so
 *   when End of Day said "short by 4,000" there was no way to look at the
 *   ledger and see where the position came from. A movement list with no
 *   balance is a receipt book, not a cash book.
 *
 *       opening = Σ over retail_ho_cashflow where flow_date <  month start
 *       closing = opening + total in − total out
 *       each row carries the balance after that row
 *
 *   The month is the unit because that is how the office reconciles; the
 *   opening balance is what carries the history in, so nothing before the 1st
 *   is lost by scoping the table to the month.
 *
 * WHY IT IS NOT PART OF THE CASH BOOK
 *   The cash book is per branch per day and balances against a physical count
 *   in that shop's till. The office is not a till. Folding the two together is
 *   what produced the HO double-count in the old app — a dialog pre-filled from
 *   a rendered total that mixed a stored column with an imported one, adding
 *   the Nimbus Head Office expenses again on every save: 19,770 -> 39,540 ->
 *   59,310 -> 79,080. The lesson stuck: this screen writes one table and reads
 *   one table, and every figure on it is a sum of the rows underneath.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Scale, Plus, Wallet, Trash2, Pencil, PencilLine, Check } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, MonthPicker, PreviewNote, SourceNote,
  money, num, text, today, monthKey, monthBounds, monthLabel, fetchAll, type Col,
} from "@/components/retail/kit";

/* ── the categories, ported verbatim ─────────────────────────────────────────
 * These are the exact strings the existing rows were written with, which is the
 * only reason they are the right list. The invented set this screen shipped
 * with ("From branch", "Owner injection", "Supplier payment", "Rent"…) had a
 * quiet failure mode: an old row still RENDERED its stored category, because
 * rendering just prints the string — but the moment anyone opened that row to
 * correct a typo, its category was not in the dropdown and could never be
 * chosen again. Every edit silently re-filed the entry under whichever invented
 * category happened to be first in the list, and a month of "From Shop" became
 * a month of "From branch" one correction at a time.
 */
const CF_IN = ["Cash From Boss", "Market Return", "From Shop", "Misc"];
const CF_OUT = ["To Boss", "Emp Adv", "Lunch", "Other"];

type CF = {
  id?: number; flow_date?: string; direction?: string | null;
  category?: string | null; amount?: number | null; description?: string | null;
};
/** A row with its place in the running balance worked out. */
type CFRow = CF & { _in: number; _out: number; _bal: number };

const isIn = (r: { direction?: string | null }) => String(r.direction).toLowerCase() === "in";
const signed = (r: { direction?: string | null; amount?: number | null }) =>
  isIn(r) ? num(r.amount) : -num(r.amount);

export default function HoCashflowPage() {
  const [month, setMonth] = useState(monthKey());
  const [rows, setRows] = useState<CF[]>([]);
  const [opening, setOpening] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  /* Delete is destructive and this screen is read far more often than it is
     written, so the buttons that can lose a row are behind a deliberate switch
     — exactly as the original did it. */
  const [editMode, setEditMode] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CF | null>(null);
  const [form, setForm] = useState({ flow_date: today(), direction: "in", category: CF_IN[0], amount: "", description: "" });

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = monthBounds(month);

    /* Everything BEFORE the month, for the opening balance. Only two columns,
       but possibly years of them — so it pages. A `.limit()` here would cap the
       opening balance silently and every balance on the screen would be wrong
       by the same hidden amount. */
    const priorP = fetchAll<CF>((lo, hi) =>
      supabase!.from("retail_ho_cashflow").select("direction,amount")
        .lt("flow_date", from).range(lo, hi));

    /* The month itself, oldest first — the running balance has to be built in
       the order the money actually moved, even though the table reads newest
       first. Tie-broken on id so two entries on the same date keep the order
       they were entered in. */
    const monthP = fetchAll<CF>((lo, hi) =>
      supabase!.from("retail_ho_cashflow").select("id,flow_date,direction,category,amount,description")
        .gte("flow_date", from).lte("flow_date", to)
        .order("flow_date", { ascending: true }).order("id", { ascending: true }).range(lo, hi));

    const [prior, mon] = await Promise.all([priorP, monthP]);
    if (prior.error) setErr(prior.error);
    else if (mon.error) setErr(mon.error);
    setOpening(prior.rows.reduce((t, r) => t + signed(r), 0));
    setRows(mon.rows);
    setLoading(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  /* Chain the balance forward, oldest first, then hand the table the reverse.
     Nothing is stored as a running total — every figure here is a sum of the
     rows underneath it. */
  const { chained, tin, tout, closing } = useMemo(() => {
    let bal = opening, i = 0, o = 0;
    const out: CFRow[] = rows.map((r) => {
      const _in = isIn(r) ? num(r.amount) : 0;
      const _out = isIn(r) ? 0 : num(r.amount);
      i += _in; o += _out; bal += _in - _out;
      return { ...r, _in, _out, _bal: bal };
    });
    return { chained: out.slice().reverse(), tin: i, tout: o, closing: bal };
  }, [rows, opening]);

  const stats = [
    { label: `Opening · ${monthLabel(month)}`, value: money(opening), Icon: Wallet },
    { label: "Cash in", value: money(tin), Icon: ArrowDownRight },
    { label: "Cash out", value: money(tout), Icon: ArrowUpRight },
    { label: "Closing balance", value: money(closing), Icon: Scale },
  ];

  /* The category list for the dialog. When an existing row carries a category
     that is not in the list — an older spelling, or one of the invented ones
     this screen used to write — it is FORCE-PREPENDED so the select can show
     the row's own value. Without that, opening a row to fix its amount also
     rewrites its category to whatever sits at the top of the list, and the
     correction quietly corrupts the classification. */
  const catOptions = useMemo(() => {
    const base = form.direction === "in" ? CF_IN : CF_OUT;
    const cur = form.category?.trim();
    return cur && !base.includes(cur) ? [cur, ...base] : base;
  }, [form.direction, form.category]);

  function startAdd() {
    setErr(""); setEditing(null);
    setForm({ flow_date: today(), direction: "in", category: CF_IN[0], amount: "", description: "" });
    setOpen(true);
  }
  function startEdit(r: CF) {
    setErr(""); setEditing(r);
    setForm({
      flow_date: String(r.flow_date ?? today()),
      direction: isIn(r) ? "in" : "out",
      category: String(r.category ?? ""),
      amount: String(num(r.amount) || ""),
      description: String(r.description ?? ""),
    });
    setOpen(true);
  }

  async function save() {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { setErr("Enter an amount above zero."); return; }
    if (!form.flow_date) { setErr("Pick a date."); return; }
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const rec = {
      flow_date: form.flow_date, direction: form.direction,
      category: form.category || null, amount: amt,
      description: form.description.trim() || null,
    };
    const { error } = editing?.id
      ? await supabase.from("retail_ho_cashflow").update(rec).eq("id", Number(editing.id))
      : await supabase.from("retail_ho_cashflow").insert(rec);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setOpen(false); setEditing(null);
    load();
  }

  async function remove(r: CF) {
    if (!supabase) return;
    if (!window.confirm(`Delete this ${isIn(r) ? "cash in" : "cash out"} of ${money(r.amount)} on ${text(r.flow_date)}?`)) return;
    const { error } = await supabase.from("retail_ho_cashflow").delete().eq("id", Number(r.id));
    if (error) { setErr(error.message); return; }
    load(); // the balance of every row below it has changed, so re-chain
  }

  const cols: Col<CFRow>[] = [
    { head: "Date", muted: true, cell: (r) => text(r.flow_date) },
    { head: "Category", cell: (r) => text(r.category) },
    { head: "Notes", muted: true, cell: (r) => text(r.description) },
    { head: "In", right: true, cell: (r) => (r._in ? <span className="font-semibold text-success">{money(r._in)}</span> : "") },
    { head: "Out", right: true, cell: (r) => (r._out ? <span className="font-semibold text-danger">{money(r._out)}</span> : "") },
    { head: "Balance", right: true, bold: true, cell: (r) => money(r._bal) },
    ...(editMode
      ? [{
          head: "", right: true, cell: (r: CFRow) => (
            <span className="flex justify-end gap-1">
              <button onClick={() => startEdit(r)} aria-label="Edit entry"
                className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white">
                <Pencil size={15} />
              </button>
              <button onClick={() => remove(r)} aria-label="Delete entry"
                className="rounded-full p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger dark:text-[#a89f93] dark:hover:bg-white/[0.06]">
                <Trash2 size={15} />
              </button>
            </span>
          ),
        } as Col<CFRow>]
      : []),
  ];

  const pad = editMode ? <td /> : null;

  return (
    <Shell>
      <PageHeader title="Head Office Cash Flow" subtitle="Money in and out of the office itself — no shop tills involved."
        onRefresh={load} loading={loading}>
        <MonthPicker value={month} onChange={setMonth} />
        <button onClick={() => setEditMode((v) => !v)}
          className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition ${
            editMode
              ? "border-transparent bg-ink text-white dark:bg-white dark:text-[#141414]"
              : "border-line bg-surface text-ink hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]"}`}>
          {editMode ? <><Check size={14} /> Done</> : <><PencilLine size={14} /> Edit mode</>}
        </button>
        <button onClick={startAdd} className={btnPrimary}><Plus size={15} /> New entry</button>
      </PageHeader>

      <StatCards stats={stats} loading={loading} />

      <DataTable cols={cols} rows={chained} loading={loading} err={err} minWidth={820}
        empty={`No office cash movement in ${monthLabel(month)}.`}
        footer={
          <>
            <tr className="bg-panel/60 font-bold text-ink dark:bg-white/[0.04] dark:text-[#f4f1ea]">
              <td className="px-4 py-3" colSpan={3}>Closing balance</td>
              <td className="px-4 py-3 text-right tabular-nums text-success">{money(tin)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-danger">{money(tout)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(closing)}</td>
              {pad}
            </tr>
            <tr className="text-muted dark:text-[#a89f93]">
              <td className="px-4 py-3" colSpan={5}>Opening balance carried forward</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink dark:text-[#f4f1ea]">{money(opening)}</td>
              {pad}
            </tr>
          </>
        } />

      <SourceNote>
        <strong>Closing</strong> is the opening balance plus everything in, less everything out —
        and it is the figure End of Day checks the counted safe against. Nothing is stored as a
        running total: the old app pre-filled its Head Office dialog from a rendered figure that
        mixed a stored column with an imported one, and re-added the same Nimbus expenses on every
        save until the total read 79,080 instead of 19,770.
      </SourceNote>

      <Modal open={open} onClose={() => { setOpen(false); setEditing(null); }}
        title={editing ? "Edit cash movement" : "Office cash movement"}
        subtitle="One direction per entry. A transfer is two entries, which is what makes both sides visible.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" value={form.flow_date} onChange={(e) => setForm({ ...form, flow_date: e.target.value })} className={inputCls} /></Field>
            <Field label="Direction">
              <select value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value, category: e.target.value === "in" ? CF_IN[0] : CF_OUT[0] })}
                className={inputCls}>
                <option value="in">In — money arriving</option>
                <option value="out">Out — money leaving</option>
              </select>
            </Field>
          </div>
          <Field label="Category">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
              {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Amount"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} autoFocus /></Field>
          <Field label="Notes"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder="Who, or what for" /></Field>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setOpen(false); setEditing(null); }} className={btnGhost}>Cancel</button>
            <button onClick={save} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add entry"}
            </button>
          </div>
        </div>
      </Modal>

      <PreviewNote />
    </Shell>
  );
}
