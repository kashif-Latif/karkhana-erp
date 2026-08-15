"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { Boxes, PackagePlus, Loader2, FileText, Ban, AlertTriangle, X, Pencil } from "lucide-react";
import IconChip from "@/components/IconChip";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type StockRow = { item_id: string; label: string; unit: string; balance: number };
type GrnRow = Record<string, unknown>;

function itemLabel(it: Record<string, unknown>): string {
  const g = (it.material_groups as { name?: string } | null)?.name;
  const c = (it.material_categories as { name?: string } | null)?.name;
  const col = (it.colors as { name?: string } | null)?.name;
  const s = (it.sizes as { name?: string } | null)?.name;
  return [g, c, col, s].filter(Boolean).join(" · ") || (it.name as string) || (it.code as string);
}
const money = (n: number) => "Rs " + Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const qty = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 3 });
const when = (s: string) => new Date(s).toLocaleString("en-PK", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

export default function InventoryPage() {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canVoid, setCanVoid] = useState(false);
  const [confirm, setConfirm] = useState<{ mode: "void" | "delete"; id: string; num: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [detailGrn, setDetailGrn] = useState<GrnRow | null>(null);
  const [detailLines, setDetailLines] = useState<{ label: string; unit: string; qty: number; rate: number; lineTotal: number }[] | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [bal, items, g] = await Promise.all([
      supabase.from("stock_balances").select("item_id, balance"),
      supabase.from("material_items").select("id, code, name, material_groups(name), material_categories(name), colors(name), sizes(name), units(symbol,name)"),
      supabase.from("grns").select("id, grn_number, received_at, total, subtotal, freight, discount, note, status, suppliers(company_name)").order("created_at", { ascending: false }).limit(15),
    ]);
    const meta = new Map<string, { label: string; unit: string }>();
    ((items.data as unknown as Record<string, unknown>[]) ?? []).forEach((it) => {
      meta.set(it.id as string, {
        label: itemLabel(it),
        unit: ((it.units as { symbol?: string; name?: string } | null)?.symbol) || ((it.units as { name?: string } | null)?.name) || "",
      });
    });
    const rows = ((bal.data as { item_id: string; balance: number }[]) ?? [])
      .map((b) => ({ item_id: b.item_id, balance: Number(b.balance), label: meta.get(b.item_id)?.label || "—", unit: meta.get(b.item_id)?.unit || "" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    setStock(rows);
    setGrns((g.data as unknown as GrnRow[]) ?? []);
    const { data: cv } = await supabase.rpc("has_permission", { p_permission_code: "inventory.adjust" });
    setCanVoid(!!cv);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openConfirm(mode: "void" | "delete", id: string, num: string) { setConfirm({ mode, id, num }); setVoidReason(""); setActionError(""); }
  async function runConfirm() {
    if (!supabase || !confirm) return;
    setBusy(true); setActionError("");
    const { error } = confirm.mode === "void"
      ? await supabase.rpc("void_grn", { p_grn_id: confirm.id, p_reason: voidReason })
      : await supabase.rpc("delete_grn", { p_grn_id: confirm.id });
    setBusy(false);
    if (error) { setActionError(error.message); return; }
    setConfirm(null); load();
  }

  async function openDetail(g: GrnRow) {
    setDetailGrn(g); setDetailLines(null);
    if (!supabase) return;
    const { data } = await supabase.from("grn_lines")
      .select("quantity, rate, line_total, material_items(name, material_groups(name), material_categories(name), colors(name), sizes(name), units(symbol,name))")
      .eq("grn_id", g.id as string);
    const rows = ((data as unknown as Record<string, unknown>[]) ?? []).map((r) => {
      const li = (r.material_items as Record<string, unknown>) || {};
      return {
        label: itemLabel(li),
        unit: ((li.units as { symbol?: string; name?: string } | null)?.symbol) || ((li.units as { name?: string } | null)?.name) || "",
        qty: Number(r.quantity), rate: Number(r.rate), lineTotal: Number(r.line_total),
      };
    });
    setDetailLines(rows);
  }

  return (
    <>
      <Topbar title="Inventory" subtitle="Live stock & receiving" />
      <div className="px-6 pb-10">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">Stock is calculated live from every receipt — always reconcilable.</p>
          <Link href="/inventory/receive" className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
            <PackagePlus size={16} /> Receive Stock
          </Link>
        </div>

        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to see inventory.</div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* current stock */}
            <div className="overflow-hidden rounded-card bg-surface shadow-card">
              <div className="border-b border-line px-5 py-3.5 text-[14px] font-extrabold text-ink">Current Stock</div>
              {stock.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <IconChip Icon={Boxes} size={42} />
                  <p className="text-[13px] font-semibold text-ink">No stock yet</p>
                  <p className="text-[12.5px] text-muted">Receive your first delivery to see stock here.</p>
                </div>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                      <th className="px-5 py-2.5 font-semibold">Material</th>
                      <th className="px-5 py-2.5 text-right font-semibold">In stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map((r) => (
                      <tr key={r.item_id} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                        <td className="px-5 py-2.5 font-medium text-ink">{r.label}</td>
                        <td className="px-5 py-2.5 text-right"><span className="tnum font-semibold text-ink">{qty(r.balance)}</span> <span className="text-[12px] text-muted">{r.unit}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* recent GRNs */}
            <div className="overflow-hidden rounded-card bg-surface shadow-card">
              <div className="border-b border-line px-5 py-3.5 text-[14px] font-extrabold text-ink">Recent Receipts (GRN)</div>
              {grns.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <IconChip Icon={FileText} size={42} />
                  <p className="text-[13px] font-semibold text-ink">No receipts yet</p>
                </div>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                      <th className="px-5 py-2.5 font-semibold">GRN</th>
                      <th className="px-5 py-2.5 font-semibold">Supplier</th>
                      <th className="px-5 py-2.5 font-semibold">Date</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {grns.map((g) => {
                      const voided = (g.status as string) === "voided";
                      return (
                      <tr key={g.id as string} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                        <td className="px-5 py-2.5"><button onClick={() => openDetail(g)} className="font-mono text-[12px] tnum text-ink underline decoration-dotted underline-offset-2 hover:text-salmon-strong">{g.grn_number as string}</button></td>
                        <td className="px-5 py-2.5 text-ink/80">{(g.suppliers as { company_name?: string } | null)?.company_name || "—"}</td>
                        <td className="px-5 py-2.5 text-ink/70">{when(g.received_at as string)}</td>
                        <td className={`px-5 py-2.5 text-right tnum font-semibold ${voided ? "text-hint line-through" : "text-ink"}`}>{money(g.total as number)}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {voided ? (
                              <span className="rounded-full bg-panel px-2.5 py-0.5 text-[11px] font-semibold text-muted">Voided</span>
                            ) : canVoid ? (
                              <>
                                <Link href={`/inventory/receive?edit=${g.id}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-ink/70 hover:bg-panel">
                                  <Pencil size={12} /> Edit
                                </Link>
                                <button onClick={() => openConfirm("void", g.id as string, g.grn_number as string)}
                                  className="inline-flex items-center gap-1 rounded-full border border-danger/40 px-2.5 py-1 text-[12px] font-semibold text-danger hover:bg-danger-soft">
                                  <Ban size={12} /> Void
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {detailGrn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => setDetailGrn(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <IconChip Icon={FileText} size={38} />
                <div>
                  <h2 className="text-[17px] font-extrabold">{detailGrn.grn_number as string}</h2>
                  <p className="text-[12px] text-muted">{(detailGrn.suppliers as { company_name?: string } | null)?.company_name || "—"} · {when(detailGrn.received_at as string)}{(detailGrn.status as string) === "voided" ? " · Voided" : ""}</p>
                </div>
              </div>
              <button onClick={() => setDetailGrn(null)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>

            {detailLines === null ? (
              <div className="flex items-center justify-center gap-2 py-10 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
            ) : (
              <>
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                      <th className="px-3 py-2 font-semibold">Material</th>
                      <th className="px-3 py-2 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Rate</th>
                      <th className="px-3 py-2 text-right font-semibold">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailLines.map((r, i) => (
                      <tr key={i} className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-2 font-medium text-ink">{r.label}</td>
                        <td className="px-3 py-2 text-right tnum text-ink/80">{qty(r.qty)} <span className="text-[11px] text-muted">{r.unit}</span></td>
                        <td className="px-3 py-2 text-right tnum text-ink/80">{money(r.rate)}</td>
                        <td className="px-3 py-2 text-right tnum font-semibold text-ink">{money(r.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-4 ml-auto w-full max-w-[260px] space-y-1.5 text-[13px]">
                  <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tnum text-ink">{money(Number(detailGrn.subtotal ?? 0))}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Freight (+)</span><span className="tnum text-ink">{money(Number(detailGrn.freight ?? 0))}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Discount (−)</span><span className="tnum text-ink">{money(Number(detailGrn.discount ?? 0))}</span></div>
                  <div className="flex justify-between border-t border-line pt-1.5"><span className="font-extrabold text-ink">Total</span><span className="tnum text-[15px] font-extrabold text-ink">{money(Number(detailGrn.total ?? 0))}</span></div>
                </div>
                {(detailGrn.note as string) && <p className="mt-4 rounded-xl2 bg-panel px-3.5 py-2.5 text-[12.5px] text-muted"><b>Note:</b> {detailGrn.note as string}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !busy && setConfirm(null)}>
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            {confirm.mode === "void" ? (
              <>
                <div className="mb-2 flex items-center gap-3"><IconChip Icon={Ban} size={38} /><h2 className="text-[17px] font-extrabold">Void {confirm.num}</h2></div>
                <p className="text-[13px] text-muted">This reverses the stock it added and the payable it created. The record is kept and marked &ldquo;voided&rdquo;.</p>
                <label className="mt-4 block"><span className="mb-1 block text-[12px] font-medium text-muted">Reason (optional)</span>
                  <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. wrong quantity" className={inp} autoFocus /></label>
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-3"><span className="flex h-[38px] w-[38px] items-center justify-center rounded-2xl bg-danger-soft text-danger"><AlertTriangle size={18} /></span><h2 className="text-[17px] font-extrabold">Delete {confirm.num}</h2></div>
                <p className="text-[13px] text-muted">This <b>permanently removes</b> this receipt and everything it created (stock and the supplier payable). It cannot be undone — use it only for test or mistaken data.</p>
              </>
            )}
            {actionError && <p className="mt-3 text-[12.5px] font-medium text-danger">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirm(null)} disabled={busy} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={runConfirm} disabled={busy} className={`flex items-center gap-1.5 rounded-xl2 px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50 ${confirm.mode === "delete" ? "bg-danger" : "bg-ink"}`}>
                {busy && <Loader2 size={15} className="animate-spin" />}{confirm.mode === "delete" ? "Delete permanently" : "Void receipt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
