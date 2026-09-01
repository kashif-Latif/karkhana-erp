"use client";
import { useEffect, useState, useCallback } from "react";
import Topbar from "@/components/Topbar";
import IconChip from "@/components/IconChip";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Loader2, ArrowLeftRight, Plus, Trash2, Send, RotateCcw, SlidersHorizontal, Flame, X, Ban } from "lucide-react";

type Item = { id: string; label: string; unit: string; balance: number };
type Dept = { id: string; name: string };
type Line = { item_id: string; quantity: string };
type Move = Record<string, unknown>;
type Holding = { department_id: string; department_name: string; item_label: string; unit: string; qty: number };
type DetailLine = { label: string; qty: number; unit: string };

const TYPES = [
  { key: "issue", label: "Issue", sub: "Out to a department", perm: "inventory.issue", Icon: Send, dept: true },
  { key: "return", label: "Return", sub: "Back from a department", perm: "inventory.return", Icon: RotateCcw, dept: true },
  { key: "adjustment", label: "Adjustment", sub: "Correct stock up / down", perm: "inventory.adjust", Icon: SlidersHorizontal, dept: false },
  { key: "wastage", label: "Wastage", sub: "Wasted / damaged", perm: "inventory.adjust", Icon: Flame, dept: false },
] as const;

