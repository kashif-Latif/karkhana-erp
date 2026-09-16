"use client";
/* SALES — three levels down, from every shop to a single bill.
 *
 * THE SHAPE, PORTED FROM renderSales
 *   Level 1  STORES     one row per branch, grouped under its chain, with an
 *                       all-stores footer. Tap a store to go down.
 *   Level 2  PAYMENTS   that store's takings split by how it was paid, one
 *                       tile per method. Tap a method to go down.
 *   Level 3  BILLS      the receipts behind that one method, rolled up from
 *                       the lines, newest receipt first, with a total.
 *
 *   This is how the question actually gets asked: "we're short on cash" → which
 *   shop → how much of that shop was cash → which bills. A flat line list
 *   cannot answer any step of it without a spreadsheet.
 *
 *   The three level-1/2/3 states are the BRANCH and PAYMENT-METHOD filters
 *   themselves, so the branch dropdown and the drill-down are one control and
 *   cannot disagree about where you are.
 *
 * WHY LEVEL 3 HAS A PARTY COLUMN ON CREDIT
 *   `credit` is UDHAAR — a sale handed over with the money still owed. The list
 *   of credit bills IS the debtor list, and without the customer name on it
 *   there is nowhere in this app that says who owes on account. The column is
 *   only shown for credit because on a cash bill the customer field is noise.
 *
 * WHY THE PAGING (fetchAll)
 *   PostgREST caps a response at 1000 rows; `.limit(5000)` does not raise the
 *   cap, it only stops asking. This screen at least admitted it ("capped at
 *   5,000 lines"), but a total that is a lower bound is still a wrong total.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Receipt, TrendingUp, Layers, Tag, ScrollText, Search, ChevronRight, ChevronLeft,
  Store, Rows3,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Tabs, Pill, BranchPicker,
  PreviewNote, SourceNote, useBranches, money, num, text, sum, fetchAll,
  type Branch, type Row, type Col,
} from "@/components/retail/kit";

/* The seven strings the importer actually writes, and the CHECK constraint on
   retail_sale_lines. `credit` is udhaar, not a credit card — labelling it
   "Card" is what made FC DHA's 1 Sep card figure read 36,100 instead of
   33,400. The ORDER is the order the tiles appear in: cash first because it is
   the one that has to be counted, unclassified last because it is a to-do. */
const PM_ORDER = ["cash", "meezan_card", "jazzcash", "credit", "online", "other", "unclassified"];
const PM: Record<string, { label: string; color: string }> = {
  cash:         { label: "Cash",            color: "#7FC489" },
  meezan_card:  { label: "Card",            color: "#A6C0E6" },
  jazzcash:     { label: "JazzCash",        color: "#EDA6D0" },
  credit:       { label: "Credit (udhaar)", color: "#E4B47E" },
  online:       { label: "Online",          color: "#D2B9EA" },
  other:        { label: "Other",           color: "#EBA98F" },
  unclassified: { label: "Unclassified",    color: "#B4ABA0" },
};
const pmLabel = (k: string) => PM[k]?.label ?? text(k);
const pmColor = (k: string) => PM[k]?.color ?? "#B4ABA0";

/** "Topshop" is one word in the database and two everywhere a person reads it. */
const bizLabel = (c?: string | null) => (c === "Topshop" ? "Top Shop" : c || "—");

/** One receipt is many lines. Group on receipt_txn — the transaction id the POS
 *  gave it — and fall back to the printed number, then the row id, because an
 *  older import has no txn and two shops can print the same receipt number on
 *  the same day. */
const recKey = (r: Row) => String(r.receipt_txn || r.receipt_no || r.id);

type View = "stores" | "lines" | "items" | "departments" | "salespeople";
const VIEWS: { key: View; label: string }[] = [
  { key: "stores", label: "Stores" },
  { key: "lines", label: "Lines" },
  { key: "items", label: "By Item" },
  { key: "departments", label: "By Department" },
  { key: "salespeople", label: "By Salesperson" },
];

type StoreRow =
  | { kind: "chain"; name: string; recs: number; qty: number; amt: number; id?: undefined }
  | { kind: "store"; name: string; recs: number; qty: number; amt: number; id: number };
