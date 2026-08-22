"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Truck, CheckCircle2, Undo2, Percent, Wallet, Search, RefreshCw, XCircle, Clock, TrendingUp } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates, num, rs } from "@/lib/dateRange";
import { AddShipment, UploadCourierFile } from "@/components/LogisticsEntry";
import CourierSync from "@/components/CourierSync";
import ShopifySync from "@/components/ShopifySync";

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
const isRts = (l: Logi) => l.delivery_status === "RTS" || l.delivery_status === "Returned" || (!!l.rts && l.rts !== "No" && l.rts !== "false");

export default function LogisticsPage() {
  const [rows, setRows] = useState<Logi[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [store, setStore] = useState("ALL");
  const [courier, setCourier] = useState("All couriers");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("list");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let q2 = supabase.from("online_logistics")
      .select("id,order_number,store_code,courier,tracking_id,dispatch_date,delivery_status,delivery_date,cod_amount,cpr_net_amount,courier_fee,payment_status,rts,rts_reason")
      .order("dispatch_date", { ascending: false, nullsFirst: false }).limit(5000);
    if (from) q2 = q2.gte("dispatch_date", from);
    if (to) q2 = q2.lte("dispatch_date", to);
    if (store !== "ALL") q2 = q2.eq("store_code", store);
    const { data, error } = await q2;
    if (error) setErr(error.message);
    setRows((data as Logi[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, store]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((l) =>
      (courier === "All couriers" || l.courier === courier) &&
      (!n || [l.order_number, l.tracking_id].some((v) => String(v ?? "").toLowerCase().includes(n)))
    );
  }, [rows, courier, q]);

  const M = useMemo(() => {
    const delivered = filtered.filter((l) => l.delivery_status === "Delivered").length;
    const rts = filtered.filter(isRts).length;
    const cancelled = filtered.filter((l) => l.delivery_status === "Cancelled").length;
    const settled = delivered + rts;
    const isPaid = (l: Logi) => l.payment_status === "Paid" || l.payment_status === "Received";
    return {
      total: filtered.length,
      active: filtered.length - cancelled,      // what the courier portal counts
      transit: filtered.filter((l) => l.delivery_status === "In Transit").length,
      delivered, rts, cancelled,
      rate: settled ? (delivered / settled) * 100 : 0,
      cod: filtered.filter((l) => l.delivery_status === "Delivered").reduce((a, l) => a + num(l.cod_amount), 0),
      // money already collected by the courier but not yet paid over to us
      receivable: filtered.filter((l) => l.delivery_status === "Delivered" && !isPaid(l))
                          .reduce((a, l) => a + num(l.cod_amount), 0),
      receivableCount: filtered.filter((l) => l.delivery_status === "Delivered" && !isPaid(l)).length,
      fees: filtered.reduce((a, l) => a + num(l.courier_fee), 0),
    };
  }, [filtered]);

  // 14-day delivered trend, drawn from the rows we already have
  const trend = useMemo(() => {
    const byDay: Record<string, number> = {};
    filtered.forEach((l) => {
      if (l.delivery_status !== "Delivered") return;
      const d = String(l.delivery_date ?? "").slice(0, 10);
      if (d) byDay[d] = (byDay[d] || 0) + 1;
    });
    return Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-14)
      .map(([date, count]) => ({ date, count }));
  }, [filtered]);

  const cards = [
    { label: "Active shipments", value: M.active.toLocaleString(), sub: M.cancelled ? `${M.total.toLocaleString()} incl. cancelled` : undefined, Icon: Package, bg: "bg-periwinkle-soft" },
    { label: "In transit", value: M.transit.toLocaleString(), Icon: Truck, bg: "bg-amber-soft" },
    { label: "Delivered", value: M.delivered.toLocaleString(), Icon: CheckCircle2, bg: "bg-success-soft" },
    { label: "RTS / returns", value: M.rts.toLocaleString(), Icon: Undo2, bg: "bg-salmon-soft" },
    { label: "Cancelled", value: M.cancelled.toLocaleString(), Icon: XCircle, bg: "bg-panel" },
    { label: "Delivery rate", value: `${M.rate.toFixed(1)}%`, Icon: Percent, bg: "bg-lavender-soft" },
    { label: "COD delivered", value: rs(M.cod), Icon: Wallet, bg: "bg-pink-soft" },
    { label: "COD receivable", value: rs(M.receivable), sub: M.receivableCount ? `${M.receivableCount.toLocaleString()} parcels unpaid` : "all settled", Icon: Clock, bg: "bg-success-soft", warn: M.receivable > 0 },
  ];

  const byCourier = useMemo(() => {
    const m: Record<string, { total: number; delivered: number; rts: number; transit: number; cod: number; fees: number }> = {};
    filtered.forEach((l) => {
      const k = String(l.courier || "—");
      (m[k] ||= { total: 0, delivered: 0, rts: 0, transit: 0, cod: 0, fees: 0 });
      m[k].total += 1;
      if (l.delivery_status === "Delivered") { m[k].delivered += 1; m[k].cod += num(l.cod_amount); }
      if (isRts(l)) m[k].rts += 1;
      if (l.delivery_status === "In Transit") m[k].transit += 1;
      m[k].fees += num(l.courier_fee);
    });
    return Object.entries(m).map(([name, v]) => ({ name, ...v, rate: v.delivered + v.rts ? (v.delivered / (v.delivered + v.rts)) * 100 : 0 })).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach((l) => { const k = String(l.delivery_status || "—"); m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [filtered]);
  const maxStatus = Math.max(...byStatus.map((s) => s.count), 1);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Logistics</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">PostEx / OwnEx tracking, delivery performance &amp; RTS.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ShopifySync onDone={load} />
          <CourierSync onDone={load} />
          <UploadCourierFile onDone={load} />
          <AddShipment onDone={load} />
          <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
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
            <select value={courier} onChange={(e) => setCourier(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              {COURIERS.map((c) => <option key={c}>{c}</option>)}
            </select>
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <Search size={15} className="text-hint dark:text-[#8a8175]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order or tracking" className="w-40 bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-44 dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
            </div>
          </>
        } />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {cards.map(({ label, value, sub, Icon, bg, warn }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className={`mt-3 text-[15px] font-extrabold tabular-nums sm:text-[17px] ${warn ? "text-amber-strong dark:text-amber" : "text-ink dark:text-[#f4f1ea]"}`}>{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
            {sub && <div className="mt-0.5 text-[10.5px] text-hint dark:text-[#8a8175]">{sub}</div>}
          </div>
        ))}
      </div>

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
