"use client";
/* Head Office daily cash flow.
 *
 * WHAT THIS IS
 *   Money moving in and out of the office itself, separate from any shop. Cash
 *   sent up from a branch arrives here as an "in"; a supplier paid from the
 *   office safe is an "out". The shops' own cash book never sees either.
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
import { ArrowDownRight, ArrowUpRight, Scale, Plus, ArrowLeftRight, Trash2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, PreviewNote, SourceNote,
  money, num, text, today, type Row, type Col,
} from "@/components/retail/kit";

const CATS_IN = ["From branch", "Owner injection", "Refund received", "Other in"];
const CATS_OUT = ["Supplier payment", "Salary", "Rent", "Utilities", "Purchase", "Other out"];

export default function HoCashflowPage() {
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ flow_date: today(), direction: "in", category: CATS_IN[0], amount: "", description: "" });

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let q = supabase.from("retail_ho_cashflow")
      .select("id,flow_date,direction,category,amount,description")
      .order("flow_date", { ascending: false, nullsFirst: false }).limit(1000);
    if (from) q = q.gte("flow_date", from);
    if (to) q = q.lte("flow_date", to);
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct]);
  useEffect(() => { load(); }, [load]);

  const tot = useMemo(() => {
    const ins = rows.filter((r) => String(r.direction).toLowerCase() === "in").reduce((t, r) => t + num(r.amount), 0);
    const outs = rows.filter((r) => String(r.direction).toLowerCase() === "out").reduce((t, r) => t + num(r.amount), 0);
    return { ins, outs, net: ins - outs };
  }, [rows]);

  const stats = [
    { label: "Cash in", value: money(tot.ins), Icon: ArrowDownRight },
    { label: "Cash out", value: money(tot.outs), Icon: ArrowUpRight },
    { label: "Net movement", value: money(tot.net), Icon: Scale },
    { label: "Entries", value: rows.length.toLocaleString(), Icon: ArrowLeftRight },
  ];

  async function save() {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { setErr("Enter an amount above zero."); return; }
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("retail_ho_cashflow").insert({
      flow_date: form.flow_date, direction: form.direction,
      category: form.category, amount: amt,
      description: form.description.trim() || null,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setOpen(false);
    setForm((f) => ({ ...f, amount: "", description: "" }));
    load();
  }

  async function remove(id: unknown) {
    if (!supabase) return;
    const { error } = await supabase.from("retail_ho_cashflow").delete().eq("id", Number(id));
    if (error) { setErr(error.message); return; }
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  const cols: Col<Row>[] = [
    { head: "Date", muted: true, cell: (r) => text(r.flow_date) },
    { head: "Direction", cell: (r) => (String(r.direction).toLowerCase() === "in" ? <Pill tone="good">In</Pill> : <Pill tone="warn">Out</Pill>) },
    { head: "Category", cell: (r) => text(r.category) },
    { head: "Description", muted: true, cell: (r) => text(r.description) },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.amount) },
    { head: "", right: true, cell: (r) => (
        <button onClick={() => remove(r.id)} aria-label="Delete entry"
          className="rounded-full p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger dark:text-[#a89f93] dark:hover:bg-white/[0.06]">
          <Trash2 size={15} />
        </button>
      ) },
  ];

  return (
    <Shell>
      <PageHeader title="Head Office Cash Flow" subtitle="Money in and out of the office itself — no shop tills involved."
        onRefresh={load} loading={loading}>
        <button onClick={() => { setErr(""); setOpen(true); }} className={btnPrimary}><Plus size={15} /> New entry</button>
      </PageHeader>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} />
      <StatCards stats={stats} loading={loading} />

      <DataTable cols={cols} rows={rows} loading={loading} err={err} minWidth={760}
        empty="No office cash movement in this range." />

      <SourceNote>
        Every figure above is a sum of the rows below it — nothing is stored as a running total.
        That is deliberate: the old app pre-filled its Head Office dialog from a rendered figure
        that mixed a stored column with an imported one, and re-added the same Nimbus expenses on
        every save until the total read 79,080 instead of 19,770.
      </SourceNote>

      <Modal open={open} onClose={() => setOpen(false)} title="Office cash movement"
        subtitle="One direction per entry. A transfer is two entries, which is what makes both sides visible.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" value={form.flow_date} onChange={(e) => setForm({ ...form, flow_date: e.target.value })} className={inputCls} /></Field>
            <Field label="Direction">
              <select value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value, category: e.target.value === "in" ? CATS_IN[0] : CATS_OUT[0] })}
                className={inputCls}>
                <option value="in">In — money arriving</option>
                <option value="out">Out — money leaving</option>
              </select>
            </Field>
          </div>
          <Field label="Category">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
              {(form.direction === "in" ? CATS_IN : CATS_OUT).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Amount"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} autoFocus /></Field>
          <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder="Who, or what for" /></Field>
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
