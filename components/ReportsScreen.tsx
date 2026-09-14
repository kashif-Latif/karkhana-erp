"use client";
/* REPORTS — reading back what the system already recorded.
 *
 * Nothing is computed here that was not written at the time it happened.
 * A GRN report is the GRNs; a low-quantity report is stock measured against
 * a level somebody set. That is deliberate: a report that calculates its own
 * version of the truth is how two numbers start disagreeing.
 *
 * Five reports, one screen, because they share every filter — dates, search,
 * division, export.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { FileBarChart, Download, AlertTriangle, Ban } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Side = "factory" | "warehouse";
type Rep = "grn" | "grout" | "str" | "low" | "blocked";
type Row = Record<string, unknown>;

const REPORTS: { r: Rep; label: string }[] = [
  { r: "grn", label: "New GRN" }, { r: "grout", label: "GR out" },
  { r: "str", label: "STR" }, { r: "low", label: "Low quantity" },
  { r: "blocked", label: "Blocked items" },
];
const n = (v: unknown) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const rs = (v: unknown) => (v == null ? "—" : "Rs " + Math.round(Number(v)).toLocaleString());
const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : "—");

export default function ReportsScreen({ side, report }: { side: Side; report: Rep }) {
  /* Fixed by the route. Opening GR out shows GR out — no row of buttons
     offering four reports you did not ask for. */
  const rep = report;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [weeks, setWeeks] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [div, setDiv] = useState("all");
  /* Category, not just division. "Fabric" is not an answer when you hold
     Fleece, Jersey and Lycra — which was the whole complaint. */
  const [cat, setCat] = useState("all");



  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const pick = async (view: string, order: string) => {
      const { data, error } = await supabase!.from(view).select("*").order(order, { ascending: false });
      if (error) setErr(error.message);
      return (data as Row[]) ?? [];
    };
    let d: Row[] = [];
    if (rep === "grn") d = side === "factory"
      ? await pick("v_grn_in", "received_at")
      : (await pick("v_khana_movements", "created_at")).filter((x) => x.movement_type === "IN");
    else if (rep === "grout") d = side === "factory"
      ? await pick("v_grn_out", "moved_at")
      : (await pick("v_khana_movements", "created_at")).filter((x) => x.movement_type === "OUT");
    else if (rep === "str") d = (await pick("v_stock_transfers", "moved_at")).filter((x) => x.from_side === side);
    else if (rep === "low") d = await pick("v_low_stock", "headroom");
    else d = await pick("v_blocked_items", "updated_at");
    setRows(d); setLoading(false);
  }, [rep, side]);
  useEffect(() => { load(); }, [load]);

  const dateKey = rep === "grn" ? (side === "factory" ? "received_at" : "created_at")
    : rep === "grout" ? (side === "factory" ? "moved_at" : "created_at")
    : rep === "str" ? "moved_at" : "updated_at";

  const cats = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => String(r.categories ?? r.category ?? "").split(" · ")
      .filter(Boolean).forEach((c) => set.add(c)));
    return [...set].sort();
  }, [rows]);

  const view = useMemo(() => rows.filter((r) => {
    if (div !== "all" && String(r.kind ?? r.division ?? "") !== div) return false;
    if (cat !== "all" && !String(r.categories ?? r.category ?? "").split(" · ").includes(cat)) return false;
    const raw = r[dateKey];
    if (raw) {
      const day = String(raw).slice(0, 10);
      if (weeks !== null) {
        const edge = new Date(); edge.setHours(0, 0, 0, 0);
        edge.setDate(edge.getDate() - weeks * 7);
        if (new Date(day) < edge) return false;
      }
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, q, weeks, from, to, div, cat, dateKey]);

  /* Columns per report — named, so an export means the same thing as the
     screen rather than dumping whatever the view happened to return. */
  const COLS: Record<Rep, { k: string; h: string; align?: "r"; fmt?: (v: unknown) => string }[]> = {
    grn: side === "factory"
      ? [{ k: "grn_number", h: "GRN" }, { k: "kind", h: "Division" },
         { k: "categories", h: "Category" }, { k: "supplier", h: "Supplier" },
         { k: "quantity", h: "Quantity", align: "r", fmt: n }, { k: "total", h: "Value", align: "r", fmt: rs },
         { k: "received_at", h: "Received", fmt: when }]
      : [{ k: "movement_no", h: "Movement" }, { k: "barcode", h: "Barcode" }, { k: "name", h: "Product" },
         { k: "quantity", h: "Quantity", align: "r", fmt: n }, { k: "created_at", h: "Received", fmt: when }],
    grout: side === "factory"
      ? [{ k: "out_number", h: "GRO" }, { k: "kind", h: "Division" }, { k: "what", h: "What" },
         { k: "quantity", h: "Quantity", align: "r", fmt: n }, { k: "went_to", h: "Went to" },
         { k: "moved_at", h: "Date", fmt: when }]
      : [{ k: "movement_no", h: "Movement" }, { k: "barcode", h: "Barcode" }, { k: "name", h: "Product" },
         { k: "quantity", h: "Quantity", align: "r", fmt: n }, { k: "party", h: "Party" },
         { k: "created_at", h: "Date", fmt: when }],
    str: [{ k: "str_number", h: "STR" }, { k: "barcode", h: "Barcode" }, { k: "product", h: "Product" },
          { k: "quantity", h: "Quantity", align: "r", fmt: n }, { k: "destination", h: "Destination" },
          { k: "moved_at", h: "Date", fmt: when }],
    low: [{ k: "material", h: "Material" }, { k: "category", h: "Category" }, { k: "division", h: "Division" },
          { k: "in_stock", h: "In stock", align: "r", fmt: n }, { k: "min_quantity", h: "Minimum", align: "r", fmt: n },
          { k: "unit", h: "Unit" }],
    blocked: [{ k: "kind", h: "Type" }, { k: "code", h: "Code" }, { k: "name", h: "Name" },
              { k: "barcode", h: "Barcode" }, { k: "division", h: "Belongs to" },
              { k: "updated_at", h: "Blocked", fmt: when }],
  };
  const cols = COLS[rep];
  const current = REPORTS.find((x) => x.r === rep)!;

  const table = (): ExportTable => ({
    title: `${side}-${rep}-report`,
    headers: cols.map((c) => c.h),
    rows: view.map((r) => cols.map((c) => (c.fmt ? c.fmt(r[c.k]) : String(r[c.k] ?? "")))),
  });

  return (
    <>
      <Topbar title={`${side === "factory" ? "Karkhana" : "Warehouse"} — Reports`}
        subtitle="Read back what was recorded, filtered however you need it" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}


        <div className="flex flex-wrap items-center gap-1.5">
          {[{ l: "All time", w: null }, { l: "This week", w: 1 }, { l: "2 weeks", w: 2 },
            { l: "5 weeks", w: 5 }, { l: "3 months", w: 13 }].map((x) => (
            <button key={x.l} onClick={() => { setWeeks(x.w); setFrom(""); setTo(""); }}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${weeks === x.w && !from && !to ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {x.l}
            </button>
          ))}
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setWeeks(null); }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          <span className="text-[12px] text-hint">to</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setWeeks(null); }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          {side === "factory" && (rep === "grn" || rep === "grout" || rep === "low") && (
            <select value={div} onChange={(e) => setDiv(e.target.value)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none">
              <option value="all">All divisions</option>
              <option value="fabric">Fabric</option>
              <option value="other">Other materials</option>
              {rep !== "low" && <option value="finished">Market goods</option>}
            </select>
          )}
          {cats.length > 0 && (
            <select value={cat} onChange={(e) => setCat(e.target.value)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none">
              <option value="all">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search anything in this report…"
            className="w-full max-w-sm rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <span className="ml-auto text-[12.5px] text-muted">{view.length} rows</span>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink">
              {rep === "low" ? <AlertTriangle size={24} /> : rep === "blocked" ? <Ban size={24} /> : <FileBarChart size={24} />}
            </span>
            <p className="mt-3 text-[15px] font-semibold text-ink">Nothing in {current.label.toLowerCase()}</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
              {rep === "low"
                ? "Nothing is at or below its minimum. Set a minimum on an item and it will appear here when stock runs down to it."
                : rep === "blocked"
                ? "No items have been blocked. Blocking keeps something out of the dropdowns without removing it from history."
                : "No records match these filters."}
            </p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                {cols.map((c) => (
                  <th key={c.k} className={`px-4 py-3 font-bold ${c.align === "r" ? "text-right" : ""}`}>{c.h}</th>
                ))}
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={ix}
                    onClick={() => {
                      /* A GRN row opens its receipt. Selecting text does not. */
                      if (rep !== "grn" || side !== "factory") return;
                      if ((window.getSelection()?.toString() ?? "").length > 0) return;
                      window.location.href = "/grn?open=" + String(r.id ?? "");
                    }}
                    className={`border-b border-line/60 last:border-0 ${rep === "grn" && side === "factory" ? "cursor-pointer hover:bg-panel/40" : ""} ${ix % 2 ? "bg-panel/25" : ""}`}>
                    {cols.map((c) => (
                      <td key={c.k} className={`px-4 py-3 ${c.align === "r" ? "text-right tnum font-semibold text-ink" : "text-ink/85"}`}>
                        {c.fmt ? c.fmt(r[c.k]) : String(r[c.k] ?? "—")}
                      </td>
                    ))}
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
