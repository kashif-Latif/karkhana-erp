"use client";
/* GRAPH REPORT — the shape of what moved, rather than a list of it.
 *
 * Top ten products by pieces transferred. A donut because the question is
 * "what share of everything we moved was this one product" — a bar chart
 * answers "how many", which the number beside each row already tells you.
 *
 * Drawn as plain SVG: no charting library, nothing to load, and it prints.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PieChart, Download , Printer } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { exportCSV, exportExcel, exportPDF, type ExportTable, printTable } from "@/lib/export";

type Row = { str_number: string; product: string | null; barcode: string | null;
             quantity: number; moved_at: string; from_side: string; destination: string | null };
type Slice = { name: string; barcode: string; qty: number; pct: number; colour: string };

/* Distinguishable at a glance, and still readable printed in grey. */
const COLOURS = ["#2F6FED", "#E8833A", "#2E9E6B", "#C2417E", "#7B5BD6",
                 "#D4A017", "#3AA7B8", "#B5533C", "#6B8E23", "#8A6FB0"];
const n = (v: number) => Number(v || 0).toLocaleString();

export default function GraphReport({ side }: { side: "factory" | "warehouse" }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [weeks, setWeeks] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("v_stock_transfers").select("*");
    if (error) setErr(error.message);
    setRows(((data as Row[]) ?? []).filter((r) => r.from_side === side));
    setLoading(false);
  }, [side]);
  useEffect(() => { load(); }, [load]);

  const slices = useMemo<Slice[]>(() => {
    const inRange = rows.filter((r) => {
      if (weeks === null) return true;
      const edge = new Date(); edge.setHours(0, 0, 0, 0);
      edge.setDate(edge.getDate() - weeks * 7);
      return new Date(String(r.moved_at).slice(0, 10)) >= edge;
    });
    const by = new Map<string, { name: string; barcode: string; qty: number }>();
    for (const r of inRange) {
      const key = r.barcode ?? r.product ?? "—";
      const prev = by.get(key);
      by.set(key, { name: r.product ?? "—", barcode: r.barcode ?? "",
                    qty: (prev?.qty ?? 0) + Number(r.quantity || 0) });
    }
    const all = [...by.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
    const total = all.reduce((a, x) => a + x.qty, 0) || 1;
    return all.map((x, i) => ({ ...x, pct: (x.qty / total) * 100, colour: COLOURS[i % COLOURS.length] }));
  }, [rows, weeks]);

  const total = slices.reduce((a, s) => a + s.qty, 0);

  /* One ring, each slice an arc drawn with stroke-dasharray. */
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = (s.pct / 100) * C;
    const a = { ...s, dash: `${len} ${C - len}`, off: -offset };
    offset += len;
    return a;
  });

  const table = (): ExportTable => ({
    title: `top-transfers-${side}`,
    headers: ["Rank", "Barcode", "Product", "Pieces", "Share %"],
    rows: slices.map((s, i) => [i + 1, s.barcode, s.name, s.qty, s.pct.toFixed(1)]),
  });

  return (
    <>
      <Topbar
        title={side === "factory" ? "Top transfers — Factory to Warehouse" : "Top transfers — out of the Warehouse"}
        subtitle="The ten products that moved most, by share of everything moved" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <button onClick={() => printTable(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Printer size={13} /> Print</button>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && slices.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><PieChart size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">Nothing transferred yet</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
              {side === "factory"
                ? "Once an STR moves packed goods to the warehouse, this shows which products move most."
                : "Once an STR sends goods out, this shows which products leave most."}
            </p>
          </div>
        )}

        {!loading && slices.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
            <div className="rounded-card border border-line bg-surface p-6">
              <svg viewBox="0 0 200 200" className="mx-auto w-full max-w-[260px]" role="img"
                aria-label="Share of pieces transferred by product">
                <circle cx="100" cy="100" r={R} fill="none" stroke="currentColor"
                  className="text-line" strokeWidth="26" />
                {arcs.map((a) => (
                  <circle key={a.barcode + a.name} cx="100" cy="100" r={R} fill="none"
                    stroke={a.colour} strokeWidth="26"
                    strokeDasharray={a.dash} strokeDashoffset={a.off}
                    transform="rotate(-90 100 100)" />
                ))}
                <text x="100" y="94" textAnchor="middle" className="fill-current text-ink"
                  style={{ fontSize: 26, fontWeight: 800 }}>{n(total)}</text>
                <text x="100" y="114" textAnchor="middle" className="fill-current text-muted"
                  style={{ fontSize: 10 }}>pieces moved</text>
              </svg>
            </div>

            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                  <th className="px-4 py-3 font-bold">Product</th>
                  <th className="px-4 py-3 text-right font-bold">Pieces</th>
                  <th className="px-4 py-3 text-right font-bold">Share</th>
                </tr></thead>
                <tbody>
                  {slices.map((s) => (
                    <tr key={s.barcode + s.name} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.colour }} />
                          <span>
                            <span className="font-semibold text-ink">{s.name}</span>
                            <span className="block font-mono text-[11px] text-hint">{s.barcode}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tnum font-bold text-ink">{n(s.qty)}</td>
                      <td className="px-4 py-3 text-right tnum text-muted">{s.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
