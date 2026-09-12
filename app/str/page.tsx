"use client";
/* STR — stock transfer between departments.
 *
 * Moving stock used to mean taking it out of one system and typing it into
 * another: two entries, two chances to be wrong, and nothing tying them
 * together. An STR is one act — it leaves here and arrives there in the same
 * transaction, or neither happens.
 *
 * Factory → Warehouse matches on the article's own barcode, so the two sides
 * cannot drift apart and nobody retypes anything.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Download, Loader2, Plus, Trash2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Row = { id: string; str_number: string; from_side: string; to_side: string;
             destination: string | null; note: string | null; moved_at: string;
             voided_at: string | null; quantity: number; barcode: string | null;
             product: string | null; section: string | null };
type Ready = { article_id: string; code: string; name: string;
               system_barcode: string | null; in_hand: number };
type WItem = { id: string; barcode: string; name: string; in_stock: number };
type Line = { id: string; qty: string };
type Side = "factory" | "warehouse";

const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const when = (v: string) => new Date(v).toLocaleString();

export default function StrPage() {
  const { can } = usePermissions();
  const canFactory = can(["production.entry"]);
  const canWarehouse = can(["khana.manage"]);

  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState<Ready[]>([]);
  const [wItems, setWItems] = useState<WItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [side, setSide] = useState<"all" | Side>("all");

  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<Side>("factory");
  const [dest, setDest] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([{ id: "", qty: "" }]);
  const [busy, setBusy] = useState(false);
  const [fErr, setFErr] = useState("");
  const [made, setMade] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [t, r, w] = await Promise.all([
      supabase.from("v_stock_transfers").select("*").order("moved_at", { ascending: false }),
      supabase.from("v_ready_to_ship").select("article_id,code,name,system_barcode,in_hand"),
      supabase.from("khana_final_stock").select("item_id,quantity,khana_final_items(id,barcode,name)"),
    ]);
    if (t.error) setErr(t.error.message);
    setRows((t.data as Row[]) ?? []);
    setReady(((r.data as Ready[]) ?? []).filter((x) => Number(x.in_hand) > 0));
    setWItems(((w.data as unknown as { item_id: string; quantity: number;
        khana_final_items: { id: string; barcode: string; name: string } | null }[]) ?? [])
      .filter((x) => Number(x.quantity) > 0 && x.khana_final_items)
      .map((x) => ({ id: x.khana_final_items!.id, barcode: x.khana_final_items!.barcode,
                     name: x.khana_final_items!.name, in_stock: Number(x.quantity) })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    if (side !== "all" && r.from_side !== side) return false;
    const day = String(r.moved_at).slice(0, 10);
    if (days !== null) {
      const edge = new Date(); edge.setHours(0, 0, 0, 0);
      edge.setDate(edge.getDate() - (days - 1));
      if (new Date(day) < edge) return false;
    }
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return [r.str_number, r.product, r.barcode, r.destination, r.note]
        .some((x) => String(x ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, side, q, days, from, to]);

  const moved = view.filter((r) => !r.voided_at).reduce((a, r) => a + Number(r.quantity || 0), 0);
  const choices = dir === "factory"
    ? ready.map((x) => ({ id: x.article_id, label: `${x.system_barcode ?? x.code} — ${x.name} (${n(x.in_hand)} packed)`, max: Number(x.in_hand) }))
    : wItems.map((x) => ({ id: x.id, label: `${x.barcode} — ${x.name} (${n(x.in_stock)} in stock)`, max: Number(x.in_stock) }));

  function openForm(d: Side) {
    setOpen(true); setDir(d); setDest(""); setNote("");
    setLines([{ id: "", qty: "" }]); setFErr(""); setMade(null);
  }

  async function send() {
    if (!supabase) return;
    setFErr("");
    const good = lines.filter((l) => l.id && parseFloat(l.qty) > 0);
    if (good.length === 0) { setFErr("Add at least one line with a quantity."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("post_stock_transfer", {
      p_from: dir, p_to: dir === "factory" ? "warehouse" : "party",
      p_destination: dest.trim() || null, p_note: note.trim() || null,
      p_lines: good.map((l) => dir === "factory"
        ? { article_id: l.id, quantity: parseFloat(l.qty) }
        : { khana_item_id: l.id, quantity: parseFloat(l.qty) }),
    });
    setBusy(false);
    if (error) { setFErr(error.message); return; }
    setMade(data as Record<string, unknown>); load();
  }

  const table = (): ExportTable => ({
    title: "stock-transfers",
    headers: ["STR", "Date", "From", "To", "Barcode", "Product", "Quantity", "Destination", "Note"],
    rows: view.map((r) => [r.str_number, when(r.moved_at), r.from_side, r.to_side,
      r.barcode ?? "", r.product ?? "", r.quantity, r.destination ?? "", r.note ?? ""]),
  });

  return (
    <>
      <Topbar title="STR — Stock Transfer" subtitle="Stock moving between departments, in one act" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Transfers</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{view.length}</p>
          </div>
          <div className="rounded-card bg-success-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Pieces moved</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(moved)}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Ready in factory</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">
              {n(ready.reduce((a, x) => a + Number(x.in_hand || 0), 0))}
            </p>
            <p className="mt-1 text-[12px] text-ink/60">packed, not yet transferred</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[{ l: "Both", v: "all" }, { l: "From factory", v: "factory" }, { l: "From warehouse", v: "warehouse" }].map((x) => (
            <button key={x.v} onClick={() => setSide(x.v as "all" | Side)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${side === x.v ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {x.l}
            </button>
          ))}
          <span className="mx-1 text-line">|</span>
          {[{ l: "All time", d: null }, { l: "Today", d: 1 }, { l: "5 days", d: 5 }, { l: "30 days", d: 30 }].map((r) => (
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search STR, barcode, product, destination…"
            className="w-full max-w-sm rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <div className="ml-auto flex gap-2">
            {canFactory && (
              <button onClick={() => openForm("factory")}
                className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
                <Plus size={15} /> Factory → Warehouse
              </button>
            )}
            {canWarehouse && (
              <button onClick={() => openForm("warehouse")}
                className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-ink/75 hover:bg-panel">
                <Plus size={15} /> Warehouse out
              </button>
            )}
          </div>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><ArrowLeftRight size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">No transfers yet</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
              A transfer moves stock out of one department and into the other in a single step — nothing is typed twice.
            </p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">STR</th>
                <th className="px-4 py-3 font-bold">Product</th>
                <th className="px-4 py-3 text-right font-bold">Quantity</th>
                <th className="px-4 py-3 font-bold">Moved</th>
                <th className="px-4 py-3 font-bold">Destination</th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id + (r.barcode ?? "")} className={`border-b border-line/60 last:border-0 ${r.voided_at ? "opacity-45" : ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12.5px] font-bold text-ink">{r.str_number}</span>
                      <span className="block text-[11px] text-hint">{when(r.moved_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.product}</span>
                      <span className="block font-mono text-[11px] text-hint">{r.barcode ?? ""}</span>
                    </td>
                    <td className="px-4 py-3 text-right tnum text-[15px] font-extrabold text-ink">{n(r.quantity)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-ink/80">
                      {r.from_side === "factory" ? "Factory → Warehouse" : "Warehouse → out"}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-muted">{r.destination ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} wide
        title={dir === "factory" ? "Transfer — Factory to Warehouse" : "Transfer — out of the Warehouse"}>
        {made ? (
          <div className="text-center">
            <p className="font-mono text-[26px] font-extrabold tracking-tight text-ink">{String(made.str)}</p>
            <p className="mt-1.5 text-[13px] text-ink/75">{String(made.lines)} line(s) moved</p>
            {Number(made.products_created) > 0 && (
              <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-relaxed text-muted">
                {String(made.products_created)} product(s) were created in the warehouse against their barcode — the first time this article has been sent.
              </p>
            )}
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => openForm(dir)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Another</button>
              <button onClick={() => setOpen(false)} className="rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white">Done</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12.5px] text-muted">
              {dir === "factory"
                ? "Packed articles leave the factory and arrive in warehouse stock against their own barcode."
                : "Goods leave the warehouse for a branch, a mall or an online order."}
            </p>

            {lines.map((l, i) => {
              const c = choices.find((x) => x.id === l.id);
              const over = c && parseFloat(l.qty) > c.max;
              return (
                <div key={i} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_auto]">
                  <select value={l.id} className={inp}
                    onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, id: e.target.value } : y))}>
                    <option value="">Choose…</option>
                    {choices.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                  <input type="number" value={l.qty} placeholder="Quantity" className={`${inp} ${over ? "border-danger" : ""}`}
                    onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, qty: e.target.value } : y))} />
                  <button onClick={() => setLines((x) => x.filter((_, j) => j !== i))}
                    disabled={lines.length === 1}
                    className="mt-1 rounded-xl2 p-2 text-muted transition hover:bg-panel hover:text-danger disabled:opacity-30">
                    <Trash2 size={15} />
                  </button>
                  {over && <p className="text-[12px] text-danger sm:col-span-3">Only {n(c!.max)} available.</p>}
                </div>
              );
            })}
            {choices.length === 0 && (
              <p className="mt-2 text-[12.5px] text-muted">
                {dir === "factory" ? "Nothing is packed and waiting in the factory." : "The warehouse holds no stock."}
              </p>
            )}

            <button onClick={() => setLines((x) => [...x, { id: "", qty: "" }])}
              className="mt-2 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink/70">+ Another line</button>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label={dir === "factory" ? "Note for the warehouse" : "Going to"}>
                <input value={dir === "factory" ? note : dest}
                  onChange={(e) => dir === "factory" ? setNote(e.target.value) : setDest(e.target.value)}
                  placeholder={dir === "factory" ? "optional" : "e.g. Packages Mall"} className={inp} />
              </Field>
              <Field label="Note">
                <input value={dir === "factory" ? dest : note}
                  onChange={(e) => dir === "factory" ? setDest(e.target.value) : setNote(e.target.value)}
                  placeholder="optional" className={inp} />
              </Field>
            </div>

            {fErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{fErr}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
              <button onClick={send} disabled={busy}
                className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {busy && <Loader2 size={15} className="animate-spin" />} Transfer
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
