"use client";
/* FACTORY STAFF — who works here, at what rate, and what is owed.
 *
 * The rate lives on the person because most men have a standing one; the
 * entry form fills it in and it stays editable per job, since a harder cut
 * is paid more.
 *
 * Pending is shown here too — "who do I owe" is the question this list gets
 * opened for, and sending someone to another screen for it is how a second
 * sheet starts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Plus, Loader2, Download, Printer } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, printTable, type ExportTable } from "@/lib/export";

type Staff = { id: string; code: string; name: string; phone: string | null;
               is_active: boolean; rate: number | null; employment_type: string | null;
               join_date: string | null; dept_code: string; department: string;
               earned: number; pending: number };

const DEPTS = [["CUT", "Cutting"], ["MFSU", "Stitching unit"], ["OVL", "Overlock"],
               ["FLT", "Flatlock"], ["SGL", "Singlelock"], ["CLIP", "Clipping"],
               ["QAQC", "Checking"], ["PACK", "Packing"]];
const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();

export default function StaffPage() {
  const { can } = usePermissions();
  const canDo = can(["process.manage", "production.entry"]);

  const [rows, setRows] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [show, setShow] = useState<"active" | "all">("active");

  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Staff | null>(null);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [phone, setPhone] = useState("");
  const [cnic, setCnic] = useState("");
  const [dCode, setDCode] = useState("CUT");
  const [emp, setEmp] = useState("casual");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fErr, setFErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("v_factory_staff").select("*").order("code");
    if (error) setErr(error.message);
    setRows((data as Staff[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    if (show === "active" && !r.is_active) return false;
    if (dept !== "all" && r.dept_code !== dept) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [r.name, r.code, r.phone, r.department].some((x) => String(x ?? "").toLowerCase().includes(t));
  }), [rows, q, dept, show]);

  const owed = view.reduce((a, r) => a + Number(r.pending || 0), 0);

  function openAdd() {
    setOpen(true); setEdit(null); setName(""); setRate(""); setPhone("");
    setCnic(""); setDCode("CUT"); setEmp("casual"); setActive(true); setFErr("");
  }
  function openEdit(r: Staff) {
    setOpen(true); setEdit(r); setName(r.name);
    setRate(r.rate == null ? "" : String(r.rate));
    setPhone(r.phone ?? ""); setCnic(""); setDCode(r.dept_code);
    setEmp(r.employment_type ?? "casual"); setActive(r.is_active); setFErr("");
  }

  async function save() {
    if (!supabase) return;
    setFErr("");
    if (!name.trim()) { setFErr("Give the name."); return; }
    setBusy(true);
    const { error } = edit
      ? await supabase.rpc("update_factory_employee", {
          p_id: edit.id, p_name: name.trim(),
          p_rate: rate === "" ? null : parseFloat(rate),
          p_phone: phone.trim() || null, p_active: active,
        })
      : await supabase.rpc("add_factory_employee", {
          p_name: name.trim(), p_department_code: dCode,
          p_rate: rate === "" ? null : parseFloat(rate),
          p_phone: phone.trim() || null, p_cnic: cnic.trim() || null,
          p_employment: emp,
        });
    setBusy(false);
    if (error) { setFErr(error.message); return; }
    setOpen(false); load();
  }

  const table = (): ExportTable => ({
    title: "Factory Staff",
    headers: ["Code", "Name", "Department", "Rate", "Phone", "Type", "Earned", "Pending", "Status"],
    rows: view.map((r) => [r.code, r.name, r.department, r.rate ?? "", r.phone ?? "",
      r.employment_type ?? "", r.earned || "", r.pending || "", r.is_active ? "active" : "inactive"]),
  });

  return (
    <>
      <Topbar title="Factory Staff" subtitle="Who works here, their rate, and what is owed" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">People</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{view.length}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Owed right now</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{rs(owed)}</p>
          </div>
          <div className="rounded-card bg-success-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">On a set rate</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">
              {view.filter((r) => r.rate != null).length}
            </p>
            <p className="mt-1 text-[12px] text-ink/60">of {view.length}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code, phone…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <select value={dept} onChange={(e) => setDept(e.target.value)}
            className="rounded-full border border-line bg-surface px-3 py-2 text-[12px] outline-none">
            <option value="all">All departments</option>
            {DEPTS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
          <button onClick={() => setShow(show === "active" ? "all" : "active")}
            className={`rounded-full px-3 py-2 text-[12px] font-semibold transition ${show === "all" ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
            {show === "all" ? "Showing inactive" : "Active only"}
          </button>
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <button onClick={() => printTable(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Printer size={13} /> Print</button>
          {canDo && (
            <button onClick={openAdd} className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
              <Plus size={15} /> Add employee
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Users size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">No staff yet</p>
            <p className="mt-1 text-[13px] text-muted">Add the men who cut, stitch and pack — their names then appear in every entry form.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">Name</th>
                <th className="px-4 py-3 font-bold">Department</th>
                <th className="px-4 py-3 text-right font-bold">Rate</th>
                <th className="px-4 py-3 font-bold">Phone</th>
                <th className="px-4 py-3 text-right font-bold">Earned</th>
                <th className="px-4 py-3 text-right font-bold">Pending</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} className={`border-b border-line/60 last:border-0 ${r.is_active ? "" : "opacity-50"} ${ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.name}</span>
                      <span className="block text-[11px] text-hint">
                        {r.code}{r.employment_type ? ` · ${r.employment_type}` : ""}
                        {!r.is_active && " · inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink/80">{r.department}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">
                      {r.rate == null ? <span className="text-hint">not set</span> : n(r.rate)}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-muted">{r.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{r.earned ? rs(r.earned) : "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-[15px] font-extrabold text-ink">
                      {r.pending ? rs(r.pending) : <span className="text-[12px] font-semibold text-hint">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canDo && (
                        <button onClick={() => openEdit(r)}
                          className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink/75 hover:bg-panel">Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit ${edit.name}` : "Add employee"}>
        <Field label="Name *">
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Aslam" className={inp} />
        </Field>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Department">
            <select value={dCode} onChange={(e) => setDCode(e.target.value)} disabled={!!edit} className={inp}>
              {DEPTS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </select>
          </Field>
          <Field label="Rate per piece">
            <input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)}
              placeholder="12 or 14.5" className={inp} />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} />
          </Field>
          {!edit && (
            <Field label="Type">
              <select value={emp} onChange={(e) => setEmp(e.target.value)} className={inp}>
                <option value="casual">Casual</option>
                <option value="permanent">Permanent</option>
                <option value="contract">Contract</option>
              </select>
            </Field>
          )}
          {!edit && (
            <Field label="CNIC (optional)">
              <input value={cnic} onChange={(e) => setCnic(e.target.value)} className={inp} />
            </Field>
          )}
        </div>

        {edit && (
          <div className="mt-4 flex items-center justify-between rounded-xl2 border border-line p-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">{active ? "Active" : "Inactive"}</p>
              <p className="mt-0.5 text-[12px] text-muted">
                {active ? "Appears in every entry form." : "Hidden from the forms. His past work stays."}
              </p>
            </div>
            <button onClick={() => setActive((v) => !v)}
              className={`rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition ${active ? "border border-line text-ink/75 hover:bg-panel" : "bg-ink text-white"}`}>
              {active ? "Make inactive" : "Make active"}
            </button>
          </div>
        )}

        <p className="mt-3 text-[12px] text-hint">
          The rate is a default the entry form fills in. It stays editable per job — a harder cut is paid more.
        </p>
        {fErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{fErr}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={save} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} {edit ? "Save" : "Add employee"}
          </button>
        </div>
      </Modal>
    </>
  );
}
