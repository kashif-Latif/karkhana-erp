"use client";
/* STOCK — arranged by the same three divisions as the GRNs.
 *
 *   Fabric     cloth, received on a fabric GRN
 *   Other      sticker · shopper · zip · thread
 *   Finished   packed goods, received from our own floor
 *
 * The first two are material bought from a supplier and live in the stock
 * ledger. The third is not bought at all — it is made here, so it has no
 * supplier and lives in its own ledger. Showing them in one list would
 * imply they are the same kind of thing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Boxes, PackageCheck, Download } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Mat = { item_id: string; code: string; division: string; material: string;
             category: string | null; colour: string | null; size: string | null;
             unit: string; in_stock: number;
             /* K152 — the rate and supplier of the most recent arrival. */
             last_rate: number | null; last_supplier: string | null;
             last_received: string | null; last_grn: string | null;
             stock_value: number | null };
type Fin = { article_id: string; code: string; name: string; system_barcode: string | null;
             audience: string | null; retail_price: number | null; in_hand: number };
type Kind = "fabric" | "other" | "finished";

const DIV: { k: Kind; label: string; sub: string; Icon: typeof Boxes; tone: string }[] = [
  { k: "fabric",   label: "Fabric",          sub: "cloth, by category",               Icon: Layers,       tone: "bg-periwinkle-soft" },
  { k: "other",    label: "Other materials", sub: "sticker · shopper · zip · thread",  Icon: Boxes,        tone: "bg-amber-soft" },
  { k: "finished", label: "Finished goods",  sub: "packed here, not bought",           Icon: PackageCheck, tone: "bg-success-soft" },
];

const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

