"use client";
import { useEffect, useMemo, useState } from "react";
import { ShoppingBag, Clock, Truck, XCircle, Search, RefreshCw } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Order = {
  id: number; order_number: string; store_code: string; order_date: string | null;
  customer_name: string; phone: string; city: string; amount: number; status: string;
};

const STORES = [
  { code: "ALL", label: "All stores" },
  { code: "LM", label: "Little Minors" },
  { code: "TS", label: "TopShop" },
  { code: "TRZ", label: "Trenzee" },
];
const STATUSES = ["All", "Pending", "Dispatched", "Delivered", "Cancelled", "Returned"];

function statusClass(s: string) {
  switch (s) {
    case "Dispatched": return "bg-periwinkle-soft text-periwinkle-strong dark:bg-white/[0.08] dark:text-periwinkle";
    case "Delivered":  return "bg-success-soft text-success dark:bg-white/[0.08] dark:text-success";
    case "Cancelled":  return "bg-danger-soft text-danger dark:bg-white/[0.08] dark:text-danger";
    case "Returned":   return "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]";
    default:           return "bg-amber-soft text-amber-strong dark:bg-white/[0.08] dark:text-amber";
  }
}
const money = (n: number) => "Rs " + (Number(n) || 0).toLocaleString("en-PK");

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [store, setStore] = useState("ALL");
  const [status, setStatus] = useState("All");
  const [q, setQ] = useState("");

  async function load() {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase
      .from("online_orders")
      .select("id,order_number,store_code,order_date,customer_name,phone,city,amount,status")
      .order("order_date", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) setErr(error.message);
    setOrders((data as Order[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.filter((o) =>
      (store === "ALL" || o.store_code === store) &&
      (status === "All" || o.status === status) &&
      (!needle || o.order_number?.toLowerCase().includes(needle) || o.customer_name?.toLowerCase().includes(needle) || o.phone?.includes(needle))
    );
  }, [orders, store, status, q]);

  const stats = useMemo(() => {
    const base = store === "ALL" ? orders : orders.filter((o) => o.store_code === store);
    const by = (s: string) => base.filter((o) => o.status === s).length;
    return { total: base.length, pending: by("Pending"), dispatched: by("Dispatched"), cancelled: by("Cancelled") };
  }, [orders, store]);

  const cards = [
    { label: "Orders loaded", value: stats.total, Icon: ShoppingBag, bg: "bg-periwinkle-soft" },
    { label: "Pending", value: stats.pending, Icon: Clock, bg: "bg-amber-soft" },
    { label: "Dispatched", value: stats.dispatched, Icon: Truck, bg: "bg-success-soft" },
    { label: "Cancelled", value: stats.cancelled, Icon: XCircle, bg: "bg-salmon-soft" },
  ];

  return (
    <div className="px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Orders</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Online orders across Little Minors, TopShop &amp; Trenzee.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, bg }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[24px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value.toLocaleString()}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {STORES.map((s) => (
            <button key={s.code} onClick={() => setStore(s.code)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${store === s.code ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
            <Search size={15} className="text-hint dark:text-[#8a8175]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, name, phone" className="w-44 bg-transparent text-[13px] outline-none placeholder:text-hint dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                <th className="px-4 py-3 font-semibold">Order #</th>
                <th className="px-4 py-3 font-semibold">Store</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">City</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>
                ))
              ) : err ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load orders: {err}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">{orders.length === 0 ? "No orders yet — run the data migration to bring your orders in." : "No orders match these filters."}</td></tr>
              ) : (
                filtered.map((o) => (
                  <tr key={o.id} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold">{o.order_number}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{o.store_code}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{o.order_date ?? "—"}</td>
                    <td className="px-4 py-3">{o.customer_name}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{o.phone}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{o.city}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(o.amount)}</td>
                    <td className="px-4 py-3"><span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${statusClass(o.status)}`}>{o.status}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && !err && filtered.length > 0 && (
          <div className="border-t border-line px-4 py-3 text-[12px] text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
            Showing {filtered.length.toLocaleString()} order{filtered.length === 1 ? "" : "s"}{orders.length >= 1000 ? " · most recent 1,000 loaded" : ""}.
          </div>
        )}
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live orders.</p>
      )}
    </div>
  );
}
