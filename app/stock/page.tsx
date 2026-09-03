"use client";
/* STOCK — what you have bought and sorted, sitting on the shelf.
 *
 * Not the same screen as Inventory. Stock is what you buy; Inventory is what
 * you make. Two words, two screens, so nobody has to ask which one they are
 * looking at.
 *
 * Every total on this page is computed in Postgres. PostgREST caps a response
 * at 1,000 rows however you ask, and four screens in this system have already
 * shipped a wrong number by adding up a capped response in the browser. So the
 * page renders totals; it never calculates them.
 */
import { useCallback, useEffect, useState } from "react";
import { Warehouse, AlertTriangle, PackageOpen, Search } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Summary = {
  group_id: string; group_code: string; material: string;
  has_category: boolean; has_color: boolean; has_size: boolean;
  items: number; items_with_stock: number;
  in_stock: number; units: string | null; lots_awaiting_sorting: number;
};
type Row = {
  group_id: string; group_code: string; material: string;
  category_id: string | null; category: string | null;
  size_id: string | null; size: string | null;
  unit: string; items: number; items_with_stock: number;
  in_stock: number; value_at_last_rate: number; last_received: string | null;
};

const rs = (n: number) => "Rs " + Math.round(Number(n) || 0).toLocaleString();
const qty = (n: number) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const when = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function StockPage() {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [s, r] = await Promise.all([
      supabase.from("v_stock_summary").select("*").order("material"),
      supabase.from("v_stock_by_material").select("*").order("material").order("category", { nullsFirst: true }),
    ]);
    if (s.error || r.error) setErr((s.error || r.error)!.message);
    setSummary((s.data as Summary[]) ?? []);
    setRows((r.data as Row[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (only && r.group_id !== only) return false;
    if (!needle) return true;
    return [r.material, r.category, r.size, r.unit].filter(Boolean).join(" ").toLowerCase().includes(needle);
  });

  const byGroup = visible.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[r.group_id] ||= []).push(r);
    return acc;
  }, {});

  const awaiting = summary.reduce((a, s) => a + (s.lots_awaiting_sorting || 0), 0);
  const emptyGroups = summary.filter((s) => s.items === 0);

  return (
    <>
      <Topbar title="Stock" subtitle="Raw material on the shelf" action={{ label: "Receive", href: "/inventory/receive" }} />

      <div className="space-y-5 px-6 pb-12">
        {err && (
          <div className="rounded-xl2 border border-salmon-strong/30 bg-salmon-soft px-4 py-3 text-[13px] text-ink">
            {err}
          </div>
        )}

        {/* A material group with no items cannot be ordered against, whatever
            the recipe says. Saying so here beats an order failing later with
            a message nobody expected. */}
        {!loading && emptyGroups.length > 0 && (
          <div className="flex gap-2.5 rounded-xl2 border border-amber-strong/30 bg-amber-soft px-4 py-3">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-strong" />
            <div className="text-[13px] leading-relaxed text-ink/85">
              <b>{emptyGroups.map((g) => g.material).join(", ")}</b>{" "}
              {emptyGroups.length === 1 ? "has" : "have"} no items in the catalogue yet, so
              nothing can be received against {emptyGroups.length === 1 ? "it" : "them"} and any
              order needing {emptyGroups.length === 1 ? "it" : "them"} will be refused. Add{" "}
              {emptyGroups.length === 1 ? "it" : "them"} under <b>Raw Materials</b>.
            </div>
          </div>
        )}

        {awaiting > 0 && (
          <div className="flex gap-2.5 rounded-xl2 border border-line bg-panel px-4 py-3">
            <PackageOpen size={17} className="mt-0.5 shrink-0 text-muted" />
            <div className="text-[13px] text-ink/85">
              {awaiting} {awaiting === 1 ? "batch is" : "batches are"} still waiting to be opened and
              sorted. Until then the colours inside {awaiting === 1 ? "it are" : "them are"} not stock yet.
            </div>
          </div>
        )}

        {/* Group cards. Units are listed, never summed — 2,000 kg and 40 m
            is not 2,040 of anything. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {summary.map((s) => {
            const on = only === s.group_id;
            return (
              <button
                key={s.group_id}
                onClick={() => setOnly(on ? null : s.group_id)}
                className={`rounded-card border p-4 text-left transition ${
                  on ? "border-ink bg-panel" : "border-line bg-surface hover:border-ink/25"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink">{s.material}</span>
                  <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-semibold text-muted">
                    {s.group_code}
                  </span>
                </div>
                <p className="mt-2 text-[22px] font-extrabold leading-none tracking-tight text-ink">
                  {qty(s.in_stock)}{" "}
                  <span className="text-[13px] font-semibold text-muted">{s.units || ""}</span>
                </p>
                <p className="mt-1.5 text-[12px] text-hint">
                  {s.items === 0
                    ? "no items yet"
                    : `${s.items_with_stock} of ${s.items} ${s.items === 1 ? "item" : "items"} in stock`}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2">
          <Search size={15} className="text-hint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a material, category or size…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-hint"
          />
          {only && (
            <button onClick={() => setOnly(null)} className="text-[12px] font-semibold text-muted hover:text-ink">
              show all
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && visible.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink">
              <Warehouse size={24} />
            </span>
            <h2 className="mt-4 text-[17px] font-extrabold text-ink">Nothing here yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
              {rows.length === 0
                ? "Receive a delivery and it will appear here, grouped by material, category and size."
                : "No material matches what you typed."}
            </p>
          </div>
        )}

        {!loading &&
          Object.entries(byGroup).map(([gid, list]) => {
            const head = list[0];
            return (
              <div key={gid} className="overflow-hidden rounded-card border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <h3 className="text-[15px] font-bold text-ink">{head.material}</h3>
                  <span className="text-[12px] text-hint">
                    {list.length} {list.length === 1 ? "line" : "lines"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-hint">
                        <th className="px-5 py-2.5 font-bold">Category</th>
                        <th className="px-5 py-2.5 font-bold">Size</th>
                        <th className="px-5 py-2.5 text-right font-bold">In stock</th>
                        <th className="px-5 py-2.5 font-bold">Unit</th>
                        <th className="px-5 py-2.5 text-right font-bold">At last rate</th>
                        <th className="px-5 py-2.5 font-bold">Last received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r, i) => (
                        <tr key={`${r.category_id}-${r.size_id}-${r.unit}-${i}`} className="border-b border-line/60 last:border-0">
                          <td className="px-5 py-3 font-medium text-ink">{r.category || <span className="text-hint">any</span>}</td>
                          <td className="px-5 py-3 text-muted">{r.size || "—"}</td>
                          <td className={`px-5 py-3 text-right font-bold ${r.in_stock > 0 ? "text-ink" : "text-hint"}`}>
                            {qty(r.in_stock)}
                          </td>
                          <td className="px-5 py-3 text-muted">{r.unit}</td>
                          <td className="px-5 py-3 text-right text-muted">{rs(r.value_at_last_rate)}</td>
                          <td className="px-5 py-3 text-muted">{when(r.last_received)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

        {!loading && rows.length > 0 && (
          <p className="text-[12px] leading-relaxed text-hint">
            &ldquo;At last rate&rdquo; values what is on the shelf at the price you last paid for it.
            It is a guide, not a valuation — each batch carries its own real cost, and that is what
            an order uses when it deducts material.
          </p>
        )}
      </div>
    </>
  );
}
