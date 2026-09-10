"use client";
/* GRN — STITCHING UNIT. Every arrival of ready goods from the floor.
 *
 * Its own series (GRS-…) because a number should say what it is. GRN-000145
 * being either a bale of cloth or a box of shirts means every conversation
 * starts by working out which.
 *
 * Nothing is entered here. A row exists because a supervisor recorded pieces
 * coming back; this is the ledger of that, not a second place to type it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Factory, Download } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Row = { id: string; grn_no: string; received_at: string; quantity: number;
             rejected: number; unit_rate: number | null; wage: number;
             paid_at: string | null; note: string | null; order_number: string | null;
             article_code: string | null; article: string | null;
             system_barcode: string | null; floor: string | null; worker: string | null };

const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString();

export default function GrnStitchingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("v_grn_stitching").select("*")
      .order("received_at", { ascending: false });
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    const day = String(r.received_at).slice(0, 10);
    if (days !== null) {
      const edge = new Date(); edge.setHours(0, 0, 0, 0);
      edge.setDate(edge.getDate() - (days - 1));
      if (new Date(day) < edge) return false;
    }
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return [r.grn_no, r.article, r.article_code, r.system_barcode, r.order_number, r.worker]
        .some((x) => String(x ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, q, days, from, to]);

  const pieces = view.reduce((a, r) => a + Number(r.quantity || 0), 0);
  const rejected = view.reduce((a, r) => a + Number(r.rejected || 0), 0);
  const wages = view.reduce((a, r) => a + Number(r.wage || 0), 0);

  const table = (): ExportTable => ({
    title: "grn-stitching-unit",
    headers: ["GRN", "Date", "Order", "Barcode", "Article", "Pieces", "Rejected", "Rate", "Wage", "Worker", "Paid"],
    rows: view.map((r) => [r.grn_no, when(r.received_at), r.order_number ?? "",
      r.system_barcode ?? "", r.article ?? "", r.quantity, r.rejected,
      r.unit_rate ?? "", r.wage, r.worker ?? "", r.paid_at ? "yes" : "no"]),
  });

  return (
    <>
      <Topbar title="GRN — Stitching Unit" subtitle="Ready goods received from the floor" />
      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Pieces received</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(pieces)}</p>
            <p className="mt-1 text-[12px] text-ink/60">{view.length} receipts</p>
          </div>
          <div className="rounded-card bg-salmon-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Rejected</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(rejected)}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Wages on these</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{rs(wages)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[{ l: "All time", d: null }, { l: "Today", d: 1 }, { l: "5 days", d: 5 },
            { l: "This week", d: 7 }, { l: "30 days", d: 30 }].map((r) => (
            <button key={r.l} onClick={() => { setDays(r.d); setFrom(""); setTo(""); }}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${days === r.d && !from && !to ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {r.l}
            </button>
          ))}
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setDays(null); }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          <span className="text-[12px] text-hint">to</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setDays(null); }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GRN, barcode, article, order…"
            className="w-full max-w-sm rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Factory size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">Nothing received yet</p>
            <p className="mt-1 text-[13px] text-muted">A GRN appears here each time pieces come back from the stitching unit.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">GRN</th>
                <th className="px-4 py-3 font-bold">Article</th>
                <th className="px-4 py-3 font-bold">Order</th>
                <th className="px-4 py-3 text-right font-bold">Pieces</th>
                <th className="px-4 py-3 text-right font-bold">Rejected</th>
                <th className="px-4 py-3 text-right font-bold">Wage</th>
                <th className="px-4 py-3 font-bold">Worker</th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12.5px] font-bold text-ink">{r.grn_no}</span>
                      <span className="block text-[11px] text-hint">{when(r.received_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.article}</span>
                      <span className="block font-mono text-[11px] text-hint">{r.system_barcode ?? r.article_code}</span>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-muted">{r.order_number ?? "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-[15px] font-extrabold text-ink">{n(r.quantity)}</td>
                    <td className={`px-4 py-3 text-right tnum ${Number(r.rejected) > 0 ? "font-semibold text-danger" : "text-hint/60"}`}>{n(r.rejected)}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">
                      {rs(r.wage)}
                      {r.paid_at
                        ? <span className="block text-[10.5px] font-semibold text-[#166534]">paid</span>
                        : Number(r.wage) > 0 && <span className="block text-[10.5px] font-semibold text-danger">unpaid</span>}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-ink/80">{r.worker ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>
    </>
  );
}
