"use client";
/* THE FS TRADERS KIT.
 *
 * WHY IT EXISTS
 *   The department is twenty-odd screens that are all the same shape: a title,
 *   a date range, four figures across the top, one table, one dialog. Written
 *   out longhand that is roughly two hundred lines per page of which a hundred
 *   and seventy are identical, and the first time a column header needs a
 *   different colour somebody edits twenty files and misses three.
 *
 *   So the shape lives here once. A page below is the part that is actually
 *   different: which table it reads and what the columns mean.
 *
 * WHAT IT IS NOT
 *   Not a design system and not a place for business logic. The cash book sum,
 *   the commission rules and the import guard belong to the pages and to the
 *   database. This file knows about layout and loading states.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, type LucideIcon } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/* ── numbers & dates ─────────────────────────────────────────────────────── */

export type Row = Record<string, unknown>;

export const num = (v: unknown) => Number(v) || 0;
export const money = (v: unknown) => "Rs " + Math.round(num(v)).toLocaleString("en-PK");
/** Money that is allowed to be blank. A missing physical cash count is not zero. */
export const moneyOrDash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : money(v));
export const sum = (rows: Row[], k: string) => rows.reduce((t, r) => t + num(r[k]), 0);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const text = (v: unknown, dash = "—") => (v === null || v === undefined || v === "" ? dash : String(v));

/** 'YYYY-MM' for the month a date falls in. Salary and summary screens key on this. */
export const monthKey = (d: Date | string = new Date()) => {
  const x = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
};
export const monthBounds = (mk: string): [string, string] => {
  const [y, m] = mk.split("-").map(Number);
  return [`${mk}-01`, iso(new Date(y, m, 0))];
};
export const daysInMonth = (mk: string) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};
export const monthLabel = (mk: string) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};
/** The last n months, newest first, as 'YYYY-MM'. */
export const recentMonths = (n = 15) => {
  const out: string[] = [];
  const t = new Date();
  for (let i = 0; i < n; i++) out.push(monthKey(new Date(t.getFullYear(), t.getMonth() - i, 1)));
  return out;
};

/* ── shared types ────────────────────────────────────────────────────────── */

export type Branch = { id: number; name: string; code?: string; chain?: string; color?: string; active?: boolean; nimbus_name?: string | null; needs_review?: boolean; business?: string };
export type Employee = { id: number; name: string; branch_id: number | null; designation?: string; active?: boolean; monthly_salary?: number; pay_type?: string; hourly_rate?: number | null; phone?: string; repay_freq?: string | null; repay_amount?: number | null };

/* ── the constants the business runs on ──────────────────────────────────
 * Each of these is a number somebody discovered the hard way. They live here
 * rather than in the screen that uses them so there is exactly one place to
 * change them, and so a second screen cannot quietly disagree with the first.
 */

/** The acquirer's cut on a card sale. The bank credits NET; the till records
 *  GROSS. Reconciling one against the other without this reports ~1.28% of card
 *  turnover as permanently missing. */
export const CARD_RATE_PCT = 1.276;
export const cardExpected = (grossCardSale: number, ratePct = CARD_RATE_PCT) =>
  grossCardSale * (1 - ratePct / 100);

/** Matching tolerance for a card settlement: Rs 2, or 0.5% of the expected
 *  figure, whichever is larger. Rs 2 because rounding; 0.5% because a big
 *  shop-day's rounding is bigger. */
export const crTol = (expected: number) => Math.max(2, Math.abs(expected) * 0.005);

/** A shop-day still short after this many days is filled from the unmatched
 *  pool rather than reported as a shortage — by then the money has landed,
 *  it just never got tied to a day. */
export const CR_AGE_DAYS = 3;

/** Commission bonus, ported verbatim. `total` is RUPEES, never a count. */
export type CommCfg = { bonus_mode?: string; bonus_basis?: string; bonus_slab?: number; bonus_per_slab?: number };
export function commBonus(total: number, cfg: CommCfg): number {
  const slab = num(cfg.bonus_slab) || 5000;
  const per = num(cfg.bonus_per_slab) || 50;
  /* 'exact' pays only on an exact multiple of the slab. It looks like a bug
     and is not — it is a rule some shops run, and floor() would overpay them
     on every receipt that lands between slabs. */
  if (cfg.bonus_mode === "exact") return total > 0 && total % slab === 0 ? (total / slab) * per : 0;
  return Math.floor(total / slab) * per;
}

