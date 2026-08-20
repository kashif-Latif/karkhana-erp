"use client";
import { useEffect, useMemo, useState } from "react";
import { Receipt, TrendingUp, Layers, Tag, Search, RefreshCw } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Sale = Record<string, unknown>;
type Branch = { id: number; name: string; chain?: string };
const money = (n: unknown) => "Rs " + Math.round(Number(n) || 0).toLocaleString("en-PK");
const sum = (rows: Sale[], k: string) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

export default function RetailSalesPage() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [branch, setBranch] = useState("ALL");
  const [q, setQ] = useState("");

  const branchName = (id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—";

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.from("retail_branches").select("id,name,chain").order("name").then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);

  async function load() {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase
      .from("retail_sale_lines")
      .select("id,branch_id,sale_date,receipt_no,item_name,department,quantity,net_sales,gross_margin,discount,payment_method,customer")
      .order("sale_date", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) setErr(error.message);
    setRows((data as Sale[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) =>
      (branch === "ALL" || String(r.branch_id) === branch) &&
      (!n || String(r.receipt_no ?? "").toLowerCase().includes(n) || String(r.item_name ?? "").toLowerCase().includes(n) || String(r.customer ?? "").toLowerCase().includes(n))
    );
  }, [rows, branch, q]);

  const cards = [
    { label: "Net sales", value: money(sum(filtered, "net_sales")), Icon: Receipt, bg: "bg-salmon-soft" },
    { label: "Gross margin", value: money(sum(filtered, "gross_margin")), Icon: TrendingUp, bg: "bg-success-soft" },
    { label: "Sale lines", value: filtered.length.toLocaleString(), Icon: Layers, bg: "bg-periwinkle-soft" },
    { label: "Discounts", value: money(sum(filtered, "discount")), Icon: Tag, bg: "bg-amber-soft" },
  ];

  return (
    <div className="px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Sales</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">In-store POS sales across all branches.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, bg }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <select value={branch} onChange={(e) => setBranch(e.target.value)}
          className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
          <option value="ALL">All branches</option>
          {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
          <Search size={15} className="text-hint dark:text-[#8a8175]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt, item, customer" className="w-52 bg-transparent text-[13px] outline-none placeholder:text-hint dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                <th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Branch</th><th className="px-4 py-3 font-semibold">Receipt</th>
                <th className="px-4 py-3 font-semibold">Item</th><th className="px-4 py-3 text-right font-semibold">Qty</th><th className="px-4 py-3 text-right font-semibold">Net sales</th><th className="px-4 py-3 font-semibold">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load sales: {err}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">{rows.length === 0 ? "No sales yet — this fills when the shop sales are brought in." : "No sales match these filters."}</td></tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.sale_date ?? "—")}</td>
                    <td className="px-4 py-3 font-semibold">{branchName(r.branch_id)}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.receipt_no ?? "—")}</td>
                    <td className="px-4 py-3">{String(r.item_name ?? "—")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(r.quantity ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.net_sales)}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.payment_method ?? "—")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && !err && filtered.length > 0 && (
          <div className="border-t border-line px-4 py-3 text-[12px] text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
            Showing {filtered.length.toLocaleString()} line{filtered.length === 1 ? "" : "s"}{rows.length >= 1000 ? " · most recent 1,000 loaded" : ""}.
          </div>
        )}
      </div>
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live sales.</p>}
    </div>
  );
}
