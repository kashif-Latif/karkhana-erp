"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Undo2, PackageCheck, Wallet, RefreshCw, Loader2, ArrowLeft, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { PRESETS, rangeDates, rs } from "@/lib/dateRange";
import { useLiveTables } from "@/lib/useLiveTables";

/* Returns live under Logistics, not Finance — a return is a parcel problem
   first and a money problem second, and the people chasing them are the
   logistics team.

   Three sections, because three different questions get asked:

     All returns        the historical record            newest first
     Pending returns    nobody here has confirmed the box  OLDEST first
     Pending delivered  delivered, money not in           newest first

   Pending returns is deliberately oldest-first: couriers stop honouring claims
   after a while, so the row most likely to cost money is the one at the top. */

type Section = "pending_returns" | "all_returns" | "delivered_unpaid";

const TABS: { key: Section; label: string; hint: string }[] = [
  { key: "pending_returns",  label: "Pending returns",   hint: "Courier says it is coming back or is back — nobody here has confirmed holding it. Oldest first: claims expire." },
  { key: "all_returns",      label: "All returns",       hint: "Every return on record, newest first." },
  { key: "delivered_unpaid", label: "Pending delivered", hint: "Delivered, money not yet received. This is the receivable." },
];

type ReturnRow = {
  tracking_id: string; order_number: string | null; store_code: string | null;
  courier: string | null; cod_amount: number | null; stage: string | null;
  courier_reason: string | null; shopify_reason: string | null; shopify_note: string | null;
  customer_name: string | null; city: string | null;
  return_date: string | null; return_received_at: string | null; received: boolean;
  return_claim_status: string | null; age_days: number | null;
};

type UnpaidRow = {
  tracking_id: string; order_number: string | null; store_code: string | null;
  courier: string | null; cod_amount: number | null; delivery_date: string | null;
  payment_status: string | null; cpr_number: string | null;
  customer_name: string | null; city: string | null; age_days: number | null;
};

type SectionCount = { section: string; n: number; value: number; oldest_days: number };

const PAGE = 500;

