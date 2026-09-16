"use client";
/* RETAIL DASHBOARD — the shop-floor numbers, and the one nag that guards them.
 *
 * WHY THE PAGING MATTERS (rule 1)
 *   PostgREST caps a response at 1000 rows. `.limit(5000)` does not raise that
 *   cap — it just stops asking. Over the default 30-day window across every
 *   branch this screen was reading the first page of sale lines and printing
 *   the sum as "Total Sales", with no cap warning anywhere on the page (the
 *   Sales screen at least said "capped at 5,000"). A headline total that is
 *   quietly a lower bound is worse than one that errors, because nobody
 *   double-checks a number that looks plausible. Everything here goes through
 *   fetchAll.
 *
 * WHY THE UPLOAD REMINDER IS ON THE DASHBOARD
 *   retail_upload_log records which shop-day has had which file imported. The
 *   importer writes it and, until this card, NOTHING read it. A shop-day that
 *   was never imported is not a gap in a report — it is a day of revenue that
 *   never entered the system at all, and every figure above is short by it
 *   without saying so. The reminder is the only thing that turns silence into
 *   a visible list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet, TrendingUp, Receipt, Coins, ScrollText, Package, Store, Layers,
  AlertTriangle, CalendarClock, CheckCircle2,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, BranchPicker, PreviewNote, SourceNote,
  useBranches, money, num, text, today, fetchAll, type Branch, type Row, type Col,
} from "@/components/retail/kit";

/* ── payment methods, keyed the way the data is actually written ─────────────
 * These seven strings are the CHECK constraint on retail_sale_lines
 * (payment_method in 'cash','jazzcash','meezan_card','online','other','credit',
 * 'unclassified') and they are what the Nimbus importer writes.
 *
 * This map used to be keyed cash / card / jazz / online / easypaisa /
 * unclassified. Three of those keys — card, jazz, easypaisa — match nothing
 * that exists, so card and JazzCash sales fell through to the fallback and the
 * donut printed the raw database key in fallback grey: two identical-looking
 * grey wedges labelled "meezan_card" and "jazzcash", and an "easypaisa" slice
 * that could never appear at all.
 *
 * `credit` is UDHAAR — a sale taken on account, money not yet received — and it
 * is deliberately not called "Card". Nimbus MOP "Credit" being read as a credit
 * card is what made FC DHA's 1 Sep card figure read 36,100 instead of 33,400.
 * It gets its own colour for the same reason.
 */
const PM: Record<string, { label: string; color: string }> = {
  cash:         { label: "Cash",            color: "#7FC489" },
  meezan_card:  { label: "Card",            color: "#A6C0E6" },
  jazzcash:     { label: "JazzCash",        color: "#EDA6D0" },
  credit:       { label: "Credit (udhaar)", color: "#E4B47E" },
  online:       { label: "Online",          color: "#D2B9EA" },
  other:        { label: "Other",           color: "#EBA98F" },
  unclassified: { label: "Unclassified",    color: "#B4ABA0" },
};
/** Donut order: the real keys first, in the order above, then anything the
 *  database grows later so a new method is still visible rather than dropped. */
const PM_ORDER = Object.keys(PM);

/** "Topshop" is one word in the database and two everywhere a person reads it.
 *  One helper so the by-business table and the store headings cannot disagree. */
const bizLabel = (c?: string | null) => (c === "Topshop" ? "Top Shop" : c || "—");

/* ── the upload reminder ─────────────────────────────────────────────────── */

const UPLOAD_KINDS: [string, string][] = [
  ["sales", "Sales"], ["expenses", "Expenses"], ["noncash", "Non-cash"],
];

/** Shift a 'YYYY-MM-DD' by n days using the string PARTS only.
 *  Date.UTC in, getUTC* out — a local-midnight Date formatted with
 *  toISOString() lands a day early in every UTC+ timezone, which is exactly how
 *  a seven-day window silently becomes an eight-day one in Karachi. */
