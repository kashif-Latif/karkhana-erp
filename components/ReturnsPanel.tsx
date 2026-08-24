"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, Loader2, AlertTriangle, CheckCircle2, FileWarning, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import { rs } from "@/lib/dateRange";

/* A courier saying "returned" is not the same as the parcel being on our shelf.
   Everything here stays PENDING until a person confirms they are holding it —
   nothing marks itself received, because only a human can see a box. Age is the
   number that matters: couriers stop honouring claims after a while, so an old
   pending row is money about to be lost. */

type Pending = {
  tracking_id: string; order_number: string | null; store_code: string | null;
  courier: string | null; cod_amount: number | null;
  delivery_date: string | null; dispatch_date: string | null;
  raw_status: string | null; rts_reason: string | null;
  still_travelling: boolean; claim_status: string; return_claim_ref: string | null;
  age_days: number | null;
};
type Sum = {
  pending: number; pending_value: number; travelling: number; awaiting_receipt: number;
  overdue: number; overdue_value: number; claimed: number; claimed_value: number;
  received_30d: number;
};

const n = (v: unknown) => Number(v ?? 0);

export default function ReturnsPanel({ store = "ALL", from = null, to = null }:
  { store?: string; from?: string | null; to?: string | null }) {
  const [rows, setRows] = useState<Pending[]>([]);
  const [sum, setSum] = useState<Sum | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [showReceive, setShowReceive] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "overdue" | "travelling" | "claimed">("all");
  const [courier, setCourier] = useState("All couriers");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setErr("");
    // the date range on the page has to actually do something — a filter that
    // silently does nothing is worse than no filter
    let q = supabase.from("v_returns_pending").select("*")
      .order("age_days", { ascending: false, nullsFirst: false }).limit(1000);
    if (from) q = q.gte("return_date", from);
    if (to)   q = q.lte("return_date", to);

    const [p, s] = await Promise.all([
      q,
      supabase.rpc("hub_returns_summary", {
        p_store: store === "ALL" ? null : store, p_courier: null,
        p_from: from, p_to: to,
      }),
    ]);
    if (p.error) setErr(p.error.message);
    setRows((p.data as Pending[]) ?? []);
    setSum(((s.data as Sum[]) ?? [])[0] ?? null);
    setPicked([]);
    setLoading(false);
  }, [store, from, to]);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => {
    let base = store === "ALL" ? rows : rows.filter((r) => r.store_code === store);
    if (courier !== "All couriers") base = base.filter((r) => r.courier === courier);
    if (filter === "overdue")    return base.filter((r) => !r.still_travelling && (r.age_days ?? 0) > 14);
    if (filter === "travelling") return base.filter((r) => r.still_travelling);
    if (filter === "claimed")    return base.filter((r) => r.claim_status === "claimed");
    return base;
  }, [rows, store, filter, courier]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function receive(form: { date: string; by: string; condition: string; notes: string }) {
    if (!supabase || !picked.length) return;
    setBusy(true);
    const { error } = await supabase.rpc("mark_return_received", {
      p_tracking_ids: picked, p_received_at: form.date || null,
      p_received_by: form.by || null, p_condition: form.condition, p_notes: form.notes || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setShowReceive(false); load();
  }

  async function claim(form: { ref: string; notes: string }) {
    if (!supabase || !picked.length) return;
    setBusy(true);
    const { error } = await supabase.rpc("raise_return_claim", {
      p_tracking_ids: picked, p_claim_ref: form.ref || null, p_notes: form.notes || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setShowClaim(false); load();
  }

  const cards = [
    { key: "all", label: "Pending returns", value: n(sum?.pending).toLocaleString(), sub: rs(n(sum?.pending_value)), bg: "bg-amber-soft" },
    { key: "travelling", label: "Still coming back", value: n(sum?.travelling).toLocaleString(), sub: "courier has it", bg: "bg-periwinkle-soft" },
    { key: "all", label: "Awaiting receipt", value: n(sum?.awaiting_receipt).toLocaleString(), sub: "courier says done", bg: "bg-panel" },
    { key: "overdue", label: "Overdue 14+ days", value: n(sum?.overdue).toLocaleString(), sub: rs(n(sum?.overdue_value)), bg: "bg-danger-soft", warn: true },
    { key: "claimed", label: "Claims raised", value: n(sum?.claimed).toLocaleString(), sub: rs(n(sum?.claimed_value)), bg: "bg-salmon-soft" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i) => (
          <button key={i} onClick={() => setFilter(c.key as typeof filter)}
            className={`rounded-card border p-4 text-left transition hover:brightness-95 ${c.bg} ${filter === c.key ? "border-ink dark:border-white/40" : "border-line dark:border-white/[0.06]"} dark:bg-[#201c17]`}>
            <div className={`text-[17px] font-extrabold tabular-nums ${c.warn ? "text-danger" : "text-ink dark:text-[#f4f1ea]"}`}>{loading ? "—" : c.value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{c.label}</div>
            <div className="mt-0.5 text-[10.5px] text-hint dark:text-[#8a8175]">{c.sub}</div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ink dark:text-[#f4f1ea]">
          {picked.length ? `${picked.length} selected` : `${view.length.toLocaleString()} pending`}
        </span>
        <button onClick={() => setShowReceive(true)} disabled={!picked.length} className={btnPrimary}>
          <PackageCheck size={15} /> Mark received
        </button>
        <button onClick={() => setShowClaim(true)} disabled={!picked.length} className={btnGhost}>
          <FileWarning size={15} /> Raise claim
        </button>
        <select value={courier} onChange={(e) => setCourier(e.target.value)}
          className="rounded-full border border-line bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink outline-none dark:border-white/10 dark:bg-white/[0.06] dark:text-white">
          <option>All couriers</option><option>PostEx</option><option>OwnEx</option>
        </select>
        <button onClick={load} className={btnGhost}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
        {filter !== "all" && <button onClick={() => setFilter("all")} className="text-[12px] underline text-muted dark:text-[#a89f93]">clear filter</button>}
        {(from || to) && (
          <span className="text-[11.5px] text-hint dark:text-[#8a8175]">
            showing returns dated {from ?? "any"} → {to ?? "today"} · switch to All time to see everything outstanding
          </span>
        )}
      </div>

      {err && <p className="mt-3 text-[13px] font-semibold text-danger">{err}</p>}

      <div className="mt-3 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[860px] text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-hint dark:text-[#8a8175]">
            <tr className="border-b border-line dark:border-white/[0.06]">
              <th className="px-3 py-2.5">
                <input type="checkbox" className="h-4 w-4 accent-current"
                  checked={!!view.length && picked.length === view.length}
                  onChange={() => setPicked(picked.length === view.length ? [] : view.map((r) => r.tracking_id))} />
              </th>
              <th className="px-3 py-2.5">Order</th>
              <th className="px-3 py-2.5">Store</th>
              <th className="px-3 py-2.5">Courier</th>
              <th className="px-3 py-2.5">Tracking</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5 text-right">COD</th>
              <th className="px-3 py-2.5 text-right">Age</th>
              <th className="px-3 py-2.5">Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-3 py-8 text-center text-muted dark:text-[#a89f93]"><Loader2 size={16} className="mx-auto animate-spin" /></td></tr>}
            {!loading && !view.length && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-muted dark:text-[#a89f93]">
                <CheckCircle2 size={18} className="mx-auto mb-2 text-success" />Nothing pending. Every declared return has been received.
              </td></tr>
            )}
            {!loading && view.map((r) => {
              const overdue = !r.still_travelling && (r.age_days ?? 0) > 14;
              return (
                <tr key={r.tracking_id} className="border-b border-line text-ink last:border-0 hover:bg-panel/50 dark:border-white/[0.06] dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                  <td className="px-3 py-2.5">
                    <input type="checkbox" className="h-4 w-4 accent-current"
                      checked={picked.includes(r.tracking_id)} onChange={() => toggle(r.tracking_id)} />
                  </td>
                  <td className="px-3 py-2.5 font-semibold">{r.order_number ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.store_code ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.courier ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted dark:text-[#a89f93]">{r.tracking_id}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      r.claim_status === "claimed" ? "bg-salmon-soft text-danger dark:bg-white/[0.08]"
                      : r.still_travelling ? "bg-periwinkle-soft text-periwinkle-strong dark:bg-white/[0.08]"
                      : "bg-amber-soft text-amber-strong dark:bg-white/[0.08]"}`}>
                      {r.claim_status === "claimed" ? "Claim raised" : r.still_travelling ? "Coming back" : "Awaiting receipt"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.cod_amount == null ? "—" : rs(n(r.cod_amount))}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${overdue ? "text-danger" : "text-muted dark:text-[#a89f93]"}`}>
                    {r.age_days == null ? "—" : `${r.age_days}d`}
                  </td>
                  <td className="px-3 py-2.5 text-muted dark:text-[#a89f93]">{r.rts_reason ?? r.raw_status ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ReceiveModal open={showReceive} count={picked.length} busy={busy}
        onClose={() => setShowReceive(false)} onSave={receive} />
      <ClaimModal open={showClaim} count={picked.length} busy={busy}
        onClose={() => setShowClaim(false)} onSave={claim} />
    </div>
  );
}

function ReceiveModal({ open, count, busy, onClose, onSave }: {
  open: boolean; count: number; busy: boolean; onClose: () => void;
  onSave: (f: { date: string; by: string; condition: string; notes: string }) => void;
}) {
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), by: "", condition: "good", notes: "" });
  return (
    <Modal open={open} onClose={onClose} title="Confirm return received"
      subtitle={`${count} parcel(s) will be marked as physically in your inventory.`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date received"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Received by"><input className={inputCls} value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} placeholder="name" /></Field>
        <Field label="Condition">
          <select className={inputCls} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>
            <option value="good">Good — back in stock</option>
            <option value="damaged">Damaged</option>
            <option value="partial">Partial / items missing</option>
          </select>
        </Field>
        <Field label="Notes"><input className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <p className="mt-3 text-[12px] text-hint dark:text-[#8a8175]">
        Only confirm what you are actually holding — this closes any open claim on these parcels.
      </p>
      <div className="mt-5 flex gap-2">
        <button onClick={() => onSave(f)} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Confirm received</button>
        <button onClick={onClose} className={btnGhost}>Cancel</button>
      </div>
    </Modal>
  );
}

function ClaimModal({ open, count, busy, onClose, onSave }: {
  open: boolean; count: number; busy: boolean; onClose: () => void;
  onSave: (f: { ref: string; notes: string }) => void;
}) {
  const [f, setF] = useState({ ref: "", notes: "" });
  return (
    <Modal open={open} onClose={onClose} title="Raise a claim"
      subtitle={`${count} parcel(s) the courier says were returned but never reached you.`}>
      <div className="space-y-3">
        <Field label="Courier complaint reference"><input className={inputCls} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="from PostEx / OwnEx" /></Field>
        <Field label="Notes"><input className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-muted dark:text-[#a89f93]">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-strong" />
        Couriers stop accepting claims after a period, so raise these while they are still recent.
      </p>
      <div className="mt-5 flex gap-2">
        <button onClick={() => onSave(f)} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Mark as claimed</button>
        <button onClick={onClose} className={btnGhost}>Cancel</button>
      </div>
    </Modal>
  );
}
