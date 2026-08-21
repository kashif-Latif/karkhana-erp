"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShoppingBag, Clock, Truck, XCircle, Wallet, TrendingUp, Search, RefreshCw } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates, num, rs } from "@/lib/dateRange";

type Order = Record<string, unknown>;
type View = "list" | "cities" | "status" | "stores";

const STORES = [
  { code: "ALL", label: "All stores" }, { code: "LM", label: "Little Minors" },
  { code: "TS", label: "TopShop" }, { code: "TRZ", label: "Trenzee" },
];
const STATUSES = ["All", "Pending", "Dispatched", "Delivered", "Cancelled", "Returned"];
const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "Orders" }, { key: "cities", label: "By City" },
  { key: "status", label: "By Status" }, { key: "stores", label: "By Store" },
];

function statusClass(s: string) {
  switch (s) {
    case "Dispatched": return "bg-periwinkle-soft text-periwinkle-strong dark:bg-white/[0.08] dark:text-periwinkle";
    case "Delivered": return "bg-success-soft text-success dark:bg-white/[0.08] dark:text-success";
    case "Cancelled": return "bg-danger-soft text-danger dark:bg-white/[0.08] dark:text-danger";
    case "Returned": return "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]";
    default: return "bg-amber-soft text-amber-strong dark:bg-white/[0.08] dark:text-amber";
  }
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [store, setStore] = useState("ALL");
  const [status, setStatus] = useState("All");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("list");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let q2 = supabase.from("online_orders")
      .select("id,order_number,store_code,order_date,customer_name,phone,city,amount,status")
      .order("order_date", { ascending: false, nullsFirst: false }).limit(5000);
    if (from) q2 = q2.gte("order_date", from);
    if (to) q2 = q2.lte("order_date", to);
    if (store !== "ALL") q2 = q2.eq("store_code", store);
    const { data, error } = await q2;
    if (error) setErr(error.message);
    setOrders((data as Order[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, store]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return orders.filter((o) =>
      (status === "All" || o.status === status) &&
      (!n || [o.order_number, o.customer_name, o.phone, o.city].some((v) => String(v ?? "").toLowerCase().includes(n)))
    );
  }, [orders, status, q]);

  const totalAmt = useMemo(() => filtered.reduce((a, o) => a + num(o.amount), 0), [filtered]);
  const by = (s: string) => filtered.filter((o) => o.status === s).length;
  const cards = [
    { label: "Orders", value: filtered.length.toLocaleString(), Icon: ShoppingBag, bg: "bg-periwinkle-soft" },
    { label: "Pending", value: by("Pending").toLocaleString(), Icon: Clock, bg: "bg-amber-soft" },
    { label: "Dispatched", value: by("Dispatched").toLocaleString(), Icon: Truck, bg: "bg-lavender-soft" },
    { label: "Delivered", value: by("Delivered").toLocaleString(), Icon: Truck, bg: "bg-success-soft" },
    { label: "Order value", value: rs(totalAmt), Icon: Wallet, bg: "bg-pink-soft" },
    { label: "Avg order", value: rs(filtered.length ? totalAmt / filtered.length : 0), Icon: TrendingUp, bg: "bg-salmon-soft" },
  ];

  const grouped = useMemo(() => {
    const key = view === "cities" ? "city" : view === "status" ? "status" : view === "stores" ? "store_code" : null;
    if (!key) return [];
    const m: Record<string, { count: number; amt: number }> = {};
    filtered.forEach((o) => {
      const k = String(o[key] || "Unknown").trim() || "Unknown";
      (m[k] ||= { count: 0, amt: 0 });
      m[k].count += 1; m[k].amt += num(o.amount);
    });
    return Object.entries(m).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count).slice(0, 200);
  }, [filtered, view]);
  const maxCount = Math.max(...grouped.map((g) => g.count), 1);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Orders</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Online orders across Little Minors, TopShop &amp; Trenzee.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt}
        right={
          <>
            <select value={store} onChange={(e) => setStore(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              {STORES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <Search size={15} className="text-hint dark:text-[#8a8175]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, name, phone" className="w-40 bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-48 dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
            </div>
          </>
        } />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(({ label, value, Icon, bg }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[16px] font-extrabold tabular-nums text-ink sm:text-[18px] dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

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
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {view === "list" ? <><th className="px-4 py-3 font-semibold">Order #</th><th className="px-4 py-3 font-semibold">Store</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Customer</th><th className="px-4 py-3 font-semibold">City</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Status</th></>
                : <><th className="px-4 py-3 font-semibold">{view === "cities" ? "City" : view === "status" ? "Status" : "Store"}</th><th className="px-4 py-3 text-right font-semibold">Orders</th><th className="px-4 py-3 text-right font-semibold">Value</th><th className="hidden px-4 py-3 font-semibold sm:table-cell">Share</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load orders: {err}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">{orders.length === 0 ? "No orders in this period — fills once the Shopify sync is live." : "Nothing matches these filters."}</td></tr>
              ) : view === "list" ? (
                filtered.slice(0, 500).map((o, i) => (
                  <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold">{String(o.order_number ?? "—")}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(o.store_code ?? "—")}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(o.order_date ?? "—")}</td>
                    <td className="px-4 py-3">{String(o.customer_name ?? "—")}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(o.city ?? "—")}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(num(o.amount))}</td>
                    <td className="px-4 py-3"><span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${statusClass(String(o.status))}`}>{String(o.status ?? "—")}</span></td>
                  </tr>
                ))
              ) : (
                grouped.map((g) => (
                  <tr key={g.name} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold">{g.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{g.count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(g.amt)}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <div className="h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
                        <div className="h-full rounded-full bg-periwinkle" style={{ width: `${Math.max((g.count / maxCount) * 100, 2)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && !err && filtered.length > 0 && (
          <div className="border-t border-line px-4 py-3 text-[12px] text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
            {view === "list" ? `${Math.min(filtered.length, 500).toLocaleString()} of ${filtered.length.toLocaleString()} orders` : `${grouped.length.toLocaleString()} rows`}
          </div>
        )}
      </div>
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live orders.</p>}
    </div>
  );
}