function shiftDay(ds: string, n: number): string {
  const [y, m, d] = ds.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

type MissKind = { kind: string; label: string };
type MissUnit = { unit: string; label: string; miss: MissKind[] };
type MissDay = { date: string; units: MissUnit[] };

/** Look back seven days to YESTERDAY and cross-reference retail_upload_log
 *  against the three file kinds for every branch that has ever sold anything.
 *
 *  Today is excluded on purpose: the day is not over, so nothing is late yet,
 *  and a reminder that fires for today cries wolf every morning until people
 *  stop reading it.
 *
 *  A branch is skipped for any day BEFORE its first-ever upload. A shop that
 *  joined on Thursday was not failing to upload on Monday, and listing four
 *  impossible days next to two real ones is how a useful list becomes noise. A
 *  branch with no upload log at all is only ever asked about yesterday, for the
 *  same reason.
 *
 *  UNIT KEY: the importer on this build stamps `unit` with the BRANCH ID, so
 *  that is what is looked up here. The reminder has to key exactly the way the
 *  writer keys, or every day reads as missing for ever. */
async function checkUploadsCatchup(branches: Branch[]): Promise<MissDay[]> {
  if (!supabase) return [];
  const live = branches.filter((b) => b.active !== false);
  if (!live.length) return [];

  /* "Active" means the branch has sale lines at all — a branch row that has
     never sold anything is not behind on its uploads, it is not trading. */
  const units: { unit: string; label: string }[] = [];
  for (const b of live) {
    const { count } = await supabase.from("retail_sale_lines")
      .select("id", { count: "exact", head: true }).eq("branch_id", b.id);
    if (count) units.push({ unit: String(b.id), label: b.name });
  }
  if (!units.length) return [];

  const end = shiftDay(today(), -1);
  const start = shiftDay(end, -6);

  const { data: logs } = await supabase.from("retail_upload_log")
    .select("unit,kind,log_date").gte("log_date", start).lte("log_date", end);
  const done = new Set(
    ((logs as Row[]) ?? []).map((l) => `${l.unit}|${l.log_date}|${l.kind}`)
  );

  const firstOf: Record<string, string> = {};
  for (const u of units) {
    const { data } = await supabase.from("retail_upload_log")
      .select("log_date").eq("unit", u.unit).order("log_date", { ascending: true }).limit(1);
    firstOf[u.unit] = ((data as Row[]) ?? [])[0] ? String((data as Row[])[0].log_date) : end;
  }

  const days: MissDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDay(end, -i);
    const um: MissUnit[] = [];
    units.forEach((u) => {
      if (d < firstOf[u.unit]) return;
      const miss = UPLOAD_KINDS
        .filter(([k]) => !done.has(`${u.unit}|${d}|${k}`))
        .map(([kind, label]) => ({ kind, label }));
      if (miss.length) um.push({ unit: u.unit, label: u.label, miss });
    });
    if (um.length) days.push({ date: d, units: um });
  }
  return days;
}