export default function StockPage() {
  const [kind, setKind] = useState<Kind>("fabric");
  const [mats, setMats] = useState<Mat[]>([]);
  const [fins, setFins] = useState<Fin[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [zero, setZero] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [m, f] = await Promise.all([
      supabase.from("v_stock_split").select("*").order("material"),
      supabase.from("v_ready_to_ship").select("*").order("name"),
    ]);
    if (m.error) setErr(m.error.message);
    setMats((m.data as unknown as Mat[]) ?? []);
    setFins((f.data as unknown as Fin[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    fabric: mats.filter((x) => x.division === "fabric" && Number(x.in_stock) !== 0).length,
    other: mats.filter((x) => x.division === "other" && Number(x.in_stock) !== 0).length,
    finished: fins.filter((x) => Number(x.in_hand) !== 0).length,
  }), [mats, fins]);

  const hit = (...v: (string | null)[]) =>
    !q.trim() || v.some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase()));

  const matView = useMemo(() => mats
    .filter((x) => x.division === kind && (zero || Number(x.in_stock) !== 0)
      && hit(x.material, x.category, x.colour, x.code))
    .sort((a, b) => Number(b.in_stock) - Number(a.in_stock)), [mats, kind, q, zero]);

  const finView = useMemo(() => fins
    .filter((x) => (zero || Number(x.in_hand) !== 0) && hit(x.name, x.code, x.system_barcode))
    .sort((a, b) => Number(b.in_hand) - Number(a.in_hand)), [fins, q, zero]);

  const current = DIV.find((d) => d.k === kind)!;
  const totalUnits = kind === "finished"
    ? finView.reduce((a, x) => a + Number(x.in_hand || 0), 0)
    : matView.reduce((a, x) => a + Number(x.in_stock || 0), 0);

  const table = (): ExportTable => kind === "finished"
    ? { title: "stock-finished",
        headers: ["Barcode", "Article", "For", "Retail", "In hand"],
        rows: finView.map((x) => [x.system_barcode ?? x.code, x.name, x.audience ?? "",
          x.retail_price ?? "", x.in_hand]) }
    : { title: `stock-${kind}`,
        headers: ["Code", "Material", "Category", "Colour", "Size", "Unit", "In stock",
                  "Rate", "Value", "Supplier", "Last GRN", "Last received"],
        rows: matView.map((x) => [x.code, x.material, x.category ?? "", x.colour ?? "",
          x.size ?? "", x.unit, x.in_stock, x.last_rate ?? "", x.stock_value ?? "",
          x.last_supplier ?? "", x.last_grn ?? "", x.last_received ? when(x.last_received) : ""]) };

  return (
    <>
      <Topbar title="Stock" subtitle="Held by division — the same three the GRNs use" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {DIV.map((d) => {
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

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => setZero((v) => !v)}
            className={`rounded-full px-3 py-2 text-[12px] font-semibold transition ${zero ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
            {zero ? "Showing empty" : "Hiding empty"}
          </button>
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <span className="ml-auto text-[12.5px] text-muted">
            {kind === "finished"
              ? `${n(totalUnits)} pieces`
              : `${n(totalUnits)} units · ${rs(matView.reduce((a, x) => a + Number(x.stock_value || 0), 0))}`}
          </span>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && kind !== "finished" && (
          matView.length === 0 ? (
            <div className="rounded-card border border-line bg-surface p-10 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><current.Icon size={24} /></span>
              <p className="mt-3 text-[15px] font-semibold text-ink">No {current.label.toLowerCase()} in stock</p>
              <p className="mt-1 text-[13px] text-muted">Received on a {current.label.toLowerCase()} GRN.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                  <th className="px-4 py-3 font-bold">Material</th>
                  <th className="px-4 py-3 font-bold">Category</th>
                  <th className="px-4 py-3 font-bold">Code</th>
                  <th className="px-4 py-3 text-right font-bold">In stock</th>
                  <th className="px-4 py-3 text-right font-bold">Rate</th>
                  <th className="px-4 py-3 text-right font-bold">Value</th>
                  <th className="px-4 py-3 font-bold">Supplier</th>
                  <th className="px-4 py-3 font-bold">Last received</th>
                </tr></thead>
                <tbody>
                  {matView.map((x, ix) => (
                    <tr key={x.item_id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                      <td className="px-4 py-3 font-semibold text-ink">{x.material}</td>
                      <td className="px-4 py-3 text-[12.5px] text-ink/75">
                        {[x.category, x.colour, x.size].filter(Boolean).join(" · ") || <span className="text-hint">none</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-muted">{x.code}</td>
                      <td className={`px-4 py-3 text-right tnum text-[15px] font-extrabold ${Number(x.in_stock) > 0 ? "text-ink" : "text-hint/60"}`}>
                        {n(x.in_stock)} <span className="text-[11px] font-medium text-muted">{x.unit}</span>
                      </td>
                      {/* Rate and supplier are from the LAST arrival — the price
                          you last paid and who you paid it to. Older stock may
                          have cost less, so the value is close, not exact. */}
                      <td className="px-4 py-3 text-right tnum text-muted">{x.last_rate == null ? "—" : rs(x.last_rate)}</td>
                      <td className="px-4 py-3 text-right tnum font-semibold text-ink">{x.stock_value == null ? "—" : rs(x.stock_value)}</td>
                      <td className="px-4 py-3 text-[12.5px] text-ink/80">
                        {x.last_supplier ?? "—"}
                        {x.last_grn && <span className="block font-mono text-[11px] text-hint">{x.last_grn}</span>}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted">{when(x.last_received)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )
        )}

        {!loading && kind === "finished" && (
          finView.length === 0 ? (
            <div className="rounded-card border border-line bg-surface p-10 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><PackageCheck size={24} /></span>
              <p className="mt-3 text-[15px] font-semibold text-ink">Nothing packed yet</p>
              {/* Said plainly, because the absence of a supplier here is the
                  point: these arrive from packing, not from anyone we buy from. */}
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
                Finished goods are not bought — they arrive from your own floor when a packing GRN is recorded.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                  <th className="px-4 py-3 font-bold">Barcode</th>
                  <th className="px-4 py-3 font-bold">Article</th>
                  <th className="px-4 py-3 text-right font-bold">Retail</th>
                  <th className="px-4 py-3 text-right font-bold">In hand</th>
                </tr></thead>
                <tbody>
                  {finView.map((x, ix) => (
                    <tr key={x.article_id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                      <td className="px-4 py-3 font-mono text-[12.5px] font-bold text-ink">{x.system_barcode ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-ink">{x.name}</span>
                        <span className="block text-[11px] text-hint">{x.code}{x.audience ? ` · ${x.audience}` : ""}</span>
                      </td>
                      <td className="px-4 py-3 text-right tnum text-muted">{x.retail_price == null ? "—" : rs(x.retail_price)}</td>
                      <td className={`px-4 py-3 text-right tnum text-[15px] font-extrabold ${Number(x.in_hand) > 0 ? "text-ink" : "text-hint/60"}`}>{n(x.in_hand)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )
        )}
      </div>
    </>
  );
}
