"use client";
/* GR OUT — goods going BACK TO THE SUPPLIER.
 *
 * Not the same thing as STR. STR moves stock on: factory to warehouse,
 * warehouse to a shop. GR out is the narrow case where material was received
 * and is being returned — wrong goods, wrong quality, not wanted.
 *
 * It is a separate screen because the two are answerable to different people:
 * a shipment is a sale, a return is a conversation with the supplier.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Undo2, Download, Printer, Loader2, Plus } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, printTable, type ExportTable } from "@/lib/export";

type Row = { id: string; movement_no: string; created_at: string; quantity: number;
             note: string | null; barcode: string; name: string;
             manual_code: string | null; section: string | null;
             cost_price: number | null; retail_price: number | null;
             cost_total: number | null; retail_total: number | null;
             voided_at: string | null };
type Item = { item_id: string; barcode: string; name: string; quantity: number };

const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString();

export default function ReturnsPage() {
  const { can } = usePermissions();
  const canDo = can(["khana.manage"]);

  const [rows, setRows] = useState<Row[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState("");
  const [qty, setQty] = useState("");
  const [why, setWhy] = useState("");
  const [supplier, setSupplier] = useState("");
  const [onDate, setOnDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [fErr, setFErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [m, i] = await Promise.all([
      supabase.from("v_khana_movements").select("*")
        .eq("movement_type", "OUT").order("created_at", { ascending: false }),
      supabase.from("v_khana_stock").select("item_id,barcode,name,quantity"),
    ]);
    if (m.error) setErr(m.error.message);
    /* Returns are OUT movements whose note marks them as such — the same
       ledger as every other movement, so stock stays in one place. */
    setRows(((m.data as Row[]) ?? []).filter((r) => String(r.note ?? "").startsWith("RETURN")));
    setItems((i.data as unknown as Item[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const found = useMemo(() => {
    const t = scan.trim().toLowerCase();
    if (!t) return null;
    return items.find((x) => x.barcode.toLowerCase() === t)
      ?? (items.filter((x) => x.barcode.toLowerCase().includes(t)
            || x.name.toLowerCase().includes(t)).length === 1
          ? items.find((x) => x.barcode.toLowerCase().includes(t)
              || x.name.toLowerCase().includes(t))!
          : null);
  }, [scan, items]);

  const suggestions = useMemo(() => {
    const t = scan.trim().toLowerCase();
    if (!t || found) return [];
    return items.filter((x) => x.barcode.toLowerCase().includes(t)
      || x.name.toLowerCase().includes(t)).slice(0, 8);
  }, [scan, items, found]);

  const view = useMemo(() => rows.filter((r) => {
    const d = String(r.created_at).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [r.movement_no, r.name, r.barcode, r.manual_code, r.note]
      .some((x) => String(x ?? "").toLowerCase().includes(t));
  }), [rows, q, from, to]);

  const pieces = view.filter((r) => !r.voided_at).reduce((a, r) => a + Number(r.quantity || 0), 0);
  const value = view.filter((r) => !r.voided_at).reduce((a, r) => a + Number(r.cost_total || 0), 0);

  async function save() {
    if (!supabase || !found) return;
    setFErr("");
    if (!(parseFloat(qty) > 0)) { setFErr("How many pieces are going back?"); return; }
    if (parseFloat(qty) > Number(found.quantity)) {
      setFErr(`Only ${n(found.quantity)} in stock.`); return;
    }
    if (!why.trim()) { setFErr("Why is it going back? The supplier will ask."); return; }
    setBusy(true);
    const { error } = await supabase.from("khana_stock_movements").insert({
      item_id: found.item_id, movement_type: "OUT", quantity: parseFloat(qty),
      note: `RETURN${supplier.trim() ? " to " + supplier.trim() : ""} — ${why.trim()}`,
      created_at: onDate ? new Date(onDate + "T12:00:00").toISOString() : undefined,
    });
    setBusy(false);
    if (error) { setFErr(error.message); return; }
    setOpen(false); setScan(""); setQty(""); setWhy(""); setSupplier(""); setOnDate(""); load();
  }

  const table = (): ExportTable => ({
    title: "Warehouse GR out - supplier returns",
    headers: ["GRO", "Date", "Item code", "Barcode", "Item description", "Catgry",
              "Qty", "Cost", "Cost total", "Reason"],
    rows: view.map((r) => [r.movement_no, when(r.created_at), r.barcode,
      r.manual_code ?? "", r.name, r.section ?? "", r.quantity,
      r.cost_price ?? "", r.cost_total ?? "", r.note ?? ""]),
  });

  return (
    <>
      <Topbar title="Warehouse — GR out"
        subtitle="Goods going back to the supplier — not shipments to shops" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-salmon-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Returned</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(pieces)}</p>
            <p className="mt-1 text-[12px] text-ink/60">{view.length} return(s)</p>
          </div>
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Value returned</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{rs(value)}</p>
          </div>
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Sending stock on?</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink/70">
              Shipments to shops and branches go under <b>STR</b>. This screen is only for goods returned to a supplier.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          <span className="text-[12px] text-hint">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, code, reason…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <button onClick={() => printTable(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Printer size={13} /> Print</button>
          {canDo && (
            <button onClick={() => { setOpen(true); setScan(""); setQty(""); setWhy(""); setSupplier(""); setOnDate(""); setFErr(""); }}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
              <Plus size={15} /> New return
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Undo2 size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">Nothing returned</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
              A return is recorded when goods go back to whoever supplied them. Stock leaves and the reason stays on the record.
            </p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">GRO</th>
                <th className="px-4 py-3 font-bold">Item</th>
                <th className="px-4 py-3 text-right font-bold">Qty</th>
                <th className="px-4 py-3 text-right font-bold">Cost total</th>
                <th className="px-4 py-3 font-bold">Reason</th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} className={`border-b border-line/60 last:border-0 ${r.voided_at ? "opacity-45" : ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12.5px] font-bold text-ink">{r.movement_no}</span>
                      <span className="block text-[11px] text-hint">{when(r.created_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.name}</span>
                      <span className="block font-mono text-[11px] text-hint">
                        {r.barcode}{r.manual_code ? ` · ${r.manual_code}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tnum text-[15px] font-extrabold text-ink">{n(r.quantity)}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{r.cost_total ? rs(r.cost_total) : "—"}</td>
                    <td className="max-w-[280px] px-4 py-3 text-[12px] text-muted">{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Return goods to the supplier">
        <Field label="Item">
          <input value={scan} autoFocus onChange={(e) => setScan(e.target.value)}
            placeholder="scan, or type a code or name" className={inp} />
        </Field>
        {suggestions.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-xl2 border border-line">
            {suggestions.map((x) => (
              <button key={x.item_id} onClick={() => setScan(x.barcode)}
                className="flex w-full items-center justify-between gap-3 border-b border-line/60 px-3 py-2 text-left last:border-0 hover:bg-panel">
                <span>
                  <span className="text-[13px] font-semibold text-ink">{x.name}</span>
                  <span className="block font-mono text-[11px] text-hint">{x.barcode}</span>
                </span>
                <span className="text-[12px] tnum text-muted">{n(x.quantity)}</span>
              </button>
            ))}
          </div>
        )}
        {found && (
          <p className="mt-2 text-[12.5px] text-ink/80"><b>{found.name}</b> · holding {n(found.quantity)}</p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="How many *">
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className={inp} />
          </Field>
          <Field label="Date">
            <input type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} className={inp} />
          </Field>
        </div>
        <div className="mt-3"><Field label="Back to (supplier)">
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. F S Traders" className={inp} />
        </Field></div>
        <div className="mt-3"><Field label="Why is it going back? *">
          <input value={why} onChange={(e) => setWhy(e.target.value)}
            placeholder="wrong size, damaged, not ordered…" className={inp} />
        </Field></div>

        {fErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{fErr}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={save} disabled={busy || !found}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Record return
          </button>
        </div>
      </Modal>
    </>
  );
}
