"use client";
/* Everyone in the group, in one place, filtered by business.
 *
 * WHY THIS LIVES IN ADMINISTRATION AND NOT INSIDE A DEPARTMENT
 *   Employees ended up under Inventory because that is where the factory needed
 *   them first, not because that is where they belong. Payroll, attendance and
 *   advances are the same shape for a stitcher, a Hub agent and a shop
 *   assistant. Adding a person is an administrative act, so it happens in the
 *   administrative room.
 *
 * ONE LIST, NOT ONE PER DEPARTMENT
 *   A single table with a department against each row gives exactly the same
 *   separation as three separate screens, without three copies of the same code
 *   to fix every time something changes. Nobody sees another department's
 *   people: the filter decides what is on screen, and the hub.* / inventory.*
 *   permissions decide what a person can reach at all.
 *
 *   When FS Traders arrives with eight shops, nothing new gets built. Shop staff
 *   are added here and given FS Traders.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Users, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Dept = { id: string; code: string; name: string; kind: string | null; parent_id: string | null };
type Emp = {
  id: string; name: string | null; department_id: string | null;
  phone: string | null; is_active: boolean | null;
  pay_type: string | null; pay_amount: number | null;
  departments: { name: string | null; parent_id: string | null } | null;
  designations: { name: string | null } | null;
};

const rs = (v: unknown) => (v == null ? "—" : "Rs " + Math.round(Number(v) || 0).toLocaleString("en-PK"));

export default function EmployeesTab({ canManage }: { canManage: boolean }) {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [rows, setRows] = useState<Emp[]>([]);
  const [pick, setPick] = useState("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    /* Read `employees`, not online_att_employees.
       online_att_employees is empty and belongs to a separate attendance app
       that has not been migrated yet. The people who actually exist — all of
       them, every department — are in `employees`, which already carries
       department_id, pay_type and pay_amount.

       Every department is fetched, not just the business units, because an
       employee is attached to a SECTION (Cutting, Stitching) and the section
       is what knows which business it belongs to. */
    const [d, e] = await Promise.all([
      supabase.from("departments").select("id,code,name,kind,parent_id").order("sort_order"),
      supabase.from("employees")
        .select("id,name,department_id,phone,is_active,pay_type,pay_amount,departments(name,parent_id),designations(name)")
        .order("name").limit(1000),
    ]);
    if (d.error) setErr(d.error.message);
    if (e.error) setErr(e.error.message);
    setDepts((d.data as Dept[]) ?? []);
    /* Supabase types an embedded relation as an array even when it resolves to
       one row, so it is flattened here rather than fought with everywhere it is
       read. */
    const flat = ((e.data ?? []) as Record<string, unknown>[]).map((r) => ({
      ...r,
      departments: Array.isArray(r.departments) ? r.departments[0] ?? null : r.departments,
      designations: Array.isArray(r.designations) ? r.designations[0] ?? null : r.designations,
    })) as unknown as Emp[];
    setRows(flat);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* Which BUSINESS does this person belong to?
     Karkhana staff sit in a section — Cutting, Stitching — and the section
     points at Karkhana. Hub staff will sit against the Hub directly. Comparing
     department_id to a business unit would therefore match every Hub person and
     no factory worker at all, which is how this showed an empty list.
     Resolve the section to its parent first, then compare. */
  const unitOf = useCallback((r: Emp) => {
    const dept = depts.find((d) => d.id === r.department_id);
    if (!dept) return null;
    return dept.kind === "business_unit" ? dept.id : dept.parent_id;
  }, [depts]);

  const units = useMemo(() => depts.filter((d) => d.kind === "business_unit"), [depts]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (pick === "ALL" || unitOf(r) === pick) &&
      (!needle ||
        (r.name ?? "").toLowerCase().includes(needle) ||
        (r.departments?.name ?? "").toLowerCase().includes(needle) ||
        (r.designations?.name ?? "").toLowerCase().includes(needle)));
  }, [rows, pick, q, unitOf]);

  const byDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) { const u = unitOf(r) ?? "none"; m.set(u, (m.get(u) ?? 0) + 1); }
    return m;
  }, [rows, unitOf]);

  // Only monthly salaries add up. A piece-rate worker has no monthly figure to
  // total, so including them would invent a payroll number that is not real.
  const payroll = shown
    .filter((r) => (r.pay_type ?? "").toLowerCase().startsWith("month"))
    .reduce((t, r) => t + (Number(r.pay_amount) || 0), 0);

  return (
    <div>
      {err && (
        <div className="mb-3 flex gap-2 rounded-card border border-red-300 bg-red-50 p-3 text-[13px] text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{err}</span>
        </div>
      )}

      {/* One chip per business. The count is the useful part — it answers
          "how many people does this department actually have" at a glance. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setPick("ALL")}
          className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
            pick === "ALL" ? "border-ink bg-ink text-white dark:border-white dark:bg-white dark:text-[#141414]"
                           : "border-line bg-surface text-muted hover:bg-panel dark:border-white/10 dark:bg-white/[0.05] dark:text-[#a89f93]"}`}>
          Everyone · {rows.length}
        </button>
        {units.map((d) => (
          <button key={d.id} onClick={() => setPick(d.id)}
            className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
              pick === d.id ? "border-ink bg-ink text-white dark:border-white dark:bg-white dark:text-[#141414]"
                            : "border-line bg-surface text-muted hover:bg-panel dark:border-white/10 dark:bg-white/[0.05] dark:text-[#a89f93]"}`}>
            {d.name} · {byDept.get(d.id) ?? 0}
          </button>
        ))}
        {(byDept.get("none") ?? 0) > 0 && (
          <button onClick={() => setPick("none")}
            className="rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-[12.5px] font-semibold text-amber-900">
            No department · {byDept.get("none")}
          </button>
        )}

        <div className="relative ml-auto">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-hint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or role"
            className="w-56 rounded-full border border-line bg-surface py-1.5 pl-8 pr-3 text-[12.5px] outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-line dark:border-white/10">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead className="bg-panel text-left text-muted dark:bg-white/[0.04] dark:text-[#a89f93]">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Business</th>
              <th className="px-4 py-3 font-semibold">Phone</th>
              <th className="px-4 py-3 text-right font-semibold">Monthly salary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-white/[0.05]">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">
                <Loader2 size={15} className="inline animate-spin" /> Loading…
              </td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted">
                <Users size={20} className="mx-auto mb-2 opacity-40" />
                {rows.length === 0 ? "No employees yet." : "Nobody matches that filter."}
              </td></tr>
            ) : shown.map((r) => (
              <tr key={r.id} className="text-ink dark:text-[#e7e2d8]">
                <td className="px-4 py-3 font-semibold">{r.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{r.designations?.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">
                  {depts.find((d) => d.id === r.department_id)?.name
                    ?? <span className="text-amber-700">not set</span>}
                </td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{r.phone ?? "—"}</td>
                {/* Piece-rate has no monthly figure, and showing a dash is more
                    honest than showing zero. */}
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {(r.pay_type ?? "").toLowerCase().startsWith("month") ? rs(r.pay_amount)
                    : <span className="text-muted dark:text-[#a89f93]">{r.pay_type ?? "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t border-line dark:border-white/10">
              <tr className="text-ink dark:text-[#f4f1ea]">
                <td className="px-4 py-3 font-bold" colSpan={4}>
                  {shown.length.toLocaleString()} {shown.length === 1 ? "person" : "people"}
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">{rs(payroll)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-[12px] text-hint dark:text-[#8a8175]">
        {canManage
          ? "Adding and editing people moves here next, so a person is created once and assigned a business at the same time."
          : "Read only — you can see people but not change them."}
      </p>
    </div>
  );
}
