"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, X, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";

type Group = { id: string; name: string; has_category: boolean; has_color: boolean; has_size: boolean };
type Opt = { id: string; name: string };
type CatOpt = Opt & { group_id: string };
type Unit = { id: string; name: string; symbol: string | null };
type Item = Record<string, unknown>;

type FormState = {
  group_id: string; category_id: string; color_id: string;
  size_id: string; unit_id: string; name: string; is_active: boolean;
};
const EMPTY: FormState = { group_id: "", category_id: "", color_id: "", size_id: "", unit_id: "", name: "", is_active: true };

export default function ItemsTab({ canManage }: { canManage: boolean }) {
  const confirm = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [categories, setCategories] = useState<CatOpt[]>([]);
  const [colors, setColors] = useState<Opt[]>([]);
  const [sizes, setSizes] = useState<Opt[]>([]);
  const [groupUnits, setGroupUnits] = useState<Record<string, Unit[]>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadItems = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("material_items")
      .select("*, material_groups(name), material_categories(name), colors(name), sizes(name), units(symbol)")
      .order("created_at", { ascending: false });
    setItems((data as unknown as Item[]) ?? []);
  }, []);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    (async () => {
      const [g, c, col, sz, gu] = await Promise.all([
        supabase.from("material_groups").select("id,name,has_category,has_color,has_size").eq("is_active", true).order("name"),
        supabase.from("material_categories").select("id,name,group_id").eq("is_active", true).order("name"),
        supabase.from("colors").select("id,name").eq("is_active", true).order("name"),
        supabase.from("sizes").select("id,name").eq("is_active", true).order("sort_order"),
        supabase.from("group_units").select("group_id, units(id,name,symbol)"),
      ]);
      setGroups((g.data as unknown as Group[]) ?? []);
      setCategories((c.data as unknown as CatOpt[]) ?? []);
      setColors((col.data as unknown as Opt[]) ?? []);
      setSizes((sz.data as unknown as Opt[]) ?? []);
      const map: Record<string, Unit[]> = {};
      ((gu.data as unknown as { group_id: string; units: Unit }[]) ?? []).forEach((r) => {
        (map[r.group_id] ||= []).push(r.units);
      });
      setGroupUnits(map);
      await loadItems();
      setLoading(false);
    })();
  }, [loadItems]);

  const grp = groups.find((g) => g.id === form.group_id);
  const catOpts = categories.filter((c) => c.group_id === form.group_id);
  const unitOpts = groupUnits[form.group_id] ?? [];

  function openAdd() { setEditing(null); setForm({ ...EMPTY }); setError(""); setOpen(true); }
  function openEdit(it: Item) {
    setEditing(it.id as string);
    setForm({
      group_id: (it.group_id as string) ?? "", category_id: (it.category_id as string) ?? "",
      color_id: (it.color_id as string) ?? "", size_id: (it.size_id as string) ?? "",
      unit_id: (it.unit_id as string) ?? "", name: (it.name as string) ?? "", is_active: (it.is_active as boolean) ?? true,
    });
    setError(""); setOpen(true);
  }
  function pickGroup(id: string) {
    const units = groupUnits[id] ?? [];
    setForm((f) => ({ ...f, group_id: id, category_id: "", color_id: "", size_id: "", unit_id: units.length === 1 ? units[0].id : "" }));
  }

  async function save() {
    if (!form.group_id) { setError("Pick a material first."); return; }
    if (grp?.has_category && !form.category_id) { setError("Category is required."); return; }
    if (grp?.has_color && !form.color_id) { setError("Colour is required."); return; }
    if (grp?.has_size && !form.size_id) { setError("Size is required."); return; }
    if (!form.unit_id) { setError("Unit is required."); return; }
    if (!supabase) return;
    setSaving(true); setError("");
    const payload = {
      group_id: form.group_id,
      category_id: grp?.has_category ? form.category_id : null,
      color_id: grp?.has_color ? form.color_id : null,
      size_id: grp?.has_size ? form.size_id : null,
      unit_id: form.unit_id,
      name: form.name.trim() || null,
      is_active: form.is_active,
    };
    const res = editing
      ? await supabase.from("material_items").update(payload).eq("id", editing)
      : await supabase.from("material_items").insert(payload);
    setSaving(false);
    if (res.error) { setError(res.error.message.toLowerCase().includes("row-level") ? "You don't have permission to do this." : res.error.message); return; }
    setOpen(false); await loadItems();
  }

  async function remove() {
    if (!supabase || !editing) return;
    if (!(await confirm({ title: "Delete this item?",
                          body: "This cannot be undone.", confirmLabel: "Delete" }))) return;
    setSaving(true); setError("");
    const res = await supabase.from("material_items").delete().eq("id", editing);
    setSaving(false);
    if (res.error) {
      const fk = res.error.code === "23503" || res.error.message.toLowerCase().includes("foreign key") || res.error.message.toLowerCase().includes("violat");
      setError(fk ? "Can't delete — this item is used in other records. Set it to Inactive instead." : res.error.message);
      return;
    }
    setOpen(false); await loadItems();
  }

  const rel = (it: Item, key: string) => (it[key] as { name?: string } | null)?.name || "—";
  const unitOf = (it: Item) => (it.units as { symbol?: string } | null)?.symbol || "—";

  return (
    <div>
      <div className="mb-3 flex justify-end">
        {canManage && (
          <button onClick={openAdd} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
            <Plus size={16} /> Add item
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="py-14 text-center text-[13px] text-muted">No items yet{canManage ? " — add your first one." : "."}</div>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-semibold">Code</th>
                <th className="px-5 py-3 font-semibold">Material</th>
                <th className="px-5 py-3 font-semibold">Category</th>
                <th className="px-5 py-3 font-semibold">Colour</th>
                <th className="px-5 py-3 font-semibold">Size</th>
                <th className="px-5 py-3 font-semibold">Unit</th>
                {canManage && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id as string} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                  <td className="px-5 py-3 font-mono text-[12px] tnum text-muted">{it.code as string}</td>
                  <td className="px-5 py-3 font-semibold text-ink">{rel(it, "material_groups")}</td>
                  <td className="px-5 py-3 text-ink/80">{rel(it, "material_categories")}</td>
                  <td className="px-5 py-3 text-ink/80">{rel(it, "colors")}</td>
                  <td className="px-5 py-3 text-ink/80">{rel(it, "sizes")}</td>
                  <td className="px-5 py-3 text-ink/80">{unitOf(it)}</td>
                  {canManage && (
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openEdit(it)} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] text-ink/70 hover:bg-panel">
                        <Pencil size={13} /> Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <p className="mt-3 text-[12px] text-muted">{items.length} item(s)</p>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !saving && setOpen(false)}>
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[17px] font-extrabold">{editing ? "Edit item" : "Add item"}</h2>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>

            <div className="space-y-3">
              <Sel label="Material *" value={form.group_id} onChange={pickGroup}
                options={groups.map((g) => ({ value: g.id, label: g.name }))} placeholder="Choose a material…" />

              {grp?.has_category && (
                <Sel label="Category *" value={form.category_id} onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
                  options={catOpts.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose a category…" />
              )}
              {grp?.has_color && (
                <Sel label="Colour *" value={form.color_id} onChange={(v) => setForm((f) => ({ ...f, color_id: v }))}
                  options={colors.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose a colour…" />
              )}
              {grp?.has_size && (
                <Sel label="Size *" value={form.size_id} onChange={(v) => setForm((f) => ({ ...f, size_id: v }))}
                  options={sizes.map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose a size…" />
              )}
              {form.group_id && (
                <Sel label="Received in (unit) *" value={form.unit_id} onChange={(v) => setForm((f) => ({ ...f, unit_id: v }))}
                  options={unitOpts.map((u) => ({ value: u.id, label: u.symbol ? `${u.name} (${u.symbol})` : u.name }))} placeholder="Choose a unit…" />
              )}
            </div>

            {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              {editing && (
                <button onClick={remove} disabled={saving}
                  className="mr-auto flex items-center gap-1 rounded-xl2 border border-danger/40 px-3 py-2.5 text-[13px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-50">
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button onClick={() => setOpen(false)} disabled={saving} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {saving && <Loader2 size={15} className="animate-spin" />}{editing ? "Save" : "Add item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Sel({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none focus:border-salmon-strong/50">
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
