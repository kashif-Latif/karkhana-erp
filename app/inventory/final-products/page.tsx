"use client";
/* INVENTORY — finished garments.
 *
 * Nothing is entered here. Every piece arrives because a supervisor recorded
 * it coming back from the floor, and leaves because it was issued out. That
 * is deliberate: an inventory you can type into is an inventory that stops
 * matching what was made.
 *
 * K119 built the ledger; this is the screen that was owed for it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, Download, ArrowUpFromLine, Loader2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Stock = { article_id: string; code: string; name: string;
               garment_type: string | null; audience: string | null;
               in_stock: number; ever_made: number; ever_issued: number;
               last_movement: string | null };
type Mv = { id: string; article_code: string; article: string; qty_change: number;
            movement_type: string; note: string | null; created_at: string };

const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const when = (v: string) => new Date(v).toLocaleString();
const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";

export default function InventoryPage() {
  const { can } = usePermissions();
  const canAdjust = can(["finished.adjust"]);

  const [tab, setTab] = useState<"stock" | "history">("stock");
  const [rows, setRows] = useState<Stock[]>([]);
  const [moves, setMoves] = useState<Mv[]>([]);
  const [q, setQ] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  /* issuing finished goods out */
  const [out, setOut] = useState<Stock | null>(null);
  const [qty, setQty] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [s, m] = await Promise.all([
      supabase.from("v_finished_stock").select("*").order("name"),
      supabase.from("v_finished_movements").select("*").order("created_at", { ascending: false }).limit(300),
    ]);
    if (s.error) setErr(s.error.message);
    setRows((s.data as Stock[]) ?? []);
    setMoves((m.data as unknown as Mv[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const inRange = (iso: string | null) => {
    if (days === null) return true;
    if (!iso) return false;
    const edge = new Date(); edge.setHours(0, 0, 0, 0);
    edge.setDate(edge.getDate() - (days - 1));
    return new Date(String(iso).slice(0, 10)) >= edge;
  };
  const hit = (...v: (string | null)[]) =>
    !q.trim() || v.some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase()));

  const fRows = useMemo(() => rows
    .filter((r) => hit(r.code, r.name, r.garment_type, r.audience) && inRange(r.last_movement))
    .sort((a, b) => Number(b.in_stock) - Number(a.in_stock) || a.name.localeCompare(b.name)),
    [rows, q, days]);
  const fMoves = useMemo(() => moves.filter((m) => hit(m.article_code, m.article) && inRange(m.created_at)),
    [moves, q, days]);

  const held = fRows.reduce((a, r) => a + Number(r.in_stock || 0), 0);
  const made = fRows.reduce((a, r) => a + Number(r.ever_made || 0), 0);
  const issued = fRows.reduce((a, r) => a + Number(r.ever_issued || 0), 0);

  async function issueOut() {
    if (!supabase || !out) return;
    setErr("");
    if (!(parseFloat(qty) > 0)) { setErr("Enter a quantity."); return; }
    if (!why.trim()) { setErr("Say where these are going — it is the only record of it."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("adjust_finished_stock", {
      p_article_id: out.article_id,
      p_qty_change: -Math.abs(parseFloat(qty)),
      p_reason: why.trim(),
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOut(null); setQty(""); setWhy(""); load();
  }

  const table = (): ExportTable => tab === "stock"
    ? { title: "finished-inventory",
        headers: ["Code", "Article", "Type", "For", "In stock", "Ever made", "Ever issued", "Last movement"],
        rows: fRows.map((r) => [r.code, r.name, r.garment_type ?? "", r.audience ?? "",
          r.in_stock, r.ever_made, r.ever_issued, r.last_movement ? when(r.last_movement) : ""]) }
    : { title: "finished-history",
        headers: ["Date", "Code", "Article", "Change", "Type", "Note"],
        rows: fMoves.map((m) => [when(m.created_at), m.article_code, m.article,
          m.qty_change, m.movement_type, m.note ?? ""]) };

  return (
    <>
      <Topbar title="Inventory" subtitle="Finished garments — what came back from the floor and what is left" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-card bg-periwinkle-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Articles</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">{fRows.filter((r) => Number(r.in_stock) > 0).length}</p>
          </div>
          <div className="rounded-card bg-success-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Pieces in hand</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">{n(held)}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Ever made</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">{n(made)}</p>
          </div>
          <div className="rounded-card bg-salmon-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Ever issued</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">{n(issued)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["stock", "history"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setQ(""); setDays(null); }}
              className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${tab === t ? "bg-ink text-white" : "border border-line text-ink/70 hover:bg-panel"}`}>
              {t === "stock" ? "In stock" : "History"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[{ l: "All time", d: null }, { l: "Today", d: 1 }, { l: "5 days", d: 5 },
            { l: "This week", d: 7 }, { l: "30 days", d: 30 }].map((r) => (
            <button key={r.l} onClick={() => setDays(r.d)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${days === r.d ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {r.l}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search article or code…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && tab === "stock" && (
          fRows.length === 0 ? (
            <div className="rounded-card border border-line bg-surface p-10 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><PackageCheck size={24} /></span>
              <p className="mt-3 text-[15px] font-semibold text-ink">Nothing finished yet</p>
              <p className="mt-1 text-[13px] text-muted">Pieces appear here the moment a supervisor records them coming back from the floor.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                  <th className="px-4 py-2.5 font-bold">Article</th>
                  <th className="px-4 py-2.5 text-right font-bold">In stock</th>
                  <th className="px-4 py-2.5 text-right font-bold">Made</th>
                  <th className="px-4 py-2.5 text-right font-bold">Issued</th>
                  <th className="px-4 py-2.5 font-bold">Last movement</th>
                  <th className="px-4 py-2.5"></th>
                </tr></thead>
                <tbody>
                  {fRows.map((r, ix) => (
                    <tr key={r.article_id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-ink">{r.name}</span>
                        <span className="block text-[11px] text-hint">{r.code}{r.audience ? ` · ${r.audience}` : ""}{r.garment_type ? ` · ${r.garment_type}` : ""}</span>
                      </td>
                      <td className={`px-4 py-2.5 text-right tnum text-[15px] font-extrabold ${Number(r.in_stock) > 0 ? "text-ink" : "text-hint/60"}`}>{n(r.in_stock)}</td>
                      <td className="px-4 py-2.5 text-right tnum text-muted">{n(r.ever_made)}</td>
                      <td className="px-4 py-2.5 text-right tnum text-muted">{n(r.ever_issued)}</td>
                      <td className="px-4 py-2.5 text-[12px] text-muted">{r.last_movement ? when(r.last_movement) : "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        {canAdjust && Number(r.in_stock) > 0 && (
                          <button onClick={() => { setOut(r); setQty(""); setWhy(""); }}
                            className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink/70 hover:bg-panel">
                            <ArrowUpFromLine size={12} /> Issue
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )
        )}

        {!loading && tab === "history" && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-2.5 font-bold">Date</th>
                <th className="px-4 py-2.5 font-bold">Article</th>
                <th className="px-4 py-2.5 text-right font-bold">Change</th>
                <th className="px-4 py-2.5 font-bold">Why</th>
              </tr></thead>
              <tbody>
                {fMoves.map((m) => (
                  <tr key={m.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2.5 text-[12px] text-muted">{when(m.created_at)}</td>
                    <td className="px-4 py-2.5"><span className="font-semibold text-ink">{m.article}</span>
                      <span className="block text-[11px] text-hint">{m.article_code}</span></td>
                    <td className={`px-4 py-2.5 text-right tnum font-bold ${Number(m.qty_change) > 0 ? "text-[#166534]" : "text-danger"}`}>
                      {Number(m.qty_change) > 0 ? "+" : ""}{n(m.qty_change)}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-hint">{m.movement_type}{m.note ? ` · ${m.note}` : ""}</td>
                  </tr>
                ))}
                {fMoves.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-[13px] text-muted">Nothing yet.</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={!!out} onClose={() => setOut(null)} title={`Issue ${out?.name ?? ""}`}>
        <p className="text-[12.5px] text-muted">{n(Number(out?.in_stock ?? 0))} in stock.</p>
        <div className="mt-3"><Field label="How many *">
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus className={inp} />
        </Field></div>
        <div className="mt-3"><Field label="Where are they going? *">
          <input value={why} onChange={(e) => setWhy(e.target.value)}
            placeholder="e.g. to Final Inventory, to TopShop DHA, sample" className={inp} />
        </Field></div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setOut(null)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={issueOut} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Issue
          </button>
        </div>
      </Modal>
    </>
  );
}