type Bill = { key: string; no: string; date: string; party: string; qty: number; amt: number; short: number };
type GroupRow = { name: string; qty: number; amt: number; margin: number; lines: number };

export default function RetailSalesPage() {
  const { branches } = useBranches();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  /* Level 1 is branch === "". Level 2 is a branch with no method chosen.
     Level 3 is both. The dropdown writes the same state the drill-down does. */
  const [branch, setBranch] = useState("");
  const [pm, setPm] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("stores");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  const branchById = useCallback((id: unknown) => branches.find((b) => b.id === Number(id)), [branches]);
  const branchName = useCallback((id: unknown) => branchById(id)?.name ?? "—", [branchById]);

  /* Changing branch always drops the method: the methods on screen belong to
     the shop you were in, and carrying "cash" across to another shop would show
     that shop's cash bills under the previous shop's heading. */
  const goBranch = useCallback((v: string) => { setBranch(v); setPm(null); }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    const { rows: got, error } = await fetchAll<Row>((lo, hi) => {
      let sq = supabase!.from("retail_sale_lines")
        .select("id,branch_id,sale_date,receipt_no,receipt_txn,item_code,item_name,department,salesperson,customer,quantity,net_sales,sales_amount,gross_margin,discount,payment_method")
        .order("sale_date", { ascending: false, nullsFirst: false });
      if (from) sq = sq.gte("sale_date", from);
      if (to) sq = sq.lte("sale_date", to);
      if (branch) sq = sq.eq("branch_id", Number(branch));
      return sq.range(lo, hi);
    });
    if (error) setErr(error);
    setRows(got);
    setLoading(false);
  }, [preset, cf, ct, branch]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) => [r.receipt_no, r.item_name, r.item_code, r.customer, r.salesperson]
      .some((v) => String(v ?? "").toLowerCase().includes(n)));
  }, [rows, q]);

  const receiptCount = useMemo(
    () => new Set(filtered.map((r) => `${r.branch_id}|${recKey(r)}`)).size, [filtered]);
  const totalSales = useMemo(() => sum(filtered, "sales_amount"), [filtered]);

  const headline = [
    { label: "Total sales", value: money(totalSales), Icon: Receipt, bg: "bg-salmon-soft" },
    { label: "Gross margin", value: money(sum(filtered, "gross_margin")), Icon: TrendingUp, bg: "bg-success-soft" },
    { label: "Receipts", value: receiptCount.toLocaleString(), Icon: ScrollText, bg: "bg-periwinkle-soft" },
    { label: "Avg receipt", value: money(receiptCount ? totalSales / receiptCount : 0), Icon: Layers, bg: "bg-lavender-soft" },
  ];
  const secondary = [
    { label: "Items sold", value: Math.round(sum(filtered, "quantity")).toLocaleString(), Icon: Layers, bg: "bg-amber-soft" },
    { label: "Discounts", value: money(sum(filtered, "discount")), Icon: Tag, bg: "bg-pink-soft" },
    { label: "Lines read", value: filtered.length.toLocaleString(), Icon: Rows3, bg: "bg-panel" },
    { label: "Shops selling", value: new Set(filtered.map((r) => String(r.branch_id))).size.toLocaleString(), Icon: Store, bg: "bg-panel" },
  ];

  /* ── LEVEL 1 · stores ───────────────────────────────────────────────────
     Every trading branch is listed, not only the ones with sales, because a
     shop that sold nothing all week is the single most interesting row on the
     screen and dropping it hides exactly that. */
  const storeRows: StoreRow[] = useMemo(() => {
    const agg: Record<string, { amt: number; qty: number; recs: Set<string> }> = {};
    filtered.forEach((r) => {
      const id = String(r.branch_id);
      (agg[id] ||= { amt: 0, qty: 0, recs: new Set() });
      agg[id].amt += num(r.sales_amount); agg[id].qty += num(r.quantity);
      agg[id].recs.add(recKey(r));
    });
    const live: Branch[] = branches.filter((b) => b.active !== false || agg[String(b.id)]);
    const chains = [...new Set(live.map((b) => b.chain || "—"))];
    const multi = chains.length > 1;
    const out: StoreRow[] = [];
    chains.forEach((ch) => {
      const stores = live.filter((b) => (b.chain || "—") === ch)
        .map((b) => ({ b, g: agg[String(b.id)] ?? { amt: 0, qty: 0, recs: new Set<string>() } }))
        .sort((x, y) => y.g.amt - x.g.amt);
      if (multi) {
        out.push({
          kind: "chain", name: bizLabel(ch),
          recs: stores.reduce((t, x) => t + x.g.recs.size, 0),
          qty: stores.reduce((t, x) => t + x.g.qty, 0),
          amt: stores.reduce((t, x) => t + x.g.amt, 0),
        });
      }
      stores.forEach((x) => out.push({
        kind: "store", id: x.b.id, name: x.b.name,
        recs: x.g.recs.size, qty: x.g.qty, amt: x.g.amt,
      }));
    });
    /* Sales whose branch_id matches no branch row — a branch deleted after its
       sales were imported. They are listed rather than dropped, because the
       footer totals include them and a table whose rows do not add up to its
       own total is the exact failure this screen is supposed to prevent. */
    const seen = new Set(live.map((b) => String(b.id)));
    Object.keys(agg).filter((id) => !seen.has(id)).forEach((id) => out.push({
      kind: "store", id: Number(id), name: `Unknown branch #${id}`,
      recs: agg[id].recs.size, qty: agg[id].qty, amt: agg[id].amt,
    }));
    return out;
  }, [filtered, branches]);

  const storeCols: Col<StoreRow>[] = [
    { head: "Store", cell: (r) =>
        r.kind === "chain"
          ? <span className="text-[11.5px] font-extrabold uppercase tracking-wide text-hint dark:text-[#8a8175]">{r.name}</span>
          : (
            <button onClick={() => goBranch(String(r.id))}
              className="flex w-full items-center gap-1.5 pl-2 text-left font-semibold text-ink transition hover:text-salmon-strong dark:text-[#e7e2d8] dark:hover:text-salmon">
              {r.name} <ChevronRight size={14} className="text-hint" />
            </button>
          ) },
    { head: "Receipts", right: true, cell: (r) => <span className={r.kind === "chain" ? "font-extrabold" : ""}>{r.recs.toLocaleString()}</span> },
    { head: "Items", right: true, cell: (r) => <span className={r.kind === "chain" ? "font-extrabold" : ""}>{Math.round(r.qty).toLocaleString()}</span> },
    { head: "Total sales", right: true, cell: (r) => <span className={r.kind === "chain" ? "font-extrabold" : "font-semibold"}>{money(r.amt)}</span> },
  ];

  /* ── LEVEL 2 · payment methods for one store ────────────────────────────── */
  const pmTiles = useMemo(() => {
    const agg: Record<string, { amt: number; recs: Set<string> }> = {};
    filtered.forEach((r) => {
      const k = String(r.payment_method || "unclassified");
      (agg[k] ||= { amt: 0, recs: new Set() });
      agg[k].amt += num(r.sales_amount); agg[k].recs.add(recKey(r));
    });
    const known = PM_ORDER.filter((k) => agg[k]);
    const rest = Object.keys(agg).filter((k) => !PM_ORDER.includes(k));
    return [...known, ...rest].map((k) => ({ k, amt: agg[k].amt, bills: agg[k].recs.size }));
  }, [filtered]);

  /* ── LEVEL 3 · the bills behind one method ──────────────────────────────
     Rolled up from the lines, because a receipt is not a row anywhere — it is
     however many lines share a transaction id. Sorted by receipt NUMBER
     descending, which is the order the shop wrote them, not by amount. */
  const bills: Bill[] = useMemo(() => {
    if (!pm) return [];
    const m: Record<string, Bill> = {};
    filtered.filter((r) => String(r.payment_method || "unclassified") === pm).forEach((r) => {
      const key = recKey(r);
      const b = (m[key] ||= {
        key, no: String(r.receipt_no || key), date: String(r.sale_date ?? ""),
        party: "", qty: 0, amt: 0,
        short: parseInt(String(r.receipt_no ?? "0"), 10) || 0,
      });
      b.qty += num(r.quantity); b.amt += num(r.sales_amount);
      if (r.customer && !b.party) b.party = String(r.customer);
    });
    return Object.values(m).sort((a, b) => b.short - a.short);
  }, [filtered, pm]);

  const showParty = pm === "credit";
  const billCols: Col<Bill>[] = [
    { head: "Date", muted: true, cell: (r) => text(r.date) },
    { head: "Receipt", bold: true, cell: (r) => text(r.no) },
    ...(showParty ? [{ head: "Party", cell: (r: Bill) => (r.party ? text(r.party) : <span className="text-muted dark:text-[#a89f93]">—</span>) } as Col<Bill>] : []),
    { head: "Items", right: true, cell: (r) => Math.round(r.qty).toLocaleString() },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.amt) },
  ];

  /* ── the flat views, kept as extra tabs ─────────────────────────────────── */
  const grouped: GroupRow[] = useMemo(() => {
    const key = view === "items" ? "item_name" : view === "departments" ? "department" : view === "salespeople" ? "salesperson" : null;
    if (!key) return [];
    const m: Record<string, GroupRow> = {};
    filtered.forEach((r) => {
      const k = String(r[key] || "—");
      const g = (m[k] ||= { name: k, qty: 0, amt: 0, margin: 0, lines: 0 });
      g.qty += num(r.quantity); g.amt += num(r.sales_amount); g.margin += num(r.gross_margin); g.lines += 1;
    });
    return Object.values(m).sort((a, b) => b.amt - a.amt).slice(0, 300);
  }, [filtered, view]);

  const maxAmt = Math.max(...grouped.map((g) => g.amt), 1);
  const groupCols: Col<GroupRow>[] = [
    { head: view === "items" ? "Item" : view === "departments" ? "Department" : "Salesperson", bold: true, cell: (r) => r.name },
    { head: "Lines", right: true, muted: true, cell: (r) => r.lines.toLocaleString() },
    { head: "Qty", right: true, cell: (r) => Math.round(r.qty).toLocaleString() },
    { head: "Sales", right: true, bold: true, cell: (r) => money(r.amt) },
    { head: "Margin", right: true, cell: (r) => money(r.margin) },
    { head: "Share", cell: (r) => (
        <div className="h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
          <div className="h-full rounded-full bg-salmon" style={{ width: `${Math.max((r.amt / maxAmt) * 100, 2)}%` }} />
        </div>
      ) },
  ];

  const lineCols: Col<Row>[] = [
    { head: "Date", muted: true, cell: (r) => text(r.sale_date) },
    { head: "Branch", bold: true, cell: (r) => branchName(r.branch_id) },
    { head: "Receipt", muted: true, cell: (r) => text(r.receipt_no) },
    { head: "Item", cell: (r) => text(r.item_name) },
    { head: "Qty", right: true, cell: (r) => num(r.quantity).toLocaleString() },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.sales_amount) },
    { head: "Payment", muted: true, cell: (r) => pmLabel(String(r.payment_method || "unclassified")) },
  ];

  const here = branch ? branchName(branch) : "All stores";

  return (
    <Shell>
      <PageHeader title="Sales" subtitle="Every shop, then every payment method, then every bill."
        onRefresh={load} loading={loading} />

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt}
        right={
          <>
            <BranchPicker branches={branches} value={branch} onChange={goBranch} allLabel="All stores" />
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <Search size={15} className="text-hint dark:text-[#8a8175]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt, item, staff"
                className="w-40 bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-48 dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
            </div>
          </>
        } />

      <StatCards stats={headline} loading={loading} />
      <StatCards stats={secondary} loading={loading} />

      <Tabs tabs={VIEWS} value={view} onChange={setView} />

      {view === "stores" ? (
        <>
          {/* The back control, at every level below the first. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {branch && (
              <button onClick={() => (pm ? setPm(null) : goBranch(""))}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
                <ChevronLeft size={14} /> {pm ? here : "All stores"}
              </button>
            )}
            <Pill tone="info">{here}</Pill>
            {pm && <Pill tone="neutral">{pmLabel(pm)}</Pill>}
          </div>

          {!branch ? (
            /* LEVEL 1 */
            <>
              <DataTable cols={storeCols} rows={storeRows} loading={loading} err={err} minWidth={620}
                empty="No sales in this period — this fills when shop sales are brought in."
                footer={
                  <tr className="bg-panel/60 font-bold text-ink dark:bg-white/[0.04] dark:text-[#f4f1ea]">
                    <td className="px-4 py-3">All stores</td>
                    <td className="px-4 py-3 text-right tabular-nums">{receiptCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Math.round(sum(filtered, "quantity")).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(totalSales)}</td>
                  </tr>
                } />
              <p className="mt-2 text-[12px] text-hint dark:text-[#8a8175]">Tap a store to see its Cash / Card / JazzCash breakdown.</p>
            </>
          ) : !pm ? (
            /* LEVEL 2 */
            <>
              <div className="mt-4 rounded-card border border-line bg-surface p-5 dark:border-white/[0.06] dark:bg-[#201c17]">
                <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{here} — total</div>
                <div className="mt-1 text-[24px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{money(totalSales)}</div>
                <div className="mt-0.5 text-[12px] text-hint dark:text-[#8a8175]">{receiptCount.toLocaleString()} bill{receiptCount === 1 ? "" : "s"}</div>
              </div>
              {pmTiles.length === 0 ? (
                <div className="mt-3 rounded-card border border-line bg-surface px-4 py-16 text-center text-[13px] text-muted dark:border-white/[0.06] dark:bg-[#201c17] dark:text-[#a89f93]">
                  No sales for this store in this period.
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {pmTiles.map((t) => (
                    <button key={t.k} onClick={() => setPm(t.k)}
                      style={{ borderLeftColor: pmColor(t.k) }}
                      className="rounded-card border border-line border-l-[6px] bg-surface p-4 text-left transition hover:bg-panel/60 dark:border-white/[0.06] dark:bg-[#201c17] dark:hover:bg-white/[0.05]">
                      <div className="text-[12px] font-semibold text-muted dark:text-[#a89f93]">{pmLabel(t.k)}</div>
                      <div className="mt-1.5 text-[19px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{money(t.amt)}</div>
                      <div className="mt-1 flex items-center gap-1 text-[11.5px] text-hint dark:text-[#8a8175]">
                        {t.bills.toLocaleString()} bill{t.bills === 1 ? "" : "s"} · tap to view <ChevronRight size={12} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* LEVEL 3 */
            <>
              <DataTable cols={billCols} rows={bills} loading={loading} err={err} minWidth={showParty ? 680 : 560}
                empty={`No ${pmLabel(pm)} bills for this store in this period.`}
                footer={
                  <tr className="bg-panel/60 font-bold text-ink dark:bg-white/[0.04] dark:text-[#f4f1ea]">
                    <td className="px-4 py-3" colSpan={showParty ? 4 : 3}>Total · {bills.length.toLocaleString()} bill{bills.length === 1 ? "" : "s"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(bills.reduce((t, b) => t + b.amt, 0))}</td>
                  </tr>
                } />
              {showParty && (
                <SourceNote>
                  <strong>Credit is udhaar</strong> — the goods left the shop, the money did not arrive with
                  them. Every party named here owes that amount on account.
                </SourceNote>
              )}
            </>
          )}
        </>
      ) : view === "lines" ? (
        <DataTable cols={lineCols} rows={filtered.slice(0, 500)} loading={loading} err={err} minWidth={820}
          empty={rows.length === 0 ? "No sales in this period — this fills when shop sales are brought in." : "Nothing matches this search."} />
      ) : (
        <DataTable cols={groupCols} rows={grouped} loading={loading} err={err} minWidth={740}
          empty={rows.length === 0 ? "No sales in this period — this fills when shop sales are brought in." : "Nothing matches this search."} />
      )}

      {view === "lines" && !loading && !err && filtered.length > 500 && (
        <p className="mt-2 text-[12px] text-hint dark:text-[#8a8175]">
          Showing the first 500 of {filtered.length.toLocaleString()} lines. All {filtered.length.toLocaleString()} are
          in every total on this page — the cut is only on how many rows are drawn.
        </p>
      )}

      <SourceNote>
        Sale lines are read a page at a time until the database stops returning rows, so these totals
        are the whole period and not the first thousand lines of it. A <b>receipt</b> is counted by its
        transaction id, so a bill with nine items is one receipt, not nine.
      </SourceNote>

      <PreviewNote />
    </Shell>
  );
}
