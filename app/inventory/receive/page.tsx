"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Topbar from "@/components/Topbar";
import IconChip from "@/components/IconChip";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Plus, Trash2, Loader2, PackagePlus, ArrowLeft } from "lucide-react";
import Link from "next/link";

type Group = { id: string; code: string; name: string; has_category: boolean; has_color: boolean; has_size: boolean };
type Cat = { id: string; group_id: string; name: string };
type Named = { id: string; name: string };
type Unit = { id: string; name: string; symbol: string | null };
type GU = { group_id: string; unit_id: string };
type Line = { group_id: string; category_id: string; color_id: string; size_id: string; unit_id: string; quantity: string; rate: string };

const EMPTY: Line = { group_id: "", category_id: "", color_id: "", size_id: "", unit_id: "", quantity: "", rate: "" };
function toLocalInput(d: Date) { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
const fmt = (n: number) => "Rs " + (n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });

export default function ReceiveStock() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [colors, setColors] = useState<Named[]>([]);
  const [sizes, setSizes] = useState<Named[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [gunits, setGunits] = useState<GU[]>([]);
  const [suppliers, setSuppliers] = useState<Named[]>([]);
  const [canReceive, setCanReceive] = useState(true);

  const [supplierId, setSupplierId] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => toLocalInput(new Date()));
  const [note, setNote] = useState("");
  const [freight, setFreight] = useState("");
  const [discount, setDiscount] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.from("suppliers").select("id, company_name").eq("is_active", true).order("company_name")
      .then(({ data }) => setSuppliers(((data as { id: string; company_name: string }[]) ?? []).map((s) => ({ id: s.id, name: s.company_name }))));
    supabase.from("material_groups").select("id, code, name, has_category, has_color, has_size").eq("is_active", true).order("name")
      .then(({ data }) => setGroups((data as Group[]) ?? []));
    supabase.from("material_categories").select("id, group_id, name").eq("is_active", true).order("name").then(({ data }) => setCats((data as Cat[]) ?? []));
    supabase.from("colors").select("id, name").eq("is_active", true).order("name").then(({ data }) => setColors((data as Named[]) ?? []));
    supabase.from("sizes").select("id, name, sort_order").eq("is_active", true).order("sort_order").then(({ data }) => setSizes((data as Named[]) ?? []));
    supabase.from("units").select("id, name, symbol").eq("is_active", true).order("name").then(({ data }) => setUnits((data as Unit[]) ?? []));
    supabase.from("group_units").select("group_id, unit_id").then(({ data }) => setGunits((data as GU[]) ?? []));
    supabase.rpc("has_permission", { p_permission_code: "grn.create" }).then(({ data }) => setCanReceive(!!data));
  }, []);

  const groupById = (id: string) => groups.find((g) => g.id === id);
  const catsFor = (gid: string) => cats.filter((c) => c.group_id === gid);
  const unitsFor = (gid: string) => gunits.filter((gu) => gu.group_id === gid).map((gu) => units.find((u) => u.id === gu.unit_id)).filter(Boolean) as Unit[];
  const unitSym = (id: string) => units.find((u) => u.id === id)?.symbol || units.find((u) => u.id === id)?.name || "";

  function setLine(i: number, patch: Partial<Line>) { setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }
  function chooseGroup(i: number, gid: string) {
    const allowed = unitsFor(gid);
    setLine(i, { group_id: gid, category_id: "", color_id: "", size_id: "", unit_id: allowed.length === 1 ? allowed[0].id : "" });
  }
  const addLine = () => setLines((ls) => [...ls, { ...EMPTY }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));

  const lineTotal = (l: Line) => (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = subtotal + (parseFloat(freight) || 0) - (parseFloat(discount) || 0);

  function labelOf(l: Line) {
    const g = groupById(l.group_id); if (!g) return "";
    const parts = [g.name];
    if (g.has_category && l.category_id) parts.push(cats.find((c) => c.id === l.category_id)?.name || "");
    if (g.has_color && l.color_id) parts.push(colors.find((c) => c.id === l.color_id)?.name || "");
    if (g.has_size && l.size_id) parts.push("Size " + (sizes.find((s) => s.id === l.size_id)?.name || ""));
    return parts.filter(Boolean).join(" · ");
  }

  async function post() {
    setError("");
    if (!supabase) return;
    if (!supplierId) { setError("Please choose a supplier."); return; }
    const clean: Line[] = [];
    for (const l of lines) {
      if (!l.group_id) continue;
      const g = groupById(l.group_id)!;
      if (g.has_category && !l.category_id) { setError(`Choose a category for ${g.name}.`); return; }
      if (g.has_color && !l.color_id) { setError(`Choose a colour for ${g.name}.`); return; }
      if (g.has_size && !l.size_id) { setError(`Choose a size for ${g.name}.`); return; }
      if (!l.unit_id) { setError(`Choose a unit for ${g.name}.`); return; }
      if (!(parseFloat(l.quantity) > 0)) { setError(`Enter a quantity for ${g.name}.`); return; }
      if (l.rate === "" || parseFloat(l.rate) < 0) { setError(`Enter a rate for ${g.name}.`); return; }
      clean.push(l);
    }
    if (clean.length === 0) { setError("Add at least one material line."); return; }

    setSaving(true);
    const p_lines = clean.map((l) => ({
      group_id: l.group_id, category_id: l.category_id || null, color_id: l.color_id || null,
      size_id: l.size_id || null, unit_id: l.unit_id, quantity: parseFloat(l.quantity), rate: parseFloat(l.rate),
    }));
    const { error } = await supabase.rpc("post_grn_smart", {
      p_supplier_id: supplierId, p_received_at: new Date(receivedAt).toISOString(),
      p_freight: parseFloat(freight) || 0, p_discount: parseFloat(discount) || 0, p_note: note, p_lines,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    router.push("/inventory");
  }

  return (
    <>
      <Topbar title="Receive Stock" subtitle="Goods Receipt Note (GRN)" />
      <div className="px-6 pb-12">
        <Link href="/inventory" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft size={15} /> Back to Inventory</Link>

        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to receive stock.</div>
        ) : !canReceive ? (
          <div className="rounded-card bg-surface p-8 text-center shadow-card">
            <IconChip Icon={PackagePlus} size={44} />
            <p className="mt-3 text-[15px] font-semibold text-ink">You can&apos;t receive stock</p>
            <p className="mt-1 text-[13px] text-muted">Your role doesn&apos;t include creating goods receipts. Ask an administrator.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <div className="rounded-card bg-surface p-5 shadow-card">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Supplier *</span>
                    <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inp}>
                      <option value="">Choose supplier…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {suppliers.length === 0 && <span className="mt-1 block text-[11px] text-hint">No suppliers yet — add one under Suppliers.</span>}
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Received on</span>
                    <input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={inp} />
                  </label>
                </div>
              </div>

              <div className="rounded-card bg-surface p-5 shadow-card">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[14px] font-extrabold text-ink">Materials received</h3>
                  <button onClick={addLine} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel"><Plus size={14} /> Add material</button>
                </div>

                <div className="space-y-3">
                  {lines.map((l, i) => {
                    const g = groupById(l.group_id);
                    const allowed = l.group_id ? unitsFor(l.group_id) : [];
                    return (
                      <div key={i} className="rounded-xl2 border border-line bg-canvas/60 p-3.5">
                        <div className="flex items-center gap-2">
                          <select value={l.group_id} onChange={(e) => chooseGroup(i, e.target.value)} className={`${inpSm} font-semibold`}>
                            <option value="">Choose material…</option>
                            {groups.map((gr) => <option key={gr.id} value={gr.id}>{gr.name}</option>)}
                          </select>
                          <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="rounded-full p-2 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30"><Trash2 size={15} /></button>
                        </div>

                        {g && (
                          <>
                            {(g.has_category || g.has_color || g.has_size) && (
                              <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {g.has_category && (
                                  <Field label="Category">
                                    <select value={l.category_id} onChange={(e) => setLine(i, { category_id: e.target.value })} className={inpSm}>
                                      <option value="">Select…</option>
                                      {catsFor(g.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                  </Field>
                                )}
                                {g.has_color && (
                                  <Field label="Colour">
                                    <select value={l.color_id} onChange={(e) => setLine(i, { color_id: e.target.value })} className={inpSm}>
                                      <option value="">Select…</option>
                                      {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                  </Field>
                                )}
                                {g.has_size && (
                                  <Field label="Size">
                                    <select value={l.size_id} onChange={(e) => setLine(i, { size_id: e.target.value })} className={inpSm}>
                                      <option value="">Select…</option>
                                      {sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                  </Field>
                                )}
                              </div>
                            )}

                            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              <Field label="Unit">
                                {allowed.length > 1 ? (
                                  <select value={l.unit_id} onChange={(e) => setLine(i, { unit_id: e.target.value })} className={inpSm}>
                                    <option value="">Select…</option>
                                    {allowed.map((u) => <option key={u.id} value={u.id}>{u.symbol || u.name}</option>)}
                                  </select>
                                ) : (
                                  <div className="rounded-xl2 border border-line bg-panel px-2.5 py-2 text-[13px] text-ink/70">{l.unit_id ? unitSym(l.unit_id) : "—"}</div>
                                )}
                              </Field>
                              <Field label="Quantity"><input type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="0" className={inpSm} /></Field>
                              <Field label="Rate (Rs)"><input type="number" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder="0" className={inpSm} /></Field>
                              <Field label="Line total"><div className="px-1 py-2 text-[13.5px] font-bold tnum text-ink">{fmt(lineTotal(l))}</div></Field>
                            </div>
                            {labelOf(l) && <p className="mt-2 text-[11.5px] text-hint">Receiving: <span className="font-medium text-muted">{labelOf(l)}</span></p>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-card bg-surface p-5 shadow-card">
                <h3 className="mb-3 text-[14px] font-extrabold text-ink">Summary</h3>
                <div className="space-y-2 text-[13px]">
                  <div className="flex items-center justify-between"><span className="text-muted">Subtotal</span><span className="tnum font-semibold text-ink">{fmt(subtotal)}</span></div>
                  <label className="flex items-center justify-between gap-2"><span className="text-muted">Freight (+)</span><input type="number" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" className={inpTiny} /></label>
                  <label className="flex items-center justify-between gap-2"><span className="text-muted">Discount (−)</span><input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className={inpTiny} /></label>
                  <div className="mt-2 flex items-center justify-between border-t border-line pt-2.5"><span className="text-[14px] font-extrabold text-ink">Total</span><span className="text-[16px] font-extrabold tnum text-ink">{fmt(total)}</span></div>
                </div>
                <label className="mt-4 block"><span className="mb-1 block text-[12px] font-medium text-muted">Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. invoice #, vehicle…" className={inp} /></label>
                {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}
                <button onClick={post} disabled={saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl2 bg-ink px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50">{saving && <Loader2 size={16} className="animate-spin" />} Post receipt</button>
                <p className="mt-2 text-center text-[11px] text-hint">Adds stock to inventory and records what you owe the supplier.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
const inpSm = "w-full rounded-xl2 border border-line bg-surface px-2.5 py-2 text-[13px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
const inpTiny = "w-28 rounded-xl2 border border-line bg-canvas px-2.5 py-1.5 text-right text-[13px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>{children}</label>;
}
