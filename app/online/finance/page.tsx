"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, FileText, Undo2, RefreshCw, CheckCircle2, Clock, Truck } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import ReturnsPanel from "@/components/ReturnsPanel";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import { AddFinanceRow, EditFinanceRow } from "@/components/FinanceEntry";
import CprImport from "@/components/CprImport";
import CprDetail from "@/components/CprDetail";

type Tab = "payments" | "cpr" | "returns";
type Row = Record<string, unknown>;

/** One row, straight from hub_finance_summary(). Counted in the database. */
type Summary = {
  pending_value: number; pending_count: number; oldest_pending_days: number;
  received_gross: number; received_net: number; received_count: number;
  gross_cod: number; courier_fees: number; net_expected: number;
};
/** PostEx and OwnEx kept apart deliberately: OwnEx has no payment API, so its
 *  share of the receivable can only move by import or by hand. A blended figure
 *  hides which half is automatable. */
type CourierRow = {
  courier: string; pending_value: number; pending_count: number;
  oldest_pending_days: number; received_gross: number; courier_fees: number;
};

const STORES = [
  { code: "ALL", label: "All stores" },
  { code: "LM", label: "Little Minors" },
  { code: "TS", label: "TopShop" },
  { code: "TRZ", label: "Trenzee" },
];
const TABS: { key: Tab; label: string }[] = [
  { key: "payments", label: "Payments" },
  { key: "cpr", label: "CPR" },
];
const money = (n: unknown) => (n == null ? "—" : "Rs " + Math.round(Number(n) || 0).toLocaleString("en-PK"));
const sum = (rows: Row[], k: string) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

