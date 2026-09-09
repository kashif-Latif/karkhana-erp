"use client";
/* PURCHASE RETURN — material going back to the supplier.
 *
 * Faulty, wrong, damaged, or simply not wanted. It is stock LEAVING, so it
 * writes to the same ledger as everything else (K147) — never a note in a
 * spreadsheet that the shelf disagrees with.
 *
 * The database refuses to send back more than is actually held, and voiding
 * a return puts the material straight back. Both matter: a supplier argument
 * is won with a number that has always matched the shelf.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Undo2, Plus, Loader2, Download, Trash2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Supplier = { id: string; company_name: string; code: string | null };
type Item = { item_id: string; item_code: string; short_code: string | null;
              material: string; unit: string; usable: number };
type Row = { id: string; return_no: string; returned_at: string; reason: string | null;
             note: string | null; voided_at: string | null; void_reason: string | null;
             supplier: string; supplier_code: string | null;
             short_code: string | null; item_code: string; material: string;
             quantity: number; unit: string; rate: number | null; line_value: number };
type Line = { item_id: string; quantity: string; rate: string };

const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString();

export default function PurchaseReturnPage() {
  const { can } = usePermissions();
  const canDo = can(["grn.create"]);

  const [rows, setRows] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [fSupplier, setFSupplier] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [showVoided, setShowVoided] = useState(false);

  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([{ item_id: "", quantity: "", rate: "" }]);
  const [busy, setBusy] = useState(false);
  const [voidRow, setVoidRow] = useState<string | null>(null);
  const [voidWhy, setVoidWhy] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [r, s, i] = await Promise.all([
      supabase.from("v_purchase_returns").select("*").order("returned_at", { ascending: false }),
      supabase.from("suppliers").select("id,company_name,code").eq("is_active", true).order("company_name"),
      supabase.from("v_usable_stock").select("item_id,item_code,material,unit,usable").gt("usable", 0).order("material"),
    ]);
    if (r.error) setErr(r.error.message);
    setRows((r.data as Row[]) ?? []);
    setSuppliers((s.data as Supplier[]) ?? []);
    setItems((i.data as unknown as Item[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const inRange = (iso: string) => {
    if (days === null) return true;
    const edge = new Date(); edge.setHours(0, 0, 0, 0);
    edge.setDate(edge.getDate() - (days - 1));
    return new Date(String(iso).slice(0, 10)) >= edge;
  };
  const view = useMemo(() => rows.filter((r) =>
    (showVoided || !r.voided_at)
    && (!fSupplier || r.supplier === fSupplier)
    && inRange(r.returned_at)
    && (!q.trim() || [r.return_no, r.supplier, r.material, r.short_code, r.item_code]
        .some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase())))
  ), [rows, q, fSupplier, days, showVoided]);

  const voidedCount = rows.filter((r) => r.voided_at).length;
  const totalValue = view.filter((r) => !r.voided_at).reduce((a, r) => a + Number(r.line_value || 0), 0);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, x) => x === i ? { ...l, ...patch } : l));

  function openForm() {
    setOpen(true); setSupplierId(""); setReason(""); setNote("");
    setLines([{ item_id: "", quantity: "", rate: "" }]); setErr("");
  }

  async function post() {
    if (!supabase) return;
    setErr("");
    if (!supplierId) { setErr("Choose the supplier this is going back to."); return; }
    if (!reason.trim()) { setErr("Say why it is going back — the supplier will ask."); return; }
    const clean = lines.filter((l) => l.item_id && parseFloat(l.quantity) > 0);
    if (clean.length === 0) { setErr("Add at least one item with a quantity."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("post_purchase_return", {
      p_supplier_id: supplierId, p_reason: reason.trim(), p_note: note.trim() || null,
      p_lines: clean.map((l) => ({
        item_id: l.item_id, quantity: parseFloat(l.quantity),
        rate: l.rate ? parseFloat(l.rate) : null,
      })),
    });
    setBusy(false);
    /* The refusal names both numbers — "only 40 in stock, cannot send 50" —
       so it is shown as it comes rather than softened. */
    if (error) { setErr(error.message); return; }
    setOpen(false); load();
  }

  async function voidReturn(id: string) {
    if (!supabase || !voidWhy.trim()) return;
    const { error } = await supabase.rpc("void_purchase_return", { p_id: id, p_reason: voidWhy.trim() });
    if (error) { setErr(error.message); return; }
    setVoidRow(null); setVoidWhy(""); load();
  }

  const table = (): ExportTable => ({
    title: "purchase-returns",
    headers: ["Return", "Date", "Supplier", "Code", "Material", "Qty", "Unit", "Rate", "Value", "Reason", "Voided"],
    rows: view.map((r) => [r.return_no, when(r.returned_at), r.supplier,
      r.short_code ?? r.item_code, r.material, r.quantity, r.unit,
      r.rate ?? "", r.line_value, r.reason ?? "", r.voided_at ? "yes" : ""]),
  });

  return (
    <>
      <Topbar title="Purchase Return" subtitle="Material going back to the supplier — faulty, wrong or unwanted" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-card bg-periwinkle-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Return lines</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">{view.filter((r) => !r.voided_at).length}</p>
          </div>
          <div className="rounded-card bg-salmon-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Value returned</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">{rs(totalValue)}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Suppliers involved</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">
              {new Set(view.filter((r) => !r.voided_at).map((r) => r.supplier)).size}
            </p>
          </div>
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search return, material or code…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <select value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}
            className="rounded-xl2 border border-line bg-surface px-3 py-2 text-[12.5px] outline-none">
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.company_name}>{s.company_name}</option>)}
          </select>
          {voidedCount > 0 && (
            <button onClick={() => setShowVoided((v) => !v)}
              className={`rounded-full px-3 py-2 text-[12px] font-semibold transition ${showVoided ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {showVoided ? "Hide" : "Show"} voided ({voidedCount})
            </button>
          )}
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          {canDo && (
            <button onClick={openForm} className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
              <Plus size={15} /> New return
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Undo2 size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">Nothing returned yet</p>
            <p className="mt-1 text-[13px] text-muted">When material goes back to a supplier, record it here so the shelf and the supplier agree.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-2.5 font-bold">Return</th>
                <th className="px-4 py-2.5 font-bold">Supplier</th>
                <th className="px-4 py-2.5 font-bold">Material</th>
                <th className="px-4 py-2.5 text-right font-bold">Qty</th>
                <th className="px-4 py-2.5 text-right font-bold">Value</th>
                <th className="px-4 py-2.5 font-bold">Why</th>
                <th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id + r.item_code} className={`border-b border-line/60 last:border-0 ${r.voided_at ? "opacity-45" : ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-ink">{r.return_no}</span>
                      <span className="block text-[11px] text-hint">{when(r.returned_at)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{r.supplier}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-ink">{r.material}</span>
                      <span className="block font-mono text-[11px] text-hint">{r.short_code ?? r.item_code}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tnum font-bold text-ink">{n(r.quantity)} {r.unit}</td>
                    <td className="px-4 py-2.5 text-right tnum text-muted">{r.rate ? rs(r.line_value) : "—"}</td>
                    <td className="max-w-[220px] px-4 py-2.5 text-[12px] text-hint">
                      {r.voided_at ? `voided — ${r.void_reason ?? ""}` : r.reason}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canDo && !r.voided_at && (voidRow === r.id ? (
                        <span className="flex items-center justify-end gap-1.5">
                          <input value={voidWhy} autoFocus onChange={(e) => setVoidWhy(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") voidReturn(r.id); if (e.key === "Escape") setVoidRow(null); }}
                            placeholder="reason" className="w-32 rounded-lg border border-ink/30 px-2 py-1 text-[12px] outline-none" />
                          <button onClick={() => voidReturn(r.id)} disabled={!voidWhy.trim()}
                            className="text-[11px] font-bold text-danger disabled:opacity-40">void</button>
                          <button onClick={() => setVoidRow(null)} className="text-[11px] text-ink/50">cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => { setVoidRow(r.id); setVoidWhy(""); }} title="Void — material comes back"
                          className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-danger"><Trash2 size={14} /></button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Return material to supplier" wide>
        <Field label="Supplier *">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inp}>
            <option value="">Choose…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company_name}{s.code ? ` · ${s.code}` : ""}</option>)}
          </select>
        </Field>

        <div className="mt-3"><Field label="Why is it going back? *">
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. shade mismatch, torn rolls, short weight" className={inp} />
        </Field></div>

        <div className="mt-4 rounded-xl2 border border-line p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-semibold text-ink">Items</p>
            <button onClick={() => setLines((ls) => [...ls, { item_id: "", quantity: "", rate: "" }])}
              className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink/70">+ Item</button>
          </div>
          {/* Only material actually in stock is offered — you cannot send back
              what you do not have, and the database refuses it anyway. */}
          {lines.map((l, i) => {
            const it = items.find((x) => x.item_id === l.item_id);
            const over = it && parseFloat(l.quantity) > Number(it.usable);
            return (
              <div key={i} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <select value={l.item_id} onChange={(e) => setLine(i, { item_id: e.target.value })} className={inp}>
                  <option value="">Material…</option>
                  {items.map((x) => (
                    <option key={x.item_id} value={x.item_id}>
                      {x.material} — {n(x.usable)} {x.unit}
                    </option>
                  ))}
                </select>
                <input type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })}
                  placeholder="Quantity" className={`${inp} ${over ? "border-danger" : ""}`} />
                <input type="number" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })}
                  placeholder="Rate (optional)" className={inp} />
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-hint">
                    {it && over ? `only ${n(it.usable)} in stock` : it ? rs((parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0)) : ""}
                  </span>
                  {lines.length > 1 && (
                    <button onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}
                      className="ml-auto text-[11px] font-semibold text-danger/70">remove</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3"><Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} />
        </Field></div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={post} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Record return
          </button>
        </div>
      </Modal>
    </>
  );
}
