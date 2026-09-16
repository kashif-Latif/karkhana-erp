"use client";
/* Non-cash — everything that was sold but did not go into the till.
 *
 * WHY THIS SCREEN EXISTS SEPARATELY FROM THE CASH BOOK
 *   The cash book's closing balance is cash only, by decision: JazzCash, card
 *   and credit never enter the drawer, so they cannot move the cash difference.
 *   But they are still sales, they still have to be collected, and somebody has
 *   to notice when the bank credit for Tuesday's card sales never arrived.
 *   That noticing happens here.
 *
 * THE RULE THAT COST MONEY
 *   Nimbus MOP "Credit" is UDHAAR — goods taken on account by a customer. It
 *   is not a credit card. Counting it as card is what made FC DHA's 1 Sep card
 *   figure read 36,100 instead of 33,400. Card is payment_method='meezan_card'
 *   and nothing else, and only the two Fashion Collection shops take credit
 *   sales at all.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, CreditCard, Smartphone, Globe, Users } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, BranchPicker, PreviewNote, SourceNote,
  useBranches, money, num, text, type Row, type Col,
} from "@/components/retail/kit";

/* 'cash' is deliberately absent — this screen is the other side of it.
   'unclassified' is here because a row nobody has categorised is a row nobody
   is chasing, and hiding it would make the totals look tidier than they are. */
const METHODS = [
  { key: "meezan_card", label: "Card", Icon: CreditCard, tone: "info" as const },
  { key: "jazzcash", label: "JazzCash", Icon: Smartphone, tone: "warn" as const },
  { key: "online", label: "Online", Icon: Globe, tone: "info" as const },
  { key: "credit", label: "Credit (udhaar)", Icon: Users, tone: "bad" as const },
  { key: "other", label: "Other", Icon: ArrowLeftRight, tone: "neutral" as const },
  { key: "unclassified", label: "Unclassified", Icon: ArrowLeftRight, tone: "neutral" as const },
];
const LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]));
const TONE = Object.fromEntries(METHODS.map((m) => [m.key, m.tone]));

type Agg = { branch_id: number; method: string; amount: number; lines: number };

export default function NonCashPage() {
  const { branches, branchName } = useBranches();
  const [branch, setBranch] = useState("");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let q = supabase.from("retail_sale_lines")
      .select("branch_id,sale_date,payment_method,net_sales,sales_amount")
      .neq("payment_method", "cash")
      .limit(20000);
    if (from) q = q.gte("sale_date", from);
    if (to) q = q.lte("sale_date", to);
    if (branch) q = q.eq("branch_id", Number(branch));
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, branch]);
  useEffect(() => { load(); }, [load]);

  /* Aggregated in the browser rather than by a view, because the line grain is
     what makes a drill-down possible later and a view would throw it away. */
  const agg: Agg[] = useMemo(() => {
    const map = new Map<string, Agg>();
    rows.forEach((r) => {
      const bid = Number(r.branch_id);
      const m = String(r.payment_method || "unclassified");
      const k = `${bid}:${m}`;
      const amt = num(r.sales_amount) || num(r.net_sales);
      const cur = map.get(k) ?? { branch_id: bid, method: m, amount: 0, lines: 0 };
      cur.amount += amt; cur.lines += 1;
      map.set(k, cur);
    });
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [rows]);

  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    agg.forEach((a) => m.set(a.method, (m.get(a.method) ?? 0) + a.amount));
    return m;
  }, [agg]);

  const total = useMemo(() => [...byMethod.values()].reduce((t, v) => t + v, 0), [byMethod]);

  const stats = [
    { label: "Card", value: money(byMethod.get("meezan_card") ?? 0), Icon: CreditCard },
    { label: "JazzCash", value: money(byMethod.get("jazzcash") ?? 0), Icon: Smartphone },
    { label: "Credit (udhaar)", value: money(byMethod.get("credit") ?? 0), Icon: Users },
    { label: "All non-cash", value: money(total), Icon: ArrowLeftRight },
  ];

  const cols: Col<Agg>[] = [
    { head: "Branch", bold: true, cell: (a) => branchName(a.branch_id) },
    { head: "Method", cell: (a) => <Pill tone={TONE[a.method] ?? "neutral"}>{LABEL[a.method] ?? text(a.method)}</Pill> },
    { head: "Lines", right: true, muted: true, cell: (a) => a.lines.toLocaleString() },
    { head: "Amount", right: true, bold: true, cell: (a) => money(a.amount) },
    { head: "Share", right: true, muted: true, cell: (a) => (total ? ((a.amount / total) * 100).toFixed(1) + "%" : "—") },
  ];

  return (
    <Shell>
      <PageHeader title="Non-cash" subtitle="Card, JazzCash, online and udhaar — sales that never reached the till."
        onRefresh={load} loading={loading}>
        <BranchPicker branches={branches} value={branch} onChange={setBranch} />
      </PageHeader>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} />
      <StatCards stats={stats} loading={loading} />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {METHODS.map(({ key, label, Icon }) => {
          const v = byMethod.get(key) ?? 0;
          const pct = total ? (v / total) * 100 : 0;
          return (
            <div key={key} className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-ink dark:bg-white/[0.08] dark:text-white"><Icon size={15} /></span>
                <span className="text-[13px] font-semibold text-ink dark:text-[#e7e2d8]">{label}</span>
                <span className="ml-auto text-[13px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : money(v)}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
                <div className="h-full rounded-full bg-ink dark:bg-white" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="mt-1.5 text-[11.5px] font-medium text-muted dark:text-[#a89f93]">{pct.toFixed(1)}% of non-cash</div>
            </div>
          );
        })}
      </div>

      <DataTable cols={cols} rows={agg} loading={loading} err={err} minWidth={720}
        empty="No non-cash sales in this range." />

      <SourceNote>
        <strong>Credit is udhaar, not a credit card.</strong> It is goods taken on account by a
        customer, and only the two Fashion Collection shops take it. Card means{" "}
        <code>meezan_card</code> and nothing else — counting Nimbus MOP &ldquo;Credit&rdquo; as card is what
        made FC DHA&apos;s 1 Sep card figure read 36,100 instead of 33,400.
        None of these figures move the cash book, because none of this money enters the till.
      </SourceNote>

      <PreviewNote />
    </Shell>
  );
}
