"use client";
/* The employee portal. One person, their own month, nothing else.
 *
 * WHAT IT IS FOR
 *   Somebody who works here signs in and wants three answers: have my days been
 *   marked correctly, what have I already taken as an advance, and what am I
 *   owed so far. That is the whole product.
 *
 * WHY IT SHOWS A RUNNING TOTAL
 *   The payable grows through the month rather than appearing at the end. Being
 *   able to watch it is the point — it turns payday from a figure handed down
 *   into one the person has been able to check all along, and a wrong day gets
 *   queried on the 3rd instead of argued about on the 30th.
 *
 * WHERE THE SECURITY IS
 *   Not here. Every figure comes from a my_* function that filters on
 *   auth.uid() inside Postgres. This page cannot ask for somebody else's data
 *   because there is no parameter to ask with — and if it could, the database
 *   would refuse. A filter written in a page is a filter that can be bypassed
 *   from the browser console.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, HandCoins, Wallet, Loader2, AlertTriangle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Me = { emp_id: string; name: string; designation: string | null; department: string | null; salary: number };
type Pay = {
  name: string; designation: string | null; salary: number;
  leave_days: number; absent_deduction: number;
  present: number; half: number; absent: number; paid_off: number;
  extra_days: number; counted_days: number; advances: number;
  payable: number; is_paid: boolean;
};
type Day = { day: number; status: string };
type Adv = { date: string; amount: number; note: string | null };

const MONTHS = ["", "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
const rs = (v: unknown) => "Rs " + Math.round(Number(v) || 0).toLocaleString("en-PK");

export default function MyPortal() {
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [me, setMe] = useState<Me | null>(null);
  const [pay, setPay] = useState<Pay | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [advs, setAdvs] = useState<Adv[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [m, p, d, a] = await Promise.all([
      supabase.rpc("my_employee"),
      supabase.rpc("my_monthly_payable", { p_year: year, p_month: month }),
      supabase.rpc("my_attendance", { p_year: year, p_month: month }),
      supabase.rpc("my_advances", { p_year: year, p_month: month }),
    ]);
    if (m.error) setErr(m.error.message);
    setMe(((m.data as Me[]) ?? [])[0] ?? null);
    setPay(((p.data as Pay[]) ?? [])[0] ?? null);
    setDays((d.data as Day[]) ?? []);
    setAdvs((a.data as Adv[]) ?? []);
    setLoading(false);
  }, [year, month]);
  useEffect(() => { load(); }, [load]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    router.push("/login");
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const byDay = new Map(days.map((d) => [d.day, d.status]));
  const isCurrent = year === today.getFullYear() && month === today.getMonth() + 1;
  // What the counted days earned, before advances come off.
  const gross = (Number(me?.salary ?? 0) / 30) * Number(pay?.counted_days ?? 0);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-canvas dark:bg-[#17140f]">
      <Loader2 size={20} className="animate-spin text-muted" /></div>;
  }

  /* No link, no data. Said plainly rather than shown as an empty portal, which
     looks like a broken page rather than an unfinished setup step. */
  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6 dark:bg-[#17140f]">
        <div className="max-w-sm rounded-card border border-line bg-surface p-6 text-center dark:border-white/10 dark:bg-[#201c17]">
          <AlertTriangle size={22} className="mx-auto text-amber-600" />
          <div className="mt-3 text-[15px] font-bold text-ink dark:text-[#f4f1ea]">Not linked yet</div>
          <p className="mt-1.5 text-[13px] text-muted dark:text-[#a89f93]">
            Your login is not attached to an employee record, so there is nothing to show.
            Ask whoever manages the department to link it.
          </p>
          {err && <p className="mt-2 text-[12px] text-red-700">{err}</p>}
          <button onClick={signOut} className="mt-4 rounded-full border border-line px-4 py-2 text-[13px] font-semibold dark:border-white/15 dark:text-white">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas pb-16 dark:bg-[#17140f]">
      <div className="mx-auto max-w-3xl px-4 pt-5 sm:px-6 sm:pt-7">

        {/* WHO, AND WHICH MONTH.
            The name is the only thing that stays fixed; everything below it is
            an answer about one month, so the month sits with the controls. */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-extrabold leading-tight text-ink dark:text-[#f4f1ea] sm:text-[22px]">
              {me.name}
            </h1>
            <p className="mt-0.5 text-[12.5px] text-muted dark:text-[#a89f93]">
              {me.designation ?? "—"}{me.department && ` · ${me.department}`}
            </p>
          </div>
          <button onClick={signOut} aria-label="Sign out"
                  className="shrink-0 rounded-full border border-line p-2 text-muted transition hover:bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:border-white/10 dark:hover:bg-white/10">
            <LogOut size={15} />
          </button>
        </header>

        <div className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="m">Month</label>
          <select id="m" value={month} onChange={(e) => setMonth(Number(e.target.value))}
                  className="flex-1 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <label className="sr-only" htmlFor="y">Year</label>
          <select id="y" value={year} onChange={(e) => setYear(Number(e.target.value))}
                  className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {[year - 1, year].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* THE PAYSLIP.
            A wage slip is the document this person already knows, so the money
            is laid out the way one reads: what was earned, what was taken off,
            what is left — ruled, right-aligned, adding up. The difference is
            that this one is not the end of the month. It is today. */}
        <section className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/10 dark:bg-[#201c17]">
          <div className="flex items-baseline justify-between border-b border-line px-4 py-3 dark:border-white/10 sm:px-5">
            <h2 className="text-[13px] font-bold text-ink dark:text-[#f4f1ea]">
              {isCurrent ? "Earned so far" : "Payable"}
            </h2>
            <span className="text-[11.5px] text-muted dark:text-[#a89f93]">
              {isCurrent ? `up to ${today.getDate()} ${MONTHS[month]}` : `${MONTHS[month]} ${year}`}
            </span>
          </div>

          <div className="px-4 py-5 text-center sm:px-5">
            <div className="text-[38px] font-extrabold leading-none tabular-nums tracking-tight text-ink dark:text-[#f4f1ea] sm:text-[46px]">
              {rs(pay?.payable ?? 0)}
            </div>
            {pay?.is_paid ? (
              <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-[12px] font-semibold text-emerald-800">
                <Wallet size={12} /> Paid
              </div>
            ) : (
              <div className="mt-2.5 inline-block rounded-full border border-line px-3 py-1 text-[12px] font-semibold text-muted dark:border-white/15 dark:text-[#a89f93]">
                Not paid yet
              </div>
            )}
          </div>

          <dl className="border-t border-line text-[13px] dark:border-white/10">
            {[
              [`${rs(me.salary)} ÷ 30 × ${pay?.counted_days ?? 0} days`, rs(gross), ""],
              ...(Number(pay?.advances) > 0
                ? [["Advances already taken", "− " + rs(pay?.advances), "text-amber-700"] as [string, string, string]]
                : []),
            ].map(([label, value, tone], i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5 last:border-0 dark:border-white/[0.06] sm:px-5">
                <dt className="text-muted dark:text-[#a89f93]">{label}</dt>
                <dd className={`shrink-0 font-semibold tabular-nums ${tone || "text-ink dark:text-[#e7e2d8]"}`}>{value}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 bg-panel px-4 py-3 dark:bg-white/[0.04] sm:px-5">
              <dt className="font-bold text-ink dark:text-[#f4f1ea]">Net payable</dt>
              <dd className="shrink-0 text-[15px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{rs(pay?.payable ?? 0)}</dd>
            </div>
          </dl>
        </section>

        {/* THE DAYS BEHIND THE FIGURE.
            A ruled list, not eight boxes: on a phone eight boxes is eight things
            to squint at, and each of these is a labelled quantity that belongs
            in a column with the others. Zero rows are dropped — a row saying
            "Half days 0" is a line the reader has to check and discard. */}
        <section className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/10 dark:bg-[#201c17]">
          <h2 className="border-b border-line px-4 py-3 text-[13px] font-bold text-ink dark:border-white/10 dark:text-[#f4f1ea] sm:px-5">
            How the {pay?.counted_days ?? 0} days add up
          </h2>
          <dl className="grid text-[13px] sm:grid-cols-2">
            {([
              ["Days present", String(pay?.present ?? 0), "text-emerald-700", true],
              ["Half days", String(pay?.half ?? 0), "text-amber-700", Number(pay?.half) > 0],
              ["Approved leave — paid", String(pay?.leave_days ?? 0), "text-sky-700", Number(pay?.leave_days) > 0],
              ["Absent — not counted", String(pay?.absent ?? 0), "text-red-700", Number(pay?.absent) > 0],
              ["Sundays & holidays — paid", String(pay?.paid_off ?? 0), "text-ink dark:text-[#e7e2d8]", true],
              ["Days off you worked", `+${pay?.extra_days ?? 0}`, "text-emerald-700", Number(pay?.extra_days) > 0],
            ] as [string, string, string, boolean][]).filter(([, , , show]) => show).map(([label, value, tone], i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5 dark:border-white/[0.06] sm:px-5 sm:even:border-l">
                <dt className="text-muted dark:text-[#a89f93]">{label}</dt>
                <dd className={`shrink-0 text-[14px] font-bold tabular-nums ${tone}`}>{value}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 bg-panel px-4 py-3 dark:bg-white/[0.04] sm:col-span-2 sm:px-5">
              <dt className="font-bold text-ink dark:text-[#f4f1ea]">Counted days</dt>
              <dd className="shrink-0 text-[15px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{pay?.counted_days ?? 0}</dd>
            </div>
          </dl>
        </section>

        {/* THE EVIDENCE.
            Every day of the month as it was marked. This is the part somebody
            checks when a figure looks wrong, so it comes before the explanation
            and after the total. */}
        <section className="mt-4 rounded-card border border-line bg-surface p-4 dark:border-white/10 dark:bg-[#201c17] sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-ink dark:text-[#f4f1ea]">
            <CalendarDays size={15} /> Your days in {MONTHS[month]}
          </h2>
          <div className="grid grid-cols-7 gap-1 text-center sm:gap-1.5">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-hint dark:text-[#8a8175]">{d}</div>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dnum = i + 1;
              const st = byDay.get(dnum);
              const sunday = new Date(year, month - 1, dnum).getDay() === 0;
              const workedOff = sunday && (st === "P" || st === "H" || st === "L");
              const cls =
                workedOff ? "bg-success-soft text-emerald-900 ring-1 ring-emerald-300"
                : st === "P" ? "bg-success-soft text-emerald-800"
                : st === "L" ? "bg-periwinkle-soft text-sky-800"
                : st === "H" ? "bg-amber-soft text-amber-900"
                : st === "A" ? "bg-salmon-soft text-red-800"
                : sunday ? "bg-panel text-muted dark:bg-white/[0.06]"
                : "text-hint dark:text-[#6f675d]";
              const word = workedOff ? "worked" : st === "P" ? "present" : st === "H" ? "half"
                : st === "L" ? "leave" : st === "A" ? "absent" : sunday ? "off" : "";
              return (
                <div key={dnum} title={`${dnum} ${MONTHS[month]}${word ? " — " + word : " — not marked"}`}
                     className={`rounded-lg py-1.5 ${cls}`}>
                  <div className="text-[12px] font-bold tabular-nums leading-none">{dnum}</div>
                  <div className="mt-0.5 text-[8.5px] font-medium uppercase leading-none tracking-wide opacity-80">{word}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ADVANCES.
            Money already in their hand, which is why it is a separate section
            and not a line hidden inside the total. */}
        <section className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/10 dark:bg-[#201c17]">
          <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-bold text-ink dark:border-white/10 dark:text-[#f4f1ea] sm:px-5">
            <HandCoins size={15} /> Advances taken this month
          </h2>
          {advs.length === 0 ? (
            <p className="px-4 py-5 text-[13px] text-muted dark:text-[#a89f93] sm:px-5">
              You have not taken any advance in {MONTHS[month]}.
            </p>
          ) : (
            <dl className="text-[13px]">
              {advs.map((a, i) => (
                <div key={i} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5 dark:border-white/[0.06] sm:px-5">
                  <dt className="min-w-0">
                    <span className="text-ink dark:text-[#e7e2d8]">{a.date}</span>
                    {a.note && <span className="ml-2 text-muted dark:text-[#a89f93]">{a.note}</span>}
                  </dt>
                  <dd className="shrink-0 font-semibold tabular-nums">{rs(a.amount)}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 bg-panel px-4 py-3 dark:bg-white/[0.04] sm:px-5">
                <dt className="font-bold text-ink dark:text-[#f4f1ea]">Deducted from this month</dt>
                <dd className="shrink-0 font-extrabold tabular-nums text-amber-700">− {rs(pay?.advances ?? 0)}</dd>
              </div>
            </dl>
          )}
        </section>

        <p className="mt-4 px-1 text-[11.5px] leading-relaxed text-hint dark:text-[#8a8175]">
          Sundays and public holidays are paid. Working one adds a day. An absent day is
          not counted and is the only thing that reduces what you earn.
          {isCurrent && " This month is still running, so the figure grows each day you are marked present."}
          {" "}Something look wrong? Speak to whoever marks attendance for your department.
        </p>

      </div>
    </div>
  );
}
