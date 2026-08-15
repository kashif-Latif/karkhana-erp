"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Topbar from "@/components/Topbar";
import { Plus, Trash2, Loader2, PackagePlus, ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Opt = { id: string; label: string; unit: string };
type Line = { key: string; item_id: string; quantity: string; rate: string };
const newLine = (): Line => ({ key: Math.random().toString(36).slice(2), item_id: "", quantity: "", rate: "" });

function itemLabel(it: Record<string, unknown>): string {
  const g = (it.material_groups as { name?: string } | null)?.name;
  const c = (it.material_categories as { name?: string } | null)?.name;
  const col = (it.colors as { name?: string } | null)?.name;
  const s = (it.sizes as { name?: string } | null)?.name;
  return [g, c, col, s].filter(Boolean).join(" · ") || (it.name as string) || (it.code as string);
}
const money = (n: number) => "Rs " + n.toLocaleString("en-PK", { maximumFractionDigits: 2 });

export default function ReceiveStock() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<{ id: string; company_name: string }[]>([]);
  const [items, setItems] = useState<Opt[]>([]);
  const [canReceive, setCanReceive] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  const [receivedAt, setReceivedAt] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [freight, setFreight] = useState("");
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    const [s, it, can] = await Promise.all([
      supabase.from("suppliers").select("id, company_name").eq("is_active", true).order("company_name"),
      supabase.from("material_items")
        .select("id, code, name, material_groups(name), material_categories(name), colors(name), sizes(name), units(symbol,name)")
        .eq("is_active", true),
      supabase.rpc("has_permission", { p_permission_code: "grn.create" }),
    ]);
    setSuppliers((s.data as { id: string; company_name: string }[]) ?? []);
    setItems(((it.data as unknown as Record<string, unknown>[]) ?? []).map((r) => ({
      id: r.id as string,
      label: itemLabel(r),
      unit: ((r.units as { symbol?: string; name?: string } | null)?.symbol) || ((r.units as { name?: string } | null)?.name) || "",
    })));
    setCanReceive(!!can.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit || "";
  const lineTotal = (l: Line) => (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = subtotal + (parseFloat(freight) || 0) - (parseFloat(discount) || 0);

  function setLine(key: string, k: keyof Line, v: string) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)));
  }

  async function post() {
    setError("");
    if (!supabase) return;
    if (!supplierId) { setError("Please choose a supplier."); return; }
    const valid = lines.filter((l) => l.item_id && parseFloat(l.quantity) > 0 && l.rate !== "");
    if (valid.length === 0) { setError("Add at least one item with a quantity and rate."); return; }
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc("post_grn", {
      p_supplier_id: supplierId,
      p_received_at: new Date(receivedAt).toISOString(),
      p_freight: parseFloat(freight) || 0,
      p_discount: parseFloat(discount) || 0,
      p_note: note || null,
      p_lines: valid.map((l) => ({ item_id: l.item_id, quantity: parseFloat(l.quantity), rate: parseFloat(l.rate) })),
    });
    setSaving(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    router.push("/inventory");
  }

  return (
    <>
      <Topbar title="Receive Stock" subtitle="Goods Receipt Note (GRN)" />
      <div className="px-6 pb-10">
        <Link href="/inventory" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
          <ArrowLeft size={15} /> Back to Inventory
        </Link>

        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to receive stock.</div>
        ) : !canReceive ? (
          <div className="flex flex-col items-center gap-3 rounded-card bg-surface py-16 text-center shadow-card">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-panel text-muted"><Lock size={24} /></span>
            <p className="text-[15px] font-extrabold text-ink">You can&apos;t receive stock</p>
            <p className="text-[13px] text-muted">Your role doesn&apos;t include creating goods receipts.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* form */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-card bg-surface p-5 shadow-card">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Supplier *</span>
                    <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inp}>
                      <option value="">Choose supplier…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Received on</span>
                    <input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={inp} />
                  </label>
                </div>
              </div>

              <div className="rounded-card bg-surface p-5 shadow-card">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[14px] font-extrabold text-ink">Items received</h3>
                  <button onClick={() => setLines((ls) => [...ls, newLine()])} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel">
                    <Plus size={14} /> Add line
                  </button>
                </div>
                <div className="space-y-2.5">
                  {lines.map((l) => (
                    <div key={l.key} className="grid grid-cols-12 items-end gap-2">
                      <div className="col-span-12 sm:col-span-5">
                        <span className="mb-1 block text-[11px] font-medium text-muted sm:hidden">Material</span>
                        <select value={l.item_id} onChange={(e) => setLine(l.key, "item_id", e.target.value)} className={inpSm}>
                          <option value="">Choose material…</option>
                          {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <span className="mb-1 block text-[11px] font-medium text-muted">Qty {l.item_id && `(${unitOf(l.item_id)})`}</span>
                        <input type="number" value={l.quantity} onChange={(e) => setLine(l.key, "quantity", e.target.value)} placeholder="0" className={inpSm} />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <span className="mb-1 block text-[11px] font-medium text-muted">Rate</span>
                        <input type="number" value={l.rate} onChange={(e) => setLine(l.key, "rate", e.target.value)} placeholder="0" className={inpSm} />
                      </div>
                      <div className="col-span-3 sm:col-span-2">
                        <span className="mb-1 block text-[11px] font-medium text-muted">Total</span>
                        <div className="tnum truncate rounded-xl2 bg-canvas px-2.5 py-2 text-[13px] font-semibold text-ink">{money(lineTotal(l))}</div>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                          className="rounded-full p-2 text-muted hover:bg-danger-soft hover:text-danger" title="Remove line">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-card bg-surface p-5 shadow-card">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-muted">Note (optional)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bilty #, vehicle, remarks" className={inp} />
                </label>
              </div>
            </div>

            {/* summary */}
            <div className="space-y-4">
              <div className="rounded-card bg-surface p-5 shadow-card">
                <h3 className="mb-3 text-[14px] font-extrabold text-ink">Summary</h3>
                <Row label="Subtotal" value={money(subtotal)} />
                <label className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] text-muted">Freight</span>
                  <input type="number" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" className={`${inpSm} w-28 text-right`} />
                </label>
                <label className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] text-muted">Discount</span>
                  <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className={`${inpSm} w-28 text-right`} />
                </label>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                  <span className="text-[14px] font-extrabold text-ink">Total</span>
                  <span className="tnum text-[16px] font-extrabold text-ink">{money(total)}</span>
                </div>
                <p className="mt-2 text-[11.5px] text-hint">Posting adds this stock to inventory and records what you owe the supplier.</p>
                {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}
                <button onClick={post} disabled={saving}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl2 bg-ink py-3 text-[14px] font-semibold text-white disabled:opacity-50">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />} Post GRN
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none focus:border-salmon-strong/50";
const inpSm = "w-full rounded-xl2 border border-line bg-canvas px-2.5 py-2 text-[13px] outline-none focus:border-salmon-strong/50";
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-[13px] text-muted">{label}</span><span className="tnum text-[13.5px] font-semibold text-ink">{value}</span></div>;
}
