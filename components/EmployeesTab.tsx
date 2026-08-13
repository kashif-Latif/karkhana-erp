"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Pencil, X, Loader2, Trash2, Users } from "lucide-react";
import IconChip from "@/components/IconChip";
import { supabase } from "@/lib/supabase";

type Opt = { id: string; name: string };
type Emp = Record<string, unknown>;
type FormState = { name: string; department_id: string; designation_id: string; phone: string; cnic: string; join_date: string; is_active: boolean };
const EMPTY: FormState = { name: "", department_id: "", designation_id: "", phone: "", cnic: "", join_date: "", is_active: true };

export default function EmployeesTab({ canManage, departments, designations }: {
  canManage: boolean; departments: Opt[]; designations: Opt[];
}) {
  const [rows, setRows] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("employees")
      .select("*, departments(name), designations(name)")
      .order("created_at", { ascending: false });
    setRows((data as unknown as Emp[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditing(null); setForm({ ...EMPTY }); setError(""); setOpen(true); }
  function openEdit(e: Emp) {
    setEditing(e.id as string);
    setForm({
      name: (e.name as string) ?? "", department_id: (e.department_id as string) ?? "",
      designation_id: (e.designation_id as string) ?? "", phone: (e.phone as string) ?? "",
      cnic: (e.cnic as string) ?? "", join_date: (e.join_date as string) ?? "", is_active: (e.is_active as boolean) ?? true,
    });
    setError(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!supabase) return;
    setSaving(true); setError("");
    const payload = {
      name: form.name.trim(),
      department_id: form.department_id || null,
      designation_id: form.designation_id || null,
      phone: form.phone || null, cnic: form.cnic || null,
      join_date: form.join_date || null, is_active: form.is_active,
    };
    const res = editing
      ? await supabase.from("employees").update(payload).eq("id", editing)
      : await supabase.from("employees").insert(payload);
    setSaving(false);
    if (res.error) { setError(res.error.message.toLowerCase().includes("row-level") ? "You don't have permission to do this." : res.error.message); return; }
    setOpen(false); load();
  }
  async function remove() {
    if (!supabase || !editing) return;
    if (!window.confirm("Delete this employee permanently? This cannot be undone.")) return;
    setSaving(true); setError("");
    const res = await supabase.from("employees").delete().eq("id", editing);
    setSaving(false);
    if (res.error) {
      const fk = res.error.code === "23503" || res.error.message.toLowerCase().includes("violat") || res.error.message.toLowerCase().includes("foreign key");
      setError(fk ? "Can't delete — this employee is used in other records. Set them Inactive instead." : res.error.message);
      return;
    }
    setOpen(false); load();
  }

  const filtered = rows.filter((r) =>
    ((r.name as string) + " " + ((r.code as string) || "") + " " + ((r.phone as string) || "")).toLowerCase().includes(search.toLowerCase()));
  const rel = (r: Emp, k: string) => (r[k] as { name?: string } | null)?.name || "—";
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2">
          <Search size={15} className="text-hint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…"
            className="w-44 bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-64" />
        </div>
        {canManage && (
          <button onClick={openAdd} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
            <Plus size={16} /> Add employee
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <IconChip Icon={Users} size={44} />
            <p className="text-[14px] font-semibold text-ink">No employees yet</p>
            <p className="text-[12.5px] text-muted">{canManage ? "Add your first employee." : "Nothing here yet."}</p>
          </div>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-semibold">Code</th>
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Department</th>
                <th className="px-5 py-3 font-semibold">Designation</th>
                <th className="px-5 py-3 font-semibold">Phone</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                {canManage && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id as string} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                  <td className="px-5 py-3 font-mono text-[12px] tnum text-muted">{e.code as string}</td>
                  <td className="px-5 py-3 font-semibold text-ink">{e.name as string}</td>
                  <td className="px-5 py-3 text-ink/80">{rel(e, "departments")}</td>
                  <td className="px-5 py-3 text-ink/80">{rel(e, "designations")}</td>
                  <td className="px-5 py-3 tnum text-ink/80">{(e.phone as string) || "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${e.is_active ? "bg-success-soft text-[#166534]" : "bg-panel text-muted"}`}>
                      {e.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openEdit(e)} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] text-ink/70 hover:bg-panel">
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
      <p className="mt-3 text-[12px] text-muted">{filtered.length} employee(s)</p>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !saving && setOpen(false)}>
          <div className="w-full max-w-lg rounded-card bg-surface p-6 shadow-card" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <IconChip Icon={Users} size={38} />
                <h2 className="text-[17px] font-extrabold">{editing ? "Edit employee" : "Add employee"}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Lbl label="Full name *"><input value={form.name} onChange={set("name")} placeholder="Ahmed Raza" className={inp} /></Lbl>
              </div>
              <Lbl label="Department">
                <select value={form.department_id} onChange={set("department_id")} className={inp}>
                  <option value="">—</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Lbl>
              <Lbl label="Designation">
                <select value={form.designation_id} onChange={set("designation_id")} className={inp}>
                  <option value="">—</option>
                  {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Lbl>
              <Lbl label="Phone"><input value={form.phone} onChange={set("phone")} placeholder="0300 1234567" className={inp} /></Lbl>
              <Lbl label="CNIC"><input value={form.cnic} onChange={set("cnic")} placeholder="00000-0000000-0" className={inp} /></Lbl>
              <Lbl label="Join date"><input type="date" value={form.join_date} onChange={set("join_date")} className={inp} /></Lbl>
              <Lbl label="Status">
                <button type="button" onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  className={`w-full rounded-xl2 border px-3.5 py-2.5 text-left text-[14px] ${form.is_active ? "border-success/40 bg-success-soft text-[#166534]" : "border-line bg-canvas text-muted"}`}>
                  {form.is_active ? "Active" : "Inactive"}
                </button>
              </Lbl>
            </div>

            {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              {editing && (
                <button onClick={remove} disabled={saving} className="mr-auto flex items-center gap-1 rounded-xl2 border border-danger/40 px-3 py-2.5 text-[13px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-50">
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button onClick={() => setOpen(false)} disabled={saving} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {saving && <Loader2 size={15} className="animate-spin" />}{editing ? "Save changes" : "Add employee"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
function Lbl({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>{children}</label>;
}