function badge(txt: string, kind: "ok" | "warn" | "bad" | "mute") {
  const m = {
    ok: "bg-success-soft text-success dark:bg-white/[0.08] dark:text-success",
    warn: "bg-amber-soft text-amber-strong dark:bg-white/[0.08] dark:text-amber",
    bad: "bg-danger-soft text-danger dark:bg-white/[0.08] dark:text-danger",
    mute: "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]",
  }[kind];
  return <span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${m}`}>{txt}</span>;
}
const isPaid = (s: unknown) => s === "Paid" || s === "Received";

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("payments");
  const [store, setStore] = useState("ALL");
  /* Whose settlements am I looking at?
     PostEx and OwnEx bill on completely different terms — PostEx deducts
     withholding per parcel, OwnEx charges a fuel surcharge at invoice level —
     so a mixed list is rarely what anyone wants to read. */
  const [courier, setCourier] = useState("All couriers");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cprRow, setCprRow] = useState<Row | null>(null);
  /* Which card is driving the list. Clicking a figure should show you the rows
     behind it — a number you cannot open is a number you have to take on
     trust, and this page exists precisely because those were wrong. */
  const [pick, setPick] = useState<"" | "pending" | "received" | "charges">("");
  const [byCourier, setByCourier] = useState<CourierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  /* THE CARDS COME FROM THE DATABASE, THE TABLE IS A PAGE OF ROWS.
     Two separate bugs were fixed here — see migration 0077.

     1. Counting a PostgREST response in the browser understates any total past
        1,000 rows, however large .limit() is. Fourth page with this fault.

     2. Worse: the Payments tab filtered on payment_date, which is NULL on every
        UNPAID parcel, and NULL fails every comparison. The default range is
        "30 days", so the pending rows were being deleted from the query before
        the cap was even reached. v_finance_payments.finance_date dates a paid
        row by when the money arrived and an unpaid one by when it became owed,
        so a range filter can no longer hide a receivable. */
  const load = useCallback(async (which: Tab) => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);

    if (which === "payments") {
      const { data: sm, error: se } = await supabase.rpc("hub_finance_summary", {
        p_from: from, p_to: to, p_store: store,
        p_courier: courier === "All couriers" ? null : courier,
      });
      if (se) setErr(se.message);
      setSummary(((sm as Summary[]) ?? [])[0] ?? null);

      const { data: bc } = await supabase.rpc("hub_finance_by_courier", {
        p_from: from, p_to: to, p_store: store,
      });
      setByCourier((bc as CourierRow[]) ?? []);
    } else {
      setSummary(null); setByCourier([]);
    }

    const dcol = which === "payments" ? "finance_date" : "cpr_date";
    let q =
      which === "payments"
        ? supabase.from("v_finance_payments")
            .select("id,tracking_id,order_number,store_code,courier,cod_amount,cpr_net_amount,courier_fee,courier_tax,payment_status,payment_date,delivery_date,finance_date,is_paid,age_days")
            // Oldest first. A receivable list is worked from the top, and the
            // oldest debt is the one closest to being uncollectable.
            .order("is_paid", { ascending: true })
            .order("finance_date", { ascending: true, nullsFirst: false })
            .limit(1000)
        : supabase.from("online_cpr")
            .select("id,cpr_number,courier,store_code,cpr_date,amount,orders_count,status,gross_total,shipping_charges,gst,wh_income_tax,wh_sales_tax,net_total,delivered_count,returned_count,returns_cost,matched_count,matched_total,unmatched,settlement_status")
            .order("cpr_date", { ascending: false, nullsFirst: false }).limit(1000);
    if (from) q = q.gte(dcol, from);
    if (to) q = q.lte(dcol, to);
    if (courier !== "All couriers") q = q.eq("courier", courier);
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, store, courier]);
  useEffect(() => { load(tab); }, [tab, load]);

  // The table is filtered in the browser only because it is explicitly a page
  // of rows, never a total. Every total on this page comes from the RPC above.
  const rowsF = useMemo(() => {
    let out = store === "ALL" ? rows : rows.filter((r) => r.store_code === store);
    // The card you pressed decides what the list shows. Pressing it again clears it.
    if (tab === "payments" && pick === "pending")  out = out.filter((r) => !r.is_paid);
    if (tab === "payments" && pick === "received") out = out.filter((r) => r.is_paid);
    if (tab === "payments" && pick === "charges")
      out = out.filter((r) => (Number(r.courier_fee) || 0) + (Number(r.courier_tax) || 0) > 0);
    return out;
  }, [rows, store, tab, pick]);

  const cards = useMemo(() => {
    if (tab === "payments") {
      const s = summary;
      const [from, to] = rangeDates(preset, cf, ct);
      /* AVERAGE DELIVERY CHARGE over whatever period is selected.
         Two readings of the same figure, both useful and both shown: what one
         delivery costs on average, and what the couriers cost you per day.
         Seven days and thirty days therefore give different answers, which is
         the point — it is a rate, not a total. */
      const parcels = Number(s?.pending_count ?? 0) + Number(s?.received_count ?? 0);
      const fees = Number(s?.courier_fees ?? 0);
      const days = from && to
        ? Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1)
        : 0;
      return [
        { label: "Pending payment", value: money(s?.pending_value), Icon: Clock, bg: "bg-amber-soft",
          note: s ? `${Number(s.pending_count).toLocaleString()} parcels · oldest ${Number(s.oldest_pending_days)} days` : "",
          key: "pending" as const },
        { label: "Received", value: money(s?.received_net), Icon: CheckCircle2, bg: "bg-success-soft",
          note: s ? `${Number(s.received_count).toLocaleString()} parcels settled` : "", key: "received" as const },
        // Revenue is GROSS COD — what the customer handed over. The courier's
        // cut is a cost, shown next to it rather than folded into it.
        { label: "Gross COD", value: money(s?.gross_cod), Icon: Wallet, bg: "bg-periwinkle-soft",
          note: "what customers paid", key: "" as const },
        { label: "Courier charges", value: money(s?.courier_fees), Icon: Wallet, bg: "bg-salmon-soft",
          note: s ? `net ${money(s.net_expected)}` : "", key: "charges" as const },
        { label: "Avg delivery charge", value: parcels ? money(fees / parcels) : "—", Icon: Truck, bg: "bg-periwinkle-soft",
          note: days ? `per parcel · ${money(fees / days)}/day over ${days}d` : "per parcel", key: "charges" as const },
      ];
    }

    if (tab === "cpr") {
      // These stay browser-side on purpose: a CPR batch is one row per
      // settlement file, so the set is small and cannot approach the 1,000 cap.
      // If it ever can, it gets its own function like everything else.
      return [
        { label: "CPR batches", value: rowsF.length.toLocaleString(), Icon: FileText, bg: "bg-periwinkle-soft", note: "", key: "" as const },
        { label: "Total amount", value: money(sum(rowsF, "amount")), Icon: Wallet, bg: "bg-success-soft", note: "", key: "" as const },
        { label: "Orders covered", value: rowsF.reduce((t, r) => t + (Number(r.orders_count) || 0), 0).toLocaleString(), Icon: FileText, bg: "bg-amber-soft", note: "", key: "" as const },
        { label: "Open", value: rowsF.filter((r) => r.status !== "Paid" && r.status !== "Cleared").length.toLocaleString(), Icon: Clock, bg: "bg-salmon-soft", note: "", key: "" as const },
      ];
    }
    return [
      { label: "Returns", value: rowsF.length.toLocaleString(), Icon: Undo2, bg: "bg-periwinkle-soft", note: "", key: "" as const },
      { label: "Received back", value: rowsF.filter((r) => r.received).length.toLocaleString(), Icon: CheckCircle2, bg: "bg-success-soft", note: "", key: "" as const },
      { label: "Awaiting", value: rowsF.filter((r) => !r.received).length.toLocaleString(), Icon: Clock, bg: "bg-amber-soft", note: "", key: "" as const },
      { label: "—", value: "", Icon: Undo2, bg: "bg-salmon-soft", note: "", key: "" as const },
    ];
  }, [tab, rowsF, summary]);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold sm:text-[22px] tracking-tight text-ink dark:text-[#f4f1ea]">Finance</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">CPR reconciliation, and pending &amp; received payments. Returns moved to Logistics.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(tab === "payments" || tab === "cpr") && (
            <select value={courier} onChange={(e) => setCourier(e.target.value)}
                    className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              <option>All couriers</option><option>PostEx</option><option>OwnEx</option>
            </select>
          )}
          <select value={store} onChange={(e) => setStore(e.target.value)}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {STORES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          {/* Settlement import lives on the CPR tab, where the batches it
              creates are listed. Showing it on Payments would invite dropping
              an invoice onto a screen that cannot display the result. */}
          {tab === "cpr" && <CprImport onDone={() => load(tab)} />}
          <AddFinanceRow tab={tab} onDone={() => load(tab)} />
          <button onClick={() => load(tab)} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} />

      <div className="mt-5 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><div className="flex w-max gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${tab === t.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div></div>

      {tab === "returns" ? <div className="mt-5"><ReturnsPanel store={store} from={rangeDates(preset, cf, ct)[0]} to={rangeDates(preset, cf, ct)[1]} /></div> : <>
      {/* Five on payments, four elsewhere. Two per row on a phone. */}
      <div className={`mt-5 grid grid-cols-2 gap-3 ${tab === "payments" ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {cards.map(({ label, value, Icon, bg, note, key }, i) => (
          <button key={i} type="button"
            onClick={() => key && setPick((p) => (p === key ? "" : key))}
            className={`rounded-card border ${bg} p-4 text-left transition dark:bg-[#201c17] ${label === "—" ? "opacity-0" : ""} ${
              key ? "cursor-pointer hover:brightness-95" : "cursor-default"} ${
              key && pick === key ? "border-ink ring-2 ring-ink/20 dark:border-white" : "border-line dark:border-white/[0.06]"}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
            {note && !loading && <div className="mt-0.5 text-[11px] text-hint dark:text-[#8a8175]">{note}</div>}
            {key && pick === key && <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink dark:text-white">filtering ↓</div>}
          </button>
        ))}
      </div>

      {/* Who owes what. PostEx settles through an API; OwnEx has none, so its
          line is the one that can only ever move by import or by hand. */}
      {cprRow && <CprDetail row={cprRow} onClose={() => setCprRow(null)} />}

      {tab === "payments" && byCourier.length > 0 && !loading && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Each chip shows the figure for whichever CARD is selected. Showing
              "pending" while the Received card was active answered a question
              nobody had asked. Clicking a chip also sets the courier filter, so
              the number and the list underneath always agree. */}
          {byCourier.map((c) => {
            const on = courier === c.courier;
            const shown =
              pick === "received" ? { v: money(c.received_gross), w: "received" }
              : pick === "charges" ? { v: money(c.courier_fees), w: "in charges" }
              : { v: money(c.pending_value), w: "pending" };
            return (
              <button key={c.courier} type="button"
                onClick={() => setCourier(on ? "All couriers" : c.courier)}
                className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${
                  on ? "border-ink bg-ink text-white dark:border-white dark:bg-white dark:text-[#141414]"
                     : "border-line bg-surface text-muted hover:bg-panel dark:border-white/10 dark:bg-white/[0.05] dark:text-[#a89f93]"}`}>
                <span className={`font-semibold ${on ? "" : "text-ink dark:text-[#f4f1ea]"}`}>{c.courier}</span>
                {" · "}{shown.v} {shown.w}
                {pick !== "received" && pick !== "charges" && <>
                  {" · "}{Number(c.pending_count).toLocaleString()} parcels
                  {Number(c.oldest_pending_days) > 0 && <> · oldest {Number(c.oldest_pending_days)}d</>}
                </>}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {tab === "payments" && <>
                  {/* Store dropped: the order number already carries it —
                      #LM15237, #TS2761, #TRZ1760 — so the column repeated
                      itself in narrower form. */}
                  <th className="px-4 py-3 font-semibold">Order #</th><th className="px-4 py-3 font-semibold">Tracking</th><th className="px-4 py-3 font-semibold">Courier</th>
                  <th className="px-4 py-3 text-right font-semibold">COD</th>
                  <th className="px-4 py-3 text-right font-semibold">Charges</th>
                  <th className="px-4 py-3 text-right font-semibold">Net received</th>
                  <th className="px-4 py-3 font-semibold">Paid on</th><th className="px-4 py-3 font-semibold">Status</th>
                </>}
                {tab === "cpr" && <>
                  <th className="px-4 py-3 font-semibold">CPR #</th><th className="px-4 py-3 font-semibold">Courier</th><th className="px-4 py-3 font-semibold">Store</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 text-right font-semibold">Net paid</th>
                  <th className="px-4 py-3 text-right font-semibold">Delivered</th>
                  <th className="px-4 py-3 text-right font-semibold">Returned</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={tab === "cpr" ? 8 : 8} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={tab === "cpr" ? 8 : 8} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load: {err}</td></tr>
              ) : rowsF.length === 0 ? (
                <tr><td colSpan={tab === "cpr" ? 8 : 8} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">Nothing here yet — this fills once the sync is live.</td></tr>
              ) : (
                rowsF.map((r, i) => (
                  <tr key={i} onClick={() => (tab === "cpr" ? setCprRow(r) : setEditRow(r))} className="cursor-pointer text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    {tab === "payments" && <>
                      <td className="px-4 py-3 font-semibold">{String(r.order_number ?? "—")}</td>
                      <td className="px-4 py-3 font-mono text-[11.5px] text-muted dark:text-[#a89f93]">{String(r.tracking_id ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.courier ?? "—")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.cod_amount)}</td>
                      {/* What the courier kept: its fee plus the tax withheld.
                          Shown in brackets, the way both couriers' own receipts
                          show a deduction. */}
                      <td className="px-4 py-3 text-right tabular-nums text-muted dark:text-[#a89f93]">
                        {(Number(r.courier_fee) || 0) + (Number(r.courier_tax) || 0)
                          ? "(" + Math.round((Number(r.courier_fee) || 0) + (Number(r.courier_tax) || 0)).toLocaleString("en-PK") + ")"
                          : "—"}
                      </td>
                      {/* Net is only known once a settlement has been imported.
                          A dash here means no CPR has covered this parcel yet —
                          not that the amount is zero. */}
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.cpr_net_amount)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.payment_date ?? "—")}</td>
                      <td className="px-4 py-3">{badge(String(r.payment_status ?? "Pending"), isPaid(r.payment_status) ? "ok" : "warn")}</td>
                    </>}
                    {tab === "cpr" && <>
                      <td className="px-4 py-3 font-semibold">{String(r.cpr_number ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.courier ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.store_code ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.cpr_date ?? "—")}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.net_total ?? r.amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{String(r.delivered_count ?? r.orders_count ?? 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted dark:text-[#a89f93]">{String(r.returned_count ?? 0)}</td>
                      <td className="px-4 py-3">{badge(String(r.status ?? "Pending"), r.status === "Paid" || r.status === "Cleared" ? "ok" : "warn")}</td>
                    </>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && !err && rowsF.length > 0 && (
        <p className="mt-3 text-center text-[12px] text-hint dark:text-[#8a8175]">Tip: click any row to {tab === "payments" ? "mark it paid" : tab === "cpr" ? "see how the courier calculated it" : "mark it received"}.</p>
      )}

      <EditFinanceRow tab={tab} row={editRow} onClose={() => setEditRow(null)} onDone={() => load(tab)} />

      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live finance data.</p>}
      </>}
    </div>
  );
}
