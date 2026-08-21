"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, TrendingUp, Layers, Tag, ScrollText, Search, RefreshCw } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates, num, rs } from "@/lib/dateRange";

type Sale = Record<string, unknown>;
type Branch = { id: number; name: string; color?: string };
type View = "lines" | "items" | "departments" | "salespeople" | "receipts";

const VIEWS: { key: View; label: string }[] = [
  { key: "lines", label: "Lines" },
  { key: "items", label: "By Item" },
  { key: "departments", label: "By Department" },
  { key: "salespeople", label: "By Salesperson" },
  { key: "receipts", label: "By Receipt" },
];
const sum = (rows: Sale[], k: string) => rows.reduce((t, r) => t + num(r[k]), 0);

export default function RetailSalesPage() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [branch, setBranch] = useState("ALL");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("lines");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  const branchName = useCallback((id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—", [branches]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.from("retail_branches").select("id,name,color").order("name").then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let sq = supabase.from("retail_sale_lines")
      .select("id,branch_id,sale_date,receipt_no,receipt_txn,item_code,item_name,department,salesperson,customer,quantity,net_sales,sales_amount,gross_margin,discount,payment_method")
      .order("sale_date", { ascending: false, nullsFirst: false }).limit(5000);
    if (from) sq = sq.gte("sale_date", from);
    if (to) sq = sq.lte("sale_date", to);
    if (branch !== "ALL") sq = sq.eq("branch_id", Number(branch));
    const { data, error } = await sq;
    if (error) setErr(error.message);
    setRows((data as Sale[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, branch]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) => [r.receipt_no, r.item_name, r.item_code, r.customer, r.salesperson].some((v) => String(v ?? "").toLowerCase().includes(n)));
  }, [rows, q]);

  const receiptCount = useMemo(() => new Set(filtered.map((r) => `${r.branch_id}|${r.receipt_txn || r.receipt_no || r.id}`)).size, [filtered]);
  const totalSales = useMemo(() => sum(filtered, "sales_amount"), [filtered]);

  const cards = [
    { label: "Total sales", value: rs(totalSales), Icon: Receipt, bg: "bg-salmon-soft" },
    { label: "Gross margin", value: rs(sum(filtered, "gross_margin")), Icon: TrendingUp, bg: "bg-success-soft" },
    { label: "Receipts", value: receiptCount.toLocaleString(), Icon: ScrollText, bg: "bg-periwinkle-soft" },
    { label: "Avg receipt", value: rs(receiptCount ? totalSales / receiptCount : 0), Icon: Layers, bg: "bg-lavender-soft" },
    { label: "Items sold", value: Math.round(sum(filtered, "quantity")).toLocaleString(), Icon: Layers, bg: "bg-amber-soft" },
    { label: "Discounts", value: rs(sum(filtered, "discount")), Icon: Tag, bg: "bg-pink-soft" },
  ];

  // grouped aggregations
  const grouped = useMemo(() => {
    const key = view === "items" ? "item_name" : view === "departments" ? "department" : view === "salespeople" ? "salesperson" : null;
    if (view === "receipts") {
      const m: Record<string, { branch: unknown; date: unknown; qty: number; amt: number; margin: number }> = {};
      filtered.forEach((r) => {
        const k = `${r.branch_id}|${r.receipt_txn || r.receipt_no || r.id}`;
        (m[k] ||= { branch: r.branch_id, date: r.sale_date, qty: 0, amt: 0, margin: 0 });
        m[k].qty += num(r.quantity); m[k].amt += num(r.sales_amount); m[k].margin += num(r.gross_margin);
      });
      return Object.entries(m).map(([k, v]) => ({ name: k.split("|")[1], ...v })).sort((a, b) => b.amt - a.amt).slice(0, 300);
    }
    if (!key) return [];
    const m: Record<string, { qty: number; amt: number; margin: number; lines: number }> = {};
    filtered.forEach((r) => {
      const k = String(r[key] || "—");
      (m[k] ||= { qty: 0, amt: 0, margin: 0, lines: 0 });
      m[k].qty += num(r.quantity); m[k].amt += num(r.sales_amount); m[k].margin += num(r.gross_margin); m[k].lines += 1;
    });
    return Object.entries(m).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amt - a.amt).slice(0, 300);
  }, [filtered, view]);

  const maxAmt = Math.max(...grouped.map((g) => ("amt" in g ? g.amt : 0)), 1);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Sales</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">In-store POS sales, with item, department &amp; salesperson breakdowns.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt}
        right={
          <>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              <option value="ALL">All branches</option>
              {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <Search size={15} className="text-hint dark:text-[#8a8175]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt, item, staff" className="w-40 bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-48 dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
            </div>
          </>
        } />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(({ label, value, Icon, bg }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[16px] font-extrabold tabular-nums text-ink sm:text-[18px] dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${view === v.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {view === "lines" && <><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Branch</th><th className="px-4 py-3 font-semibold">Receipt</th><th className="px-4 py-3 font-semibold">Item</th><th className="px-4 py-3 text-right font-semibold">Qty</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Payment</th></>}
                {view === "receipts" && <><th className="px-4 py-3 font-semibold">Receipt</th><th className="px-4 py-3 font-semibold">Branch</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 text-right font-semibold">Items</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 text-right font-semibold">Margin</th></>}
                {(view === "items" || view === "departments" || view === "salespeople") && <><th className="px-4 py-3 font-semibold">{view === "items" ? "Item" : view === "departments" ? "Department" : "Salesperson"}</th><th className="px-4 py-3 text-right font-semibold">Qty</th><th className="px-4 py-3 text-right font-semibold">Sales</th><th className="px-4 py-3 text-right font-semibold">Margin</th><th className="hidden px-4 py-3 font-semibold sm:table-cell">Share</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load sales: {err}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">{rows.length === 0 ? "No sales in this period — this fills when shop sales are brought in." : "Nothing matches this search."}</td></tr>
              ) : view === "lines" ? (
                filtered.slice(0, 500).map((r, i) => (
                  <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.sale_date ?? "—")}</td>
                    <td className="px-4 py-3 font-semibold">{branchName(r.branch_id)}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.receipt_no ?? "—")}</td>
                    <td className="px-4 py-3">{String(r.item_name ?? "—")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(r.quantity).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(num(r.sales_amount))}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.payment_method ?? "—")}</td>
                  </tr>
                ))
              ) : view === "receipts" ? (
                grouped.map((g, i) => {
                  const row = g as { name: string; branch: unknown; date: unknown; qty: number; amt: number; margin: number };
                  return (
                    <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                      <td className="px-4 py-3 font-semibold">{row.name}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{branchName(row.branch)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(row.date ?? "—")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.qty.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(row.amt)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{rs(row.margin)}</td>
                    </tr>
                  );
                })
              ) : (
                grouped.map((g, i) => {
                  const row = g as { name: string; qty: number; amt: number; margin: number };
                  return (
                    <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                      <td className="px-4 py-3 font-semibold">{row.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.qty.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(row.amt)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{rs(row.margin)}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <div className="h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
                          <div className="h-full rounded-full bg-salmon" style={{ width: `${Math.max((row.amt / maxAmt) * 100, 2)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && !err && filtered.length > 0 && (
          <div className="border-t border-line px-4 py-3 text-[12px] text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
            {view === "lines" ? `${Math.min(filtered.length, 500).toLocaleString()} of ${filtered.length.toLocaleString()} lines` : `${grouped.length.toLocaleString()} rows`}{rows.length >= 5000 ? " · capped at 5,000 lines for this period" : ""}
          </div>
        )}
      </div>
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live sales.</p>}
    </div>
  );
}
