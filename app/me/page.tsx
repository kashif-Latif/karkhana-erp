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
  extra_days: number; counted_days: number; gross: number; advances: number;
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
  /* The calendar has to know about public holidays too.
     It only checked for Sundays, so 14 August — Independence Day, worked —
     showed as an ordinary "present" day while the figures above it said
     "days off you worked +1". The two disagreed on the same screen, and the
     calendar was the one that was wrong. */
  const [hols, setHols] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [m, p, d, a, h] = await Promise.all([
      supabase.rpc("my_employee"),
      supabase.rpc("my_monthly_payable", { p_year: year, p_month: month }),
      supabase.rpc("my_attendance", { p_year: year, p_month: month }),
      supabase.rpc("my_advances", { p_year: year, p_month: month }),
      supabase.from("online_att_holidays").select("hdate,name"),
    ]);
    if (m.error) setErr(m.error.message);
    setMe(((m.data as Me[]) ?? [])[0] ?? null);
    setPay(((p.data as Pay[]) ?? [])[0] ?? null);
    setDays((d.data as Day[]) ?? []);
    setAdvs((a.data as Adv[]) ?? []);
    setHols(new Set(((h.data as { hdate: string }[]) ?? []).map((x) => x.hdate)));
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
  /* The gross comes from the database, not from salary ÷ 30 × days here.
     That local sum cannot know a rate changed mid-month, which is precisely how
     Hamza Khan's August was overstated by Rs 7,700. */
  const gross = Number(pay?.gross ?? 0);

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

      {/* THE IDENTITY BAND.
          A wage slip opens by saying who it is for and what it is worth, and
          everything after that is the working. So the department, the person and
          the amount share one dark field at the top — the single bold thing on
          the page. Everything below stays light and ruled, which is what makes
          this read as a document rather than a wall of cards. */}
      <header className="bg-ink text-white dark:bg-[#221d17]">
        <div className="mx-auto max-w-5xl px-4 pb-7 pt-5 sm:px-6 sm:pb-9 sm:pt-7">

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/55">
                {me.department ?? "Employee"}
              </div>
              <h1 className="mt-1.5 truncate text-[26px] font-extrabold leading-none tracking-tight sm:text-[32px]">
                {me.name}
              </h1>
              <p className="mt-1.5 text-[13px] text-white/60">
                {me.designation ?? "—"} · {rs(me.salary)} a month
              </p>
            </div>
            <button onClick={signOut} aria-label="Sign out"
                    className="shrink-0 rounded-full border border-white/20 p-2 text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <LogOut size={15} />
            </button>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-white/55">
                {isCurrent ? `Earned up to ${today.getDate()} ${MONTHS[month]}` : `Payable for ${MONTHS[month]}`}
              </div>
              <div className="mt-1 text-[42px] font-extrabold leading-none tabular-nums tracking-tight sm:text-[54px]">
                {rs(pay?.payable ?? 0)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {pay?.is_paid ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1.5 text-[12px] font-bold text-emerald-200">
                  <Wallet size={12} /> Paid
                </span>
              ) : (
                <span className="rounded-full border border-white/25 px-3 py-1.5 text-[12px] font-semibold text-white/70">
                  Not paid yet
                </span>
              )}
              <label className="sr-only" htmlFor="m">Month</label>
              <select id="m" value={month} onChange={(e) => setMonth(Number(e.target.value))}
                      className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1} className="text-ink">{m}</option>)}
              </select>
              <label className="sr-only" htmlFor="y">Year</label>
              <select id="y" value={year} onChange={(e) => setYear(Number(e.target.value))}
                      className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                {[year - 1, year].map((y) => <option key={y} value={y} className="text-ink">{y}</option>)}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Two columns on a desktop, stacked on a phone. The order is the order
          somebody reads in: the money first, then the days behind it, then the
          evidence. On a wide screen the calendar sits beside the figures rather
          than a screen below them. */}
      <div className="mx-auto -mt-4 max-w-5xl px-4 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr] lg:items-start">

          <div className="space-y-4">

            <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card dark:border-white/10 dark:bg-[#201c17]">
              <h2 className="border-b border-line px-4 py-3 text-[13px] font-bold text-ink dark:border-white/10 dark:text-[#f4f1ea] sm:px-5">
                How this is worked out
              </h2>
              <dl className="text-[13px]">
                <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5 dark:border-white/[0.06] sm:px-5">
                  <dt className="text-muted dark:text-[#a89f93]">
                    Earned over {pay?.counted_days ?? 0} days
                    <span className="mt-0.5 block text-[11.5px] text-hint dark:text-[#8a8175]">
                      each day at that day&rsquo;s rate ÷ 30
                    </span>
                  </dt>
                  <dd className="shrink-0 font-semibold tabular-nums text-ink dark:text-[#e7e2d8]">{rs(gross)}</dd>
                </div>
                {Number(pay?.advances) > 0 && (
                  <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5 dark:border-white/[0.06] sm:px-5">
                    <dt className="text-muted dark:text-[#a89f93]">Advances already taken</dt>
                    <dd className="shrink-0 font-semibold tabular-nums text-amber-700">− {rs(pay?.advances)}</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-4 bg-panel px-4 py-3 dark:bg-white/[0.04] sm:px-5">
                  <dt className="font-bold text-ink dark:text-[#f4f1ea]">Net payable</dt>
                  <dd className="shrink-0 text-[16px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">
                    {rs(pay?.payable ?? 0)}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Zero rows are dropped. A line reading "Half days 0" is one the
                reader has to check and then discard. */}
            <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card dark:border-white/10 dark:bg-[#201c17]">
              <h2 className="border-b border-line px-4 py-3 text-[13px] font-bold text-ink dark:border-white/10 dark:text-[#f4f1ea] sm:px-5">
                The {pay?.counted_days ?? 0} days you are paid for
              </h2>
              <dl className="text-[13px]">
                {([
                  ["Days present", String(pay?.present ?? 0), "text-emerald-700", true],
                  ["Half days", String(pay?.half ?? 0), "text-amber-700", Number(pay?.half) > 0],
                  ["Approved leave — paid", String(pay?.leave_days ?? 0), "text-sky-700", Number(pay?.leave_days) > 0],
                  ["Absent — not counted", String(pay?.absent ?? 0), "text-red-700", Number(pay?.absent) > 0],
                  ["Sundays & holidays — paid", String(pay?.paid_off ?? 0), "text-ink dark:text-[#e7e2d8]", true],
                  ["Days off you worked", `+${pay?.extra_days ?? 0}`, "text-emerald-700", Number(pay?.extra_days) > 0],
                ] as [string, string, string, boolean][]).filter(([, , , show]) => show).map(([label, value, tone], i) => (
                  <div key={i} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5 dark:border-white/[0.06] sm:px-5">
                    <dt className="text-muted dark:text-[#a89f93]">{label}</dt>
                    <dd className={`shrink-0 text-[14px] font-bold tabular-nums ${tone}`}>{value}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-4 bg-panel px-4 py-3 dark:bg-white/[0.04] sm:px-5">
                  <dt className="font-bold text-ink dark:text-[#f4f1ea]">Counted days</dt>
                  <dd className="shrink-0 text-[16px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">
                    {pay?.counted_days ?? 0}
                  </dd>
                </div>
              </dl>
            </section>

          </div>

          <div className="space-y-4">

            <section className="rounded-card border border-line bg-surface p-4 shadow-card dark:border-white/10 dark:bg-[#201c17] sm:p-5">
              <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-ink dark:text-[#f4f1ea]">
                <CalendarDays size={15} /> Your days in {MONTHS[month]}
              </h2>
              <div className="grid grid-cols-7 gap-1 text-center sm:gap-1.5">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <div key={i} className="pb-1 text-[10px] font-bold uppercase tracking-wider text-hint dark:text-[#8a8175]">{d}</div>
                ))}
                {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const dnum = i + 1;
                  const st = byDay.get(dnum);
                  const iso = `${year}-${String(month).padStart(2, "0")}-${String(dnum).padStart(2, "0")}`;
                  const sunday = new Date(year, month - 1, dnum).getDay() === 0;
                  const holiday = hols.has(iso);
                  const off = sunday || holiday;
                  const workedOff = off && (st === "P" || st === "H" || st === "L");
                  const cls =
                    workedOff ? "bg-success-soft text-emerald-900 ring-2 ring-emerald-400"
                    : st === "P" ? "bg-success-soft text-emerald-800"
                    : st === "L" ? "bg-periwinkle-soft text-sky-800"
                    : st === "H" ? "bg-amber-soft text-amber-900"
                    : st === "A" ? "bg-salmon-soft text-red-800"
                    : off ? "bg-panel text-muted dark:bg-white/[0.06]"
                    : "text-hint dark:text-[#6f675d]";
                  const word = workedOff ? "worked" : st === "P" ? "present" : st === "H" ? "half"
                    : st === "L" ? "leave" : st === "A" ? "absent"
                    : holiday ? "holiday" : sunday ? "off" : "";
                  return (
                    <div key={dnum} title={`${dnum} ${MONTHS[month]}${holiday ? " · public holiday" : ""} — ${word || "not marked"}`}
                         className={`rounded-xl py-2 ${cls}`}>
                      <div className="text-[12.5px] font-bold tabular-nums leading-none">{dnum}</div>
                      <div className="mt-1 text-[8.5px] font-semibold uppercase leading-none tracking-wide opacity-75">{word}</div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card dark:border-white/10 dark:bg-[#201c17]">
              <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-bold text-ink dark:border-white/10 dark:text-[#f4f1ea] sm:px-5">
                <HandCoins size={15} /> Advances taken
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
                    <dt className="font-bold text-ink dark:text-[#f4f1ea]">Deducted this month</dt>
                    <dd className="shrink-0 font-extrabold tabular-nums text-amber-700">− {rs(pay?.advances ?? 0)}</dd>
                  </div>
                </dl>
              )}
            </section>

          </div>
        </div>

        <p className="mt-5 px-1 text-[11.5px] leading-relaxed text-hint dark:text-[#8a8175]">
          Sundays and public holidays are paid. Working one adds a day. An absent day is
          not counted, and it is the only thing that reduces what you earn.
          {isCurrent && " This month is still running, so the figure grows each day you are marked present."}
          {" "}Something look wrong? Speak to whoever marks attendance for your department.
        </p>
      </div>
    </div>
  );
}