/* ── charts ──────────────────────────────────────────────────────────────── */

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
          <div className="w-20 shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink dark:text-[#f4f1ea]">{money(d.value)}</div>
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
        <text x="70" y="66" textAnchor="middle" className="fill-ink text-[15px] font-extrabold dark:fill-[#f4f1ea]">{money(total)}</text>
        <text x="70" y="82" textAnchor="middle" className="fill-hint text-[9px] uppercase tracking-wide dark:fill-[#8a8175]">total</text>
      </svg>
      <div className="flex min-w-[180px] flex-1 flex-col gap-2">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="flex-1 text-ink dark:text-[#e7e2d8]">{d.label}</span>
            <b className="tabular-nums text-ink dark:text-[#f4f1ea]">{((d.value / total) * 100).toFixed(1)}%</b>
            <span className="min-w-[84px] text-right tabular-nums text-muted dark:text-[#a89f93]">{money(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

type BranchAgg = { id: string; name: string; color: string; s: number; mg: number; e: number; net: number };

export default function RetailDashboard() {
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [branch, setBranch] = useState("");
  const { branches } = useBranches();
  const [sales, setSales] = useState<Row[]>([]);
  const [expenses, setExpenses] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [missing, setMissing] = useState<MissDay[]>([]);
  const [marking, setMarking] = useState("");

  const branchById = useCallback((id: unknown) => branches.find((b) => b.id === Number(id)), [branches]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);

    /* Paged, both of them. See the note at the top of the file. */
    const sP = fetchAll<Row>((lo, hi) => {
      let q = supabase!.from("retail_sale_lines")
        .select("branch_id,sales_amount,gross_margin,quantity,receipt_txn,receipt_no,id,payment_method");
      if (from) q = q.gte("sale_date", from);
      if (to) q = q.lte("sale_date", to);
      if (branch) q = q.eq("branch_id", Number(branch));
      return q.range(lo, hi);
    });
    const eP = fetchAll<Row>((lo, hi) => {
      let q = supabase!.from("retail_expenses").select("branch_id,amount,txn_type");
      if (from) q = q.gte("expense_date", from);
      if (to) q = q.lte("expense_date", to);
      if (branch) q = q.eq("branch_id", Number(branch));
      return q.range(lo, hi);
    });

    const [sres, eres] = await Promise.all([sP, eP]);
    if (sres.error) setErr(sres.error);
    else if (eres.error) setErr(eres.error);
    setSales(sres.rows); setExpenses(eres.rows);
    setLoading(false);
  }, [preset, cf, ct, branch]);
  useEffect(() => { load(); }, [load]);

  const refreshReminder = useCallback(() => {
    if (!isSupabaseConfigured || !supabase || !branches.length) return;
    checkUploadsCatchup(branches).then(setMissing).catch(() => setMissing([]));
  }, [branches]);
  useEffect(() => { refreshReminder(); }, [refreshReminder]);

  /** "Nothing to upload that day" — a closed shop, a public holiday. Stamps the
   *  missing kinds as done so the day stops being asked about. It writes the
   *  same table and the same conflict target the importer writes, which is what
   *  makes a marked day and an imported day indistinguishable afterwards. */
  async function markDone(day: MissDay) {
    if (!supabase) return;
    setMarking(day.date);
    const rows = day.units.flatMap((u) => u.miss.map((mk) => ({ unit: u.unit, log_date: day.date, kind: mk.kind })));
    const { error } = await supabase.from("retail_upload_log").upsert(rows, { onConflict: "unit,log_date,kind" });
    setMarking("");
    if (error) { setErr(error.message); return; }
    refreshReminder();
  }

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

    /* Income is a NEGATIVE expense in these aggregates, so a branch's net is
       margin − (expenses − income) without a second subtraction downstream. */
    const chainAgg: Record<string, { s: number; mg: number; e: number }> = {};
    sales.forEach((r) => { const c = branchById(r.branch_id)?.chain || "—"; (chainAgg[c] ||= { s: 0, mg: 0, e: 0 }); chainAgg[c].s += num(r.sales_amount); chainAgg[c].mg += num(r.gross_margin); });
    expenses.forEach((r) => { const c = branchById(r.branch_id)?.chain || "—"; (chainAgg[c] ||= { s: 0, mg: 0, e: 0 }); chainAgg[c].e += (r.txn_type === "income" ? -num(r.amount) : num(r.amount)); });

    const perBranch: Record<string, { s: number; mg: number; e: number }> = {};
    sales.forEach((r) => { const id = String(r.branch_id); (perBranch[id] ||= { s: 0, mg: 0, e: 0 }); perBranch[id].s += num(r.sales_amount); perBranch[id].mg += num(r.gross_margin); });
    expenses.forEach((r) => { const id = String(r.branch_id); (perBranch[id] ||= { s: 0, mg: 0, e: 0 }); perBranch[id].e += (r.txn_type === "income" ? -num(r.amount) : num(r.amount)); });

    return { totSales, totMargin, totExp, totInc, receipts, items, net, pay, chainAgg, perBranch };
  }, [sales, expenses, branchById]);

  const byBranch: BranchAgg[] = useMemo(() =>
    Object.keys(M.perBranch).map((id) => {
      const b = branchById(id);
      const a = M.perBranch[id];
      return { id, name: b?.name || "—", color: b?.color || "#EBA98F", ...a, net: a.mg - a.e };
    }).sort((a, b) => b.s - a.s), [M, branchById]);

  const chainRows = useMemo(() =>
    Object.keys(M.chainAgg).map((c) => ({ c, ...M.chainAgg[c], net: M.chainAgg[c].mg - M.chainAgg[c].e }))
      .sort((a, b) => b.s - a.s), [M]);

  /* Known methods first, in PM_ORDER; then anything unexpected the database has
     grown, so a new method shows up as itself rather than vanishing. */
  const payKeys = useMemo(() => {
    const present = Object.keys(M.pay).filter((k) => M.pay[k] > 0);
    const known = PM_ORDER.filter((k) => present.includes(k));
    const rest = present.filter((k) => !PM_ORDER.includes(k)).sort((a, b) => M.pay[b] - M.pay[a]);
    return [...known, ...rest];
  }, [M]);

  const headline = [
    { label: "Total sales", value: money(M.totSales), Icon: Wallet, bg: "bg-salmon-soft" },
    { label: "Gross margin", value: money(M.totMargin), Icon: TrendingUp, bg: "bg-success-soft" },
    { label: "Expenses", value: money(M.totExp), Icon: Receipt, bg: "bg-amber-soft" },
    { label: "Net profit", value: money(M.net), Icon: Coins, bg: "bg-periwinkle-soft" },
  ];
  const secondary = [
    { label: "Receipts", value: M.receipts.toLocaleString(), Icon: ScrollText, bg: "bg-lavender-soft" },
    { label: "Items sold", value: Math.round(M.items).toLocaleString(), Icon: Package, bg: "bg-pink-soft" },
    { label: "Avg receipt", value: money(M.receipts ? M.totSales / M.receipts : 0), Icon: Layers, bg: "bg-panel" },
    { label: "Branches selling", value: byBranch.filter((b) => b.s > 0).length.toLocaleString(), Icon: Store, bg: "bg-panel" },
  ];

  const branchCols: Col<BranchAgg>[] = [
    { head: "Branch", bold: true, cell: (r) => r.name },
    { head: "Sales", right: true, cell: (r) => money(r.s) },
    { head: "Gross margin", right: true, cell: (r) => money(r.mg) },
    { head: "Expenses", right: true, cell: (r) => money(r.e) },
    { head: "Net profit", right: true, bold: true, cell: (r) => (
        <span className={r.net < 0 ? "text-danger" : "text-success"}>{money(r.net)}</span>
      ) },
  ];

  const missingCount = missing.reduce((a, d) => a + d.units.reduce((x, u) => x + u.miss.length, 0), 0);
  const nextUp = missing[0]?.units[0];

  return (
    <Shell>
      <PageHeader title="Dashboard" subtitle="Shop sales, margin &amp; profit across all branches."
        onRefresh={() => { load(); refreshReminder(); }} loading={loading} />

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt}
        right={<BranchPicker branches={branches} value={branch} onChange={setBranch} />} />

      <StatCards stats={headline} loading={loading} />
      <StatCards stats={secondary} loading={loading} />

      {/* ── uploads still owed ─────────────────────────────────────────────
          A shop-day never imported is revenue that never entered the system.
          Nothing else in the app reads retail_upload_log, so if this card does
          not say it, nobody finds out. */}
      {missing.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-card border border-amber/40 bg-amber-soft dark:border-white/[0.06] dark:bg-white/[0.04]">
          <div className="flex flex-wrap items-start gap-2.5 px-5 py-4">
            <CalendarClock size={18} className="mt-0.5 shrink-0 text-amber-strong dark:text-amber" />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">
                {missingCount.toLocaleString()} file{missingCount === 1 ? "" : "s"} still needed across {missing.length} day{missing.length === 1 ? "" : "s"}
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink/80 dark:text-[#d6cfc4]">
                Upload them from the <b>Import</b> tab — order per shop is <b>Sales → Expenses → Non-cash</b>.
                {nextUp && <> Next up: <b>{nextUp.label} — {nextUp.miss[0].label}</b> for <b>{missing[0].date}</b>.</>}
              </p>
            </div>
          </div>
          {missing.map((d) => (
            <div key={d.date} className="border-t border-amber/40 px-5 py-3.5 dark:border-white/[0.06]">
              <div className="mb-2 text-[12.5px] font-bold text-ink dark:text-[#f4f1ea]">
                {d.date}
                {d.date === shiftDay(today(), -1) && <span className="ml-1.5 font-semibold text-muted dark:text-[#a89f93]">· yesterday</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-hint dark:text-[#8a8175]">
                      <th className="py-1.5 pr-3 font-semibold">Shop</th>
                      {UPLOAD_KINDS.map(([k, l]) => <th key={k} className="py-1.5 pr-3 font-semibold">{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {d.units.map((u) => (
                      <tr key={u.unit} className="text-ink dark:text-[#e7e2d8]">
                        <td className="py-1.5 pr-3 font-semibold">{u.label}</td>
                        {UPLOAD_KINDS.map(([k]) => (
                          <td key={k} className="py-1.5 pr-3">
                            {u.miss.some((x) => x.kind === k)
                              ? <span className="font-bold text-danger">• needed</span>
                              : <CheckCircle2 size={14} className="text-success" />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={() => markDone(d)} disabled={marking === d.date}
                className="mt-2.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
                {marking === d.date ? "Marking…" : `Nothing to upload for ${d.date} — mark done`}
              </button>
            </div>
          ))}
        </div>
      )}

      {M.pay.unclassified > 0 && (
        <div className="mt-4 flex items-start gap-2.5 rounded-card border border-amber/40 bg-amber-soft px-4 py-3 text-[13px] text-ink dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-[#f4f1ea]">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-strong dark:text-amber" />
          <span><b>{money(M.pay.unclassified)}</b> of non-cash sales are still unclassified — tag them as JazzCash or Card to sharpen the payment split.</span>
        </div>
      )}

      {chainRows.length > 1 && (
        <>
          <h3 className="mt-7 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">By business</h3>
          <DataTable
            cols={[
              { head: "Business", bold: true, cell: (r) => bizLabel(r.c) },
              { head: "Sales", right: true, cell: (r) => money(r.s) },
              { head: "Gross margin", right: true, cell: (r) => money(r.mg) },
              { head: "Expenses", right: true, cell: (r) => money(r.e) },
              { head: "Net profit", right: true, bold: true, cell: (r) => (
                  <span className={r.net < 0 ? "text-danger" : "text-success"}>{money(r.net)}</span>
                ) },
            ] as Col<typeof chainRows[number]>[]}
            rows={chainRows} loading={loading} minWidth={620} />
        </>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h3 className="mb-4 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Branch ranking</h3>
          {loading ? <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">Loading…</div>
            : <BarChart data={byBranch.map((b) => ({ name: b.name, value: b.s, color: b.color }))} />}
        </div>
        <div className="rounded-card border border-line bg-surface p-5 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h3 className="mb-4 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Payment method split</h3>
          {loading ? <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">Loading…</div>
            : <Donut data={payKeys.map((k) => ({ label: PM[k]?.label || text(k), value: M.pay[k], color: PM[k]?.color || "#B4ABA0" }))} />}
        </div>
      </div>

      {/* The bar chart above only ranks branches by turnover; it does not say
          whether any of them made money. byBranch was already computed for that
          chart and its margin, expense and net figures were being thrown away —
          a branch can top the chart and still be the one losing money. */}
      <h3 className="mt-7 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Sales by branch</h3>
      <DataTable cols={branchCols} rows={byBranch} loading={loading} err={err} minWidth={680}
        empty="No sales in this period — this fills when shop sales are brought in."
        footer={
          /* Summed from the rows above rather than from the headline figures, so
             the footer is by construction the sum of the column it sits under.
             Note the expense column is net of other income — that is what makes
             net profit = margin − this — which is why it can read lower than the
             gross Expenses card at the top. */
          <tr className="bg-panel/60 font-bold text-ink dark:bg-white/[0.04] dark:text-[#f4f1ea]">
            <td className="px-4 py-3">All branches</td>
            <td className="px-4 py-3 text-right tabular-nums">{money(byBranch.reduce((t, b) => t + b.s, 0))}</td>
            <td className="px-4 py-3 text-right tabular-nums">{money(byBranch.reduce((t, b) => t + b.mg, 0))}</td>
            <td className="px-4 py-3 text-right tabular-nums">{money(byBranch.reduce((t, b) => t + b.e, 0))}</td>
            <td className={`px-4 py-3 text-right tabular-nums ${M.net < 0 ? "text-danger" : "text-success"}`}>{money(byBranch.reduce((t, b) => t + b.net, 0))}</td>
          </tr>
        } />

      <SourceNote>
        Sales and expenses are read a page at a time until the database stops returning rows, so
        these totals are the whole period rather than the first thousand lines of it. <b>Net profit</b>
        is gross margin less expenses plus other income — not sales less expenses, which would count
        the cost of the goods as profit.
      </SourceNote>

      <PreviewNote />
    </Shell>
  );
}
