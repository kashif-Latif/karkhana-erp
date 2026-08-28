"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, TrendingUp, Receipt, Coins, ScrollText, Package, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Sale = Record<string, unknown>;
type Exp = Record<string, unknown>;
type Branch = { id: number; name: string; chain?: string; color?: string };

const PM: Record<string, { label: string; color: string }> = {
  cash: { label: "Cash", color: "#7FC489" },
  card: { label: "Card", color: "#A6C0E6" },
  jazz: { label: "JazzCash", color: "#EFD0A6" },
  online: { label: "Online", color: "#D2B9EA" },
  easypaisa: { label: "EasyPaisa", color: "#EDA6D0" },
  unclassified: { label: "Unclassified", color: "#B4ABA0" },
};
const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];
const num = (v: unknown) => Number(v) || 0;
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-PK");
const iso = (d: Date) => d.toISOString().slice(0, 10);

function rangeDates(preset: string, cf: string, ct: string): [string, string] {
  const t = new Date(); const s = new Date(t);
  if (preset === "today") return [iso(t), iso(t)];
  if (preset === "yesterday") { s.setDate(t.getDate() - 1); return [iso(s), iso(s)]; }
  if (preset === "7d") { s.setDate(t.getDate() - 6); return [iso(s), iso(t)]; }
  if (preset === "30d") { s.setDate(t.getDate() - 29); return [iso(s), iso(t)]; }
  if (preset === "month") return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
  return [cf || iso(t), ct || iso(t)];
}

function BarChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  if (data.length === 0) return <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">No sales in this period.</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.slice(0, 10).map((d) => (
        <div key={d.name} className="flex items-center gap-3">
          <div className="w-28 shrink-0 truncate text-[12px] text-muted dark:text-[#a89f93]" title={d.name}>{d.name}</div>
          <div className="h-5 flex-1 overflow-hidden rounded-full bg-panel dark:bg-white/[0.05]">
            <div className="h-full rounded-full" style={{ width: `${Math.max((d.value / max) * 100, 1.5)}%`, background: d.color || "#EBA98F" }} />
          </div>
          <div className="w-20 shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink dark:text-[#f4f1ea]">{rs(d.value)}</div>
        </div>
      ))}
    </div>
  );
}

