"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Pencil, X, Loader2, Trash2, Users } from "lucide-react";
import IconChip from "@/components/IconChip";
import { supabase } from "@/lib/supabase";

type Opt = { id: string; name: string };
type Emp = Record<string, unknown>;
type FormState = {
  name: string; guardian_name: string; dob: string; gender: string; cnic: string; phone: string;
  address: string; emergency_name: string; emergency_phone: string;
  department_id: string; designation_id: string; employment_type: string; join_date: string;
  pay_type: string; pay_amount: string; payment_method: string; bank_name: string; bank_account: string;
  is_active: boolean;
};
const EMPTY: FormState = {
  name: "", guardian_name: "", dob: "", gender: "", cnic: "", phone: "",
  address: "", emergency_name: "", emergency_phone: "",
  department_id: "", designation_id: "", employment_type: "", join_date: "",
  pay_type: "", pay_amount: "", payment_method: "", bank_name: "", bank_account: "",
  is_active: true,
};

const GENDERS = ["Male", "Female", "Other"];
const EMP_TYPES = ["Permanent", "Contract", "Daily-wage"];
const PAY_TYPES = ["Piece-rate", "Monthly salary", "Daily wage"];
const PAY_METHODS = ["Cash", "Bank"];

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
    const g = (k: string) => (e[k] as string) ?? "";
    setForm({
      name: g("name"), guardian_name: g("guardian_name"), dob: g("dob"), gender: g("gender"),
      cnic: g("cnic"), phone: g("phone"), address: g("address"),
      emergency_name: g("emergency_name"), emergency_phone: g("emergency_phone"),
      department_id: g("department_id"), designation_id: g("designation_id"),
      employment_type: g("employment_type"), join_date: g("join_date"),
      pay_type: g("pay_type"), pay_amount: e.pay_amount != null ? String(e.pay_amount) : "",
      payment_method: g("payment_method"), bank_name: g("bank_name"), bank_account: g("bank_account"),
      is_active: (e.is_active as boolean) ?? true,
    });
    setError(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!supabase) return;
    setSaving(true); setError("");
    const nn = (v: string) => (v.trim() === "" ? null : v.trim());
    const payload = {
      name: form.name.trim(), guardian_name: nn(form.guardian_name), dob: form.dob || null,
      gender: nn(form.gender), cnic: nn(form.cnic), phone: nn(form.phone), address: nn(form.address),
      emergency_name: nn(form.emergency_name), emergency_phone: nn(form.emergency_phone),
      department_id: form.department_id || null, designation_id: form.designation_id || null,
      employment_type: nn(form.employment_type), join_date: form.join_date || null,
      pay_type: nn(form.pay_type), pay_amount: form.pay_amount === "" ? null : Number(form.pay_amount),
      payment_method: nn(form.payment_method), bank_name: nn(form.bank_name), bank_account: nn(form.bank_account),
      is_active: form.is_active,
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
  const S = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
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
                <th className="px-5 py-3 font-semibold">Pay type</th>
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
                  <td className="px-5 py-3 text-ink/80">{(e.pay_type as string) || "—"}</td>
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
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-card bg-surface p-6 shadow-card" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <IconChip Icon={Users} size={38} />
                <h2 className="text-[17px] font-extrabold">{editing ? "Edit employee" : "Add employee"}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>

            <Section title="Personal">
              <div className="sm:col-span-2"><Lbl label="Full name *"><input value={form.name} onChange={S("name")} placeholder="Ahmed Raza" className={inp} /></Lbl></div>
              <Lbl label="Father / Husband name"><input value={form.guardian_name} onChange={S("guardian_name")} className={inp} /></Lbl>
              <Lbl label="Date of birth"><input type="date" value={form.dob} onChange={S("dob")} className={inp} /></Lbl>
              <Lbl label="Gender"><Pick value={form.gender} onChange={S("gender")} opts={GENDERS} /></Lbl>
              <Lbl label="CNIC"><input value={form.cnic} onChange={S("cnic")} placeholder="00000-0000000-0" className={inp} /></Lbl>
              <Lbl label="Phone"><input value={form.phone} onChange={S("phone")} placeholder="0300 1234567" className={inp} /></Lbl>
              <Lbl label="Emergency contact name"><input value={form.emergency_name} onChange={S("emergency_name")} className={inp} /></Lbl>
              <Lbl label="Emergency contact phone"><input value={form.emergency_phone} onChange={S("emergency_phone")} className={inp} /></Lbl>
              <div className="sm:col-span-2"><Lbl label="Home address"><input value={form.address} onChange={S("address")} className={inp} /></Lbl></div>
            </Section>

            <Section title="Employment">
              <Lbl label="Department"><Pick value={form.department_id} onChange={S("department_id")} opts={departments.map((d) => ({ value: d.id, label: d.name }))} /></Lbl>
              <Lbl label="Designation"><Pick value={form.designation_id} onChange={S("designation_id")} opts={designations.map((d) => ({ value: d.id, label: d.name }))} /></Lbl>
              <Lbl label="Employment type"><Pick value={form.employment_type} onChange={S("employment_type")} opts={EMP_TYPES} /></Lbl>
              <Lbl label="Join date"><input type="date" value={form.join_date} onChange={S("join_date")} className={inp} /></Lbl>
              <Lbl label="Status">
                <button type="button" onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  className={`w-full rounded-xl2 border px-3.5 py-2.5 text-left text-[14px] ${form.is_active ? "border-success/40 bg-success-soft text-[#166534]" : "border-line bg-canvas text-muted"}`}>
                  {form.is_active ? "Active" : "Inactive"}
                </button>
              </Lbl>
            </Section>

            <Section title="Pay">
              <Lbl label="Pay type"><Pick value={form.pay_type} onChange={S("pay_type")} opts={PAY_TYPES} /></Lbl>
              {(form.pay_type === "Monthly salary" || form.pay_type === "Daily wage") && (
                <Lbl label={form.pay_type === "Monthly salary" ? "Monthly salary (Rs)" : "Daily wage (Rs)"}>
                  <input type="number" value={form.pay_amount} onChange={S("pay_amount")} placeholder="0" className={inp} />
                </Lbl>
              )}
              <Lbl label="Payment method"><Pick value={form.payment_method} onChange={S("payment_method")} opts={PAY_METHODS} /></Lbl>
              {form.payment_method === "Bank" && (
                <>
                  <Lbl label="Bank name"><input value={form.bank_name} onChange={S("bank_name")} className={inp} /></Lbl>
                  <Lbl label="Account number"><input value={form.bank_account} onChange={S("bank_account")} className={inp} /></Lbl>
                </>
              )}
            </Section>

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
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-hint">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}
function Pick({ value, onChange, opts }: {
  value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  opts: (string | { value: string; label: string })[];
}) {
  return (
    <select value={value} onChange={onChange} className={inp}>
      <option value="">—</option>
      {opts.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}
