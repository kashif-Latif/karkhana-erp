"use client";
import { useEffect, useMemo, useState } from "react";
import { BookText, Receipt, ArrowLeftRight, Landmark, RefreshCw, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Tab = "daily" | "expenses" | "cashflow" | "bank";
type Row = Record<string, unknown>;
type Branch = { id: number; name: string };

const TABS: { key: Tab; label: string }[] = [
  { key: "daily", label: "Daily Book" },
  { key: "expenses", label: "Expenses" },
  { key: "cashflow", label: "Cashflow" },
  { key: "bank", label: "Bank" },
];
const money = (n: unknown) => "Rs " + Math.round(Number(n) || 0).toLocaleString("en-PK");
const sum = (rows: Row[], k: string) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

export default function CashBookPage() {
  const [tab, setTab] = useState<Tab>("daily");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const branchName = (id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—";

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.from("retail_branches").select("id,name").order("name").then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);

  async function load(which: Tab) {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const q =
      which === "daily"
        ? supabase.from("retail_daily_book").select("id,branch_id,book_date,opening_balance,net_sale,cash_sale,card_sale,expense,physical_cash").order("book_date", { ascending: false, nullsFirst: false }).limit(1000)
        : which === "expenses"
        ? supabase.from("retail_expenses").select("id,branch_id,expense_date,category,description,amount,paid_via").order("expense_date", { ascending: false, nullsFirst: false }).limit(1000)
        : which === "cashflow"
        ? supabase.from("retail_ho_cashflow").select("id,flow_date,direction,category,amount,description").order("flow_date", { ascending: false, nullsFirst: false }).limit(1000)
        : supabase.from("retail_bank_settlements").select("id,branch_id,sale_date,actual_received,note").order("sale_date", { ascending: false, nullsFirst: false }).limit(1000);
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(tab); /* eslint-disable-next-line */ }, [tab]);

  const cards = useMemo(() => {
    if (tab === "daily") return [
      { label: "Net sale", value: money(sum(rows, "net_sale")), Icon: BookText, bg: "bg-salmon-soft" },
      { label: "Cash", value: money(sum(rows, "cash_sale")), Icon: BookText, bg: "bg-success-soft" },
      { label: "Card", value: money(sum(rows, "card_sale")), Icon: BookText, bg: "bg-periwinkle-soft" },
      { label: "Expense", value: money(sum(rows, "expense")), Icon: Receipt, bg: "bg-amber-soft" },
    ];
    if (tab === "expenses") return [
      { label: "Total expenses", value: money(sum(rows, "amount")), Icon: Receipt, bg: "bg-salmon-soft" },
      { label: "Entries", value: rows.length.toLocaleString(), Icon: Receipt, bg: "bg-periwinkle-soft" },
      { label: "—", value: "", Icon: Receipt, bg: "bg-success-soft" },
      { label: "—", value: "", Icon: Receipt, bg: "bg-amber-soft" },
    ];
    if (tab === "cashflow") {
      const ins = rows.filter((r) => String(r.direction).toLowerCase() === "in");
      const outs = rows.filter((r) => String(r.direction).toLowerCase() === "out");
      return [
        { label: "Cash in", value: money(sum(ins, "amount")), Icon: ArrowDownRight, bg: "bg-success-soft" },
        { label: "Cash out", value: money(sum(outs, "amount")), Icon: ArrowUpRight, bg: "bg-salmon-soft" },
        { label: "Net", value: money(sum(ins, "amount") - sum(outs, "amount")), Icon: ArrowLeftRight, bg: "bg-periwinkle-soft" },
        { label: "Entries", value: rows.length.toLocaleString(), Icon: ArrowLeftRight, bg: "bg-amber-soft" },
      ];
    }
    return [
      { label: "Settlements", value: rows.length.toLocaleString(), Icon: Landmark, bg: "bg-salmon-soft" },
      { label: "Received", value: money(sum(rows, "actual_received")), Icon: Landmark, bg: "bg-success-soft" },
      { label: "—", value: "", Icon: Landmark, bg: "bg-periwinkle-soft" },
      { label: "—", value: "", Icon: Landmark, bg: "bg-amber-soft" },
    ];
  }, [tab, rows]);

  return (
    <div className="px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Cash Book</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Daily cash book, expenses, head-office cashflow &amp; bank.</p>
        </div>
        <button onClick={() => load(tab)} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mt-6 flex gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05] w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${tab === t.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, bg }, i) => (
          <div key={i} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17] ${label === "—" ? "opacity-0" : ""}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {tab === "daily" && <><th className="px-4 py-3 font-semibold">Branch</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 text-right font-semibold">Opening</th><th className="px-4 py-3 text-right font-semibold">Net sale</th><th className="px-4 py-3 text-right font-semibold">Cash</th><th className="px-4 py-3 text-right font-semibold">Expense</th><th className="px-4 py-3 text-right font-semibold">Physical</th></>}
                {tab === "expenses" && <><th className="px-4 py-3 font-semibold">Branch</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Category</th><th className="px-4 py-3 font-semibold">Description</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Paid via</th></>}
                {tab === "cashflow" && <><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Direction</th><th className="px-4 py-3 font-semibold">Category</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Description</th></>}
                {tab === "bank" && <><th className="px-4 py-3 font-semibold">Branch</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 text-right font-semibold">Received</th><th className="px-4 py-3 font-semibold">Note</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load: {err}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">Nothing here yet — fills once the cash book is brought in.</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    {tab === "daily" && <>
                      <td className="px-4 py-3 font-semibold">{branchName(r.branch_id)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.book_date ?? "—")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.opening_balance)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.net_sale)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.cash_sale)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.expense)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.physical_cash == null ? "—" : money(r.physical_cash)}</td>
                    </>}
                    {tab === "expenses" && <>
                      <td className="px-4 py-3 font-semibold">{branchName(r.branch_id)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.expense_date ?? "—")}</td>
                      <td className="px-4 py-3">{String(r.category ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.description ?? "—")}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.amount)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.paid_via ?? "—")}</td>
                    </>}
                    {tab === "cashflow" && <>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.flow_date ?? "—")}</td>
                      <td className="px-4 py-3">{String(r.direction).toLowerCase() === "in"
                        ? <span className="inline-block rounded-full bg-success-soft px-2.5 py-1 text-[11.5px] font-semibold text-success dark:bg-white/[0.08]">In</span>
                        : <span className="inline-block rounded-full bg-salmon-soft px-2.5 py-1 text-[11.5px] font-semibold text-salmon-strong dark:bg-white/[0.08] dark:text-salmon">Out</span>}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.category ?? "—")}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.amount)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.description ?? "—")}</td>
                    </>}
                    {tab === "bank" && <>
                      <td className="px-4 py-3 font-semibold">{branchName(r.branch_id)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.sale_date ?? "—")}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.actual_received == null ? "—" : money(r.actual_received)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.note ?? "—")}</td>
                    </>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load the cash book.</p>}
    </div>
  );
}
