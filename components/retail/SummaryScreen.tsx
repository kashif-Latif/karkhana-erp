"use client";
/* Monthly summary — what each person earned this month and what is left to pay.
 *
 * HOW A MONTH IS VALUED — this is the retail rule, not the Hub's.
 *
 *   MONTHLY staff are paid the FULL monthly salary. Flat. Attendance does not
 *   pro-rate it and days worked do not scale it. That is what the shops
 *   actually do, and an earlier version of this screen divided by days in the
 *   month and multiplied by days present — which quietly docked a salesman who
 *   took two days off and produced a number nobody could reconcile against the
 *   envelope they were handed.
 *
 *   HOURLY staff are paid rate × REAL HOURS, summed from time_in / time_out on
 *   each attendance row. Not present-days × rate: an hourly person who did four
 *   hours on Tuesday is owed four hours, and the whole reason their attendance
 *   carries times is so that is knowable.
 *
 * Attendance still matters for monthly staff — it is the record of who was
 * where — it simply does not change the wage. Absence is handled as an advance
 * or a deduction in the ledger, deliberately, so it is visible as a decision
 * somebody made rather than arithmetic nobody can see.
 *
 * NET PAYABLE deducts this month's advances and purchase credit and adds back
 * what has been repaid, which is what the person handing over the envelope
 * actually needs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Wallet, Clock, Banknote } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, MonthPicker, BranchPicker, PreviewNote, SourceNote,
  useEmployees, monthKey, monthBounds, monthLabel, isHeadOffice,
  money, num, attHours, isHourly, type Row, type Col, type Employee,
} from "@/components/retail/kit";

type Scope = "shops" | "ho";
type Line = {
  emp: Employee; hourly: boolean;
  hours: number; present: number; half: number; absent: number;
  earned: number; advance: number; credit: number; repaid: number; net: number;
};

export default function SummaryScreen({ scope }: { scope: Scope }) {
  const { employees, branches } = useEmployees(scope);
  const [month, setMonth] = useState(monthKey());
  const [branch, setBranch] = useState("");
  const [att, setAtt] = useState<Row[]>([]);
  const [led, setLed] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const pickable = useMemo(
    () => branches.filter((b) => (scope === "ho" ? isHeadOffice(b) : !isHeadOffice(b))),
    [branches, scope]
  );
  const people = useMemo(
    () => employees.filter((e) => e.active !== false && (!branch || String(e.branch_id) === branch)),
    [employees, branch]
  );
  const ids = useMemo(() => people.map((p) => p.id), [people]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    if (ids.length === 0) { setAtt([]); setLed([]); setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = monthBounds(month);
    const [a, l] = await Promise.all([
      supabase.from("retail_attendance").select("employee_id,att_date,status,time_in,time_out").in("employee_id", ids).gte("att_date", from).lte("att_date", to),
      supabase.from("retail_employee_ledger").select("employee_id,entry_date,advance,purchase_credit,paid").in("employee_id", ids).gte("entry_date", from).lte("entry_date", to),
    ]);
    if (a.error || l.error) setErr(a.error?.message ?? l.error?.message ?? "");
    setAtt((a.data as Row[]) ?? []);
    setLed((l.data as Row[]) ?? []);
    setLoading(false);
  }, [ids, month]);
  useEffect(() => { load(); }, [load]);

  const lines: Line[] = useMemo(() => people.map((emp) => {
    const mine = att.filter((r) => Number(r.employee_id) === emp.id);
    const hourly = isHourly(emp);

    const hours = mine.reduce((t, r) => t + attHours(r.time_in as string | null, r.time_out as string | null), 0);
    const present = mine.filter((r) => String(r.status) === "present").length;
    const half = mine.filter((r) => String(r.status) === "half").length;
    const absent = mine.filter((r) => String(r.status) === "absent").length;

    // The whole rule, in one line each.
    const earned = hourly ? Math.round(num(emp.hourly_rate) * hours) : num(emp.monthly_salary);

    const mineLed = led.filter((r) => Number(r.employee_id) === emp.id);
    const advance = mineLed.reduce((t, r) => t + num(r.advance), 0);
    const credit = mineLed.reduce((t, r) => t + num(r.purchase_credit), 0);
    const repaid = mineLed.reduce((t, r) => t + num(r.paid), 0);

    return { emp, hourly, hours, present, half, absent, earned, advance, credit, repaid,
             net: earned - advance - credit + repaid };
  }), [people, att, led]);

  const tot = useMemo(() => ({
    earned: lines.reduce((t, l) => t + l.earned, 0),
    drawn: lines.reduce((t, l) => t + l.advance + l.credit, 0),
    net: lines.reduce((t, l) => t + l.net, 0),
    hours: lines.reduce((t, l) => t + l.hours, 0),
  }), [lines]);

  const stats = [
    { label: "People", value: String(lines.length), Icon: CalendarRange },
    { label: "Hourly hours", value: tot.hours ? tot.hours.toFixed(1) : "—", Icon: Clock },
    { label: "Earned", value: money(tot.earned), Icon: Wallet },
    { label: "Net payable", value: money(tot.net), Icon: Banknote },
  ];

  const cols: Col<Line>[] = [
    { head: "Name", bold: true, cell: (l) => l.emp.name },
    { head: "Pay", cell: (l) => l.hourly
        ? <Pill tone="warn">{money(l.emp.hourly_rate)}/hr</Pill>
        : <Pill tone="info">Monthly</Pill> },
    { head: "Attendance", muted: true, cell: (l) => l.hourly
        ? `${l.hours.toFixed(1)} h`
        : `${l.present} present${l.half ? ` · ${l.half} half` : ""}${l.absent ? ` · ${l.absent} absent` : ""}` },
    { head: "Earned", right: true, bold: true, cell: (l) => money(l.earned) },
    { head: "Advance", right: true, cell: (l) => (l.advance ? money(l.advance) : "—") },
    { head: "Credit", right: true, cell: (l) => (l.credit ? money(l.credit) : "—") },
    { head: "Repaid", right: true, cell: (l) => (l.repaid ? money(l.repaid) : "—") },
    { head: "Net payable", right: true, bold: true, cell: (l) =>
        l.net < 0 ? <span className="text-danger">{money(l.net)}</span> : money(l.net) },
  ];

  return (
    <Shell>
      <PageHeader
        title={scope === "ho" ? "Head Office Monthly Summary" : "Monthly Summary"}
        subtitle={`Earnings and what is left to hand over for ${monthLabel(month)}.`}
        onRefresh={load} loading={loading}
      >
        <MonthPicker value={month} onChange={setMonth} />
        {pickable.length > 1 && <BranchPicker branches={pickable} value={branch} onChange={setBranch} />}
      </PageHeader>

      <StatCards stats={stats} loading={loading} />

      <DataTable cols={cols} rows={lines} loading={loading} err={err} minWidth={940}
        empty="Nobody in scope — add employees first."
        footer={
          <tr className="text-ink dark:text-[#f4f1ea]">
            <td className="px-4 py-3 font-bold" colSpan={3}>Total</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{money(tot.earned)}</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums" colSpan={3}>{money(tot.drawn)} drawn</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{money(tot.net)}</td>
          </tr>
        } />

      <SourceNote>
        <strong>Monthly staff are paid the full salary.</strong> Days present do not scale it — an
        absence is handled as a deduction in the ledger, where it is a decision somebody made
        rather than arithmetic nobody can see. <strong>Hourly staff are paid rate × real hours</strong>,
        added up from the time in and time out on each attendance row, which is why those two
        fields exist. A negative net payable means the person has drawn more than they earned this
        month.
      </SourceNote>

      <PreviewNote />
    </Shell>
  );
}
