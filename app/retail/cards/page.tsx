"use client";
/* Card reconciliation.
 *
 * THE PROBLEM THIS SCREEN EXISTS FOR
 *   All nine shops' POS terminals settle into ONE pooled Bank Alfalah account,
 *   and the bank credit carries no shop name. So the money arrives as a list of
 *   amounts and the question is always the same: which shop is this one?
 *
 * HOW IT IS ANSWERED
 *   By nearest expected value. For a given day each branch has a card figure
 *   from the sale lines — payment_method = 'meezan_card' and nothing else — and
 *   a credit is offered to the branch whose expected figure it is closest to.
 *   It is a suggestion, never an assignment: the operator confirms. A wrong
 *   automatic match is far more expensive than an unmatched row, because an
 *   unmatched row is visibly unfinished and a wrong one looks done.
 *
 * WHY DUPLICATES CANNOT HAPPEN
 *   Two unique indexes in the database, not a check in this file: one on the
 *   bank's own transaction reference, and one on (date, amount, ref) for rows
 *   that arrive without a reference. Re-uploading the same screenshot is a
 *   no-op. The file hash on retail_card_slip_files stops the upload even
 *   earlier.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Link2, CheckCircle2, AlertTriangle, Landmark } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import RangeBar from "@/components/RangeBar";
import { rangeDates, MONEY_PRESETS } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Tabs, Pill, Select, PreviewNote, SourceNote,
  useBranches, money, num, text, today, type Row, type Col, type Branch,
} from "@/components/retail/kit";

type Tab = "unmatched" | "matched" | "byday";
const TABS: { key: Tab; label: string }[] = [
  { key: "unmatched", label: "Needs a shop" },
  { key: "matched", label: "Matched" },
  { key: "byday", label: "Day by day" },
];

type DayLine = { branch_id: number; date: string; expected: number; received: number };

export default function CardReconPage() {
  const { branches, branchName } = useBranches();
  const [tab, setTab] = useState<Tab>("unmatched");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [settlements, setSettlements] = useState<Row[]>([]);
  const [cardSales, setCardSales] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ credit_date: today(), sale_date: today(), amount: "", ref: "", bank: "Bank Alfalah", branch_id: "", descr: "" });

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);

    let s = supabase.from("retail_card_settlements")
      .select("id,branch_id,credit_date,credit_time,sale_date,amount,ref,bank,descr,source")
      .order("credit_date", { ascending: false, nullsFirst: false }).limit(2000);
    if (from) s = s.gte("credit_date", from);
    if (to) s = s.lte("credit_date", to);

    /* The expected side. 'meezan_card' ONLY — this is the line that decides
       whether the reconciliation is right, and widening it to "anything that
       looks like a card" is how the FC DHA figure went wrong. */
    let c = supabase.from("retail_sale_lines")
      .select("branch_id,sale_date,sales_amount,net_sales")
      .eq("payment_method", "meezan_card").limit(20000);
    if (from) c = c.gte("sale_date", from);
    if (to) c = c.lte("sale_date", to);

    const [sr, cr] = await Promise.all([s, c]);
    if (sr.error || cr.error) setErr(sr.error?.message ?? cr.error?.message ?? "");
    setSettlements((sr.data as Row[]) ?? []);
    setCardSales((cr.data as Row[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct]);
  useEffect(() => { load(); }, [load]);

  /* Expected card money, per branch per day, from the sale lines. */
  const expected = useMemo(() => {
    const m = new Map<string, number>();
    cardSales.forEach((r) => {
      const k = `${Number(r.branch_id)}|${String(r.sale_date)}`;
      m.set(k, (m.get(k) ?? 0) + (num(r.sales_amount) || num(r.net_sales)));
    });
    return m;
  }, [cardSales]);

  const unmatched = useMemo(() => settlements.filter((r) => r.branch_id == null), [settlements]);
  const matched = useMemo(() => settlements.filter((r) => r.branch_id != null), [settlements]);

  /* The suggestion. Card money usually lands the next working day, so both the
     credit date and the day before it are considered, and the branch whose
     expected figure is nearest wins. Anything more than 5% out is offered with
     a warning rather than silently. */
  const suggest = useCallback((row: Row): { branch: Branch | null; delta: number } => {
    const cd = String(row.credit_date);
    const prev = new Date(new Date(cd + "T00:00:00").getTime() - 86400000).toISOString().slice(0, 10);
    const amt = num(row.amount);
    let best: Branch | null = null; let bestDelta = Infinity;
    branches.forEach((b) => {
      [cd, prev].forEach((d) => {
        const e = expected.get(`${b.id}|${d}`);
        if (e === undefined || e === 0) return;
        const delta = Math.abs(e - amt);
        if (delta < bestDelta) { bestDelta = delta; best = b; }
      });
    });
    return { branch: best, delta: bestDelta === Infinity ? -1 : bestDelta };
  }, [branches, expected]);

  const byDay: DayLine[] = useMemo(() => {
    const m = new Map<string, DayLine>();
    expected.forEach((v, k) => {
      const [bid, date] = k.split("|");
      m.set(k, { branch_id: Number(bid), date, expected: v, received: 0 });
    });
    matched.forEach((r) => {
      const k = `${Number(r.branch_id)}|${String(r.sale_date ?? r.credit_date)}`;
      const cur = m.get(k) ?? { branch_id: Number(r.branch_id), date: String(r.sale_date ?? r.credit_date), expected: 0, received: 0 };
      cur.received += num(r.amount);
      m.set(k, cur);
    });
    return [...m.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [expected, matched]);

  const tot = useMemo(() => ({
    credited: settlements.reduce((t, r) => t + num(r.amount), 0),
    expected: [...expected.values()].reduce((t, v) => t + v, 0),
    unmatched: unmatched.reduce((t, r) => t + num(r.amount), 0),
  }), [settlements, expected, unmatched]);

  const stats = [
    { label: "Expected (card sales)", value: money(tot.expected), Icon: CreditCard },
    { label: "Credited by bank", value: money(tot.credited), Icon: Landmark },
    { label: "Gap", value: money(tot.expected - tot.credited), Icon: AlertTriangle },
    { label: "Awaiting a shop", value: `${unmatched.length} · ${money(tot.unmatched)}`, Icon: Link2 },
  ];

  async function assign(id: unknown, branchId: string, saleDate?: string) {
    if (!supabase || !branchId) return;
    const patch: Record<string, unknown> = { branch_id: Number(branchId) };
    if (saleDate) patch.sale_date = saleDate;
    const { error } = await supabase.from("retail_card_settlements").update(patch).eq("id", Number(id));
    if (error) { setErr(error.message); return; }
    setSettlements((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function save() {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { setErr("Enter an amount above zero."); return; }
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("retail_card_settlements").insert({
      credit_date: form.credit_date,
      sale_date: form.sale_date || null,
      amount: amt,
      ref: form.ref.trim(),
      bank: form.bank.trim() || null,
      descr: form.descr.trim() || null,
      branch_id: form.branch_id ? Number(form.branch_id) : null,
      source: "manual",
    });
    setSaving(false);
    if (error) {
      /* The unique indexes speak here. Saying "already recorded" is the whole
         point of them — a duplicate is a success, not a failure. */
      setErr(/duplicate|unique/i.test(error.message)
        ? "That credit is already recorded — the duplicate guard caught it."
        : error.message);
      return;
    }
    setOpen(false);
    setForm((f) => ({ ...f, amount: "", ref: "", descr: "" }));
    load();
  }

  const unmatchedCols: Col<Row>[] = [
    { head: "Credited", muted: true, cell: (r) => text(r.credit_date) },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.amount) },
    { head: "Reference", muted: true, cell: (r) => text(r.ref) },
    { head: "Bank says", muted: true, cell: (r) => text(r.descr) },
    { head: "Nearest shop", cell: (r) => {
        const { branch, delta } = suggest(r);
        if (!branch) return <Pill tone="neutral">no candidate</Pill>;
        const pct = num(r.amount) ? (delta / num(r.amount)) * 100 : 100;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold">{(branch as Branch).name}</span>
            {pct <= 5 ? <Pill tone="good">±{money(delta)}</Pill> : <Pill tone="warn">off by {money(delta)}</Pill>}
          </span>
        );
      } },
    { head: "Assign to", right: true, cell: (r) => (
        <Select value="" onChange={(v) => assign(r.id, v, String(r.credit_date))}>
          <option value="">Pick a shop…</option>
          {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </Select>
      ) },
  ];

  const matchedCols: Col<Row>[] = [
    { head: "Credited", muted: true, cell: (r) => text(r.credit_date) },
    { head: "Sale day", muted: true, cell: (r) => text(r.sale_date) },
    { head: "Shop", bold: true, cell: (r) => branchName(r.branch_id) },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.amount) },
    { head: "Reference", muted: true, cell: (r) => text(r.ref) },
    { head: "Source", cell: (r) => (String(r.source) === "manual" ? <Pill>Typed</Pill> : <Pill tone="info">Slip</Pill>) },
  ];

  const dayCols: Col<DayLine>[] = [
    { head: "Date", muted: true, cell: (d) => d.date },
    { head: "Shop", bold: true, cell: (d) => branchName(d.branch_id) },
    { head: "Card sales", right: true, cell: (d) => money(d.expected) },
    { head: "Bank credited", right: true, cell: (d) => money(d.received) },
    { head: "Gap", right: true, bold: true, cell: (d) => {
        const g = d.expected - d.received;
        if (Math.abs(g) < 1) return <Pill tone="good">Settled</Pill>;
        return <span className={g > 0 ? "text-danger" : "text-success"}>{money(g)}</span>;
      } },
  ];

  return (
    <Shell>
      <PageHeader title="Card Reconciliation" subtitle="Pooled Alfalah credits, matched back to the shop that earned them."
        onRefresh={load} loading={loading}>
        <button onClick={() => { setErr(""); setOpen(true); }} className={btnPrimary}><Plus size={15} /> Add a credit</button>
      </PageHeader>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} presets={MONEY_PRESETS} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <StatCards stats={stats} loading={loading} />

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}

      {tab === "unmatched" && (
        unmatched.length === 0 && !loading ? (
          <div className="mt-4 flex items-center gap-3 rounded-card border border-success/30 bg-success-soft p-5 dark:border-success/30 dark:bg-success/10">
            <CheckCircle2 size={18} className="flex-none text-success" />
            <p className="text-[13px] font-medium text-ink dark:text-[#e7e2d8]">Every credit in this range is assigned to a shop.</p>
          </div>
        ) : (
          <DataTable cols={unmatchedCols} rows={unmatched} loading={loading} minWidth={1000}
            empty="Nothing waiting — every credit has a shop." />
        )
      )}
      {tab === "matched" && <DataTable cols={matchedCols} rows={matched} loading={loading} minWidth={860} empty="No matched credits in this range." />}
      {tab === "byday" && <DataTable cols={dayCols} rows={byDay} loading={loading} minWidth={720} empty="No card sales in this range." />}

      <SourceNote>
        <strong>Card sales</strong> counts only <code>meezan_card</code> lines. Nimbus MOP
        &ldquo;Credit&rdquo; is udhaar and is excluded — including it is what made FC DHA&apos;s 1 Sep figure
        read 36,100 instead of 33,400. The nearest-shop suggestion looks at the credit date and
        the day before it, because card money usually lands the next working day; it is only ever
        a suggestion, and a credit stays unassigned until somebody says which shop it is.
      </SourceNote>

      <Modal open={open} onClose={() => setOpen(false)} title="Record a card credit"
        subtitle="Type what the bank shows. Duplicates are refused by the database, so it is safe to add one you are unsure about.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Credit date"><input type="date" value={form.credit_date} onChange={(e) => setForm({ ...form, credit_date: e.target.value })} className={inputCls} /></Field>
            <Field label="Sale day it covers"><input type="date" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} autoFocus /></Field>
            <Field label="Bank reference / TXID"><input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} className={inputCls} placeholder="Blank is allowed" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank"><input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className={inputCls} /></Field>
            <Field label="Shop (optional)">
              <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className={inputCls}>
                <option value="">Leave unassigned</option>
                {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="What the statement says"><input value={form.descr} onChange={(e) => setForm({ ...form, descr: e.target.value })} className={inputCls} /></Field>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Record credit"}</button>
          </div>
        </div>
      </Modal>

      <PreviewNote />
    </Shell>
  );
}
