"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Layers, TrendingUp, RefreshCw } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates, num, rs } from "@/lib/dateRange";

type Branch = { id: number; code: string; name: string; chain: string; business?: string; active?: boolean; color?: string };
type Row = Record<string, unknown>;

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [sales, setSales] = useState<Row[]>([]);
  const [expenses, setExpenses] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let sq = supabase.from("retail_sale_lines").select("branch_id,sales_amount,gross_margin,quantity,receipt_txn,receipt_no,id").limit(5000);
    let eq = supabase.from("retail_expenses").select("branch_id,amount,txn_type").limit(5000);
    if (from) { sq = sq.gte("sale_date", from); eq = eq.gte("expense_date", from); }
    if (to) { sq = sq.lte("sale_date", to); eq = eq.lte("expense_date", to); }
    const [b, s, e] = await Promise.all([
      supabase.from("retail_branches").select("id,code,name,chain,business,active,color").order("chain").order("name"),
      sq, eq,
    ]);
    if (b.error) setErr(b.error.message);
    setBranches((b.data as Branch[]) ?? []); setSales((s.data as Row[]) ?? []); setExpenses((e.data as Row[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct]);
  useEffect(() => { load(); }, [load]);

  const perf = useMemo(() => {
    const m: Record<string, { sales: number; margin: number; qty: number; exp: number; receipts: Set<string> }> = {};
    sales.forEach((r) => {
      const k = String(r.branch_id);
      (m[k] ||= { sales: 0, margin: 0, qty: 0, exp: 0, receipts: new Set() });
      m[k].sales += num(r.sales_amount); m[k].margin += num(r.gross_margin); m[k].qty += num(r.quantity);
      m[k].receipts.add(String(r.receipt_txn || r.receipt_no || r.id));
    });
    expenses.forEach((r) => {
      const k = String(r.branch_id);
      (m[k] ||= { sales: 0, margin: 0, qty: 0, exp: 0, receipts: new Set() });
      m[k].exp += r.txn_type === "income" ? -num(r.amount) : num(r.amount);
    });
    return m;
  }, [sales, expenses]);

  const totalSales = useMemo(() => Object.values(perf).reduce((a, v) => a + v.sales, 0), [perf]);
  const maxSales = Math.max(...Object.values(perf).map((v) => v.sales), 1);

  const cards = [
    { label: "Branches", value: branches.length.toLocaleString(), Icon: Building2, bg: "bg-salmon-soft" },
    { label: "Active", value: branches.filter((b) => b.active !== false).length.toLocaleString(), Icon: CheckCircle2, bg: "bg-success-soft" },
    { label: "Chains", value: new Set(branches.map((b) => b.chain)).size.toLocaleString(), Icon: Layers, bg: "bg-periwinkle-soft" },
    { label: "Period sales", value: rs(totalSales), Icon: TrendingUp, bg: "bg-amber-soft" },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Branches</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Your shops and how each performed in the selected period.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, bg }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[17px] font-extrabold tabular-nums text-ink sm:text-[19px] dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                <th className="px-4 py-3 font-semibold">Branch</th><th className="px-4 py-3 font-semibold">Chain</th>
                <th className="px-4 py-3 text-right font-semibold">Sales</th><th className="px-4 py-3 text-right font-semibold">Margin</th>
                <th className="px-4 py-3 text-right font-semibold">Expenses</th><th className="px-4 py-3 text-right font-semibold">Net</th>
                <th className="px-4 py-3 text-right font-semibold">Receipts</th><th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load branches: {err}</td></tr>
              ) : branches.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">No branches yet — these come in with your shop data.</td></tr>
              ) : (
                branches.map((b) => {
                  const p = perf[String(b.id)] || { sales: 0, margin: 0, qty: 0, exp: 0, receipts: new Set() };
                  const net = p.margin - p.exp;
                  return (
                    <tr key={b.id} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: b.color || "#EBA98F" }} />{b.name}</span>
                        <span className="mt-1 block h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
                          <span className="block h-full rounded-full" style={{ width: `${Math.max((p.sales / maxSales) * 100, 1)}%`, background: b.color || "#EBA98F" }} />
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{b.chain}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(p.sales)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{rs(p.margin)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{rs(p.exp)}</td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${net < 0 ? "text-danger" : "text-success"}`}>{rs(net)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.receipts.size.toLocaleString()}</td>
                      <td className="px-4 py-3">{b.active !== false ? <span className="text-[12px] font-semibold text-success">Active</span> : <span className="text-[12px] font-semibold text-muted">Inactive</span>}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load branches.</p>}
    </div>
  );
}