function Donut({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total <= 0) return <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">No payments in this period.</div>;
  const R = 52, C = 2 * Math.PI * R; let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0">
        <circle cx="70" cy="70" r={R} fill="none" stroke="currentColor" strokeWidth="16" className="text-panel dark:text-white/[0.06]" />
        {data.map((d) => {
          const frac = d.value / total; const dash = frac * C;
          const seg = <circle key={d.label} cx="70" cy="70" r={R} fill="none" stroke={d.color} strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" strokeLinecap="butt" />;
          acc += dash; return seg;
        })}
        <text x="70" y="66" textAnchor="middle" className="fill-ink text-[15px] font-extrabold dark:fill-[#f4f1ea]">{rs(total)}</text>
        <text x="70" y="82" textAnchor="middle" className="fill-hint text-[9px] uppercase tracking-wide dark:fill-[#8a8175]">total</text>
      </svg>
      <div className="flex min-w-[180px] flex-1 flex-col gap-2">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="flex-1 text-ink dark:text-[#e7e2d8]">{d.label}</span>
            <b className="tabular-nums text-ink dark:text-[#f4f1ea]">{((d.value / total) * 100).toFixed(1)}%</b>
            <span className="min-w-[84px] text-right tabular-nums text-muted dark:text-[#a89f93]">{rs(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RetailDashboard() {
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [branch, setBranch] = useState("ALL");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Exp[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.from("retail_branches").select("id,name,chain,color").order("name").then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);
  const branchById = useCallback((id: unknown) => branches.find((b) => b.id === Number(id)), [branches]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let sq = supabase.from("retail_sale_lines").select("branch_id,sales_amount,gross_margin,quantity,receipt_txn,receipt_no,id,payment_method").gte("sale_date", from).lte("sale_date", to).limit(5000);
    let eq = supabase.from("retail_expenses").select("branch_id,amount,txn_type").gte("expense_date", from).lte("expense_date", to).limit(5000);
    if (branch !== "ALL") { sq = sq.eq("branch_id", Number(branch)); eq = eq.eq("branch_id", Number(branch)); }
    const [sres, eres] = await Promise.all([sq, eq]);
    if (sres.error) setErr(sres.error.message);
    setSales((sres.data as Sale[]) ?? []); setExpenses((eres.data as Exp[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, branch]);
  useEffect(() => { load(); }, [load]);

  const M = useMemo(() => {
    const totSales = sales.reduce((a, r) => a + num(r.sales_amount), 0);
    const totMargin = sales.reduce((a, r) => a + num(r.gross_margin), 0);
    const totExp = expenses.filter((r) => r.txn_type !== "income").reduce((a, r) => a + num(r.amount), 0);
    const totInc = expenses.filter((r) => r.txn_type === "income").reduce((a, r) => a + num(r.amount), 0);
    const receipts = new Set(sales.map((r) => `${r.branch_id}|${r.receipt_txn || r.receipt_no || r.id}`)).size;
    const items = sales.reduce((a, r) => a + num(r.quantity), 0);
    const net = totMargin - totExp + totInc;

    const pay: Record<string, number> = {};
    sales.forEach((r) => { const k = String(r.payment_method || "unclassified"); pay[k] = (pay[k] || 0) + num(r.sales_amount); });

    const chainAgg: Record<string, { s: number; mg: number; e: number }> = {};
    sales.forEach((r) => { const c = branchById(r.branch_id)?.chain || "—"; (chainAgg[c] ||= { s: 0, mg: 0, e: 0 }); chainAgg[c].s += num(r.sales_amount); chainAgg[c].mg += num(r.gross_margin); });
    expenses.forEach((r) => { const c = branchById(r.branch_id)?.chain || "—"; (chainAgg[c] ||= { s: 0, mg: 0, e: 0 }); chainAgg[c].e += (r.txn_type === "income" ? -num(r.amount) : num(r.amount)); });

    const perBranch: Record<string, { s: number; mg: number; e: number }> = {};
    sales.forEach((r) => { const id = String(r.branch_id); (perBranch[id] ||= { s: 0, mg: 0, e: 0 }); perBranch[id].s += num(r.sales_amount); perBranch[id].mg += num(r.gross_margin); });
    expenses.forEach((r) => { const id = String(r.branch_id); (perBranch[id] ||= { s: 0, mg: 0, e: 0 }); perBranch[id].e += (r.txn_type === "income" ? -num(r.amount) : num(r.amount)); });

    return { totSales, totMargin, totExp, totInc, receipts, items, net, pay, chainAgg, perBranch };
  }, [sales, expenses, branchById]);

  const cards = [
    { label: "Total Sales", value: rs(M.totSales), Icon: Wallet, bg: "bg-salmon-soft" },
    { label: "Gross Margin", value: rs(M.totMargin), Icon: TrendingUp, bg: "bg-success-soft" },
    { label: "Expenses", value: rs(M.totExp), Icon: Receipt, bg: "bg-amber-soft" },
    { label: "Net Profit", value: rs(M.net), Icon: Coins, bg: "bg-periwinkle-soft", danger: M.net < 0 },
    { label: "Receipts", value: M.receipts.toLocaleString(), Icon: ScrollText, bg: "bg-lavender-soft" },
    { label: "Items Sold", value: Math.round(M.items).toLocaleString(), Icon: Package, bg: "bg-pink-soft" },
  ];
  const chainKeys = Object.keys(M.chainAgg);
  const byBranch = Object.keys(M.perBranch).map((id) => { const b = branchById(id); return { id, name: b?.name || "—", color: b?.color || "#EBA98F", ...M.perBranch[id], net: M.perBranch[id].mg - M.perBranch[id].e }; }).sort((a, b) => b.s - a.s);
  const payKeys = Object.keys(M.pay).filter((k) => M.pay[k] > 0).sort((a, b) => M.pay[b] - M.pay[a]);

  return (
    <div className="px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Dashboard</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Shop sales, margin &amp; profit across all branches.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${preset === p.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={cf} onChange={(e) => setCf(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
            <span className="text-[12px] text-hint">to</span>
            <input type="date" value={ct} onChange={(e) => setCt(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
          </div>
        )}
        <select value={branch} onChange={(e) => setBranch(e.target.value)}
          className="ml-auto rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
          <option value="ALL">All branches</option>
          {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>
      </div>

      {/* metric cards */}
      <div className="mt-5 grid grid-cols-2 gap-3.5 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(({ label, value, Icon, bg, danger }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className={`mt-3 text-[18px] font-extrabold tabular-nums ${danger ? "text-danger" : "text-ink dark:text-[#f4f1ea]"}`}>{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      {M.pay.unclassified > 0 && (
        <div className="mt-4 flex items-start gap-2.5 rounded-card border border-amber/40 bg-amber-soft px-4 py-3 text-[13px] text-ink dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-[#f4f1ea]">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-strong dark:text-amber" />
          <span><b>{rs(M.pay.unclassified)}</b> of non-cash sales are still unclassified — tag them as JazzCash or Card to sharpen the payment split.</span>
        </div>
      )}

      {chainKeys.length > 1 && (
        <div className="mt-6">
          <h3 className="mb-2 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">By business</h3>
          <div className="overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]"><th className="px-4 py-3 font-semibold">Business</th><th className="px-4 py-3 text-right font-semibold">Sales</th><th className="px-4 py-3 text-right font-semibold">Gross Margin</th><th className="px-4 py-3 text-right font-semibold">Expenses</th><th className="px-4 py-3 text-right font-semibold">Net Profit</th></tr></thead>
              <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                {chainKeys.map((c) => ({ c, ...M.chainAgg[c], net: M.chainAgg[c].mg - M.chainAgg[c].e })).sort((a, b) => b.s - a.s).map((r) => (
                  <tr key={r.c} className="text-ink dark:text-[#e7e2d8]"><td className="px-4 py-3 font-semibold">{r.c}</td><td className="px-4 py-3 text-right tabular-nums">{rs(r.s)}</td><td className="px-4 py-3 text-right tabular-nums">{rs(r.mg)}</td><td className="px-4 py-3 text-right tabular-nums">{rs(r.e)}</td><td className={`px-4 py-3 text-right font-semibold tabular-nums ${r.net < 0 ? "text-danger" : "text-success"}`}>{rs(r.net)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h3 className="mb-4 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Sales by branch</h3>
          {loading ? <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">Loading…</div> : <BarChart data={byBranch.map((b) => ({ name: b.name, value: b.s, color: b.color }))} />}
        </div>
        <div className="rounded-card border border-line bg-surface p-5 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h3 className="mb-4 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Payment method split</h3>
          {loading ? <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">Loading…</div> : <Donut data={payKeys.map((k) => ({ label: PM[k]?.label || k, value: M.pay[k], color: PM[k]?.color || "#B4ABA0" }))} />}
        </div>
      </div>

      {err && <p className="mt-4 text-[12.5px] font-medium text-danger">Couldn&apos;t load: {err}</p>}
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live figures.</p>}
    </div>
  );
}
