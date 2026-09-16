"use client";
/* Attendance — a month at a time, one row per person, one cell per day.
 *
 * WHY A GRID AND NOT A FORM
 *   Attendance is never entered for one person. It is entered for a shop, for
 *   yesterday, by somebody who already knows who was in. A form that asks for a
 *   person, then a date, then a status is three decisions per row; a grid is
 *   one tap. The old app learned this and so does this one.
 *
 * WHY A CELL CYCLES RATHER THAN OPENING A MENU
 *   Present is the overwhelming majority, and a dropdown that has to be opened
 *   and dismissed for every correction is slower than tapping twice. Tap moves
 *   present -> absent -> half -> leave -> off -> present. Nothing is destructive
 *   and every state is two taps from any other.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, UserCheck, UserX, Clock, CalendarDays } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  Shell, PageHeader, StatCards, BranchPicker, MonthPicker, PreviewNote, SourceNote,
  useEmployees, monthKey, monthBounds, daysInMonth, isHeadOffice, type Row,
} from "@/components/retail/kit";

type Scope = "shops" | "ho";
type Status = "present" | "absent" | "half" | "leave" | "off";

const CYCLE: Status[] = ["present", "absent", "half", "leave", "off"];
const LOOK: Record<Status, { ch: string; cls: string; title: string }> = {
  present: { ch: "P", cls: "bg-success-soft text-success dark:bg-success/20 dark:text-success", title: "Present" },
  absent:  { ch: "A", cls: "bg-danger-soft text-danger dark:bg-danger/20 dark:text-danger", title: "Absent" },
  half:    { ch: "½", cls: "bg-amber-soft text-amber-strong dark:bg-amber/20 dark:text-amber", title: "Half day" },
  leave:   { ch: "L", cls: "bg-periwinkle-soft text-periwinkle-strong dark:bg-periwinkle/20 dark:text-periwinkle", title: "Leave" },
  off:     { ch: "—", cls: "bg-panel text-hint dark:bg-white/[0.06] dark:text-[#8a8175]", title: "Weekly off" },
};

export default function AttendanceScreen({ scope }: { scope: Scope }) {
  const { employees, branches } = useEmployees(scope);
  const [month, setMonth] = useState(monthKey());
  const [branch, setBranch] = useState("");
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [savingCell, setSavingCell] = useState("");

  const pickable = useMemo(
    () => branches.filter((b) => (scope === "ho" ? isHeadOffice(b) : !isHeadOffice(b))),
    [branches, scope]
  );
  const people = useMemo(
    () => employees.filter((e) => e.active !== false && (!branch || String(e.branch_id) === branch)),
    [employees, branch]
  );
  const nDays = daysInMonth(month);
  const days = useMemo(() => Array.from({ length: nDays }, (_, i) => i + 1), [nDays]);
  const key = (empId: number, day: number) => `${empId}:${month}-${String(day).padStart(2, "0")}`;

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = monthBounds(month);
    const { data, error } = await supabase
      .from("retail_attendance").select("employee_id,att_date,status")
      .gte("att_date", from).lte("att_date", to);
    if (error) setErr(error.message);
    const next: Record<string, Status> = {};
    ((data as Row[]) ?? []).forEach((r) => {
      next[`${r.employee_id}:${String(r.att_date)}`] = (String(r.status) as Status) || "present";
    });
    setMarks(next); setLoading(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  async function cycle(empId: number, day: number) {
    const k = key(empId, day);
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const cur = marks[k];
    /* An unmarked day becomes Present on the first tap. That is what the person
       doing this is almost always trying to say, and it means a full shop is
       one pass of taps rather than a pass plus corrections. */
    const next = cur ? CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length] : "present";
    setMarks((m) => ({ ...m, [k]: next }));   // optimistic: the grid must feel instant
    if (!supabase) return;
    setSavingCell(k);
    const { error } = await supabase.from("retail_attendance")
      .upsert({ employee_id: empId, att_date: date, status: next }, { onConflict: "employee_id,att_date" });
    setSavingCell("");
    if (error) { setErr(error.message); setMarks((m) => ({ ...m, [k]: cur })); }
  }

  const stats = useMemo(() => {
    const vals = Object.entries(marks).filter(([k]) => people.some((p) => k.startsWith(p.id + ":")));
    const c = (s: Status) => vals.filter(([, v]) => v === s).length;
    return [
      { label: "People", value: String(people.length), Icon: CalendarCheck },
      { label: "Present days", value: String(c("present")), Icon: UserCheck },
      { label: "Absent days", value: String(c("absent")), Icon: UserX },
      { label: "Half / leave", value: String(c("half") + c("leave")), Icon: Clock },
    ];
  }, [marks, people]);

  return (
    <Shell>
      <PageHeader
        title={scope === "ho" ? "Head Office Attendance" : "Attendance"}
        subtitle="Tap a day to cycle it: present, absent, half, leave, weekly off."
        onRefresh={load} loading={loading}
      >
        <MonthPicker value={month} onChange={setMonth} />
        {pickable.length > 1 && <BranchPicker branches={pickable} value={branch} onChange={setBranch} allLabel="All branches" />}
      </PageHeader>

      <StatCards stats={stats} loading={loading} />

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">Couldn&apos;t save: {err}</p>}

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                <th className="sticky left-0 z-10 bg-surface px-4 py-3 font-semibold dark:bg-[#201c17]">Name</th>
                {days.map((d) => <th key={d} className="px-1 py-3 text-center font-semibold">{d}</th>)}
                <th className="px-3 py-3 text-right font-semibold">P</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={nDays + 2} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>
                ))
              ) : people.length === 0 ? (
                <tr><td colSpan={nDays + 2} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">No active employees in scope — add them first.</td></tr>
              ) : (
                people.map((p) => {
                  const present = days.filter((d) => {
                    const v = marks[key(p.id, d)];
                    return v === "present" || v === "half";
                  }).reduce((t, d) => t + (marks[key(p.id, d)] === "half" ? 0.5 : 1), 0);
                  return (
                    <tr key={p.id} className="text-ink dark:text-[#e7e2d8]">
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-4 py-2 font-semibold dark:bg-[#201c17]">{p.name}</td>
                      {days.map((d) => {
                        const k = key(p.id, d);
                        const v = marks[k];
                        const look = v ? LOOK[v] : null;
                        return (
                          <td key={d} className="px-0.5 py-1.5 text-center">
                            <button onClick={() => cycle(p.id, d)} title={look?.title ?? "Not marked"}
                              className={`h-7 w-7 rounded-lg text-[11.5px] font-bold transition ${savingCell === k ? "opacity-50" : ""} ${look ? look.cls : "bg-canvas text-hint hover:bg-panel dark:bg-white/[0.03] dark:text-[#6b6358] dark:hover:bg-white/[0.08]"}`}>
                              {look ? look.ch : "·"}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{present}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[11.5px] font-semibold">
        {(Object.keys(LOOK) as Status[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-muted dark:text-[#a89f93]">
            <span className={`flex h-5 w-5 items-center justify-center rounded ${LOOK[s].cls}`}>{LOOK[s].ch}</span>
            {LOOK[s].title}
          </span>
        ))}
      </div>

      <SourceNote>
        The <strong>P</strong> column counts paid days: a half day counts as 0.5, leave and
        weekly off count as nothing here. It is the number the monthly summary values against
        each person&apos;s rate — which is why a daily-paid person who is never marked is never paid.
      </SourceNote>

      <PreviewNote />
      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[12px] text-hint dark:text-[#8a8175]">
        <CalendarDays size={13} /> Marks save as you tap — there is no Save button.
      </p>
    </Shell>
  );
}
