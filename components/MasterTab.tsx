"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
};
export type Col = { key: string; label: string; render?: (row: Record<string, unknown>) => React.ReactNode };

export default function MasterTab({
  table, singular, cols, fields, selectQuery, canManage,
}: {
  table: string;
  singular: string;
  cols: Col[];
  fields: Field[];
  selectQuery?: string;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from(table).select(selectQuery ?? "*").order("name");
    setRows((data as unknown as Record<string, unknown>[]) ?? []);
    setLoading(false);
  }, [table, selectQuery]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    const f: Record<string, unknown> = { is_active: true };
    fields.forEach((x) => (f[x.key] = ""));
    setEditing(null); setForm(f); setError(""); setOpen(true);
  }
  function openEdit(row: Record<string, unknown>) {
    const f: Record<string, unknown> = { is_active: row.is_active ?? true };
    fields.forEach((x) => (f[x.key] = row[x.key] ?? ""));
    setEditing(row.id as string); setForm(f); setError(""); setOpen(true);
  }

  async function save() {
    for (const x of fields) {
      if (x.required && !String(form[x.key] ?? "").trim()) { setError(`${x.label} is required.`); return; }
    }
    if (!supabase) return;
    setSaving(true); setError("");
    const payload: Record<string, unknown> = { is_active: !!form.is_active };
    fields.forEach((x) => {
      let v = form[x.key];
      if (v === "") v = null;
      if (x.type === "number" && v != null) v = Number(v);
      payload[x.key] = v;
    });
    const res = editing
      ? await supabase.from(table).update(payload).eq("id", editing)
      : await supabase.from(table).insert(payload);
    setSaving(false);
    if (res.error) {
      setError(res.error.message.toLowerCase().includes("row-level")
        ? "You don't have permission to do this." : res.error.message);
      return;
    }
    setOpen(false); load();
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        {canManage && (
          <button onClick={openAdd}
            className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
            <Plus size={16} /> Add {singular.toLowerCase()}
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-muted">
            <Loader2 size={18} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center text-[13px] text-muted">
            No {singular.toLowerCase()} yet{canManage ? " — add your first one." : "."}
          </div>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                {cols.map((c) => <th key={c.key} className="px-5 py-3 font-semibold">{c.label}</th>)}
                <th className="px-5 py-3 font-semibold">Status</th>
                {canManage && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id as string} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                  {cols.map((c) => (
                    <td key={c.key} className="px-5 py-3 text-ink/90">
                      {c.render ? c.render(r) : ((r[c.key] as string) || "—")}
                    </td>
                  ))}
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      r.is_active ? "bg-success-soft text-[#166534]" : "bg-panel text-muted"}`}>
                      {r.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openEdit(r)}
                        className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] text-ink/70 hover:bg-panel">
                        <Pencil size={13} /> Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-[12px] text-muted">{rows.length} {singular.toLowerCase()}(s)</p>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !saving && setOpen(false)}>
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[17px] font-extrabold">{editing ? `Edit ${singular.toLowerCase()}` : `Add ${singular.toLowerCase()}`}</h2>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>

            <div className="space-y-3">
              {fields.map((x) => (
                <label key={x.key} className="block">
                  <span className="mb-1 block text-[12px] font-medium text-muted">{x.label}{x.required && " *"}</span>
                  {x.type === "select" ? (
                    <select value={(form[x.key] as string) ?? ""} onChange={(e) => setForm((f) => ({ ...f, [x.key]: e.target.value }))}
                      className="w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none focus:border-salmon-strong/50">
                      <option value="">Select…</option>
                      {x.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input type={x.type === "number" ? "number" : "text"} value={(form[x.key] as string) ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [x.key]: e.target.value }))}
                      className="w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50" />
                  )}
                </label>
              ))}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[12px] font-medium text-muted">Status</span>
                <button type="button" onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                    form.is_active ? "bg-success-soft text-[#166534]" : "bg-panel text-muted"}`}>
                  {form.is_active ? "Active" : "Inactive"}
                </button>
              </div>
            </div>

            {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={saving}
                className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {saving && <Loader2 size={15} className="animate-spin" />}{editing ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
