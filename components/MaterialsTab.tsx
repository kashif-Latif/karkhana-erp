"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Plus, Pencil, Loader2, X, Check } from "lucide-react";

type Unit = { id: string; name: string; symbol: string };
type Group = { id: string; code?: string; name: string; has_category: boolean; has_color: boolean; has_size: boolean; units: { id: string; symbol: string }[] };

export default function MaterialsTab({ canManage, family, clothGroups }:
  { canManage: boolean; family?: "cloth" | "other"; clothGroups?: string[] }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState<null | { id?: string }>(null);
  const [name, setName] = useState("");
  const [hasCat, setHasCat] = useState(false);
  const [hasCol, setHasCol] = useState(false);
  const [hasSize, setHasSize] = useState(false);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [g, u] = await Promise.all([
      supabase.from("material_groups").select("id,code,name,has_category,has_color,has_size, group_units(unit_id, units(id,symbol))").eq("is_active", true).order("name"),
      supabase.from("units").select("id,name,symbol").eq("is_active", true).order("name"),
    ]);
    const list = ((g.data as unknown as Record<string, unknown>[]) ?? []).map((r) => {
      const gu = (r.group_units as { units: { id: string; symbol: string } | null }[]) ?? [];
      return {
        id: r.id as string, code: r.code as string, name: r.name as string,
        has_category: !!r.has_category, has_color: !!r.has_color, has_size: !!r.has_size,
        units: gu.map((x) => x.units).filter(Boolean) as { id: string; symbol: string }[],
      };
    });
    setGroups(list);
    setUnits((u.data as Unit[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openAdd() { setModal({}); setName(""); setHasCat(false); setHasCol(false); setHasSize(false); setUnitIds([]); setErr(""); }
  function openEdit(g: Group) { setModal({ id: g.id }); setName(g.name); setHasCat(g.has_category); setHasCol(g.has_color); setHasSize(g.has_size); setUnitIds(g.units.map((x) => x.id)); setErr(""); }
  function toggleUnit(id: string) { setUnitIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); }

  async function save() {
    setErr("");
    if (!supabase) return;
    if (!name.trim()) { setErr("Enter a material name."); return; }
    if (unitIds.length === 0) { setErr("Choose at least one unit."); return; }
    setSaving(true);
    const args = { p_name: name.trim(), p_has_category: hasCat, p_has_color: hasCol, p_has_size: hasSize, p_unit_ids: unitIds };
    const { error } = modal?.id
      ? await supabase.rpc("update_material_group", { p_id: modal.id, ...args })
      : await supabase.rpc("create_material_group", args);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setModal(null); load();
  }

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">Each material carries its own rules. Turn an attribute on and it appears when you add items of that material.{!canManage && " (View only — ask an admin to change these.)"}</p>
        {canManage && <button onClick={openAdd} className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white"><Plus size={15} /> Add material</button>}
      </div>

      <div className="space-y-3">
        {groups
          .filter((g) => {
            const cloth = clothGroups ?? ["FAB"];
            if (!family) return true;
            return family === "cloth" ? cloth.includes(g.code ?? "") : !cloth.includes(g.code ?? "");
          })
          .map((g) => (
          <div key={g.id} className="rounded-card bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[16px] font-extrabold text-ink">{g.name}</h3>
                  {/* The material's own code. Every item created under it inherits
                      this prefix, so seeing FAB here explains where MAT codes and
                      the recipes get their family from. */}
                  {g.code && <span className="rounded-full bg-panel px-2 py-0.5 font-mono text-[11px] font-semibold text-muted">{g.code}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
                  Received in
                  {g.units.length ? g.units.map((u) => <span key={u.id} className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-semibold normal-case text-ink/70">{u.symbol}</span>) : <span className="text-hint">—</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {([["has_category", "Category"], ["has_color", "Colour"], ["has_size", "Size"]] as const).map(([k, label]) => {
                  const on = g[k as keyof Group] as boolean;
                  return <span key={k} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${on ? "bg-success-soft text-[#166534]" : "bg-panel text-muted"}`}>{on ? <Check size={13} /> : <span className="text-hint">—</span>} {label}</span>;
                })}
                {canManage && <button onClick={() => openEdit(g)} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel"><Pencil size={13} /> Edit</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !saving && setModal(null)}>
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-extrabold">{modal.id ? "Edit material" : "Add material"}</h2>
              <button onClick={() => setModal(null)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>

            <label className="block text-[12px] font-medium text-muted">Material name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Elastic Band" className="mt-1.5 w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint" autoFocus />

            <p className="mt-4 text-[12px] font-medium text-muted">This material is tracked by:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {([["cat", hasCat, setHasCat, "Category"], ["col", hasCol, setHasCol, "Colour"], ["size", hasSize, setHasSize, "Size"]] as const).map(([key, val, setter, label]) => (
                <button key={key} type="button" onClick={() => setter(!val)} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${val ? "bg-ink text-white" : "bg-panel text-muted hover:text-ink"}`}>{val ? "✓ " : ""}{label}</button>
              ))}
            </div>

            <p className="mt-4 text-[12px] font-medium text-muted">Received in (units): *</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {units.map((u) => {
                const on = unitIds.includes(u.id);
                return <button key={u.id} type="button" onClick={() => toggleUnit(u.id)} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${on ? "bg-ink text-white" : "bg-panel text-muted hover:text-ink"}`}>{on ? "✓ " : ""}{u.symbol} · {u.name}</button>;
              })}
            </div>

            {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(null)} disabled={saving} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />}{modal.id ? "Save changes" : "Add material"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
