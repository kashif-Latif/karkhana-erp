"use client";
import { useEffect, useMemo, useState } from "react";
import { Package, Truck, CheckCircle2, Undo2, Search, RefreshCw } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Logi = {
  id: number; order_number: string; store_code: string; courier: string | null;
  tracking_id: string | null; dispatch_date: string | null; delivery_status: string | null;
  cod_amount: number | null; rts: string | null; status: string | null;
};

const STORES = [
  { code: "ALL", label: "All stores" },
  { code: "LM", label: "Little Minors" },
  { code: "TS", label: "TopShop" },
  { code: "TRZ", label: "Trenzee" },
];
const COURIERS = ["All couriers", "PostEx", "OwnEx"];

function deliveryClass(s: string | null) {
  switch (s) {
    case "Delivered": return "bg-success-soft text-success dark:bg-white/[0.08] dark:text-success";
    case "RTS":
    case "Returned":  return "bg-danger-soft text-danger dark:bg-white/[0.08] dark:text-danger";
    case "In Transit":return "bg-periwinkle-soft text-periwinkle-strong dark:bg-white/[0.08] dark:text-periwinkle";
    default:          return "bg-amber-soft text-amber-strong dark:bg-white/[0.08] dark:text-amber";
  }
}
const money = (n: number | null) => (n == null ? "—" : "Rs " + (Number(n) || 0).toLocaleString("en-PK"));
const isRts = (l: Logi) => l.delivery_status === "RTS" || l.delivery_status === "Returned" || (!!l.rts && l.rts !== "No");

export default function LogisticsPage() {
  const [rows, setRows] = useState<Logi[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [store, setStore] = useState("ALL");
  const [courier, setCourier] = useState("All couriers");
  const [q, setQ] = useState("");

  async function load() {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase
      .from("online_logistics")
      .select("id,order_number,store_code,courier,tracking_id,dispatch_date,delivery_status,cod_amount,rts,status")
      .order("dispatch_date", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) setErr(error.message);
    setRows((data as Logi[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((l) =>
      (store === "ALL" || l.store_code === store) &&
      (courier === "All couriers" || l.courier === courier) &&
      (!needle || l.order_number?.toLowerCase().includes(needle) || l.tracking_id?.toLowerCase().includes(needle))
    );
  }, [rows, store, courier, q]);

  const stats = useMemo(() => {
    const base = store === "ALL" ? rows : rows.filter((l) => l.store_code === store);
    return {
      total: base.length,
      transit: base.filter((l) => l.delivery_status === "In Transit").length,
      delivered: base.filter((l) => l.delivery_status === "Delivered").length,
      rts: base.filter(isRts).length,
    };
  }, [rows, store]);

  const cards = [
    { label: "Shipments", value: stats.total, Icon: Package, bg: "bg-periwinkle-soft" },
    { label: "In transit", value: stats.transit, Icon: Truck, bg: "bg-amber-soft" },
    { label: "Delivered", value: stats.delivered, Icon: CheckCircle2, bg: "bg-success-soft" },
    { label: "RTS / returns", value: stats.rts, Icon: Undo2, bg: "bg-salmon-soft" },
  ];

  return (
    <div className="px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Logistics</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">PostEx / OwnEx couriers, tracking, delivery status &amp; RTS.</p>
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order or tracking" className="w-44 bg-transparent text-[13px] outline-none placeholder:text-hint dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
          </div>
          <select value={courier} onChange={(e) => setCourier(e.target.value)}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {COURIERS.map((c) => <option key={c}>{c}</option>)}
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
                <th className="px-4 py-3 font-semibold">Courier</th>
                <th className="px-4 py-3 font-semibold">Tracking</th>
                <th className="px-4 py-3 font-semibold">Dispatched</th>
                <th className="px-4 py-3 text-right font-semibold">COD</th>
                <th className="px-4 py-3 font-semibold">Delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>
                ))
              ) : err ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load logistics: {err}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">{rows.length === 0 ? "No shipments yet — this fills once the courier sync is live." : "No shipments match these filters."}</td></tr>
              ) : (
                filtered.map((l) => (
                  <tr key={l.id} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold">{l.order_number}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{l.store_code}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{l.courier ?? "—"}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{l.tracking_id ?? "—"}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{l.dispatch_date ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(l.cod_amount)}</td>
                    <td className="px-4 py-3"><span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${deliveryClass(l.delivery_status)}`}>{l.delivery_status ?? "—"}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && !err && filtered.length > 0 && (
          <div className="border-t border-line px-4 py-3 text-[12px] text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
            Showing {filtered.length.toLocaleString()} shipment{filtered.length === 1 ? "" : "s"}{rows.length >= 1000 ? " · most recent 1,000 loaded" : ""}.
          </div>
        )}
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load live shipments.</p>
      )}
    </div>
  );
}
