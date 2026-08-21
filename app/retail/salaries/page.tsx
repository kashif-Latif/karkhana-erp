"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, BookText, Wallet, HandCoins, RefreshCw, Search, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Tab = "employees" | "ledger" | "salaries" | "wages";
type Row = Record<string, unknown>;
type Emp = { id: number; branch_id?: number; name: string; designation?: string; phone?: string; active?: boolean; monthly_salary?: number; pay_type?: string; hourly_rate?: number };
type Branch = { id: number; name: string };

const TABS: { key: Tab; label: string }[] = [
  { key: "employees", label: "Employees" },
  { key: "ledger", label: "Ledger" },
  { key: "salaries", label: "Salary Runs" },
  { key: "wages", label: "Wages" },
];
const num = (v: unknown) => Number(v) || 0;
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-PK");
const sum = (rows: Row[], k: string) => rows.reduce((t, r) => t + num(r[k]), 0);

export default function SalariesPage() {
  const [tab, setTab] = useState<Tab>("employees");
  const [emps, setEmps] = useState<Emp[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [ledger, setLedger] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("ALL");

  const empName = (id: unknown) => emps.find((e) => e.id === Number(id))?.name ?? "—";
  const branchName = (id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—";

  const loadRef = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const [e, b, l] = await Promise.all([
      supabase.from("retail_employees").select("id,branch_id,name,designation,phone,active,monthly_salary,pay_type,hourly_rate").order("name").limit(2000),
      supabase.from("retail_branches").select("id,name").order("name"),
      supabase.from("retail_employee_ledger").select("employee_id,advance,purchase_credit,paid").limit(5000),
    ]);
    setEmps((e.data as Emp[]) ?? []); setBranches((b.data as Branch[]) ?? []); setLedger((l.data as Row[]) ?? []);
  }, []);

  const load = useCallback(async (which: Tab) => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    if (which === "employees") { setRows([]); setLoading(false); return; }
    const q2 =
      which === "ledger"
        ? supabase.from("retail_employee_ledger").select("id,employee_id,entry_date,advance,purchase_credit,purchase_details,paid,note").order("entry_date", { ascending: false, nullsFirst: false }).limit(1000)
        : which === "salaries"
        ? supabase.from("retail_salary_payments").select("id,employee_id,pay_month,salary_amount,advance_deducted,net_paid,paid_on,note").order("pay_month", { ascending: false }).limit(1000)
        : supabase.from("retail_wage_payments").select("id,employee_id,pay_date,amount,note").order("pay_date", { ascending: false, nullsFirst: false }).limit(1000);
    const { data, error } = await q2;
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadRef(); }, [loadRef]);
  useEffect(() => { load(tab); }, [tab, load]);

  // outstanding per employee = advances + purchase credit − paid
  const outstanding = useMemo(() => {
    const m: Record<string, number> = {};
    ledger.forEach((l) => { const k = String(l.employee_id); m[k] = (m[k] || 0) + num(l.advance) + num(l.purchase_credit) - num(l.paid); });
    return m;
  }, [ledger]);
  const totalOutstanding = useMemo(() => Object.values(outstanding).reduce((a, v) => a + Math.max(v, 0), 0), [outstanding]);

  const empsF = useMemo(() => {
    const n = q.trim().toLowerCase();
    return emps.filter((e) => (branch === "ALL" || String(e.branch_id) === branch) && (!n || e.name.toLowerCase().includes(n) || (e.designation || "").toLowerCase().includes(n)));
  }, [emps, q, branch]);

  const cards = useMemo(() => {
    if (tab === "employees") {
      const active = emps.filter((e) => e.active !== false);
      return [
        { label: "Employees", value: emps.length.toLocaleString(), Icon: Users, bg: "bg-salmon-soft" },
        { label: "Active", value: active.length.toLocaleString(), Icon: Users, bg: "bg-success-soft" },
        { label: "Monthly payroll", value: rs(active.reduce((a, e) => a + num(e.monthly_salary), 0)), Icon: Wallet, bg: "bg-periwinkle-soft" },
        { label: "Outstanding", value: rs(totalOutstanding), Icon: AlertTriangle, bg: "bg-amber-soft" },
      ];
    }
    if (tab === "ledger") return [
      { label: "Advances", value: rs(sum(rows, "advance")), Icon: HandCoins, bg: "bg-amber-soft" },
      { label: "Purchase credit", value: rs(sum(rows, "purchase_credit")), Icon: BookText, bg: "bg-periwinkle-soft" },
      { label: "Repaid", value: rs(sum(rows, "paid")), Icon: Wallet, bg: "bg-success-soft" },
      { label: "Entries", value: rows.length.toLocaleString(), Icon: BookText, bg: "bg-salmon-soft" },
    ];
    if (tab === "salaries") return [
      { label: "Salary paid", value: rs(sum(rows, "salary_amount")), Icon: Wallet, bg: "bg-salmon-soft" },
      { label: "Advance deducted", value: rs(sum(rows, "advance_deducted")), Icon: HandCoins, bg: "bg-amber-soft" },
      { label: "Net paid", value: rs(sum(rows, "net_paid")), Icon: Wallet, bg: "bg-success-soft" },
      { label: "Runs", value: rows.length.toLocaleString(), Icon: BookText, bg: "bg-periwinkle-soft" },
    ];
    return [
      { label: "Wages paid", value: rs(sum(rows, "amount")), Icon: HandCoins, bg: "bg-salmon-soft" },
      { label: "Payouts", value: rows.length.toLocaleString(), Icon: BookText, bg: "bg-periwinkle-soft" },
      { label: "—", value: "", Icon: Wallet, bg: "bg-success-soft" },
      { label: "—", value: "", Icon: Wallet, bg: "bg-amber-soft" },
    ];
  }, [tab, emps, rows, totalOutstanding]);

  const empty = tab === "employees" ? empsF.length === 0 : rows.length === 0;

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Salaries</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Staff, advances &amp; purchase credit, salary runs and wages.</p>
        </div>
        <button onClick={() => { loadRef(); load(tab); }} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mt-5 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => { setTab(t.key); setQ(""); }}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${tab === t.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, bg }, i) => (
          <div key={i} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17] ${label === "—" ? "hidden lg:block lg:opacity-0" : ""}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[17px] font-extrabold tabular-nums text-ink sm:text-[19px] dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      {tab === "employees" && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            <option value="ALL">All branches</option>
            {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
          <div className="flex flex-1 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05] sm:flex-none">
            <Search size={15} className="text-hint dark:text-[#8a8175]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff" className="w-full bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-44 dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
          </div>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {tab === "employees" && <><th className="px-4 py-3 font-semibold">Name</th><th className="px-4 py-3 font-semibold">Branch</th><th className="px-4 py-3 font-semibold">Designation</th><th className="px-4 py-3 text-right font-semibold">Salary</th><th className="px-4 py-3 text-right font-semibold">Outstanding</th><th className="px-4 py-3 font-semibold">Status</th></>}
                {tab === "ledger" && <><th className="px-4 py-3 font-semibold">Employee</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 text-right font-semibold">Advance</th><th className="px-4 py-3 text-right font-semibold">Purchase</th><th className="px-4 py-3 text-right font-semibold">Repaid</th><th className="px-4 py-3 font-semibold">Note</th></>}
                {tab === "salaries" && <><th className="px-4 py-3 font-semibold">Employee</th><th className="px-4 py-3 font-semibold">Month</th><th className="px-4 py-3 text-right font-semibold">Salary</th><th className="px-4 py-3 text-right font-semibold">Adv. deducted</th><th className="px-4 py-3 text-right font-semibold">Net paid</th><th className="px-4 py-3 font-semibold">Paid on</th></>}
                {tab === "wages" && <><th className="px-4 py-3 font-semibold">Employee</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Note</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load: {err}</td></tr>
              ) : empty ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">Nothing here yet — fills once staff &amp; pay records are brought in.</td></tr>
              ) : tab === "employees" ? (
                empsF.map((e) => {
                  const out = outstanding[String(e.id)] || 0;
                  return (
                    <tr key={e.id} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                      <td className="px-4 py-3 font-semibold">{e.name}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{branchName(e.branch_id)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{e.designation ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{e.pay_type === "hourly" ? `${rs(num(e.hourly_rate))}/hr` : rs(num(e.monthly_salary))}</td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${out > 0 ? "text-danger" : "text-muted dark:text-[#a89f93]"}`}>{out > 0 ? rs(out) : "—"}</td>
                      <td className="px-4 py-3">{e.active !== false ? <span className="text-[12px] font-semibold text-success">Active</span> : <span className="text-[12px] font-semibold text-muted">Inactive</span>}</td>
                    </tr>
                  );
                })
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    {tab === "ledger" && <>
                      <td className="px-4 py-3 font-semibold">{empName(r.employee_id)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.entry_date ?? "—")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(r.advance) ? rs(num(r.advance)) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(r.purchase_credit) ? rs(num(r.purchase_credit)) : "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-success">{num(r.paid) ? rs(num(r.paid)) : "—"}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.note || r.purchase_details || "—")}</td>
                    </>}
                    {tab === "salaries" && <>
                      <td className="px-4 py-3 font-semibold">{empName(r.employee_id)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.pay_month ?? "—")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{rs(num(r.salary_amount))}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(r.advance_deducted) ? rs(num(r.advance_deducted)) : "—"}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{rs(num(r.net_paid))}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.paid_on ?? "—")}</td>
                    </>}
                    {tab === "wages" && <>
                      <td className="px-4 py-3 font-semibold">{empName(r.employee_id)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.pay_date ?? "—")}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(num(r.amount))}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.note ?? "—")}</td>
                    </>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load salaries.</p>}
    </div>
  );
}
