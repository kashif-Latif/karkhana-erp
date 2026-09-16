"use client";
/* Expenses — and income, which is the same table with txn_type flipped.
 *
 * WHY ONE SCREEN FOR BOTH
 *   A shop's day produces a handful of outgoings and, occasionally, money
 *   coming in that is not a sale: a refund from a supplier, a deposit returned.
 *   Splitting them into two screens means the second one is opened twice a
 *   month and forgotten, and the cash book then disagrees with the till by an
 *   amount nobody can find.
 *
 * NIMBUS ROWS ARE READ-ONLY
 *   Rows with source='nimbus' came from the POS import and carry a dedupe_key.
 *   The next import replaces the ground it covers, so an edit made here would
 *   be silently reverted. Change it in Nimbus and re-import.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { NotebookPen, Plus, ArrowDownRight, ArrowUpRight, Scale, Trash2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Tabs, Pill, BranchPicker, PreviewNote, SourceNote,
  useBranches, money, num, text, today, type Row, type Col,
} from "@/components/retail/kit";

type Tab = "all" | "expense" | "income";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "expense", label: "Expenses" },
  { key: "income", label: "Income" },
];
const PAID_VIA = ["cash", "jazzcash", "meezan_card", "bank", "other"];
const PAID_LABEL: Record<string, string> = {
  cash: "Cash", jazzcash: "JazzCash", meezan_card: "Card", bank: "Bank", other: "Other",
};

export default function ExpensesPage() {
  const { branches, branchName } = useBranches();
  const [tab, setTab] = useState<Tab>("all");
  const [branch, setBranch] = useState("");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    branch_id: "", expense_date: today(), txn_type: "expense",
    category: "", description: "", amount: "", paid_via: "cash",
  });

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.from("retail_expense_categories").select("id,name").eq("active", true).order("sort_order")
      .then(({ data }) => setCats((data as { id: number; name: string }[]) ?? []));
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let q = supabase.from("retail_expenses")
      .select("id,branch_id,expense_date,category,description,amount,paid_via,txn_type,source")
      .order("expense_date", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (from) q = q.gte("expense_date", from);
    if (to) q = q.lte("expense_date", to);
    if (branch) q = q.eq("branch_id", Number(branch));
    if (tab !== "all") q = q.eq("txn_type", tab);
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, branch, tab]);
  useEffect(() => { load(); }, [load]);

  const tot = useMemo(() => {
    const out = rows.filter((r) => String(r.txn_type) !== "income").reduce((t, r) => t + num(r.amount), 0);
    const inn = rows.filter((r) => String(r.txn_type) === "income").reduce((t, r) => t + num(r.amount), 0);
    return { out, inn, net: inn - out };
  }, [rows]);

  const stats = [
    { label: "Expenses", value: money(tot.out), Icon: ArrowUpRight },
    { label: "Income", value: money(tot.inn), Icon: ArrowDownRight },
    { label: "Net", value: money(tot.net), Icon: Scale },
    { label: "Entries", value: rows.length.toLocaleString(), Icon: NotebookPen },
  ];

  async function save() {
    const amt = Number(form.amount);
    if (!form.branch_id) { setErr("Pick a branch."); return; }
    if (!form.category) { setErr("Pick a category."); return; }
    if (!amt || amt <= 0) { setErr("Enter an amount above zero."); return; }
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("retail_expenses").insert({
      branch_id: Number(form.branch_id),
      expense_date: form.expense_date,
      category: form.category,
      description: form.description.trim() || null,
      amount: amt,
      paid_via: form.paid_via,
      txn_type: form.txn_type,
      source: "manual",
      /* No dedupe_key on a manual row, deliberately. Two identical Rs 500 tea
         expenses on the same day are two real expenses; the partial unique
         index only covers source='nimbus' for exactly this reason. */
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setOpen(false);
    setForm((f) => ({ ...f, description: "", amount: "" }));
    load();
  }

  async function remove(id: unknown, source: unknown) {
    if (String(source) === "nimbus") return;
    if (!supabase) return;
    const { error } = await supabase.from("retail_expenses").delete().eq("id", Number(id));
    if (error) { setErr(error.message); return; }
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  const cols: Col<Row>[] = [
    { head: "Date", muted: true, cell: (r) => text(r.expense_date) },
    { head: "Branch", bold: true, cell: (r) => branchName(r.branch_id) },
    { head: "Type", cell: (r) => (String(r.txn_type) === "income" ? <Pill tone="good">Income</Pill> : <Pill tone="warn">Expense</Pill>) },
    { head: "Category", cell: (r) => text(r.category) },
    { head: "Description", muted: true, cell: (r) => text(r.description) },
    { head: "Paid via", muted: true, cell: (r) => PAID_LABEL[String(r.paid_via)] ?? text(r.paid_via) },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.amount) },
    { head: "", right: true, cell: (r) => (
        String(r.source) === "nimbus"
          ? <Pill tone="info">Nimbus</Pill>
          : <button onClick={() => remove(r.id, r.source)} aria-label="Delete entry"
              className="rounded-full p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger dark:text-[#a89f93] dark:hover:bg-white/[0.06]">
              <Trash2 size={15} />
            </button>
      ) },
  ];

  return (
    <Shell>
      <PageHeader title="Expenses" subtitle="Shop outgoings and the money that comes in without being a sale."
        onRefresh={load} loading={loading}>
        <BranchPicker branches={branches} value={branch} onChange={setBranch} />
        <button onClick={() => { setForm((f) => ({ ...f, branch_id: branch || f.branch_id, category: f.category || cats[0]?.name || "" })); setErr(""); setOpen(true); }} className={btnPrimary}>
          <Plus size={15} /> New entry
        </button>
      </PageHeader>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <StatCards stats={stats} loading={loading} />

      <DataTable cols={cols} rows={rows} loading={loading} err={err} minWidth={980}
        empty="No entries in this range." />

      <SourceNote>
        Rows marked <strong>Nimbus</strong> came from the POS import and cannot be edited here —
        the next import replaces the ground it covers, so a change made on this screen would be
        reverted without telling anyone. Fix it in Nimbus and re-import.
      </SourceNote>

      <Modal open={open} onClose={() => setOpen(false)} title="New entry"
        subtitle="Expense or income, for one branch, on one day.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch">
              <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className={inputCls}>
                <option value="">Pick a branch</option>
                {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={form.txn_type} onChange={(e) => setForm({ ...form, txn_type: e.target.value })} className={inputCls}>
                <option value="expense">Expense — money out</option>
                <option value="income">Income — money in</option>
              </select>
            </Field>
            <Field label="Category">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
                <option value="">Pick a category</option>
                {cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder="What it was for" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} autoFocus /></Field>
            <Field label="Paid via">
              <select value={form.paid_via} onChange={(e) => setForm({ ...form, paid_via: e.target.value })} className={inputCls}>
                {PAID_VIA.map((p) => <option key={p} value={p}>{PAID_LABEL[p]}</option>)}
              </select>
            </Field>
          </div>
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