/** Head Office is a branch like any other in the data; it is only the UI that
 *  separates it, because the people who run it are a different team. */
export const isHeadOffice = (b?: Branch) => (b?.chain ?? "").toLowerCase().includes("head office");

/** Only 'hourly' is hourly. Everyone else is on a flat monthly salary — there
 *  is no third pay type in the retail business, whatever the column allows. */
export const isHourly = (e?: Employee | null) => !!e && e.pay_type === "hourly";

/** Hours between two "HH:MM" strings, crossing midnight if the shift does.
 *  Either side missing means no hours: a person clocked in and never out has
 *  not worked an unknown number of hours, they have an incomplete record, and
 *  guessing one would put money on it. */
export const attHours = (tin?: string | null, tout?: string | null): number => {
  if (!tin || !tout) return 0;
  const p = (s: string) => { const a = String(s).split(":"); return (+a[0] || 0) * 60 + (+a[1] || 0); };
  let d = p(tout) - p(tin);
  if (d < 0) d += 1440;
  return d / 60;
};

/** Sunday is an automatic paid holiday across the shops — it is never marked,
 *  and a screen that asks for it is asking for noise. */
export const isSunday = (ds: string) => new Date(ds + "T00:00:00").getDay() === 0;

/* ── data hooks ──────────────────────────────────────────────────────────── */

/** Branches, once per page. Every FS screen needs them to name a row. */
export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.from("retail_branches").select("id,name,code,chain,color,active").order("name")
      .then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);
  const name = useCallback(
    (id: unknown) => branches.find((b) => b.id === Number(id))?.name ?? "—",
    [branches]
  );
  return { branches, branchName: name };
}

/** Employees, optionally scoped to head office or to the shops.
 *
 *  `repay_freq` / `repay_amount` are selected because the repayment screen
 *  pre-fills the deduction from them, and a screen that has to re-query for two
 *  columns it could have asked for the first time is a screen that will forget.
 */
export function useEmployees(scope: "all" | "shops" | "ho" = "all") {
  const { branches } = useBranches();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.from("retail_employees")
      .select("id,name,branch_id,designation,active,monthly_salary,pay_type,hourly_rate,phone,repay_freq,repay_amount")
      .order("name")
      .then(({ data }) => setEmployees((data as Employee[]) ?? []));
  }, [tick]);

  const scoped = useMemo(() => {
    if (scope === "all") return employees;
    const hoIds = new Set(branches.filter(isHeadOffice).map((b) => b.id));
    return employees.filter((e) => (scope === "ho" ? hoIds.has(Number(e.branch_id)) : !hoIds.has(Number(e.branch_id))));
  }, [employees, branches, scope]);

  /* Most screens want only people still working here. Leavers keep their rows
     — their history has to stay readable — but a leaver in a payroll total or
     an attendance list is a wrong number and a confusing screen. Callers that
     genuinely want everyone (the Employees admin screen) take `allEmployees`. */
  const active = useMemo(() => scoped.filter((e) => e.active !== false), [scoped]);

  return { employees: active, allEmployees: scoped, everyEmployee: employees, branches,
           reloadEmployees: () => setTick((t) => t + 1) };
}

/* ── paging ──────────────────────────────────────────────────────────────
 * PostgREST caps a response at 1000 rows. A `.limit(5000)` does not raise
 * that — it silently returns what it returns, and a sales total that is quietly
 * a lower bound is worse than one that errors, because nobody checks a number
 * that looks plausible. Every screen that reads sale lines pages instead.
 */
export async function fetchAll<T = Row>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  step = 1000,
  hardCap = 200000
): Promise<{ rows: T[]; error: string }> {
  const out: T[] = [];
  for (let from = 0; from < hardCap; from += step) {
    const { data, error } = await build(from, from + step - 1);
    if (error) return { rows: out, error: error.message };
    const got = (data as T[]) ?? [];
    out.push(...got);
    if (got.length < step) break;
  }
  return { rows: out, error: "" };
}

type QueryBuilder = { select: (cols: string) => unknown };

/** The fetch-with-loading-and-error dance every screen repeats.
 *  `build` gets the client and returns a finished PostgREST query. */
