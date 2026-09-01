"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Topbar from "@/components/Topbar";
import IconChip from "@/components/IconChip";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Plus, Trash2, Loader2, PackagePlus, ArrowLeft, X, Building2 } from "lucide-react";
import Link from "next/link";

type Group = { id: string; code: string; name: string; has_category: boolean; has_color: boolean; has_size: boolean };
type Cat = { id: string; group_id: string; name: string };
type Named = { id: string; name: string };
type Unit = { id: string; name: string; symbol: string | null };
type GU = { group_id: string; unit_id: string };
type Line = { group_id: string; category_id: string; color_id: string; size_id: string; unit_id: string; quantity: string; rate: string; unsorted?: boolean };

const EMPTY: Line = { group_id: "", category_id: "", color_id: "", size_id: "", unit_id: "", quantity: "", rate: "" };
function todayInput() { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function dateToISO(dateStr: string) { const now = new Date(); const [y, m, d] = dateStr.split("-").map(Number); return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString(); }
function toDateInput(iso: string) { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
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
  const [receivedAt, setReceivedAt] = useState(() => todayInput());
  const [note, setNote] = useState("");
  const [freight, setFreight] = useState("");
  const [discount, setDiscount] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [canAddSupplier, setCanAddSupplier] = useState(false);
  const [showSup, setShowSup] = useState(false);
  const [supForm, setSupForm] = useState({ company_name: "", contact_person: "", phone: "" });
  const [supSaving, setSupSaving] = useState(false);
  const [supError, setSupError] = useState("");

  const [canPay, setCanPay] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [postedTotal, setPostedTotal] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState("cash");
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState("");

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
    supabase.rpc("has_permission", { p_permission_code: "suppliers.manage" }).then(({ data }) => setCanAddSupplier(!!data));
    supabase.rpc("has_permission", { p_permission_code: "payments.manage" }).then(({ data }) => setCanPay(!!data));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const id = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("edit") : null;
    if (!id) return;
    setEditId(id);
    (async () => {
      const { data: h } = await supabase!.from("grns").select("supplier_id, received_at, freight, discount, note, status").eq("id", id).single();
      if (h) {
        const hh = h as Record<string, unknown>;
        if ((hh.status as string) === "voided") { setError("This GRN is voided and can't be edited."); return; }
        setSupplierId((hh.supplier_id as string) || "");
        if (hh.received_at) setReceivedAt(toDateInput(hh.received_at as string));
        setFreight(hh.freight ? String(Number(hh.freight)) : "");
        setDiscount(hh.discount ? String(Number(hh.discount)) : "");
        setNote((hh.note as string) || "");
      }
      const { data: ls } = await supabase!.from("grn_lines")
        .select("quantity, rate, material_items(group_id, category_id, color_id, size_id, unit_id)").eq("grn_id", id);
      const mapped = ((ls as unknown as Record<string, unknown>[]) ?? []).map((r) => {
        const mi = (r.material_items as Record<string, unknown>) || {};
        return {
          group_id: (mi.group_id as string) || "", category_id: (mi.category_id as string) || "",
          color_id: (mi.color_id as string) || "", size_id: (mi.size_id as string) || "",
          unit_id: (mi.unit_id as string) || "", quantity: String(Number(r.quantity)), rate: String(Number(r.rate)),
        } as Line;
      });
      if (mapped.length) setLines(mapped);
    })();
  }, []);

  function openSupModal() { setSupForm({ company_name: "", contact_person: "", phone: "" }); setSupError(""); setShowSup(true); }
  async function saveSupplier() {
    if (!supabase) return;
    if (!supForm.company_name.trim()) { setSupError("Company name is required."); return; }
    setSupSaving(true); setSupError("");
    const { data, error } = await supabase.from("suppliers")
      .insert({ company_name: supForm.company_name.trim(), contact_person: supForm.contact_person.trim() || null, phone: supForm.phone.trim() || null })
      .select("id, company_name").single();
    setSupSaving(false);
    if (error) { setSupError(error.message.toLowerCase().includes("row-level") ? "You don't have permission to add suppliers." : error.message); return; }
    const s = data as { id: string; company_name: string };
    setSuppliers((prev) => [...prev, { id: s.id, name: s.company_name }].sort((a, b) => a.name.localeCompare(b.name)));
    setSupplierId(s.id);
    setShowSup(false);
  }

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
      /* Attributes may be left blank on purpose. Fabric arrives in sealed
         cartons and nobody knows the colour breakdown until the cartons are
         opened days later. Forcing a colour here is what pushed people into
         inventing a colour called "Mixed" that then lived in the master list
         forever. A blank attribute creates a LOT, and the Sorting screen
         resolves it. See migration 0109. */
      if (!l.unsorted) {
        if (g.has_category && !l.category_id) { setError(`Choose a category for ${g.name}, or tick "colours not known yet".`); return; }
        if (g.has_color && !l.color_id) { setError(`Choose a colour for ${g.name}, or tick "colours not known yet".`); return; }
        if (g.has_size && !l.size_id) { setError(`Choose a size for ${g.name}, or tick "colours not known yet".`); return; }
      }
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
    if (editId) {
      const { error } = await supabase.rpc("edit_grn", {
        p_grn_id: editId, p_supplier_id: supplierId, p_received_at: dateToISO(receivedAt),
        p_freight: parseFloat(freight) || 0, p_discount: parseFloat(discount) || 0, p_note: note, p_lines,
      });
      setSaving(false);
      if (error) { setError(error.message); return; }
      router.push("/inventory");
      return;
    }
    const { error } = await supabase.rpc("post_grn_smart", {
      p_supplier_id: supplierId, p_received_at: dateToISO(receivedAt),
      p_freight: parseFloat(freight) || 0, p_discount: parseFloat(discount) || 0, p_note: note, p_lines,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    if (canPay) { setPostedTotal(total); setPayAmount(String(total)); setPayMethod("cash"); setPayRef(""); setPayError(""); }
    else router.push("/inventory");
  }

  async function savePayment() {
    if (!supabase) return;
    if (!(parseFloat(payAmount) > 0)) { setPayError("Enter an amount greater than zero."); return; }
    setPaySaving(true); setPayError("");
    const { error } = await supabase.rpc("record_payment", {
      p_supplier_id: supplierId, p_amount: parseFloat(payAmount), p_method: payMethod,
      p_reference: payRef, p_paid_at: new Date().toISOString(), p_note: "Paid on receipt",
    });
    setPaySaving(false);
    if (error) { setPayError(error.message); return; }
    router.push("/inventory");
  }

  return (
    <>
      <Topbar title={editId ? "Edit GRN" : "Receive Stock"} subtitle="Goods Receipt Note (GRN)" />
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
                    <div className="flex items-center gap-2">
                      <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inp}>
                        <option value="">Choose supplier…</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {canAddSupplier && (
                        <button type="button" onClick={openSupModal} title="Add a new supplier"
                          className="flex shrink-0 items-center gap-1 rounded-xl2 border border-line bg-canvas px-3 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">
                          <Plus size={15} /> New
                        </button>
                      )}
                    </div>
                    {suppliers.length === 0 && <span className="mt-1 block text-[11px] text-hint">{canAddSupplier ? "No suppliers yet — click “New” to add one." : "No suppliers yet — ask an admin to add one."}</span>}
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Received on</span>
                    <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={inp} />
                    <span className="mt-1 block text-[11px] text-hint">Pick the date — the time is added automatically.</span>
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
                              <label className="mt-2.5 flex cursor-pointer items-start gap-2 rounded-xl2 bg-amber-soft/60 px-3 py-2.5">
                                <input type="checkbox" checked={!!l.unsorted}
                                  onChange={(e) => setLine(i, { unsorted: e.target.checked, category_id: "", color_id: "", size_id: "" })}
                                  className="mt-0.5 h-4 w-4 accent-[#141414]" />
                                <span className="min-w-0">
                                  <span className="block text-[12.5px] font-semibold text-ink">Arrived mixed — breakdown not known yet</span>
                                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
                                    Sealed cartons. Receive and pay now; a lot is created and the Sorting screen records the breakdown once they are opened.
                                  </span>
                                </span>
                              </label>
                            )}

                            {(g.has_category || g.has_color || g.has_size) && !l.unsorted && (
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
                <button onClick={post} disabled={saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl2 bg-ink px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50">{saving && <Loader2 size={16} className="animate-spin" />} {editId ? "Save changes" : "Post receipt"}</button>
                <p className="mt-2 text-center text-[11px] text-hint">Adds stock to inventory and records what you owe the supplier.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {postedTotal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card">
            <div className="mb-1 flex items-center gap-3"><IconChip Icon={PackagePlus} size={38} /><h2 className="text-[17px] font-extrabold">Receipt posted</h2></div>
            <p className="mb-4 text-[13px] text-muted">Stock added and the supplier payable recorded. Was this paid now, or on credit?</p>

            <span className="mb-1 block text-[12px] font-medium text-muted">Payment method</span>
            <div className="grid grid-cols-3 gap-2">
              {[["cash","Cash"],["bank","Online / Bank"],["cheque","Cheque"]].map(([v,l]) => (
                <button key={v} onClick={() => setPayMethod(v)} className={`rounded-xl2 border px-2 py-2 text-[12.5px] font-semibold ${payMethod===v ? "border-ink bg-ink text-white" : "border-line text-ink/70 hover:bg-panel"}`}>{l}</button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Amount (Rs)</span>
                <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inp} /></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Reference</span>
                <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="optional" className={inp} /></label>
            </div>
            <p className="mt-2 text-[11.5px] text-hint">Full amount is Rs {(postedTotal).toLocaleString("en-PK")}. You can pay part now and the rest later.</p>
            {payError && <p className="mt-3 text-[12.5px] font-medium text-danger">{payError}</p>}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button onClick={() => router.push("/inventory")} disabled={paySaving} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Pay later (on credit)</button>
              <button onClick={savePayment} disabled={paySaving} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{paySaving && <Loader2 size={15} className="animate-spin" />}Save payment</button>
            </div>
          </div>
        </div>
      )}

      {showSup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !supSaving && setShowSup(false)}>
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3"><IconChip Icon={Building2} size={38} /><h2 className="text-[17px] font-extrabold">Add supplier</h2></div>
              <button onClick={() => setShowSup(false)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Company name *</span>
                <input value={supForm.company_name} onChange={(e) => setSupForm((f) => ({ ...f, company_name: e.target.value }))} placeholder="e.g. Ravi Textiles" className={inp} autoFocus /></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Contact person</span>
                <input value={supForm.contact_person} onChange={(e) => setSupForm((f) => ({ ...f, contact_person: e.target.value }))} placeholder="optional" className={inp} /></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Phone</span>
                <input value={supForm.phone} onChange={(e) => setSupForm((f) => ({ ...f, phone: e.target.value }))} placeholder="optional" className={inp} /></label>
            </div>
            <p className="mt-2 text-[11.5px] text-hint">Saved to your Suppliers list — you can add full details there anytime.</p>
            {supError && <p className="mt-3 text-[12.5px] font-medium text-danger">{supError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowSup(false)} disabled={supSaving} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={saveSupplier} disabled={supSaving} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{supSaving && <Loader2 size={15} className="animate-spin" />}Save supplier</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
const inpSm = "w-full rounded-xl2 border border-line bg-surface px-2.5 py-2 text-[13px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
const inpTiny = "w-28 rounded-xl2 border border-line bg-canvas px-2.5 py-1.5 text-right text-[13px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>{children}</label>;
}
