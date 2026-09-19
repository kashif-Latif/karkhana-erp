"use client";
import { useEffect, useMemo, useState } from "react";
import { Users, CalendarCheck, HandCoins, Wallet, RefreshCw, Trash2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { AddEmployee, MarkAttendance, AddAdvance } from "@/components/AttendanceEntry";
import MonthlySummary from "@/components/MonthlySummary";
import { useConfirm } from "@/components/ConfirmDialog";

type Tab = "employees" | "attendance" | "advances" | "salaries";
type Row = Record<string, unknown>;
type Emp = { id: string; name: string; designation?: string; department?: string; sal?: number; wd?: number; phone?: string };

const TABS: { key: Tab; label: string }[] = [
  { key: "employees", label: "Employees" },
  { key: "attendance", label: "Attendance" },
  { key: "advances", label: "Advances" },
  /* "Summary" rather than "Salaries": it is a payroll calculation, not a
     list of paid/unpaid flags. The old tab showed the flags, which read empty
     because nobody had pressed Mark Paid — data that was missing by definition
     rather than by accident. */
  { key: "salaries", label: "Summary" },
];
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (n: unknown) => "Rs " + (Number(n) || 0).toLocaleString("en-PK");

function statusBadge(s: string) {
  const kind = s === "P" ? "ok" : s === "A" ? "bad" : s === "L" ? "warn" : "mute";
  const m = {
    ok: "bg-success-soft text-success dark:bg-white/[0.08] dark:text-success",
    warn: "bg-amber-soft text-amber-strong dark:bg-white/[0.08] dark:text-amber",
    bad: "bg-danger-soft text-danger dark:bg-white/[0.08] dark:text-danger",
    mute: "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]",
  }[kind];
  const label = s === "P" ? "Present" : s === "A" ? "Absent" : s === "L" ? "Leave" : (s || "—");
  return <span className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${m}`}>{label}</span>;
}

export default function AttendancePage() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("employees");
  const [emps, setEmps] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const empName = (id: unknown) => emps.find((e) => e.id === id)?.name ?? String(id ?? "—");

  /* REMOVING SOMEBODY FROM THE ROSTER.
     This list had no way off it. People can be added to it from this very
     screen — that box writes a roster row with a department typed by hand and
     no staff record behind it — and anybody added that way was then beyond the
     reach of every delete button in the system, including the Hub employees
     page, which quite rightly only removes Hub employees.

     Everything keyed to them goes: their attendance, advances, salary marks and
     rate history. Their central staff record goes only if they are Hub; if they
     belong to another department it is left alone and the answer says so,
     because that record is Administration's and not this screen's to decide
     about. */
  async function removeEmployee(id: string, name: string) {
    if (!supabase) return;
    if (!(await confirm({
      title: `Remove ${name} from attendance?`,
      body: "Their attendance, advances and salary history go with them. This cannot be undone.",
      confirmLabel: "Remove",
    }))) return;

    setRemoving(id); setErr(""); setMsg("");
    const { data, error } = await supabase.rpc("hub_remove_att_employee", { p_id: id });
    setRemoving(null);

    if (error) {
      setErr(/schema cache|does not exist|Could not find the function/i.test(error.message)
        ? "This needs migration H235, which has not been run on the database yet. Open Supabase → SQL editor and run H235_remove_from_attendance_roster.sql, then try again."
        : error.message);
      return;
    }
    const r = data as { ok?: boolean; error?: string; report?: string } | null;
    if (!r?.ok) { setErr(r?.error ?? "The removal was refused and gave no reason."); return; }

    await load("employees");
    setMsg(r.report ?? `${name} removed.`);
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    supabase.from("online_att_employees").select("id,name,designation,department,sal,wd,phone").order("name")
      .then(({ data }) => setEmps((data as Emp[]) ?? []));
  }, []);

  async function load(which: Tab) {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    if (which === "employees") {
      const { data, error } = await supabase.from("online_att_employees").select("id,name,designation,department,sal,wd,phone").order("name");
      if (error) setErr(error.message); setEmps((data as Emp[]) ?? []); setRows((data as Row[]) ?? []);
    } else if (which === "attendance") {
      const { data, error } = await supabase.from("online_att_records").select("id,emp_id,year,month,day,status,time_in").order("year", { ascending: false }).order("month", { ascending: false }).order("day", { ascending: false }).limit(1000);
      if (error) setErr(error.message); setRows((data as Row[]) ?? []);
    } else if (which === "advances") {
      const { data, error } = await supabase.from("online_att_advances").select("id,emp_id,amount,date,note,deduct_month,deduct_year,settled").order("date", { ascending: false }).limit(1000);
      if (error) setErr(error.message); setRows((data as Row[]) ?? []);
    } else {
      const { data, error } = await supabase.from("online_att_salary_status").select("id,emp_id,year,month,paid").order("year", { ascending: false }).order("month", { ascending: false }).limit(1000);
      if (error) setErr(error.message); setRows((data as Row[]) ?? []);
    }
    setLoading(false);
  }
  useEffect(() => { load(tab); /* eslint-disable-next-line */ }, [tab]);

  const cards = useMemo(() => {
    if (tab === "employees") {
      const deps = new Set(emps.map((e) => e.department).filter(Boolean));
      return [
        { label: "Employees", value: emps.length.toLocaleString(), Icon: Users, bg: "bg-periwinkle-soft" },
        { label: "Monthly salary", value: money(emps.reduce((t, e) => t + (Number(e.sal) || 0), 0)), Icon: Wallet, bg: "bg-success-soft" },
        { label: "Departments", value: deps.size.toLocaleString(), Icon: Users, bg: "bg-amber-soft" },
        { label: "—", value: "", Icon: Users, bg: "bg-salmon-soft" },
      ];
    }
    if (tab === "attendance") {
      const by = (s: string) => rows.filter((r) => r.status === s).length;
      return [
        { label: "Records", value: rows.length.toLocaleString(), Icon: CalendarCheck, bg: "bg-periwinkle-soft" },
        { label: "Present", value: by("P").toLocaleString(), Icon: CalendarCheck, bg: "bg-success-soft" },
        { label: "Absent", value: by("A").toLocaleString(), Icon: CalendarCheck, bg: "bg-danger-soft" },
        { label: "Leave", value: by("L").toLocaleString(), Icon: CalendarCheck, bg: "bg-amber-soft" },
      ];
    }
    if (tab === "advances") {
      const uns = rows.filter((r) => !r.settled);
      return [
        { label: "Advances", value: rows.length.toLocaleString(), Icon: HandCoins, bg: "bg-periwinkle-soft" },
        { label: "Total amount", value: money(rows.reduce((t, r) => t + (Number(r.amount) || 0), 0)), Icon: Wallet, bg: "bg-success-soft" },
        { label: "Unsettled", value: uns.length.toLocaleString(), Icon: HandCoins, bg: "bg-amber-soft" },
        { label: "—", value: "", Icon: HandCoins, bg: "bg-salmon-soft" },
      ];
    }
    return [
      { label: "Salary records", value: rows.length.toLocaleString(), Icon: Wallet, bg: "bg-periwinkle-soft" },
      { label: "Paid", value: rows.filter((r) => r.paid).length.toLocaleString(), Icon: Wallet, bg: "bg-success-soft" },
      { label: "Unpaid", value: rows.filter((r) => !r.paid).length.toLocaleString(), Icon: Wallet, bg: "bg-amber-soft" },
      { label: "—", value: "", Icon: Wallet, bg: "bg-salmon-soft" },
    ];
  }, [tab, rows, emps]);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold sm:text-[22px] tracking-tight text-ink dark:text-[#f4f1ea]">Attendance</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Employees, daily attendance, advances &amp; salaries.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "employees" && <AddEmployee onDone={() => load(tab)} />}
          {tab === "attendance" && <MarkAttendance emps={emps} onDone={() => load(tab)} />}
          {tab === "advances" && <AddAdvance emps={emps} onDone={() => load(tab)} />}
          <button onClick={() => load(tab)} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="mt-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><div className="flex w-max gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${tab === t.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div></div>

      {msg && (
        <div className="mt-4 flex items-start justify-between gap-2 rounded-card border border-emerald-300 bg-emerald-50 p-3 text-[13px] text-emerald-900">
          <span>{msg}</span>
          <button onClick={() => setMsg("")} className="shrink-0 font-semibold opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {tab === "salaries" ? (
        <div className="mt-5"><MonthlySummary department="HUB" /></div>
      ) : (<>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, bg }, i) => (
          <div key={i} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17] ${label === "—" ? "opacity-0" : ""}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                {tab === "employees" && <><th className="px-4 py-3 font-semibold">Name</th><th className="px-4 py-3 font-semibold">Designation</th><th className="px-4 py-3 font-semibold">Department</th><th className="px-4 py-3 text-right font-semibold">Salary</th><th className="px-4 py-3 text-right font-semibold">Work days</th><th className="px-4 py-3 font-semibold">Phone</th><th className="px-4 py-3 text-right font-semibold">Remove</th></>}
                {tab === "attendance" && <><th className="px-4 py-3 font-semibold">Employee</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Time in</th><th className="px-4 py-3 font-semibold">Status</th></>}
                {tab === "advances" && <><th className="px-4 py-3 font-semibold">Employee</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Deduct</th><th className="px-4 py-3 font-semibold">Note</th><th className="px-4 py-3 font-semibold">Settled</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={tab === "employees" ? 7 : 6} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={tab === "employees" ? 7 : 6} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load: {err}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={tab === "employees" ? 7 : 6} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">Nothing here yet — this fills once employees &amp; attendance are brought in.</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    {tab === "employees" && <>
                      <td className="px-4 py-3 font-semibold">{String(r.name ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.designation ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.department ?? "—")}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.sal)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{String(r.wd ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.phone ?? "—")}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          onClick={() => removeEmployee(String(r.id), String(r.name ?? "this person"))}
                          disabled={removing === String(r.id)}
                          title={`Remove ${String(r.name ?? "")} from the attendance roster`}
                          className="rounded-full border border-line px-2 py-1 text-[11.5px] font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10">
                          {removing === String(r.id)
                            ? <RefreshCw size={11} className="animate-spin" />
                            : <Trash2 size={11} />}
                        </button>
                      </td>
                    </>}
                    {tab === "attendance" && <>
                      <td className="px-4 py-3 font-semibold">{empName(r.emp_id)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.day)} {MONTHS[Number(r.month)] ?? r.month} {String(r.year)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.time_in || "—")}</td>
                      <td className="px-4 py-3">{statusBadge(String(r.status ?? ""))}</td>
                    </>}
                    {tab === "advances" && <>
                      <td className="px-4 py-3 font-semibold">{empName(r.emp_id)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.amount)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.date ?? "—")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{MONTHS[Number(r.deduct_month)] ?? r.deduct_month} {String(r.deduct_year ?? "")}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{String(r.note || "—")}</td>
                      <td className="px-4 py-3">{r.settled ? <span className="text-[12px] font-semibold text-success">Yes</span> : <span className="text-[12px] font-semibold text-amber-strong dark:text-amber">No</span>}</td>
                    </>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load attendance.</p>}
      </>)}
    </div>
  );
}
