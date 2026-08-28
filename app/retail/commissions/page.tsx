"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Tag, Percent, Settings2, Search, RefreshCw, Save, Coins } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Tab = "salesperson" | "rates" | "fcdha" | "settings";
type Row = Record<string, unknown>;
type Master = { item_code: string; item_name?: string; retail_price?: number; commission?: number; percentage?: number };
type FcRate = { item_code: string; commission: number };
type Cfg = { bonus_mode: string; bonus_basis: string; bonus_slab: number; bonus_per_slab: number };
type Branch = { id: number; name: string; chain?: string };

const TABS: { key: Tab; label: string }[] = [
  { key: "salesperson", label: "Salesperson" },
  { key: "rates", label: "Item Rates" },
  { key: "fcdha", label: "FC DHA" },
  { key: "settings", label: "Settings" },
];
const PERIODS = [
  { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" }, { key: "month", label: "This month" }, { key: "all", label: "All time" },
];
const num = (v: unknown) => Number(v) || 0;
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-PK");
const iso = (d: Date) => d.toISOString().slice(0, 10);
function periodFrom(p: string): string | null {
  const t = new Date(); const s = new Date(t);
  if (p === "7d") { s.setDate(t.getDate() - 6); return iso(s); }
  if (p === "30d") { s.setDate(t.getDate() - 29); return iso(s); }
  if (p === "month") return iso(new Date(t.getFullYear(), t.getMonth(), 1));
  return null; // all
}

export default function CommissionsPage() {
  const [tab, setTab] = useState<Tab>("salesperson");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // reference data
  const [master, setMaster] = useState<Master[]>([]);
  const [fc, setFc] = useState<FcRate[]>([]);
  const [cfg, setCfg] = useState<Cfg>({ bonus_mode: "floor", bonus_basis: "receipt", bonus_slab: 5000, bonus_per_slab: 50 });
  const [branches, setBranches] = useState<Branch[]>([]);
  // salesperson tab state
  const [period, setPeriod] = useState("30d");
  const [branch, setBranch] = useState("ALL");
  const [lines, setLines] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState("");

  const loadRef = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const [m, f, c, b] = await Promise.all([
      supabase.from("retail_commission_master").select("item_code,item_name,retail_price,commission,percentage").order("item_code").limit(5000),
      supabase.from("retail_fc_dha_comm").select("item_code,commission").order("item_code").limit(5000),
      supabase.from("retail_commission_config").select("bonus_mode,bonus_basis,bonus_slab,bonus_per_slab").eq("id", 1).maybeSingle(),
      supabase.from("retail_branches").select("id,name,chain").order("name"),
    ]);
    setMaster((m.data as Master[]) ?? []); setFc((f.data as FcRate[]) ?? []);
    if (c.data) setCfg(c.data as Cfg);
    setBranches((b.data as Branch[]) ?? []);
  }, []);

  const loadLines = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const from = periodFrom(period);
    let sq = supabase.from("retail_sale_lines").select("branch_id,salesperson,item_code,quantity,net_sales,sales_amount,receipt_txn,receipt_no,id").limit(5000);
    if (from) sq = sq.gte("sale_date", from);
    if (branch !== "ALL") sq = sq.eq("branch_id", Number(branch));
    const { data, error } = await sq;
    if (error) setErr(error.message);
    setLines((data as Row[]) ?? []);
    setLoading(false);
  }, [period, branch]);

  useEffect(() => { loadRef(); }, [loadRef]);
  useEffect(() => { if (tab === "salesperson") loadLines(); else setLoading(false); }, [tab, loadLines]);

  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.item_code, m])), [master]);
  const fcMap = useMemo(() => Object.fromEntries(fc.map((f) => [f.item_code, num(f.commission)])), [fc]);
  const fcDhaBranchIds = useMemo(() => new Set(branches.filter((b) => /dha/i.test(b.name) || /dha/i.test(b.chain || "")).map((b) => b.id)), [branches]);

  const earned = useMemo(() => {
    const by: Record<string, { sales: number; receipts: Set<string>; item: number }> = {};
    lines.forEach((l) => {
      const sp = String(l.salesperson || "—");
      const r = (by[sp] ||= { sales: 0, receipts: new Set(), item: 0 });
      r.sales += num(l.sales_amount);
      r.receipts.add(`${l.branch_id}|${l.receipt_txn || l.receipt_no || l.id}`);
      const qty = num(l.quantity); const code = String(l.item_code ?? "");
      let c = 0;
      if (fcDhaBranchIds.has(Number(l.branch_id)) && fcMap[code] != null) c = fcMap[code] * qty;
      else { const m = masterMap[code]; if (m) c = num(m.commission) > 0 ? num(m.commission) * qty : (num(m.percentage) / 100) * num(l.net_sales || l.sales_amount); }
      r.item += c;
    });
    return Object.entries(by).map(([sp, r]) => {
      const basis = cfg.bonus_basis === "sales" ? r.sales : r.receipts.size;
      const slabs = cfg.bonus_mode === "round" ? Math.round(basis / (num(cfg.bonus_slab) || 1)) : Math.floor(basis / (num(cfg.bonus_slab) || 1));
      const bonus = slabs * num(cfg.bonus_per_slab);
      return { sp, receipts: r.receipts.size, sales: r.sales, item: r.item, bonus, total: r.item + bonus };
    }).sort((a, b) => b.total - a.total);
  }, [lines, masterMap, fcMap, fcDhaBranchIds, cfg]);

  async function saveCfg() {
    if (!supabase) return;
    setSaved("saving");
    const { error } = await supabase.from("retail_commission_config").update({
      bonus_mode: cfg.bonus_mode, bonus_basis: cfg.bonus_basis, bonus_slab: num(cfg.bonus_slab), bonus_per_slab: num(cfg.bonus_per_slab),
    }).eq("id", 1);
    setSaved(error ? "error" : "saved"); setTimeout(() => setSaved(""), 2500);
  }

  const filteredMaster = useMemo(() => { const n = q.trim().toLowerCase(); return n ? master.filter((m) => m.item_code.toLowerCase().includes(n) || (m.item_name || "").toLowerCase().includes(n)) : master; }, [master, q]);
  const filteredFc = useMemo(() => { const n = q.trim().toLowerCase(); return n ? fc.filter((f) => f.item_code.toLowerCase().includes(n)) : fc; }, [fc, q]);

  const cards = useMemo(() => {
    if (tab !== "salesperson") return [];
    return [
      { label: "Salespeople", value: earned.length.toLocaleString(), Icon: Users, bg: "bg-salmon-soft" },
      { label: "Item commission", value: rs(earned.reduce((a, e) => a + e.item, 0)), Icon: Percent, bg: "bg-success-soft" },
      { label: "Bonus", value: rs(earned.reduce((a, e) => a + e.bonus, 0)), Icon: Coins, bg: "bg-periwinkle-soft" },
      { label: "Total payout", value: rs(earned.reduce((a, e) => a + e.total, 0)), Icon: Coins, bg: "bg-amber-soft" },
    ];
  }, [tab, earned]);

  return (
    <div className="px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Commissions</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Salesperson earnings, item rates, FC-DHA overrides &amp; bonus rules.</p>
        </div>
        <button onClick={() => { loadRef(); if (tab === "salesperson") loadLines(); }} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mt-6 flex gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05] w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setQ(""); }}
            className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${tab === t.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* SALESPERSON */}
      {tab === "salesperson" && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${period === p.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>{p.label}</button>
              ))}
            </div>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="ml-auto rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              <option value="ALL">All branches</option>
              {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            {cards.map(({ label, value, Icon, bg }) => (
              <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
                <div className="mt-3 text-[18px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
                <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]"><th className="px-4 py-3 font-semibold">Salesperson</th><th className="px-4 py-3 text-right font-semibold">Receipts</th><th className="px-4 py-3 text-right font-semibold">Sales</th><th className="px-4 py-3 text-right font-semibold">Item comm.</th><th className="px-4 py-3 text-right font-semibold">Bonus</th><th className="px-4 py-3 text-right font-semibold">Total</th></tr></thead>
              <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                {loading ? Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
                : err ? <tr><td colSpan={6} className="px-4 py-12 text-center text-danger">Couldn&apos;t load: {err}</td></tr>
                : earned.length === 0 ? <tr><td colSpan={6} className="px-4 py-16 text-center text-muted dark:text-[#a89f93]">No commissions yet — fills once sales &amp; rates are in.</td></tr>
                : earned.map((e) => (
                  <tr key={e.sp} className="text-ink dark:text-[#e7e2d8]"><td className="px-4 py-3 font-semibold">{e.sp}</td><td className="px-4 py-3 text-right tabular-nums">{e.receipts.toLocaleString()}</td><td className="px-4 py-3 text-right tabular-nums">{rs(e.sales)}</td><td className="px-4 py-3 text-right tabular-nums">{rs(e.item)}</td><td className="px-4 py-3 text-right tabular-nums">{rs(e.bonus)}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{rs(e.total)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}

      {/* ITEM RATES + FC DHA (shared table pattern) */}
      {(tab === "rates" || tab === "fcdha") && (
        <>
          <div className="mt-5 flex items-center justify-between gap-2">
            <div className="text-[12.5px] text-muted dark:text-[#a89f93]">{tab === "rates" ? `${master.length.toLocaleString()} items` : `${fc.length.toLocaleString()} FC-DHA overrides`}</div>
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <Search size={15} className="text-hint dark:text-[#8a8175]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item code" className="w-48 bg-transparent text-[13px] outline-none placeholder:text-hint dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {tab === "rates" ? <><th className="px-4 py-3 font-semibold">Item code</th><th className="px-4 py-3 font-semibold">Item name</th><th className="px-4 py-3 text-right font-semibold">Retail</th><th className="px-4 py-3 text-right font-semibold">Commission</th><th className="px-4 py-3 text-right font-semibold">%</th></>
                            : <><th className="px-4 py-3 font-semibold">Item code</th><th className="px-4 py-3 text-right font-semibold">Commission</th></>}
              </tr></thead>
              <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                {tab === "rates" ? (
                  filteredMaster.length === 0 ? <tr><td colSpan={5} className="px-4 py-16 text-center text-muted dark:text-[#a89f93]">No item rates yet — the commission file loads here.</td></tr>
                  : filteredMaster.slice(0, 500).map((m) => <tr key={m.item_code} className="text-ink dark:text-[#e7e2d8]"><td className="px-4 py-3 font-semibold">{m.item_code}</td><td className="px-4 py-3 text-muted dark:text-[#a89f93]">{m.item_name ?? "—"}</td><td className="px-4 py-3 text-right tabular-nums">{rs(num(m.retail_price))}</td><td className="px-4 py-3 text-right tabular-nums">{rs(num(m.commission))}</td><td className="px-4 py-3 text-right tabular-nums">{num(m.percentage)}%</td></tr>)
                ) : (
                  filteredFc.length === 0 ? <tr><td colSpan={2} className="px-4 py-16 text-center text-muted dark:text-[#a89f93]">No FC-DHA overrides yet.</td></tr>
                  : filteredFc.slice(0, 500).map((f) => <tr key={f.item_code} className="text-ink dark:text-[#e7e2d8]"><td className="px-4 py-3 font-semibold">{f.item_code}</td><td className="px-4 py-3 text-right tabular-nums">{rs(num(f.commission))}</td></tr>)
                )}
              </tbody>
            </table></div>
          </div>
        </>
      )}

      {/* SETTINGS (editable) */}
      {tab === "settings" && (
        <div className="mt-5 max-w-xl rounded-card border border-line bg-surface p-6 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h3 className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Salesperson bonus rules</h3>
          <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">A bonus is earned per slab of {cfg.bonus_basis === "sales" ? "sales" : "receipts"} — e.g. Rs {num(cfg.bonus_per_slab)} for every {num(cfg.bonus_slab).toLocaleString()} {cfg.bonus_basis === "sales" ? "in sales" : "receipts"}.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-[12.5px] font-semibold text-ink dark:text-[#e7e2d8]">Bonus basis
              <select value={cfg.bonus_basis} onChange={(e) => setCfg({ ...cfg, bonus_basis: e.target.value })} className="mt-1.5 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] font-normal outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white"><option value="receipt">Per receipt</option><option value="sales">Per sales amount</option></select>
            </label>
            <label className="text-[12.5px] font-semibold text-ink dark:text-[#e7e2d8]">Rounding
              <select value={cfg.bonus_mode} onChange={(e) => setCfg({ ...cfg, bonus_mode: e.target.value })} className="mt-1.5 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] font-normal outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white"><option value="floor">Floor (round down)</option><option value="round">Round nearest</option></select>
            </label>
            <label className="text-[12.5px] font-semibold text-ink dark:text-[#e7e2d8]">Slab size
              <input type="number" value={cfg.bonus_slab} onChange={(e) => setCfg({ ...cfg, bonus_slab: Number(e.target.value) })} className="mt-1.5 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] font-normal outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white" />
            </label>
            <label className="text-[12.5px] font-semibold text-ink dark:text-[#e7e2d8]">Bonus per slab (Rs)
              <input type="number" value={cfg.bonus_per_slab} onChange={(e) => setCfg({ ...cfg, bonus_per_slab: Number(e.target.value) })} className="mt-1.5 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] font-normal outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white" />
            </label>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button onClick={saveCfg} className="flex items-center gap-2 rounded-full bg-ink px-5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-[#141414]"><Save size={14} /> Save rules</button>
            {saved === "saved" && <span className="text-[13px] font-semibold text-success">Saved ✓</span>}
            {saved === "saving" && <span className="text-[13px] text-muted">Saving…</span>}
            {saved === "error" && <span className="text-[13px] font-semibold text-danger">Couldn&apos;t save</span>}
          </div>
        </div>
      )}

      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load commissions.</p>}
    </div>
  );
}
