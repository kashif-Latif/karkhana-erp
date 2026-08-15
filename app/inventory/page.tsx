"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { Boxes, PackagePlus, Loader2, FileText, Ban, Trash2, AlertTriangle } from "lucide-react";
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
const when = (s: string) => new Date(s).toLocaleString("en-PK", { day: "2-digit", month: "short", year: "numeric" });

export default function InventoryPage() {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canVoid, setCanVoid] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  const [confirm, setConfirm] = useState<{ mode: "void" | "delete"; id: string; num: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [bal, items, g] = await Promise.all([
      supabase.from("stock_balances").select("item_id, balance"),
      supabase.from("material_items").select("id, code, name, material_groups(name), material_categories(name), colors(name), sizes(name), units(symbol,name)"),
      supabase.from("grns").select("id, grn_number, received_at, total, status, suppliers(company_name)").order("created_at", { ascending: false }).limit(15),
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
    const { data: su } = await supabase.rpc("is_super_admin");
    setIsSuper(!!su);
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
                        <td className="px-5 py-2.5 font-mono text-[12px] tnum text-muted">{g.grn_number as string}</td>
                        <td className="px-5 py-2.5 text-ink/80">{(g.suppliers as { company_name?: string } | null)?.company_name || "—"}</td>
                        <td className="px-5 py-2.5 text-ink/70">{when(g.received_at as string)}</td>
                        <td className={`px-5 py-2.5 text-right tnum font-semibold ${voided ? "text-hint line-through" : "text-ink"}`}>{money(g.total as number)}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {voided && <span className="rounded-full bg-panel px-2.5 py-0.5 text-[11px] font-semibold text-muted">Voided</span>}
                            {!voided && canVoid && (
                              <button onClick={() => openConfirm("void", g.id as string, g.grn_number as string)}
                                className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-ink/70 hover:bg-panel">
                                <Ban size={12} /> Void
                              </button>
                            )}
                            {isSuper && (
                              <button onClick={() => openConfirm("delete", g.id as string, g.grn_number as string)}
                                className="inline-flex items-center gap-1 rounded-full border border-danger/40 px-2.5 py-1 text-[12px] font-semibold text-danger hover:bg-danger-soft">
                                <Trash2 size={12} /> Delete
                              </button>
                            )}
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
