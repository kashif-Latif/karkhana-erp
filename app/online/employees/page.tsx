"use client";
/* The Hub's own people.
 *
 * WHY THIS LIVES IN THE DEPARTMENT AND NOT IN ADMINISTRATION
 *   Each business has its own accounts person, and adding a colleague is their
 *   daily work — not something an owner should be doing. Asking them to leave
 *   their department, open Administration and remember to pick the right
 *   business is one step too many, and the step people forget.
 *
 *   So: employees are created where they work. Only LOGINS stay central,
 *   because a login is a key to the building rather than a staff record. If a
 *   department could create logins it could create one that opens Finance —
 *   not from malice, but because nothing would stop it.
 *
 * WHY THE DEPARTMENT IS NEVER CHOSEN HERE
 *   Everyone added on this page is Hub, full stop. A picker would let somebody
 *   file a Hub agent under Karkhana by accident, and nothing downstream would
 *   catch it — they would simply vanish from the list they belong in. The
 *   business comes from the page, so it cannot be got wrong.
 *
 * The same file serves Karkhana and FS Traders later by changing one constant.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Loader2, Plus, Pencil, Trash2, Search, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { btnPrimary, btnGhost, inputCls, Field } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmDialog";

const BUSINESS_CODE = "HUB";

type Emp = {
  id: string; name: string | null; phone: string | null;
  department_id: string | null; is_active: boolean | null;
  pay_type: string | null; pay_amount: number | null;
  join_date: string | null; cnic: string | null;
  designations: { name: string | null } | null;
};

const rs = (v: unknown) =>
  v == null || v === "" ? "—" : "Rs " + Math.round(Number(v) || 0).toLocaleString("en-PK");

const blank = {
  name: "", phone: "", cnic: "", designation: "",
  pay_amount: "", join_date: new Date().toISOString().slice(0, 10),
};

export default function HubEmployeesPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Emp[]>([]);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Emp | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");

    const { data: d, error: de } = await supabase
      .from("departments").select("id").eq("code", BUSINESS_CODE).maybeSingle();
    if (de) { setErr(de.message); setLoading(false); return; }
    if (!d) {
      // Better to say what is missing than to show an empty list that looks fine.
      setErr(`No department with code ${BUSINESS_CODE}. Run migration 0091.`);
      setLoading(false); return;
    }
    setDeptId(d.id as string);

    const { data, error } = await supabase.from("employees")
      .select("id,name,phone,department_id,is_active,pay_type,pay_amount,join_date,cnic,designations(name)")
      .eq("department_id", d.id)
      .order("name").limit(1000);
    if (error) setErr(error.message);
    // An embedded relation comes back as an array even when it is one row.
    setRows(((data ?? []) as Record<string, unknown>[]).map((r) => ({
      ...r, designations: Array.isArray(r.designations) ? r.designations[0] ?? null : r.designations,
    })) as unknown as Emp[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return !n ? rows : rows.filter((r) =>
      (r.name ?? "").toLowerCase().includes(n) ||
      (r.designations?.name ?? "").toLowerCase().includes(n) ||
      (r.phone ?? "").includes(n));
  }, [rows, q]);

  const payroll = shown.reduce((t, r) => t + (Number(r.pay_amount) || 0), 0);

  function startAdd() { setEditing(null); setForm({ ...blank }); setOpen(true); }
  function startEdit(e: Emp) {
    setEditing(e);
    setForm({
      name: e.name ?? "", phone: e.phone ?? "", cnic: e.cnic ?? "",
      designation: e.designations?.name ?? "",
      pay_amount: e.pay_amount == null ? "" : String(e.pay_amount),
      join_date: e.join_date ?? new Date().toISOString().slice(0, 10),
    });
    setOpen(true);
  }

  async function save() {
    if (!supabase || !deptId) return;
    if (!form.name.trim()) { setErr("A name is required."); return; }
    setBusy(true); setErr("");

    /* department_id is fixed to this page's business and monthly is fixed as
       the pay type: Hub staff are salaried, and a piece-rate field here would
       only be a way to enter something the payroll cannot use. */
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      cnic: form.cnic.trim() || null,
      department_id: deptId,
      pay_type: "Monthly",
      pay_amount: form.pay_amount === "" ? null : Number(form.pay_amount),
      join_date: form.join_date || null,
      is_active: true,
    };

    const { error } = editing
      ? await supabase.from("employees").update(payload).eq("id", editing.id)
      : await supabase.from("employees").insert(payload);

    if (error) setErr(error.message);
    else { setOpen(false); await load(); }
    setBusy(false);
  }

  async function remove(e: Emp) {
    if (!supabase) return;
    if (!(await confirm({
      title: `Remove ${e.name ?? "this person"}?`,
      body: "Their attendance and salary history goes with them. This cannot be undone.",
      confirmLabel: "Remove",
    }))) return;
    const { error } = await supabase.from("employees").delete().eq("id", e.id);
    if (error) setErr(error.message); else await load();
  }

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink dark:text-[#f4f1ea]">Hub employees</h1>
          <p className="text-[13px] text-muted dark:text-[#a89f93]">
            Everyone working in the Hub department. Attendance and salary are calculated from here.
          </p>
        </div>
        <button onClick={startAdd} className={btnPrimary}><Plus size={15} /> Add employee</button>
      </div>

      {err && (
        <div className="mt-3 flex gap-2 rounded-card border border-red-300 bg-red-50 p-3 text-[13px] text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{err}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white dark:bg-white dark:text-[#141414]">
          <Users size={12} className="mr-1 inline" />{rows.length} {rows.length === 1 ? "person" : "people"}
        </span>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-hint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role or phone"
                 className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-3 text-[13px] outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
        </div>
      </div>

      <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[680px] text-[13px]">
          <thead className="border-b border-line text-left text-muted dark:border-white/10 dark:text-[#a89f93]">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Phone</th>
              <th className="px-4 py-3 font-semibold">Joined</th>
              <th className="px-4 py-3 text-right font-semibold">Monthly salary</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-white/[0.05]">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">
                <Loader2 size={15} className="mr-2 inline animate-spin" /> Loading…
              </td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-14 text-center text-[13px] text-muted dark:text-[#a89f93]">
                {rows.length === 0
                  ? "No Hub employees yet. Add the first one, or import them from the old attendance app."
                  : "Nobody matches that search."}
              </td></tr>
            ) : shown.map((e) => (
              <tr key={e.id} className="text-ink dark:text-[#e7e2d8]">
                <td className="px-4 py-3 font-semibold">{e.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{e.designations?.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{e.phone ?? "—"}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{e.join_date ?? "—"}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(e.pay_amount)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <button onClick={() => startEdit(e)} className="mr-1 rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold hover:bg-panel dark:border-white/15 dark:hover:bg-white/10">
                    <Pencil size={11} className="mr-1 inline" />Edit
                  </button>
                  <button onClick={() => remove(e)} className="rounded-full border border-line px-2 py-1 text-[11.5px] text-red-700 hover:bg-red-50 dark:border-white/15">
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t border-line dark:border-white/10">
              <tr className="font-semibold text-ink dark:text-[#f4f1ea]">
                <td className="px-4 py-3" colSpan={4}>{shown.length} shown</td>
                <td className="px-4 py-3 text-right tabular-nums">{rs(payroll)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Modal open={open} onClose={() => !busy && setOpen(false)}
             title={editing ? `Edit ${editing.name ?? "employee"}` : "Add a Hub employee"}
             subtitle="They will appear in Hub attendance from today.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className={inputCls} value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></Field>
          <Field label="Role"><input className={inputCls} value={form.designation}
                 onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Dispatch Manager" /></Field>
          <Field label="Monthly salary (Rs)"><input className={inputCls} inputMode="numeric" value={form.pay_amount}
                 onChange={(e) => setForm({ ...form, pay_amount: e.target.value })} placeholder="50000" /></Field>
          <Field label="Phone"><input className={inputCls} value={form.phone}
                 onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03xx…" /></Field>
          <Field label="CNIC"><input className={inputCls} value={form.cnic}
                 onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="optional" /></Field>
          <Field label="Joined"><input type="date" className={inputCls} value={form.join_date}
                 onChange={(e) => setForm({ ...form, join_date: e.target.value })} /></Field>
        </div>
        <p className="mt-3 text-[12px] text-hint dark:text-[#8a8175]">
          A login is not created here. Adding someone to the payroll and giving them
          access to the system are different decisions — logins live in Administration.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className={btnGhost} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          <button className={btnPrimary} disabled={busy} onClick={save}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            {editing ? "Save changes" : "Add employee"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
