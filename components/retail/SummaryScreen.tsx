"use client";
/* Monthly summary — what each person earned this month and what is left to pay.
 *
 * HOW A MONTH IS VALUED
 *   A full month present pays the full salary, exactly. Nothing is divided and
 *   multiplied back, because 30,000 / 31 * 31 is not always 30,000 and nobody
 *   wants to explain a two-rupee shortfall to the person who worked every day.
 *
 *   A part month pays salary / (days in THAT month) * paid days. Not /30 — a
 *   day in February is worth more than a day in March, and using a fixed 30
 *   quietly underpays every February and overpays every 31-day month.
 *
 *   Daily and hourly people are counted straight from attendance against their
 *   own rate, so an unmarked day is an unpaid day. That is why the attendance
 *   grid matters more than it looks.
 *
 *   Half days count 0.5. Leave and weekly off count nothing — if a shop gives
 *   paid leave, mark the day present; the system does not guess.
 *
 * NET PAYABLE deducts the month's advances and purchase credit, which is what
 * the person handing over the envelope actually needs to know.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Wallet, HandCoins, Banknote } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, MonthPicker, BranchPicker, PreviewNote, SourceNote,
  useEmployees, monthKey, monthBounds, daysInMonth, monthLabel, isHeadOffice,
  money, num, type Row, type Col, type Employee,
} from "@/components/retail/kit";

type Scope = "shops" | "ho";
type Line = {
  emp: Employee; paidDays: number; fullMonth: boolean;
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
      supabase.from("retail_attendance").select("employee_id,att_date,status").in("employee_id", ids).gte("att_date", from).lte("att_date", to),
      supabase.from("retail_employee_ledger").select("employee_id,entry_date,advance,purchase_credit,paid").in("employee_id", ids).gte("entry_date", from).lte("entry_date", to),
    ]);
    if (a.error || l.error) setErr(a.error?.message ?? l.error?.message ?? "");
    setAtt((a.data as Row[]) ?? []);
    setLed((l.data as Row[]) ?? []);
    setLoading(false);
  }, [ids, month]);
  useEffect(() => { load(); }, [load]);

  const lines: Line[] = useMemo(() => {
    const nDays = daysInMonth(month);
    return people.map((emp) => {
      const mine = att.filter((r) => Number(r.employee_id) === emp.id);
      const paidDays = mine.reduce((t, r) => {
        const s = String(r.status);
        return t + (s === "present" ? 1 : s === "half" ? 0.5 : 0);
      }, 0);
      const fullMonth = paidDays >= nDays;

      const payType = emp.pay_type ?? "monthly";
      let earned: number;
      if (payType === "monthly") {
        earned = fullMonth ? num(emp.monthly_salary) : (num(emp.monthly_salary) / nDays) * paidDays;
      } else {
        /* Daily and hourly both sit on hourly_rate; for a daily person it is
           the day rate. An hourly person's hours are not tracked per day yet,
           so a present day is charged as one unit of their rate — the same
           thing the old app did, and the reason a full timesheet is the next
           thing this screen wants. */
        earned = num(emp.hourly_rate) * paidDays;
      }

      const mineLed = led.filter((r) => Number(r.employee_id) === emp.id);
      const advance = mineLed.reduce((t, r) => t + num(r.advance), 0);
      const credit = mineLed.reduce((t, r) => t + num(r.purchase_credit), 0);
      const repaid = mineLed.reduce((t, r) => t + num(r.paid), 0);

      return { emp, paidDays, fullMonth, earned, advance, credit, repaid, net: earned - advance - credit + repaid };
    });
  }, [people, att, led, month]);

  const tot = useMemo(() => ({
    earned: lines.reduce((t, l) => t + l.earned, 0),
    advance: lines.reduce((t, l) => t + l.advance + l.credit, 0),
    net: lines.reduce((t, l) => t + l.net, 0),
    days: lines.reduce((t, l) => t + l.paidDays, 0),
  }), [lines]);

  const stats = [
    { label: "People", value: String(lines.length), Icon: CalendarRange },
    { label: "Paid days", value: tot.days.toLocaleString(), Icon: CalendarRange },
    { label: "Earned", value: money(tot.earned), Icon: Wallet },
    { label: "Net payable", value: money(tot.net), Icon: Banknote },
  ];

  const cols: Col<Line>[] = [
    { head: "Name", bold: true, cell: (l) => l.emp.name },
    { head: "Pay", cell: (l) => ((l.emp.pay_type ?? "monthly") === "monthly" ? <Pill tone="info">Monthly</Pill> : <Pill tone="warn">{l.emp.pay_type === "hourly" ? "Hourly" : "Daily"}</Pill>) },
    { head: "Paid days", right: true, cell: (l) => (
        <span className="inline-flex items-center gap-1.5">
          {l.paidDays}
          {l.fullMonth && <Pill tone="good">Full</Pill>}
        </span>
      ) },
    { head: "Earned", right: true, bold: true, cell: (l) => money(l.earned) },
    { head: "Advance", right: true, cell: (l) => (l.advance ? money(l.advance) : "—") },
    { head: "Credit", right: true, cell: (l) => (l.credit ? money(l.credit) : "—") },
    { head: "Repaid", right: true, cell: (l) => (l.repaid ? money(l.repaid) : "—") },
    { head: "Net payable", right: true, bold: true, cell: (l) => (
        l.net < 0 ? <span className="text-danger">{money(l.net)}</span> : money(l.net)
      ) },
  ];

  return (
    <Shell>
      <PageHeader
        title={scope === "ho" ? "Head Office Monthly Summary" : "Monthly Summary"}
        subtitle={`Days worked, earnings and what is left to hand over for ${monthLabel(month)}.`}
        onRefresh={load} loading={loading}
      >
        <MonthPicker value={month} onChange={setMonth} />
        {pickable.length > 1 && <BranchPicker branches={pickable} value={branch} onChange={setBranch} />}
      </PageHeader>

      <StatCards stats={stats} loading={loading} />

      <DataTable cols={cols} rows={lines} loading={loading} err={err} minWidth={900}
        empty="Nobody in scope — add employees and mark some attendance."
        footer={
          <tr className="text-ink dark:text-[#f4f1ea]">
            <td className="px-4 py-3 font-bold" colSpan={2}>Total</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{tot.days}</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{money(tot.earned)}</td>
            <td className="px-4 py-3" colSpan={3} />
            <td className="px-4 py-3 text-right font-bold tabular-nums">{money(tot.net)}</td>
          </tr>
        } />

      <SourceNote>
        A <strong>full month</strong> pays the full salary exactly — nothing is divided and
        multiplied back. A part month pays <strong>salary ÷ {daysInMonth(month)} days × paid days</strong>,
        using the real length of {monthLabel(month)} rather than a flat 30. Half days count 0.5;
        leave and weekly off count nothing, so paid leave has to be marked present.
        A negative net payable means the person has drawn more than they earned this month.
      </SourceNote>

      <PreviewNote />
    </Shell>
  );
}
