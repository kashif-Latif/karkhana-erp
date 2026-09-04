"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveTables } from "@/lib/useLiveTables";
import { ShoppingBag, Clock, Undo2, Wallet, TrendingUp, Truck, RefreshCw, MapPin } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates, num, rs } from "@/lib/dateRange";

type Row = Record<string, unknown>;
const STORES = [
  { code: "ALL", label: "All stores", color: "#141414" },
  { code: "LM", label: "Little Minors", color: "#A6C0E6" },
  { code: "TS", label: "TopShop", color: "#EBA98F" },
  { code: "TRZ", label: "Trenzee", color: "#D2B9EA" },
];
const PIE = ["#A6C0E6", "#D2B9EA", "#EBA98F", "#EFD0A6", "#EDA6D0", "#B4ABA0"];
const isCanc = (s: unknown) => /cancel|void/i.test(String(s || ""));

function Pie({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">No city data yet.</div>;
  const cx = 100, cy = 100, r = 88; let acc = 0;
  const arc = (v: number) => {
    const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    acc += v;
    const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
  };
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="200" height="200" viewBox="0 0 200 200" className="shrink-0">
        {data.map((d, i) => <path key={d.label} d={arc(d.value)} fill={PIE[i % PIE.length]} stroke="var(--surface,#fff)" strokeWidth="1.5" />)}
      </svg>
      <div className="flex min-w-[170px] flex-1 flex-col gap-2">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: PIE[i % PIE.length] }} />
            <span className="flex-1 truncate text-ink dark:text-[#e7e2d8]">{d.label}</span>
            <b className="tabular-nums text-ink dark:text-[#f4f1ea]">{d.value.toLocaleString()}</b>
            <span className="w-12 text-right tabular-nums text-muted dark:text-[#a89f93]">{((d.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type DashSummary = {
  total_orders: number; pending: number; returned_cancel: number;
  delivered: number; in_transit: number;
  order_value: number; avg_order: number; delivery_rate: number;
  cod_received: number; cod_receivable: number; receivable_count: number;
};

type RateRow = { month_label: string; courier: string; returned: number;
                 return_pct: number | null; change_pts: number | null;
                 cod_returned: number | null; is_part_month: boolean };

export default function HubDashboard() {
  const [orders, setOrders] = useState<Row[]>([]);
  const [logi, setLogi] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rates, setRates] = useState<RateRow[]>([]);
  // The two cards answer "is it getting worse". The months answer "what is
  // normal" — worth having, not worth pushing the rest of the page down.
  const [showMonths, setShowMonths] = useState(false);
  const [store, setStore] = useState("ALL");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [summary, setSummary] = useState<DashSummary | null>(null);

  /* The headline numbers come from hub_dashboard_summary(), counted in the
     database. Rows are still fetched, but ONLY for the pie chart and the
     per-store bars — never for the totals.
     PostgREST caps a response at 1,000 rows whatever .limit() asks, so counting
     the array made "Total orders" read exactly 1,000 on every single range.
     Third page with this fault: Logistics, Orders, and this one. */
  const reqId = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const my = ++reqId.current;
    if (!opts?.silent) setLoading(true);
    setErr("");
    const [from, to] = rangeDates(preset, cf, ct);

    let oq = supabase.from("online_orders").select("order_number,store_code,order_date,amount,status,city").limit(1000);
    if (from) oq = oq.gte("order_date", from);
    if (to) oq = oq.lte("order_date", to);
    if (store !== "ALL") oq = oq.eq("store_code", store);

    let lq = supabase.from("online_logistics").select("order_number,store_code,courier,delivery_status,cod_amount,cpr_net_amount,payment_status").limit(1000);
    if (store !== "ALL") lq = lq.eq("store_code", store);

    const [o, l, sum, rt] = await Promise.all([
      oq, lq,
      supabase.rpc("hub_dashboard_summary", {
        p_from: from, p_to: to, p_store: store === "ALL" ? null : store,
      }),
      supabase.rpc("hub_return_rates", { p_months: 3 }),
    ]);
    if (my !== reqId.current) return;          // superseded by a newer request
    if (o.error) setErr(o.error.message);
    setOrders((o.data as Row[]) ?? []);
    setLogi((l.data as Row[]) ?? []);
    setSummary((sum.data as DashSummary[])?.[0] ?? null);
    setRates((rt.data as RateRow[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, store]);

  useEffect(() => { load(); }, [load]);

  /* Live: the couriers and Shopify both write straight to these tables, so the
     dashboard repaints itself rather than waiting for someone to press Refresh. */
  const { live } = useLiveTables(
    ["online_orders", "online_logistics"],
    useCallback(() => load({ silent: true }), [load]),
  );

  const M = useMemo(() => {
    const logByOrder: Record<string, Row> = {};
    logi.forEach((l) => { logByOrder[`${l.store_code}|${l.order_number}`] = l; });
    const key = (o: Row) => `${o.store_code}|${o.order_number}`;

    // counted in the database — never from `orders`, which is capped at 1,000
    const total = Number(summary?.total_orders ?? 0);
    const pending = Number(summary?.pending ?? 0);
    const retCanc = Number(summary?.returned_cancel ?? 0);
    const delivered = Number(summary?.delivered ?? 0);
    const transit = Number(summary?.in_transit ?? 0);
    const totalAmt = Number(summary?.order_value ?? 0);
    const avgAmt = Number(summary?.avg_order ?? 0);
    const deliveryRate = Number(summary?.delivery_rate ?? 0);

    // COD receivables from logistics
    const paid = logi.filter((l) => l.payment_status === "Paid" || l.payment_status === "Received");
    const unpaid = logi.filter((l) => !(l.payment_status === "Paid" || l.payment_status === "Received"));
    const received = paid.reduce((a, l) => a + (num(l.cpr_net_amount) || num(l.cod_amount)), 0);
    const receivable = unpaid.filter((l) => String(l.delivery_status) === "Delivered").reduce((a, l) => a + num(l.cod_amount), 0);

    // cities
    const cityCount: Record<string, number> = {};
    orders.forEach((o) => { const c = String(o.city || "Unknown").trim() || "Unknown"; cityCount[c] = (cityCount[c] || 0) + 1; });
    const sorted = Object.entries(cityCount).sort((a, b) => b[1] - a[1]);
    const cities = sorted.slice(0, 5).map(([label, value]) => ({ label, value }));
    const others = sorted.slice(5).reduce((a, [, c]) => a + c, 0);
    if (others > 0) cities.push({ label: "Others", value: others });

    // per store
    const byStore: Record<string, { orders: number; amt: number; delivered: number }> = {};
    orders.forEach((o) => {
      const k = String(o.store_code || "—");
      (byStore[k] ||= { orders: 0, amt: 0, delivered: 0 });
      byStore[k].orders += 1; byStore[k].amt += num(o.amount);
      if (String(logByOrder[key(o)]?.delivery_status) === "Delivered") byStore[k].delivered += 1;
    });

    // courier split
    const byCourier: Record<string, number> = {};
    logi.forEach((l) => { const c = String(l.courier || "—"); byCourier[c] = (byCourier[c] || 0) + 1; });

    return { total, pending, retCanc, delivered, transit, totalAmt, avgAmt, deliveryRate, received, receivable, cities, byStore, byCourier };
  }, [orders, logi]);

  const pct = (n: number) => (M.total ? Math.round((n / M.total) * 100) : 0);
  /* Return rate per courier, this month against last. The dashboard already
     counts returns; it never said whether the rate was rising or falling, which
     is the only part anyone can act on. */
  const rateCards = rates.filter((x) => !x.is_part_month).reduce((acc: RateRow[], r) => {
    if (acc.filter((a) => a.courier === r.courier).length < 2) acc.push(r);
    return acc;
  }, []);

  const cards = [
    { label: "Total orders", value: M.total.toLocaleString(), sub: "in period", Icon: ShoppingBag, bg: "bg-periwinkle-soft" },
    { label: "Pending (not dispatched)", value: M.pending.toLocaleString(), sub: `${pct(M.pending)}% of orders`, Icon: Clock, bg: "bg-amber-soft" },
    { label: "Returned & cancelled", value: M.retCanc.toLocaleString(), sub: `${pct(M.retCanc)}% of orders`, Icon: Undo2, bg: "bg-salmon-soft" },
    { label: "Order value", value: rs(M.totalAmt), sub: "in period", Icon: Wallet, bg: "bg-success-soft" },
    { label: "Average order", value: rs(M.avgAmt), sub: "per order", Icon: TrendingUp, bg: "bg-lavender-soft" },
    { label: "Delivery rate", value: `${M.deliveryRate.toFixed(1)}%`, sub: `${M.delivered.toLocaleString()} delivered`, Icon: Truck, bg: "bg-pink-soft" },
  ];
  const storeKeys = Object.keys(M.byStore);
  const maxStoreAmt = Math.max(...storeKeys.map((k) => M.byStore[k].amt), 1);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Dashboard</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted dark:text-[#a89f93]">
            Orders, delivery performance &amp; COD across all three stores.
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? "bg-success-soft text-success dark:bg-white/[0.08]" : "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-success" : "bg-muted"}`} />
              {live ? "Live" : "Not live"}
            </span>
          </p>
        </div>
        <button onClick={() => load()} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt}
        right={
          <select value={store} onChange={(e) => setStore(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {STORES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        } />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(({ label, value, sub, Icon, bg }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[16px] font-extrabold tabular-nums text-ink sm:text-[18px] dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
            <div className="mt-0.5 text-[11px] text-hint dark:text-[#8a8175]">{sub}</div>
          </div>
        ))}
      </div>

      {/* RETURN RATE BY COURIER — this month against last.
          The card above counts returns. This says whether the rate is rising,
          which is the part anyone can act on: OwnEx ran 14.5% in June, 25.2% in
          July and 14.9% in August, a swing worth about Rs 190,000. */}
      {rateCards.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {["PostEx", "OwnEx"].map((cr) => {
            const rows = rateCards.filter((x) => x.courier === cr);
            const now = rows[0], prev = rows[1];
            if (!now) return null;
            const p = Number(now.return_pct ?? 0);
            const d = prev ? p - Number(prev.return_pct ?? 0) : null;
            return (
              <div key={cr} className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-bold text-ink dark:text-[#f4f1ea]">{cr} returns</span>
                  <span className="text-[11.5px] text-hint dark:text-[#8a8175]">{now.month_label}</span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-[24px] font-extrabold tabular-nums leading-none text-ink dark:text-[#f4f1ea]">
                    {loading ? "—" : `${p.toFixed(1)}%`}
                  </span>
                  {d !== null && !loading && (
                    /* Fewer returns is better, so a fall is the green one. */
                    <span className={`text-[12px] font-bold tabular-nums ${d <= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {d > 0 ? "+" : ""}{d.toFixed(1)} pts
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11.5px] text-muted dark:text-[#a89f93]">
                  {now.returned} came back · {rs(Number(now.cod_returned ?? 0))} of COD
                  {prev && <> · {Number(prev.return_pct ?? 0).toFixed(1)}% in {prev.month_label}</>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rates.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowMonths((v) => !v)}
                  className="text-[12.5px] font-semibold text-muted underline-offset-2 transition hover:text-ink hover:underline dark:text-[#a89f93] dark:hover:text-white">
            {showMonths ? "Hide month by month" : "Return rate month by month"}
          </button>
          {showMonths && (
            <div className="mt-2 overflow-x-auto rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted dark:border-white/[0.06] dark:text-[#a89f93]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Month</th>
                    <th className="px-4 py-2.5 font-semibold">Courier</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Returned</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Rate</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Change</th>
                    <th className="px-4 py-2.5 text-right font-semibold">COD returned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line dark:divide-white/[0.06]">
                  {rates.filter((x) => x.courier === "PostEx" || x.courier === "OwnEx").map((x, i) => {
                    const pc = Number(x.return_pct ?? 0);
                    const d = x.change_pts === null ? null : Number(x.change_pts);
                    return (
                      <tr key={i} className="text-ink dark:text-[#e7e2d8]">
                        <td className="px-4 py-2.5">
                          {x.month_label}
                          {x.is_part_month && (
                            <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-hint dark:bg-white/[0.06]">still running</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">{x.courier}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{x.returned}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums">{pc.toFixed(1)}%</td>
                        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                          d === null ? "text-hint" : d <= 0 ? "text-emerald-700" : "text-red-700"}`}>
                          {d === null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted dark:text-[#a89f93]">
                          {rs(Number(x.cod_returned ?? 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* COD money row */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
          <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">COD received</div>
          <div className="mt-1 text-[19px] font-extrabold tabular-nums text-success">{loading ? "—" : rs(M.received)}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
          <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">COD receivable (delivered, unpaid)</div>
          <div className="mt-1 text-[19px] font-extrabold tabular-nums text-amber-strong dark:text-amber">{loading ? "—" : rs(M.receivable)}</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
          <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">In transit</div>
          <div className="mt-1 text-[19px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : M.transit.toLocaleString()}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h3 className="mb-4 flex items-center gap-2 text-[14px] font-bold text-ink dark:text-[#f4f1ea]"><MapPin size={16} /> Top cities</h3>
          {loading ? <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">Loading…</div> : <Pie data={M.cities} />}
        </div>
        <div className="rounded-card border border-line bg-surface p-5 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h3 className="mb-4 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">By store</h3>
          {loading ? <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">Loading…</div>
          : storeKeys.length === 0 ? <div className="py-10 text-center text-[13px] text-muted dark:text-[#a89f93]">No orders in this period.</div>
          : (
            <div className="space-y-3">
              {storeKeys.sort((a, b) => M.byStore[b].amt - M.byStore[a].amt).map((k) => {
                const s = M.byStore[k]; const meta = STORES.find((x) => x.code === k);
                return (
                  <div key={k}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-semibold text-ink dark:text-[#f4f1ea]">{meta?.label ?? k}</span>
                      <span className="tabular-nums text-muted dark:text-[#a89f93]">{s.orders.toLocaleString()} orders · <b className="text-ink dark:text-[#f4f1ea]">{rs(s.amt)}</b></span>
                    </div>
                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
                      <div className="h-full rounded-full" style={{ width: `${Math.max((s.amt / maxStoreAmt) * 100, 2)}%`, background: meta?.color ?? "#EBA98F" }} />
                    </div>
                  </div>
                );
              })}
              {Object.keys(M.byCourier).length > 0 && (
                <div className="mt-4 border-t border-line pt-3 dark:border-white/[0.06]">
                  <div className="mb-2 text-[12px] font-semibold text-muted dark:text-[#a89f93]">Shipments by courier</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(M.byCourier).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                      <span key={c} className="rounded-full bg-panel px-3 py-1 text-[12px] font-semibold text-ink dark:bg-white/[0.06] dark:text-[#e7e2d8]">{c} · {n.toLocaleString()}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {err && <p className="mt-4 text-[12.5px] font-medium text-danger">Couldn&apos;t load: {err}</p>}
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live figures.</p>}
    </div>
  );
}