function todayInput() { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function dateToISO(s: string) { const now = new Date(); const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString(); }
const when = (s: string) => new Date(s).toLocaleString("en-PK", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const TYPE_LABEL: Record<string, string> = { issue: "Issue", return: "Return", adjustment: "Adjustment", wastage: "Wastage" };

export default function Movements() {
  const [items, setItems] = useState<Item[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [emps, setEmps] = useState<{ id: string; name: string; department_id: string | null }[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [detailMv, setDetailMv] = useState<Move | null>(null);
  const [detailLines, setDetailLines] = useState<DetailLine[] | null>(null);
  const [voidMv, setVoidMv] = useState<{ id: string; number: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidErr, setVoidErr] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [type, setType] = useState<string>("issue");
  const [deptId, setDeptId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [direction, setDirection] = useState("remove");
  const [reason, setReason] = useState("");
  const [movedAt, setMovedAt] = useState(todayInput());
  const [lines, setLines] = useState<Line[]>([{ item_id: "", quantity: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [mi, sb, dp, mv, pm, em, dh] = await Promise.all([
      supabase.from("material_items").select("id, material_groups(name), material_categories(name), colors(name), sizes(name), units(symbol,name)").eq("is_active", true),
      supabase.from("stock_balances").select("item_id, balance"),
      supabase.from("departments").select("id, name").order("name"),
      supabase.from("stock_movements").select("id, movement_number, type, status, reason, moved_at, departments(name), employees(name)").order("created_at", { ascending: false }).limit(20),
      supabase.rpc("my_permissions"),
      supabase.from("employees").select("id, name, department_id").eq("is_active", true).order("name"),
      supabase.from("department_holdings").select("*"),
    ]);
    const balMap = new Map(((sb.data as { item_id: string; balance: number }[]) ?? []).map((b) => [b.item_id, Number(b.balance)]));
    const list = ((mi.data as unknown as Record<string, unknown>[]) ?? []).map((r) => {
      const g = r.material_groups as { name?: string } | null;
      const c = r.material_categories as { name?: string } | null;
      const col = r.colors as { name?: string } | null;
      const s = r.sizes as { name?: string } | null;
      const u = r.units as { symbol?: string; name?: string } | null;
      const label = [g?.name, c?.name, col?.name, s?.name].filter(Boolean).join(" · ");
      return { id: r.id as string, label, unit: u?.symbol || u?.name || "", balance: balMap.get(r.id as string) ?? 0 };
    }).sort((a, b) => a.label.localeCompare(b.label));
    setItems(list);
    setDepts((dp.data as Dept[]) ?? []);
    setEmps((em.data as { id: string; name: string; department_id: string | null }[]) ?? []);
    setHoldings((((dh.data as Record<string, unknown>[]) ?? []).map((h) => ({
      department_id: h.department_id as string, department_name: h.department_name as string,
      item_label: h.item_label as string, unit: (h.unit as string) || "", qty: Number(h.qty),
    }))) as Holding[]);
    setMoves((mv.data as Move[]) ?? []);
    setPerms((pm.data as string[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const can = (p: string) => perms.includes(p);
  const allowedTypes = TYPES.filter((t) => can(t.perm));
  const active = TYPES.find((t) => t.key === type)!;
  const itemById = (id: string) => items.find((i) => i.id === id);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { item_id: "", quantity: "" }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));

  async function post() {
    setError(""); setOkMsg("");
    if (!supabase) return;
    if (active.dept && !deptId) { setError("Please choose a department."); return; }
    const valid = lines.filter((l) => l.item_id && parseFloat(l.quantity) > 0);
    if (valid.length === 0) { setError("Add at least one item with a quantity."); return; }
    setSaving(true);
    const p_lines = valid.map((l) => ({ item_id: l.item_id, quantity: parseFloat(l.quantity) }));
    const { error } = await supabase.rpc("post_stock_movement", {
      p_type: type, p_department_id: active.dept ? deptId : null, p_employee_id: active.dept ? (employeeId || null) : null,
      p_reason: reason, p_moved_at: dateToISO(movedAt), p_direction: direction, p_lines,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setOkMsg(`${active.label} recorded.`);
    setLines([{ item_id: "", quantity: "" }]); setReason(""); setEmployeeId("");
    load();
  }

  async function openDetail(m: Move) {
    setDetailMv(m); setDetailLines(null);
    if (!supabase) return;
    const { data } = await supabase.from("stock_movement_lines")
      .select("quantity, material_items(material_groups(name), material_categories(name), colors(name), sizes(name), units(symbol,name))")
      .eq("movement_id", m.id as string);
    const rows = ((data as unknown as Record<string, unknown>[]) ?? []).map((r) => {
      const li = (r.material_items as Record<string, unknown>) || {};
      const g = li.material_groups as { name?: string } | null;
      const c = li.material_categories as { name?: string } | null;
      const col = li.colors as { name?: string } | null;
      const sz = li.sizes as { name?: string } | null;
      const u = li.units as { symbol?: string; name?: string } | null;
      return { label: [g?.name, c?.name, col?.name, sz?.name].filter(Boolean).join(" · "), qty: Number(r.quantity), unit: u?.symbol || u?.name || "" };
    });
    setDetailLines(rows);
  }

  async function voidMovement() {
    if (!supabase || !voidMv) return;
    setVoidBusy(true); setVoidErr("");
    const { error } = await supabase.rpc("void_movement", { p_movement_id: voidMv.id, p_reason: voidReason });
    setVoidBusy(false);
    if (error) { setVoidErr(error.message); return; }
    setVoidMv(null); load();
  }

  const byDept = holdings.reduce((acc, h) => { (acc[h.department_name] ||= []).push(h); return acc; }, {} as Record<string, Holding[]>);

  return (
    <>
      <Topbar title="Stock Movements" subtitle="Issue · Return · Adjust · Wastage" />
      <div className="px-6 pb-12">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to record movements.</div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : allowedTypes.length === 0 ? (
          <div className="rounded-card bg-surface p-8 text-center shadow-card">
            <IconChip Icon={ArrowLeftRight} size={44} />
            <p className="mt-3 text-[15px] font-semibold text-ink">You can view movements only</p>
            <p className="mt-1 text-[13px] text-muted">Your role doesn&apos;t include issuing, returning, or adjusting stock.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* form */}
            <div className="space-y-5 lg:col-span-2">
              <div className="rounded-card bg-surface p-5 shadow-card">
                <h3 className="mb-3 text-[14px] font-extrabold text-ink">New movement</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {allowedTypes.map((t) => {
                    const on = type === t.key;
                    return (
                      <button key={t.key} type="button" onClick={() => { setType(t.key); setError(""); setOkMsg(""); }}
                        className={`rounded-xl2 border p-3 text-center transition ${on ? "border-ink bg-ink text-white" : "border-line bg-canvas hover:bg-panel"}`}>
                        <t.Icon size={18} className="mx-auto mb-1" />
                        <div className="text-[12.5px] font-bold">{t.label}</div>
                        <div className={`text-[10px] ${on ? "text-white/70" : "text-hint"}`}>{t.sub}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {active.dept && (
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-muted">Department *</span>
                      <select value={deptId} onChange={(e) => { setDeptId(e.target.value); setEmployeeId(""); }} className={inp}>
                        <option value="">Choose department…</option>
                        {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                  )}
                  {active.dept && deptId && (
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-muted">Employee (optional)</span>
                      <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inp}>
                        <option value="">Not assigned</option>
                        {emps.filter((e) => e.department_id === deptId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                      {emps.filter((e) => e.department_id === deptId).length === 0 && <span className="mt-1 block text-[11px] text-hint">No employees in this department yet.</span>}
                    </label>
                  )}
                  {type === "adjustment" && (
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-muted">Direction</span>
                      <select value={direction} onChange={(e) => setDirection(e.target.value)} className={inp}>
                        <option value="remove">Remove stock (−)</option>
                        <option value="add">Add stock (+)</option>
                      </select>
                    </label>
                  )}
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Date</span>
                    <input type="date" value={movedAt} onChange={(e) => setMovedAt(e.target.value)} className={inp} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[12px] font-medium text-muted">Reason / note {type === "adjustment" || type === "wastage" ? "" : "(optional)"}</span>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === "wastage" ? "e.g. damaged in cutting" : type === "adjustment" ? "e.g. stock count correction" : "optional"} className={inp} />
                  </label>
                </div>
              </div>

              <div className="rounded-card bg-surface p-5 shadow-card">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[14px] font-extrabold text-ink">Items</h3>
                  <button onClick={addLine} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel"><Plus size={14} /> Add item</button>
                </div>
                <div className="space-y-2.5">
                  {lines.map((l, i) => {
                    const it = itemById(l.item_id);
                    return (
                      <div key={i} className="grid grid-cols-12 items-center gap-2">
                        <div className="col-span-7">
                          <select value={l.item_id} onChange={(e) => setLine(i, { item_id: e.target.value })} className={inpSm}>
                            <option value="">Choose item…</option>
                            {items.map((it2) => <option key={it2.id} value={it2.id}>{it2.label} — {it2.balance} {it2.unit} in stock</option>)}
                          </select>
                        </div>
                        <div className="col-span-4">
                          <div className="flex items-center gap-1 rounded-xl2 border border-line bg-canvas px-2.5 py-2">
                            <input type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="Qty" className="w-full bg-transparent text-[13px] outline-none" />
                            <span className="text-[11px] text-hint">{it?.unit}</span>
                          </div>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}
                {okMsg && <p className="mt-3 text-[12.5px] font-medium text-[#166534]">{okMsg}</p>}
                <button onClick={post} disabled={saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl2 bg-ink px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50">
                  {saving && <Loader2 size={16} className="animate-spin" />} Record {active.label.toLowerCase()}
                </button>
              </div>
            </div>

            {/* recent */}
            <div className="rounded-card bg-surface p-5 shadow-card">
              <h3 className="mb-3 text-[14px] font-extrabold text-ink">Recent movements</h3>
              {moves.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-muted">No movements yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {moves.map((m) => {
                    const voided = (m.status as string) === "voided";
                    return (
                    <div key={m.id as string} className="rounded-xl2 border border-line/70 px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <button onClick={() => openDetail(m)} className="font-mono text-[12px] tnum text-ink underline decoration-dotted underline-offset-2 hover:text-salmon-strong">{m.movement_number as string}</button>
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-semibold text-muted">{voided ? "Voided" : TYPE_LABEL[m.type as string]}</span>
                          {!voided && can("inventory.adjust") && (
                            <button onClick={() => { setVoidMv({ id: m.id as string, number: m.movement_number as string }); setVoidReason(""); setVoidErr(""); }}
                              className="rounded-full border border-danger/40 px-2 py-0.5 text-[10.5px] font-semibold text-danger hover:bg-danger-soft">Void</button>
                          )}
                        </div>
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted">
                        {[(m.departments as { name?: string } | null)?.name, (m.employees as { name?: string } | null)?.name].filter(Boolean).join(" · ") || (m.reason as string) || "—"} · {when(m.moved_at as string)}
                      </div>
                    </div>
                  );})}
                </div>
              )}
            </div>
          </div>
        )}

        {holdings.length > 0 && (
          <div className="mt-5 rounded-card bg-surface p-5 shadow-card">
            <h3 className="mb-3 text-[14px] font-extrabold text-ink">What each department is holding</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(byDept).map(([dept, rows]) => (
                <div key={dept} className="rounded-xl2 border border-line/70 p-3.5">
                  <div className="mb-2 text-[13px] font-bold text-ink">{dept}</div>
                  <div className="space-y-1">
                    {rows.map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="text-muted">{r.item_label}</span>
                        <span className="whitespace-nowrap tnum font-semibold text-ink">{r.qty} {r.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {detailMv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => setDetailMv(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <IconChip Icon={ArrowLeftRight} size={38} />
                <div>
                  <h2 className="text-[16px] font-extrabold">{detailMv.movement_number as string}</h2>
                  <p className="text-[12px] text-muted">{TYPE_LABEL[detailMv.type as string]}{(detailMv.status as string) === "voided" ? " · Voided" : ""} · {when(detailMv.moved_at as string)}</p>
                </div>
              </div>
              <button onClick={() => setDetailMv(null)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>
            <div className="mb-3 space-y-0.5 text-[12.5px] text-muted">
              {(detailMv.departments as { name?: string } | null)?.name && <div>Department: <span className="font-medium text-ink">{(detailMv.departments as { name?: string }).name}</span></div>}
              {(detailMv.employees as { name?: string } | null)?.name && <div>Employee: <span className="font-medium text-ink">{(detailMv.employees as { name?: string }).name}</span></div>}
              {(detailMv.reason as string) && <div>Reason: <span className="font-medium text-ink">{detailMv.reason as string}</span></div>}
            </div>
            {detailLines === null ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted"><th className="px-2 py-2 font-semibold">Item</th><th className="px-2 py-2 text-right font-semibold">Quantity</th></tr></thead>
                <tbody>
                  {detailLines.map((r, i) => (
                    <tr key={i} className="border-b border-line/60 last:border-0"><td className="px-2 py-2 font-medium text-ink">{r.label}</td><td className="px-2 py-2 text-right tnum text-ink/80">{r.qty} <span className="text-[11px] text-muted">{r.unit}</span></td></tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {voidMv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !voidBusy && setVoidMv(null)}>
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-3"><IconChip Icon={Ban} size={38} /><h2 className="text-[16px] font-extrabold">Void {voidMv.number}</h2></div>
            <p className="text-[13px] text-muted">This reverses the stock this movement changed and marks it &ldquo;voided&rdquo;. The record is kept.</p>
            <label className="mt-4 block"><span className="mb-1 block text-[12px] font-medium text-muted">Reason (optional)</span>
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. wrong entry" className={inp} autoFocus /></label>
            {voidErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{voidErr}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setVoidMv(null)} disabled={voidBusy} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={voidMovement} disabled={voidBusy} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{voidBusy && <Loader2 size={15} className="animate-spin" />}Void movement</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
const inpSm = "w-full rounded-xl2 border border-line bg-surface px-2.5 py-2 text-[13px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
