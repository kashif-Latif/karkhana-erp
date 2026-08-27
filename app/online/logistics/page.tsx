"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveTables } from "@/lib/useLiveTables";
import { Package, Truck, CheckCircle2, Undo2, Percent, Wallet, Search, RefreshCw, XCircle, Clock, TrendingUp } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates, num, rs } from "@/lib/dateRange";
import { AddShipment } from "@/components/LogisticsEntry";
import CourierSync from "@/components/CourierSync";
import SmartImport from "@/components/SmartImport";
import HealthCheck from "@/components/HealthCheck";

type Logi = Record<string, unknown>;
type View = "list" | "couriers" | "status";

const STORES = [
  { code: "ALL", label: "All stores" }, { code: "LM", label: "Little Minors" },
  { code: "TS", label: "TopShop" }, { code: "TRZ", label: "Trenzee" },
];
const COURIERS = ["All couriers", "PostEx", "OwnEx"];
const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "Shipments" }, { key: "couriers", label: "Courier performance" }, { key: "status", label: "By Status" },
];

function deliveryClass(s: string) {
  switch (s) {
    case "Delivered": return "bg-success-soft text-success dark:bg-white/[0.08] dark:text-success";
    case "RTS": case "Returned": return "bg-danger-soft text-danger dark:bg-white/[0.08] dark:text-danger";
    case "In Transit": return "bg-periwinkle-soft text-periwinkle-strong dark:bg-white/[0.08] dark:text-periwinkle";
    case "Cancelled": return "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]";
    default: return "bg-amber-soft text-amber-strong dark:bg-white/[0.08] dark:text-amber";
  }
}
type Summary = {
  total: number; active: number; transit: number; transit_portal: number;
  delivered: number; rts: number; returned_received: number; out_for_return: number;
  cancelled: number; delivery_rate: number;
  cod: number; receivable: number; receivable_count: number; fees: number;
};

type CourierRow = {
  courier: string; total: number; transit: number; transit_portal: number;
  delivered: number; rts: number; returned_received: number; out_for_return: number;
  cancelled: number; delivery_rate: number;
  cod: number; receivable: number; receivable_count: number; fees: number;
};

type StatusRow = { raw_status: string; delivery_status: string; parcels: number };

const isRts = (l: Logi) => l.delivery_status === "RTS" || l.delivery_status === "Returned" || (!!l.rts && l.rts !== "No" && l.rts !== "false");