export function useRetailQuery<T = Row>(
  build: (db: NonNullable<typeof supabase>) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  deps: unknown[]
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    (async () => {
      const { data, error } = await build(supabase!);
      if (!live) return;
      if (error) setErr(error.message);
      setRows((data as T[]) ?? []);
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { rows, loading, err, reload: () => setTick((t) => t + 1), setRows };
}

/* ── layout ──────────────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, onRefresh, loading, children }: {
  title: string; subtitle?: string; onRefresh?: () => void; loading?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {onRefresh && (
          <button onClick={onRefresh} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      </div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">{children}</div>;
}

export type Stat = { label: string; value: string; Icon: LucideIcon; bg?: string };

export function StatCards({ stats, loading }: { stats: Stat[]; loading?: boolean }) {
  const bgs = ["bg-salmon-soft", "bg-success-soft", "bg-periwinkle-soft", "bg-amber-soft"];
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(({ label, value, Icon, bg }, i) => (
        <div key={i} className={`rounded-card border border-line ${bg ?? bgs[i % 4]} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
          <div className="mt-3 text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
          <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="mt-5 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => onChange(t.key)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${value === t.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export type Col<T> = {
  head: string;
  /** Right-aligns and tabular-nums the cell. Every money and count column wants this. */
  right?: boolean;
  bold?: boolean;
  muted?: boolean;
  cell: (row: T, index: number) => React.ReactNode;
};

/** The table shell, with the four states every screen has to handle:
 *  skeleton while loading, the error, the empty case, and rows. */
export function DataTable<T>({ cols, rows, loading, err, empty, minWidth = 640, footer }: {
  cols: Col<T>[]; rows: T[]; loading?: boolean; err?: string; empty?: string; minWidth?: number;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
              {cols.map((c, i) => (
                <th key={i} className={`px-4 py-3 font-semibold ${c.right ? "text-right" : ""}`}>{c.head}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-white/[0.05]">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}><td colSpan={cols.length} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>
              ))
            ) : err ? (
              <tr><td colSpan={cols.length} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load: {err}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">{empty ?? "Nothing here yet."}</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                  {cols.map((c, j) => (
                    <td key={j} className={`px-4 py-3 ${c.right ? "text-right tabular-nums" : ""} ${c.bold ? "font-semibold" : ""} ${c.muted ? "text-muted dark:text-[#a89f93]" : ""}`}>
                      {c.cell(r, i)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer && !loading && rows.length > 0 && (
            <tfoot className="border-t-2 border-line dark:border-white/[0.08]">{footer}</tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ── small pieces ────────────────────────────────────────────────────────── */

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "bad" | "warn" | "info"; children: React.ReactNode }) {
  const cls = {
    neutral: "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]",
    good: "bg-success-soft text-success dark:bg-white/[0.08] dark:text-success",
    bad: "bg-danger-soft text-danger dark:bg-white/[0.08] dark:text-danger",
    warn: "bg-amber-soft text-amber-strong dark:bg-white/[0.08] dark:text-amber",
    info: "bg-periwinkle-soft text-periwinkle-strong dark:bg-white/[0.08] dark:text-periwinkle",
  }[tone];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${cls}`}>{children}</span>;
}

/** A difference that is meant to be zero. Red when it is not, because on the
 *  cash book a non-zero difference is the only number anybody is looking for. */
export function Diff({ value }: { value: number }) {
  if (Math.abs(value) < 1) return <Pill tone="good">Clear</Pill>;
  return <Pill tone="bad">{value > 0 ? "+" : ""}{money(value)}</Pill>;
}

export function Select({ value, onChange, children, className = "" }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className={`rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink outline-none transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white ${className}`}>
      {children}
    </select>
  );
}

export function BranchPicker({ branches, value, onChange, allLabel = "All branches" }: {
  branches: Branch[]; value: string; onChange: (v: string) => void; allLabel?: string;
}) {
  return (
    <Select value={value} onChange={onChange}>
      <option value="">{allLabel}</option>
      {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
    </Select>
  );
}

export function MonthPicker({ value, onChange, months = recentMonths() }: {
  value: string; onChange: (v: string) => void; months?: string[];
}) {
  return (
    <Select value={value} onChange={onChange}>
      {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </Select>
  );
}

export function PreviewNote() {
  if (isSupabaseConfigured) return null;
  return <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load this screen.</p>;
}

/** A note explaining where a figure comes from. The old app made every number
 *  tappable for this reason: a total nobody can explain is a total nobody
 *  trusts, and the first question about any of these screens is "from where?". */
export function SourceNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-xl2 border border-line bg-panel/60 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-[#a89f93]">
      {children}
    </p>
  );
}

export type { QueryBuilder };