export default function ReturnsPage() {
  const [tab, setTab] = useState<Section>("pending_returns");
  const [rows, setRows] = useState<(ReturnRow | UnpaidRow)[]>([]);
  const [counts, setCounts] = useState<SectionCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [preset, setPreset] = useState("all");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [store, setStore] = useState("ALL");
  const [courier, setCourier] = useState("All couriers");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  /* Same request-token guard as Logistics: switching tab or range can leave two
     queries in the air, and without this the slower, older one wins and paints
     figures that belong to a range the user already moved off. */
  const reqId = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const my = ++reqId.current;
    if (!opts?.silent) setLoading(true);
    setErr("");
    const [from, to] = rangeDates(preset, cf, ct);

    const view = tab === "delivered_unpaid" ? "v_delivered_unpaid" : "v_returns_all";
    const dateCol = tab === "delivered_unpaid" ? "delivery_date" : "return_date";
    // pending returns oldest first — the top row is the one about to expire
    const ascending = tab === "pending_returns";

    let rq = supabase.from(view).select("*")
      .order(dateCol, { ascending, nullsFirst: false })
      .limit(PAGE);
    if (tab === "pending_returns") rq = rq.eq("received", false);
    if (from) rq = rq.gte(dateCol, from);
    if (to) rq = rq.lte(dateCol, to);
    if (store !== "ALL") rq = rq.eq("store_code", store);
    if (courier !== "All couriers") rq = rq.eq("courier", courier);

    const [r, c] = await Promise.all([
      rq,
      supabase.rpc("hub_returns_sections", {
        p_store: store === "ALL" ? null : store,
        p_courier: courier === "All couriers" ? null : courier,
        p_from: from, p_to: to,
      }),
    ]);

    if (my !== reqId.current) return;      // superseded — discard
    if (r.error) setErr(r.error.message);
    setRows((r.data as (ReturnRow | UnpaidRow)[]) ?? []);
    setCounts((c.data as SectionCount[]) ?? []);
    setLoading(false);
  }, [tab, preset, cf, ct, store, courier]);

  useEffect(() => { load(); }, [load]);
  useLiveTables(["online_logistics"], useCallback(() => load({ silent: true }), [load]));

  const find = (k: string) => counts.find((c) => c.section === k);
  const cards = [
    { key: "pending_returns" as Section, label: "Pending returns", Icon: Undo2, bg: "bg-amber-soft",
      n: find("pending_returns")?.n ?? 0, v: find("pending_returns")?.value ?? 0,
      sub: find("pending_returns")?.oldest_days ? `oldest ${find("pending_returns")?.oldest_days}d` : undefined },
    { key: "all_returns" as Section, label: "All returns", Icon: PackageCheck, bg: "bg-periwinkle-soft",
      n: find("all_returns")?.n ?? 0, v: find("all_returns")?.value ?? 0, sub: undefined },
    { key: "delivered_unpaid" as Section, label: "Pending delivered", Icon: Wallet, bg: "bg-success-soft",
      n: find("delivered_unpaid")?.n ?? 0, v: find("delivered_unpaid")?.value ?? 0,
      sub: find("delivered_unpaid")?.oldest_days ? `oldest ${find("delivered_unpaid")?.oldest_days}d` : undefined },
  ];

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) =>
      String(r.order_number ?? "").toLowerCase().includes(n) ||
      String(r.tracking_id ?? "").toLowerCase().includes(n) ||
      String(r.customer_name ?? "").toLowerCase().includes(n));
  }, [rows, q]);

  const isReturns = tab !== "delivered_unpaid";

  async function markReceived() {
    if (!supabase || !picked.length) return;
    setBusy(true);
    try {
      for (const t of picked) {
        await supabase.rpc("mark_return_received", { p_tracking_id: t, p_condition: null, p_notes: null });
      }
      setPicked([]);
      await load();
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <Link href="/online/logistics" className="mb-1 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted transition hover:text-ink dark:text-[#a89f93] dark:hover:text-white">
        <ArrowLeft size={14} /> Logistics
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Returns</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">{TABS.find((t) => t.key === tab)?.hint}</p>
        </div>
        <button onClick={() => load()} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* range */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${preset === p.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <>
            <input type="date" value={cf} onChange={(e) => setCf(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
            <input type="date" value={ct} onChange={(e) => setCt(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
          </>
        )}
        <select value={store} onChange={(e) => setStore(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
          {["ALL", "LM", "TS", "TRZ"].map((s) => <option key={s} value={s}>{s === "ALL" ? "All stores" : s}</option>)}
        </select>
        <select value={courier} onChange={(e) => setCourier(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
          {["All couriers", "PostEx", "OwnEx"].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order or tracking"
          className="min-w-[200px] flex-1 rounded-full border border-line bg-surface px-4 py-2 text-[13px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
      </div>

      {/* the three sections as cards — click to switch */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <button key={c.key} onClick={() => setTab(c.key)}
            className={`rounded-card p-4 text-left transition ${c.bg} ${tab === c.key ? "ring-2 ring-ink dark:ring-white/40" : "opacity-80 hover:opacity-100"} dark:bg-white/[0.05]`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><c.Icon size={15} /></span>
            <div className="mt-3 text-[22px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : c.n.toLocaleString()}</div>
            <div className="text-[12.5px] font-semibold text-ink dark:text-[#f4f1ea]">{c.label}</div>
            <div className="text-[11.5px] text-muted dark:text-[#a89f93]">{rs(c.v)}{c.sub ? ` · ${c.sub}` : ""}</div>
          </button>
        ))}
      </div>

      {err && <p className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-danger"><AlertTriangle size={15} /> {err}</p>}

      {isReturns && picked.length > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 dark:border-white/10 dark:bg-white/[0.05]">
          <span className="text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">{picked.length} selected</span>
          <button onClick={markReceived} disabled={busy}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-semibold text-white dark:bg-white dark:text-[#141414]">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <PackageCheck size={13} />} Mark received
          </button>
          <button onClick={() => setPicked([])} className="text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">Clear</button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-white/[0.03]">
        <table className="w-full min-w-[880px] text-left text-[13px]">
          <thead className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted dark:border-white/[0.06] dark:text-[#a89f93]">
            <tr>
              {isReturns && <th className="w-10 px-4 py-3" />}
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Store</th>
              <th className="px-4 py-3 font-semibold">Courier</th>
              <th className="px-4 py-3 font-semibold">Tracking</th>
              <th className="px-4 py-3 font-semibold">{isReturns ? "Return date" : "Delivered"}</th>
              <th className="px-4 py-3 text-right font-semibold">COD</th>
              <th className="px-4 py-3 text-right font-semibold">Age</th>
              {isReturns
                ? <><th className="px-4 py-3 font-semibold">Stage</th><th className="px-4 py-3 font-semibold">Reason</th></>
                : <><th className="px-4 py-3 font-semibold">Customer</th><th className="px-4 py-3 font-semibold">CPR</th></>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-white/[0.06]">
            {loading && <tr><td colSpan={11} className="px-4 py-8 text-center text-muted dark:text-[#a89f93]">Loading…</td></tr>}
            {!loading && !filtered.length && <tr><td colSpan={11} className="px-4 py-8 text-center text-muted dark:text-[#a89f93]">Nothing here.</td></tr>}
            {!loading && filtered.map((r) => {
              const ret = r as ReturnRow;
              const up = r as UnpaidRow;
              const reason = isReturns
                ? (ret.shopify_reason || ret.courier_reason || ret.shopify_note || "—")
                : "";
              return (
                <tr key={r.tracking_id} className="transition hover:bg-panel/60 dark:hover:bg-white/[0.04]">
                  {isReturns && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={picked.includes(r.tracking_id)}
                        onChange={(e) => setPicked((p) => e.target.checked ? [...p, r.tracking_id] : p.filter((x) => x !== r.tracking_id))} />
                    </td>
                  )}
                  <td className="px-4 py-3 font-semibold text-ink dark:text-[#f4f1ea]">{r.order_number ?? "—"}</td>
                  <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{r.store_code ?? "—"}</td>
                  <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{r.courier ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-muted dark:text-[#a89f93]">{r.tracking_id}</td>
                  <td className="px-4 py-3 tabular-nums text-muted dark:text-[#a89f93]">{(isReturns ? ret.return_date : up.delivery_date) ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink dark:text-[#f4f1ea]">{rs(Number(r.cod_amount ?? 0))}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${Number(r.age_days ?? 0) > 14 ? "text-danger" : "text-muted dark:text-[#a89f93]"}`}>
                    {r.age_days != null ? `${r.age_days}d` : "—"}
                  </td>
                  {isReturns
                    ? <>
                        <td className="px-4 py-3">
                          <span className="inline-block rounded-full bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted dark:bg-white/[0.08] dark:text-[#a89f93]">{ret.stage ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{reason}</td>
                      </>
                    : <>
                        <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{up.customer_name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{up.cpr_number ?? "—"}</td>
                      </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length >= PAGE && (
        <p className="mt-3 text-[11.5px] text-hint dark:text-[#8a8175]">
          Showing the first {PAGE.toLocaleString()} rows. The card totals above are counted in the database, so they are complete — narrow the range or the store to see the rest here.
        </p>
      )}
    </div>
  );
}