export default function LogisticsPage() {
  const [rows, setRows] = useState<Logi[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trendRows, setTrendRows] = useState<{ day: string; delivered: number }[]>([]);
  const [courierSplit, setCourierSplit] = useState<CourierRow[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusRow[]>([]);
  const [rawStatus, setRawStatus] = useState("All statuses");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [store, setStore] = useState("ALL");
  const [courier, setCourier] = useState("All couriers");
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("list");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  /* Every fetch carries a sequence number and only the newest one may write to
     state.
     WHY: `load` is rebuilt whenever preset/store/courier changes, so switching
     Today -> Yesterday can leave two queries in the air at once. Without this
     guard whichever FINISHES last wins — and that is often the OLDER one, which
     is why the range button and the figures on screen could disagree. Blocking
     the second request instead is not the answer either: that leaves the
     previous period's numbers sitting under the newly pressed button.
     `silent` skips the spinner so an automatic refresh does not flash the page.
     Both are refs, not state, so they cannot themselves cause a render. */
  const reqId = useRef(0);
  const lastLoadAt = useRef(0);

  /* `figuresOnly` is what a live update uses.
     The cards, the chart and the courier split are database aggregates — small,
     cheap, and the numbers people actually watch. The 1,000-row table is the
     expensive part of this page and the part that changes least: a courier sync
     moves a handful of statuses, not the list.
     So a realtime refresh brings the FIGURES up to date and leaves the list
     alone; Refresh, or any filter change, pulls the rows. Live numbers, cheap. */
  const load = useCallback(async (opts?: { silent?: boolean; figuresOnly?: boolean }) => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const myReq = ++reqId.current;
    if (!opts?.silent) setLoading(true);
    setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let q2 = supabase.from("online_logistics")
      .select("id,order_number,store_code,courier,tracking_id,dispatch_date,delivery_status,delivery_date,cod_amount,cpr_net_amount,courier_fee,payment_status,rts,rts_reason")
      .order("dispatch_date", { ascending: false, nullsFirst: false })
      /* 1000, not 5000. PostgREST caps a response at 1000 rows however large
         the limit, so asking for 5000 fetched 1000 and quietly implied the page
         held five times more than it did. Every TOTAL on this page comes from
         hub_logistics_summary and is unaffected; this is the visible list. */
      .limit(1000);
    if (from) q2 = q2.gte("dispatch_date", from);
    if (to) q2 = q2.lte("dispatch_date", to);
    if (store !== "ALL") q2 = q2.eq("store_code", store);
    if (courier !== "All couriers") q2 = q2.eq("courier", courier);
    if (rawStatus !== "All statuses") q2 = q2.eq("raw_status", rawStatus);
    // Rows are for the table only. The cards and the chart come from database
    // aggregates, because PostgREST caps a response at 1,000 rows and counting
    // a truncated page understated every total (see migration 0051).
    const args = {
      p_from: from ?? null, p_to: to ?? null,
      p_store: store === "ALL" ? null : store,
      p_courier: courier === "All couriers" ? null : courier,
    };
    const [rowsRes, sumRes, trendRes, courierRes, statusRes] = await Promise.all([
      opts?.figuresOnly ? Promise.resolve({ data: null, error: null }) : q2,
      supabase.rpc("hub_logistics_summary", args),
      supabase.rpc("hub_logistics_trend", { ...args, p_days: 14 }),
      supabase.rpc("hub_logistics_by_courier", { p_from: args.p_from, p_to: args.p_to, p_store: args.p_store }),
      supabase.rpc("hub_logistics_status_counts", args),
    ]);
    // a newer request has started since this one left — throw the answer away
    // rather than painting stale figures under a freshly pressed button
    if (myReq !== reqId.current) return;

    if (rowsRes.error) setErr(rowsRes.error.message);
    // figuresOnly leaves the existing table in place rather than blanking it
    if (!opts?.figuresOnly) setRows((rowsRes.data as Logi[]) ?? []);
    setSummary((sumRes.data as Summary[])?.[0] ?? null);
    setTrendRows((trendRes.data as { day: string; delivered: number }[]) ?? []);
    // when one courier is selected the comparison is meaningless — show that
    // courier alone, so the table and the cards always agree
    const split = (courierRes.data as CourierRow[]) ?? [];
    setCourierSplit(courier === "All couriers" ? split : split.filter((c) => c.courier === courier));
    setStatusCounts((statusRes.data as StatusRow[]) ?? []);
    setLoading(false);
    lastLoadAt.current = Date.now();
  }, [preset, cf, ct, store, courier, rawStatus]);
  useEffect(() => { load(); }, [load]);

  /* Live. The couriers push (PostEx webhook) or are polled (OwnEx), both of
     which write straight to online_logistics — this repaints the page when they
     do, so nobody has to press Refresh to find out a parcel was delivered. */
  /* online_orders was in this list and is never read on this page, so every
     Shopify webhook triggered a full logistics refetch for nothing. */
  const { live, lastChange } = useLiveTables(
    ["online_logistics"],
    useCallback(() => load({ silent: true, figuresOnly: true }), [load]),
  );

  /* Any click on a control in this section refreshes the data — but only if
     nothing else already did.
     The range and filter buttons change state, which changes load()'s identity
     and reloads through the effect below. Firing a second fetch on top of that
     is what made the page blink twice for one click. So: wait, then check
     whether a load has happened in the meantime, and stay out of the way if it
     has. Refreshes triggered this way are silent — the numbers change, the
     spinner does not. */
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* THE BUG THIS REF FIXES — "click 30 days, see 7 days"
     This handler used to close over `load` directly. Clicking a range button
     changes `preset`, which rebuilds `load` — but the handler already bound to
     the PREVIOUS one. Half a second later it fired the OLD load, which fetched
     the OLD range and bumped the request token, discarding the correct 30-day
     answer still in flight. Clicking again worked because by then the handler
     had caught up. A stale closure, not a race in the query.
     Holding the latest `load` in a ref means the timer always calls the current
     one, whatever it was bound to at click time. */
  const loadRef = useRef(load);
  loadRef.current = load;

  const refreshOnClick = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest?.("button, select, [role='tab'], [role='option']")) return;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      if (Date.now() - lastLoadAt.current < 2500) return;   // something already refreshed
      loadRef.current({ silent: true });
    }, 600);
  }, []);

  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((l) =>
      (courier === "All couriers" || l.courier === courier) &&
      (!statusFilter
        || (statusFilter === "Out for return"
              ? l.delivery_status === "RTS"
              : statusFilter === "Returned"
                ? l.delivery_status === "Returned"
                : l.delivery_status === statusFilter)) &&
      (!statusFilter
        || (statusFilter === "RTS" ? isRts(l) : l.delivery_status === statusFilter)) &&
      (!n || [l.order_number, l.tracking_id].some((v) => String(v ?? "").toLowerCase().includes(n)))
    );
  }, [rows, courier, q, statusFilter]);

  const M = useMemo(() => {
    if (summary) {
      const n = (v: unknown) => Number(v ?? 0);
      return {
        total: n(summary.total), active: n(summary.active), transit: n(summary.transit),
        transitPortal: n(summary.transit_portal),
        delivered: n(summary.delivered), rts: n(summary.rts),
        returnedReceived: n(summary.returned_received), outForReturn: n(summary.out_for_return),
        cancelled: n(summary.cancelled),
        rate: n(summary.delivery_rate), cod: n(summary.cod),
        receivable: n(summary.receivable), receivableCount: n(summary.receivable_count),
        fees: n(summary.fees),
      };
    }
    // fallback: only correct while the result set is under PostgREST's row cap
    const delivered = filtered.filter((l) => l.delivery_status === "Delivered").length;
    const rts = filtered.filter(isRts).length;
    const cancelled = filtered.filter((l) => l.delivery_status === "Cancelled").length;
    const settled = delivered + rts;
    const isPaid = (l: Logi) => l.payment_status === "Paid" || l.payment_status === "Received";
    return {
      total: filtered.length,
      active: filtered.length - cancelled,
      transit: filtered.filter((l) => l.delivery_status === "In Transit").length,
      transitPortal: filtered.filter((l) => l.delivery_status === "In Transit").length,
      delivered, rts, returnedReceived: rts, outForReturn: 0, cancelled,
      rate: settled ? (delivered / settled) * 100 : 0,
      cod: filtered.filter((l) => l.delivery_status === "Delivered").reduce((a, l) => a + num(l.cod_amount), 0),
      receivable: filtered.filter((l) => l.delivery_status === "Delivered" && !isPaid(l)).reduce((a, l) => a + num(l.cod_amount), 0),
      receivableCount: filtered.filter((l) => l.delivery_status === "Delivered" && !isPaid(l)).length,
      fees: filtered.reduce((a, l) => a + num(l.courier_fee), 0),
    };
  }, [filtered, summary]);

  // 14-day delivered trend, drawn from the rows we already have
  const trend = useMemo(() => {
    if (trendRows.length)
      return [...trendRows].sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ date: r.day, count: Number(r.delivered ?? 0) }));
    const byDay: Record<string, number> = {};
    filtered.forEach((l) => {
      if (l.delivery_status !== "Delivered") return;
      const d = String(l.delivery_date ?? "").slice(0, 10);
      if (d) byDay[d] = (byDay[d] || 0) + 1;
    });
    return Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-14)
      .map(([date, count]) => ({ date, count }));
  }, [filtered, trendRows]);

  const cards = [
    { label: "Active shipments", value: M.active.toLocaleString(), sub: M.cancelled ? `${M.total.toLocaleString()} incl. cancelled` : undefined, Icon: Package, bg: "bg-periwinkle-soft" },
    { label: "In transit", filter: "In Transit", value: (M.transitPortal || M.transit).toLocaleString(),
      sub: M.outForReturn ? `incl. ${M.outForReturn} coming back` : undefined,
      Icon: Truck, bg: "bg-amber-soft" },
    { label: "Delivered", filter: "Delivered", value: M.delivered.toLocaleString(), Icon: CheckCircle2, bg: "bg-success-soft" },
    // split the way the courier portals do: a parcel travelling back is still
    // moving, only a received one is a finished return
    { label: "Returned", filter: "Returned", value: (M.returnedReceived ?? M.rts).toLocaleString(),
      sub: "back with us", Icon: Undo2, bg: "bg-salmon-soft" },
    { label: "Out for return", filter: "RTS", value: M.outForReturn.toLocaleString(),
      sub: M.outForReturn ? "counted in transit" : "none", Icon: Undo2, bg: "bg-panel" },
    { label: "Cancelled", filter: "Cancelled", value: M.cancelled.toLocaleString(), Icon: XCircle, bg: "bg-panel" },
    { label: "Delivery rate", value: `${M.rate.toFixed(1)}%`, Icon: Percent, bg: "bg-lavender-soft" },
    { label: "COD delivered", value: rs(M.cod), Icon: Wallet, bg: "bg-pink-soft" },
    { label: "COD receivable", value: rs(M.receivable), sub: M.receivableCount ? `${M.receivableCount.toLocaleString()} parcels unpaid` : "all settled", Icon: Clock, bg: "bg-success-soft", warn: M.receivable > 0 },
  ];

  // Counted in the database (0052). The previous version tallied the rows the
  // browser happened to receive, which PostgREST caps at 1,000 — so on wide
  // ranges this table under-reported exactly like the cards did.
  const byCourier = useMemo(() => {
    if (courierSplit.length)
      return courierSplit.filter((c) => c.courier !== "TOTAL").map((c) => ({
        name: c.courier, total: Number(c.total), delivered: Number(c.delivered),
        rts: Number(c.returned_received ?? c.rts), outForReturn: Number(c.out_for_return ?? 0),
        transit: Number(c.transit_portal ?? c.transit), cancelled: Number(c.cancelled),
        cod: Number(c.cod), receivable: Number(c.receivable), fees: Number(c.fees),
        rate: Number(c.delivery_rate),
      }));
    const m: Record<string, { total: number; delivered: number; rts: number; transit: number; cancelled: number; cod: number; receivable: number; fees: number }> = {};
    filtered.forEach((l) => {
      const k = String(l.courier || "—");
      (m[k] ||= { total: 0, delivered: 0, rts: 0, transit: 0, cancelled: 0, cod: 0, receivable: 0, fees: 0 });
      m[k].total += 1;
      if (l.delivery_status === "Delivered") { m[k].delivered += 1; m[k].cod += num(l.cod_amount); }
      if (isRts(l)) m[k].rts += 1;
      if (l.delivery_status === "In Transit") m[k].transit += 1;
      if (l.delivery_status === "Cancelled") m[k].cancelled += 1;
      m[k].fees += num(l.courier_fee);
    });
    return Object.entries(m).map(([name, v]) => ({ name, ...v, rate: v.delivered + v.rts ? (v.delivered / (v.delivered + v.rts)) * 100 : 0 })).sort((a, b) => b.total - a.total);
  }, [filtered, courierSplit]);

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach((l) => { const k = String(l.delivery_status || "—"); m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [filtered]);
  const maxStatus = Math.max(...byStatus.map((s) => s.count), 1);

  return (
    <div onClickCapture={refreshOnClick} className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Logistics</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted dark:text-[#a89f93]">
            PostEx / OwnEx tracking, delivery performance &amp; RTS.
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? "bg-success-soft text-success dark:bg-white/[0.08]" : "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-success" : "bg-muted"}`} />
              {live ? "Live" : "Not live"}
              {lastChange && live ? ` \u00b7 updated ${lastChange.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SmartImport onDone={load} />
          <HealthCheck />
          <CourierSync onDone={load} />
          
          <AddShipment onDone={load} />
          <button onClick={() => load()} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt}
        right={
          <>
            <select value={store} onChange={(e) => setStore(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              {STORES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            <select value={courier}
              onChange={(e) => { setCourier(e.target.value); setRawStatus("All statuses"); }}
              className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              {COURIERS.map((c) => <option key={c}>{c}</option>)}
            </select>

            {/* the courier's own statuses — Booked, Out For Delivery, Attempted
                and the rest — built from the data, so a new one appears by itself */}
            <select value={rawStatus} onChange={(e) => setRawStatus(e.target.value)}
              className="max-w-[220px] rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              <option>All statuses</option>
              {[...new Map(statusCounts.map((r) => [r.raw_status, r])).values()]
                .sort((a, b) => Number(b.parcels) - Number(a.parcels))
                .map((r) => (
                  <option key={r.raw_status} value={r.raw_status}>
                    {r.raw_status} ({Number(r.parcels).toLocaleString()})
                  </option>
                ))}
            </select>
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <Search size={15} className="text-hint dark:text-[#8a8175]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order or tracking" className="w-40 bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-44 dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
            </div>
          </>
        } />

      {statusFilter && (
        <div className="mt-4 flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white dark:bg-white dark:text-[#141414]">
          Showing {statusFilter.toLowerCase()} only
          <button onClick={() => setStatusFilter("")} className="underline">clear</button>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-9">
        {cards.map(({ label, value, sub, Icon, bg, warn, filter }) => {
          const clickable = filter !== undefined;
          const active = clickable && statusFilter === filter && !(filter === "" && !statusFilter);
          return (
          <button key={label} type="button"
            onClick={() => clickable && setStatusFilter(statusFilter === filter ? "" : (filter as string))}
            disabled={!clickable}
            title={clickable ? `Show only ${label.toLowerCase()}` : undefined}
            className={`rounded-card border ${active ? "border-ink ring-2 ring-ink/20 dark:border-white/40" : "border-line dark:border-white/[0.06]"} ${bg} p-4 text-left transition ${clickable ? "cursor-pointer hover:brightness-95 dark:hover:brightness-110" : "cursor-default"} dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className={`mt-3 text-[15px] font-extrabold tabular-nums sm:text-[17px] ${warn ? "text-amber-strong dark:text-amber" : "text-ink dark:text-[#f4f1ea]"}`}>{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
            {sub && <div className="mt-0.5 text-[10.5px] text-hint dark:text-[#8a8175]">{sub}</div>}
          </button>
          );
        })}
      </div>

      {statusFilter && (
        <button onClick={() => setStatusFilter("")}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white dark:bg-white dark:text-[#141414]">
          Showing {statusFilter} only · clear
        </button>
      )}

      {/* per-courier split — reconciling against a courier portal needs their
          share, not a combined figure. Counted in the database (0052). */}
      {courierSplit.length > 1 && (
        <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-hint dark:text-[#8a8175]">
              <tr className="border-b border-line dark:border-white/[0.06]">
                <th className="px-4 py-2.5">Courier</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5 text-right">In transit</th>
                <th className="px-4 py-2.5 text-right">Delivered</th>
                <th className="px-4 py-2.5 text-right">Returned</th>
                <th className="px-4 py-2.5 text-right">Out for return</th>
                <th className="px-4 py-2.5 text-right">Cancelled</th>
                <th className="px-4 py-2.5 text-right">Rate</th>
                <th className="px-4 py-2.5 text-right">COD delivered</th>
                <th className="px-4 py-2.5 text-right">Receivable</th>
              </tr>
            </thead>
            <tbody>
              {courierSplit.map((c) => {
                const isTotal = c.courier === "TOTAL";
                return (
                  <tr key={c.courier} className={`border-b border-line last:border-0 dark:border-white/[0.06] ${isTotal ? "bg-panel font-bold dark:bg-white/[0.06]" : "text-ink dark:text-[#e7e2d8]"}`}>
                    <td className="px-4 py-2.5 font-semibold text-ink dark:text-[#f4f1ea]">{c.courier}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(c.total).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(c.transit_portal ?? c.transit).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-success">{Number(c.delivered).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-danger">{Number(c.returned_received ?? c.rts).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted dark:text-[#a89f93]">{Number(c.out_for_return ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted dark:text-[#a89f93]">{Number(c.cancelled).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(c.delivery_rate).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rs(Number(c.cod))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(c.receivable) > 0 ? rs(Number(c.receivable)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* delivered trend — the courier portals show this, so we do too */}
      {!loading && trend.length > 1 && (
        <div className="mt-4 rounded-card border border-line bg-surface p-5 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink dark:text-[#f4f1ea]"><TrendingUp size={16} /> Delivered per day</h3>
          <div className="flex h-28 items-end gap-1.5">
            {trend.map((d) => {
              const max = Math.max(...trend.map((x) => x.count), 1);
              return (
                <div key={d.date} className="group flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold tabular-nums text-muted opacity-0 transition group-hover:opacity-100 dark:text-[#a89f93]">{d.count}</span>
                  <div className="w-full rounded-t bg-success transition hover:opacity-80" style={{ height: `${Math.max((d.count / max) * 80, 3)}px` }} title={`${d.date}: ${d.count} delivered`} />
                  <span className="text-[9.5px] text-hint dark:text-[#8a8175]">{d.date.slice(8)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
          <table className="w-full min-w-[680px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {view === "list" && <><th className="px-4 py-3 font-semibold">Order #</th><th className="px-4 py-3 font-semibold">Store</th><th className="px-4 py-3 font-semibold">Courier</th><th className="px-4 py-3 font-semibold">Tracking</th><th className="px-4 py-3 font-semibold">Dispatched</th><th className="px-4 py-3 text-right font-semibold">COD</th><th className="px-4 py-3 font-semibold">Delivery</th></>}
                {view === "couriers" && <><th className="px-4 py-3 font-semibold">Courier</th><th className="px-4 py-3 text-right font-semibold">Shipments</th><th className="px-4 py-3 text-right font-semibold">Delivered</th><th className="px-4 py-3 text-right font-semibold">RTS</th><th className="px-4 py-3 text-right font-semibold">Rate</th><th className="px-4 py-3 text-right font-semibold">COD</th><th className="px-4 py-3 text-right font-semibold">Fees</th></>}
                {view === "status" && <><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 text-right font-semibold">Shipments</th><th className="hidden px-4 py-3 font-semibold sm:table-cell">Share</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load logistics: {err}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">{rows.length === 0 ? "No shipments in this period — fills once the courier sync is live." : "Nothing matches these filters."}</td></tr>
              ) : view === "list" ? (
                filtered.slice(0, 500).map((l, i) => (
                  <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold">{String(l.order_number ?? "—")}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(l.store_code ?? "—")}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(l.courier ?? "—")}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(l.tracking_id ?? "—")}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(l.dispatch_date ?? "—")}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{l.cod_amount == null ? "—" : rs(num(l.cod_amount))}</td>
                    <td className="px-4 py-3"><span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${deliveryClass(String(l.delivery_status))}`}>{String(l.delivery_status ?? "—")}</span></td>
                  </tr>
                ))
              ) : view === "couriers" ? (
                byCourier.map((c) => (
                  <tr key={c.name} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold">{c.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.total.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-success">{c.delivered.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-danger">{c.rts.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">{c.rate.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right tabular-nums">{rs(c.cod)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted dark:text-[#a89f93]">{rs(c.fees)}</td>
                  </tr>
                ))
              ) : (
                byStatus.map((s) => (
                  <tr key={s.name} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3"><span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${deliveryClass(s.name)}`}>{s.name}</span></td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{s.count.toLocaleString()}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <div className="h-2 w-full max-w-[160px] overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
                        <div className="h-full rounded-full bg-periwinkle" style={{ width: `${Math.max((s.count / maxStatus) * 100, 2)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && !err && filtered.length > 0 && view === "list" && (
          <div className="border-t border-line px-4 py-3 text-[12px] text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
            {Math.min(filtered.length, 500).toLocaleString()} of {filtered.length.toLocaleString()} shipments
          </div>
        )}
      </div>
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live shipments.</p>}
    </div>
  );
}
