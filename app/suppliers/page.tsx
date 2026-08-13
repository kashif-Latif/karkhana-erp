"use client";
import { useEffect, useState, useCallback } from "react";
import Topbar from "@/components/Topbar";
import IconChip from "@/components/IconChip";
import { Truck, Plus, Search, Pencil, X, Loader2, Building2, Trash2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Supplier = {
  id: string;
  code: string | null;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

const EMPTY = {
  company_name: "", contact_person: "", phone: "", email: "",
  address: "", tax_number: "", notes: "", is_active: true,
};

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("suppliers").select("*").order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    if (supabase) {
      supabase.rpc("has_permission", { p_permission_code: "suppliers.manage" })
        .then(({ data }) => setCanManage(!!data));
    }
  }, [load]);

  function openAdd() { setEditing(null); setForm({ ...EMPTY }); setError(""); setOpen(true); }
  function openEdit(s: Supplier) {
    setEditing(s.id);
    setForm({
      company_name: s.company_name, contact_person: s.contact_person ?? "",
      phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "",
      tax_number: s.tax_number ?? "", notes: s.notes ?? "", is_active: s.is_active,
    });
    setError(""); setOpen(true);
  }

  async function save() {
    if (!form.company_name.trim()) { setError("Company name is required."); return; }
    if (!supabase) return;
    setSaving(true); setError("");
    const payload = { ...form, company_name: form.company_name.trim() };
    const res = editing
      ? await supabase.from("suppliers").update(payload).eq("id", editing)
      : await supabase.from("suppliers").insert(payload);
    setSaving(false);
    if (res.error) {
      setError(res.error.message.toLowerCase().includes("row-level")
        ? "You don't have permission to do this."
        : res.error.message);
      return;
    }
    setOpen(false);
    load();
  }

  async function remove() {
    if (!supabase || !editing) return;
    if (!window.confirm("Delete this supplier permanently? This cannot be undone.")) return;
    setSaving(true); setError("");
    const res = await supabase.from("suppliers").delete().eq("id", editing);
    setSaving(false);
    if (res.error) {
      const fk = res.error.code === "23503" || res.error.message.toLowerCase().includes("foreign key") || res.error.message.toLowerCase().includes("violat");
      setError(fk ? "Can't delete — this supplier is used in other records. Set it to Inactive instead." : res.error.message);
      return;
    }
    setOpen(false); load();
  }

  const filtered = rows.filter((r) =>
    (r.company_name + (r.code ?? "") + (r.contact_person ?? "") + (r.phone ?? ""))
      .toLowerCase().includes(search.toLowerCase()));

  const field = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <Topbar title="Suppliers" subtitle="Supplier master & purchase history" />
      <div className="px-6 pb-10">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">
            Connect Supabase to manage suppliers.
          </div>
        ) : (
          <>
            {/* toolbar */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2">
                <Search size={15} className="text-hint" />
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search suppliers…"
                  className="w-44 bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-64"
                />
              </div>
              {canManage && (
                <button onClick={openAdd}
                  className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
                  <Plus size={16} /> Add supplier
                </button>
              )}
            </div>

            {/* table */}
            <div className="overflow-hidden rounded-card bg-surface shadow-card">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-muted">
                  <Loader2 size={18} className="animate-spin" /> Loading…
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <IconChip Icon={Building2} size={44} />
                  <p className="text-[14px] font-semibold text-ink">No suppliers yet</p>
                  <p className="text-[12.5px] text-muted">
                    {canManage ? "Add your first supplier to get started." : "Nothing here yet."}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-semibold">Code</th>
                      <th className="px-5 py-3 font-semibold">Company</th>
                      <th className="px-5 py-3 font-semibold">Contact</th>
                      <th className="px-5 py-3 font-semibold">Phone</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      {canManage && <th className="px-5 py-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.id} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                        <td className="px-5 py-3 font-mono text-[12px] tnum text-muted">{s.code}</td>
                        <td className="px-5 py-3 font-semibold text-ink">{s.company_name}</td>
                        <td className="px-5 py-3 text-ink/80">{s.contact_person || "—"}</td>
                        <td className="px-5 py-3 tnum text-ink/80">{s.phone || "—"}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            s.is_active ? "bg-success-soft text-[#166534]" : "bg-panel text-muted"}`}>
                            {s.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-5 py-3 text-right">
                            <button onClick={() => openEdit(s)}
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
            <p className="mt-3 text-[12px] text-muted">{filtered.length} supplier(s)</p>
          </>
        )}
      </div>

      {/* add/edit modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !saving && setOpen(false)}>
          <div className="w-full max-w-lg rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <IconChip Icon={Truck} size={38} />
                <h2 className="text-[17px] font-extrabold">{editing ? "Edit supplier" : "Add supplier"}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted hover:bg-panel">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <L label="Company name *"><Inp value={form.company_name} onChange={field("company_name")} placeholder="ABC Textiles" /></L>
              <L label="Contact person"><Inp value={form.contact_person} onChange={field("contact_person")} placeholder="Ali Khan" /></L>
              <L label="Phone"><Inp value={form.phone} onChange={field("phone")} placeholder="0300 1234567" /></L>
              <L label="Email"><Inp value={form.email} onChange={field("email")} placeholder="orders@abc.com" /></L>
              <L label="NTN / Tax no."><Inp value={form.tax_number} onChange={field("tax_number")} placeholder="1234567-8" /></L>
              <L label="Status">
                <button type="button" onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  className={`w-full rounded-xl2 border px-3.5 py-2.5 text-left text-[14px] ${
                    form.is_active ? "border-success/40 bg-success-soft text-[#166534]" : "border-line bg-canvas text-muted"}`}>
                  {form.is_active ? "Active" : "Inactive"}
                </button>
              </L>
              <div className="sm:col-span-2">
                <L label="Address"><Inp value={form.address} onChange={field("address")} placeholder="Street, city" /></L>
              </div>
              <div className="sm:col-span-2">
                <L label="Notes"><Inp value={form.notes} onChange={field("notes")} placeholder="Optional" /></L>
              </div>
            </div>

            {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              {editing && (
                <button onClick={remove} disabled={saving}
                  className="mr-auto flex items-center gap-1 rounded-xl2 border border-danger/40 px-3 py-2.5 text-[13px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-50">
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button onClick={() => setOpen(false)} disabled={saving}
                className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {saving && <Loader2 size={15} className="animate-spin" />}
                {editing ? "Save changes" : "Add supplier"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
function Inp(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props}
    className="w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50" />;
}
