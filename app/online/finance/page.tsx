"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, FileText, Undo2, RefreshCw, CheckCircle2, Clock } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import ReturnsPanel from "@/components/ReturnsPanel";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import { AddFinanceRow, EditFinanceRow } from "@/components/FinanceEntry";

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
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
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
        p_from: from, p_to: to, p_store: store, p_courier: null,
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
            .select("id,tracking_id,order_number,store_code,courier,cod_amount,cpr_net_amount,payment_status,payment_date,delivery_date,finance_date,is_paid,age_days")
            // Unpaid first, oldest debt at the top — that is the chase list.
            .order("is_paid", { ascending: true })
            .order("finance_date", { ascending: false, nullsFirst: false })
            .limit(1000)
        : supabase.from("online_cpr")
            .select("id,cpr_number,courier,store_code,cpr_date,amount,orders_count,status")
            .order("cpr_date", { ascending: false, nullsFirst: false }).limit(1000);
    if (from) q = q.gte(dcol, from);
    if (to) q = q.lte(dcol, to);
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, store]);
  useEffect(() => { load(tab); }, [tab, load]);

  // The table is filtered in the browser only because it is explicitly a page
  // of rows, never a total. Every total on this page comes from the RPC above.
  const rowsF = useMemo(() => (store === "ALL" ? rows : rows.filter((r) => r.store_code === store)), [rows, store]);

  const cards = useMemo(() => {
    if (tab === "payments") {
      const s = summary;
      return [
        { label: "Pending payment", value: money(s?.pending_value), Icon: Clock, bg: "bg-amber-soft",
          note: s ? `${Number(s.pending_count).toLocaleString()} parcels · oldest ${Number(s.oldest_pending_days)} days` : "" },
        { label: "Received", value: money(s?.received_net), Icon: CheckCircle2, bg: "bg-success-soft",
          note: s ? `${Number(s.received_count).toLocaleString()} parcels` : "" },
        // Revenue is GROSS COD — what the customer handed over. The courier's
        // cut is a cost, shown next to it rather than folded into it.
        { label: "Gross COD", value: money(s?.gross_cod), Icon: Wallet, bg: "bg-periwinkle-soft",
          note: "what customers paid" },
        { label: "Courier charges", value: money(s?.courier_fees), Icon: Wallet, bg: "bg-salmon-soft",
          note: s ? `net ${money(s.net_expected)}` : "" },
      ];
    }
    if (tab === "cpr") {
      // These stay browser-side on purpose: a CPR batch is one row per
      // settlement file, so the set is small and cannot approach the 1,000 cap.
      // If it ever can, it gets its own function like everything else.
      return [
        { label: "CPR batches", value: rowsF.length.toLocaleString(), Icon: FileText, bg: "bg-periwinkle-soft", note: "" },
        { label: "Total amount", value: money(sum(rowsF, "amount")), Icon: Wallet, bg: "bg-success-soft", note: "" },
        { label: "Orders covered", value: rowsF.reduce((t, r) => t + (Number(r.orders_count) || 0), 0).toLocaleString(), Icon: FileText, bg: "bg-amber-soft", note: "" },
        { label: "Open", value: rowsF.filter((r) => r.status !== "Paid" && r.status !== "Cleared").length.toLocaleString(), Icon: Clock, bg: "bg-salmon-soft", note: "" },
      ];
    }
    return [
      { label: "Returns", value: rowsF.length.toLocaleString(), Icon: Undo2, bg: "bg-periwinkle-soft", note: "" },
      { label: "Received back", value: rowsF.filter((r) => r.received).length.toLocaleString(), Icon: CheckCircle2, bg: "bg-success-soft", note: "" },
      { label: "Awaiting", value: rowsF.filter((r) => !r.received).length.toLocaleString(), Icon: Clock, bg: "bg-amber-soft", note: "" },
      { label: "—", value: "", Icon: Undo2, bg: "bg-salmon-soft", note: "" },
    ];
  }, [tab, rowsF, summary]);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold sm:text-[22px] tracking-tight text-ink dark:text-[#f4f1ea]">Finance</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">CPR reconciliation, and pending &amp; received payments. Returns moved to Logistics.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={store} onChange={(e) => setStore(e.target.value)}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {STORES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
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
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, bg, note }, i) => (
          <div key={i} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17] ${label === "—" ? "opacity-0" : ""}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
            {note && !loading && <div className="mt-0.5 text-[11px] text-hint dark:text-[#8a8175]">{note}</div>}
          </div>
        ))}
      </div>

      {/* Who owes what. PostEx settles through an API; OwnEx has none, so its
          line is the one that can only ever move by import or by hand. */}
      {tab === "payments" && byCourier.length > 0 && !loading && (
        <div className="mt-3 flex flex-wrap gap-2">
          {byCourier.map((c) => (
            <div key={c.courier} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12px] text-muted dark:border-white/10 dark:bg-white/[0.05] dark:text-[#a89f93]">
              <span className="font-semibold text-ink dark:text-[#f4f1ea]">{c.courier}</span>
              {" · "}{money(c.pending_value)} pending
              {" · "}{Number(c.pending_count).toLocaleString()} parcels
              {Number(c.oldest_pending_days) > 0 && <> · oldest {Number(c.oldest_pending_days)}d</>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {tab === "payments" && <>
                  <th className="px-4 py-3 font-semibold">Order #</th><th className="px-4 py-3 font-semibold">Store</th><th className="px-4 py-3 font-semibold">Courier</th>
                  <th className="px-4 py-3 text-right font-semibold">COD</th><th className="px-4 py-3 text-right font-semibold">Net</th><th className="px-4 py-3 font-semibold">Paid on</th><th className="px-4 py-3 font-semibold">Status</th>
                </>}
                {tab === "cpr" && <>
                  <th className="px-4 py-3 font-semibold">CPR #</th><th className="px-4 py-3 font-semibold">Courier</th><th className="px-4 py-3 font-semibold">Store</th>
                  <th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 text-right font-semibold">Orders</th><th className="px-4 py-3 font-semibold">Status</th>
                </>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load: {err}</td></tr>
              ) : rowsF.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">Nothing here yet — this fills once the sync is live.</td></tr>
              ) : (
                rowsF.map((r, i) => (
                  <tr key={i} onClick={() => setEditRow(r)} className="cursor-pointer text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    {tab === "payments" && <>
                      <td className="px-4 py-3 font-semibold">{String(r.order_number ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.store_code ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.courier ?? "—")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.cod_amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.cpr_net_amount)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.payment_date ?? "—")}</td>
                      <td className="px-4 py-3">{badge(String(r.payment_status ?? "Pending"), isPaid(r.payment_status) ? "ok" : "warn")}</td>
                    </>}
                    {tab === "cpr" && <>
                      <td className="px-4 py-3 font-semibold">{String(r.cpr_number ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.courier ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.store_code ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.cpr_date ?? "—")}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{String(r.orders_count ?? 0)}</td>
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
        <p className="mt-3 text-center text-[12px] text-hint dark:text-[#8a8175]">Tip: click any row to {tab === "payments" ? "mark it paid" : tab === "cpr" ? "update the batch" : "mark it received"}.</p>
      )}

      <EditFinanceRow tab={tab} row={editRow} onClose={() => setEditRow(null)} onDone={() => load(tab)} />

      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live finance data.</p>}
      </>}
    </div>
  );
}
