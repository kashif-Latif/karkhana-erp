"use client";
/* GRN — one screen, three divisions that never mix.
 *
 *   Fabric     cloth only, with its own categories
 *   Other      sticker · shopper · zip · thread
 *   Finished   goods made and fully ready
 *
 * The division lives on the material (K150), so a fabric GRN cannot offer a
 * sticker and an other-materials GRN cannot offer cloth. That separation is
 * the whole point: two kinds of stock that look alike on a shelf but are
 * bought, priced and consumed completely differently.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Layers, PackageCheck, Download, Plus } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Grn = { id: string; grn_number: string; kind: string; received_at: string;
             total: number | null; note: string | null; status: string | null;
             supplier: string | null; lines: number; quantity: number };
type Kind = "fabric" | "other" | "finished";

const DIVISIONS: { k: Kind; label: string; sub: string; Icon: typeof Boxes; tone: string }[] = [
  { k: "fabric",   label: "Fabric",          sub: "cloth, by category",            Icon: Layers,       tone: "bg-periwinkle-soft" },
  { k: "other",    label: "Other materials", sub: "sticker · shopper · zip · thread", Icon: Boxes,     tone: "bg-amber-soft" },
  { k: "finished", label: "Finished goods",  sub: "made and fully ready",          Icon: PackageCheck, tone: "bg-success-soft" },
];

const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString();

export default function GrnPage() {
  const [kind, setKind] = useState<Kind>("fabric");
  const [rows, setRows] = useState<Grn[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("v_grn_in").select("*")
      .order("received_at", { ascending: false });
    if (error) setErr(error.message);
    setRows((data as Grn[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    fabric: rows.filter((r) => r.kind === "fabric").length,
    other: rows.filter((r) => r.kind === "other").length,
    finished: rows.filter((r) => r.kind === "finished").length,
  }), [rows]);

  const view = useMemo(() => rows.filter((r) => {
    if (r.kind !== kind) return false;
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
      return [r.grn_number, r.supplier, r.note].some((x) => String(x ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, kind, q, days, from, to]);

  const value = view.reduce((a, r) => a + Number(r.total || 0), 0);
  const qty = view.reduce((a, r) => a + Number(r.quantity || 0), 0);
  const current = DIVISIONS.find((d) => d.k === kind)!;

  const table = (): ExportTable => ({
    title: `grn-in-${kind}`,
    headers: ["GRN", "Date", "Supplier", "Lines", "Quantity", "Value", "Note"],
    rows: view.map((r) => [r.grn_number, when(r.received_at), r.supplier ?? "",
      r.lines, r.quantity, r.total ?? "", r.note ?? ""]),
  });

  return (
    <>
      <Topbar title="GRN" subtitle="Goods received — fabric, other materials and finished goods, kept apart" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        {/* The three divisions, always visible, so which one you are in is
            never a guess. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {DIVISIONS.map((d) => {
            const on = d.k === kind;
            return (
              <button key={d.k} onClick={() => { setKind(d.k); setQ(""); }}
                className={`rounded-card p-4 text-left transition ${on ? `${d.tone} ring-2 ring-ink/70` : "border border-line bg-surface hover:bg-panel"}`}>
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/55">
                  <d.Icon size={13} /> {d.label}
                </span>
                <p className="mt-1 text-[26px] font-extrabold leading-none tracking-tight text-ink">{counts[d.k]}</p>
                <p className="mt-1 text-[12px] text-ink/60">{d.sub}</p>
              </button>
            );
          })}
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GRN or supplier…"
            className="w-full max-w-sm rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <Link href={`/inventory/receive?kind=${kind}`}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
            <Plus size={15} /> New {current.label} GRN
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-muted">
          <span>{view.length} receipts</span>
          <span>{n(qty)} units</span>
          <span className="font-semibold text-ink">{rs(value)}</span>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><current.Icon size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">No {current.label.toLowerCase()} GRNs</p>
            <p className="mt-1 text-[13px] text-muted">{current.sub} — received here, and nowhere else.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">GRN</th>
                <th className="px-4 py-3 font-bold">Supplier</th>
                <th className="px-4 py-3 text-right font-bold">Lines</th>
                <th className="px-4 py-3 text-right font-bold">Quantity</th>
                <th className="px-4 py-3 text-right font-bold">Value</th>
                <th className="px-4 py-3 font-bold">Note</th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12.5px] font-bold text-ink">{r.grn_number}</span>
                      <span className="block text-[11px] text-hint">{when(r.received_at)}</span>
                    </td>
                    <td className="px-4 py-3 text-ink">{r.supplier ?? "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{r.lines}</td>
                    <td className="px-4 py-3 text-right tnum font-semibold text-ink">{n(r.quantity)}</td>
                    <td className="px-4 py-3 text-right tnum font-bold text-ink">{r.total == null ? "—" : rs(r.total)}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-[12px] text-hint">{r.note ?? ""}</td>
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
