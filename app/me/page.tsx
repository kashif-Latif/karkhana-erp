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
    <div className="min-h-screen bg-canvas pb-10 dark:bg-[#17140f]">
      <div className="mx-auto max-w-2xl px-4 pt-6 sm:px-6">

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-extrabold text-ink dark:text-[#f4f1ea]">{me.name}</h1>
            <p className="text-[13px] text-muted dark:text-[#a89f93]">
              {me.designation ?? "—"}{me.department && ` · ${me.department}`} · {rs(me.salary)}/month
            </p>
          </div>
          <button onClick={signOut} aria-label="Sign out"
                  className="shrink-0 rounded-full border border-line p-2 text-muted hover:bg-panel dark:border-white/10 dark:hover:bg-white/10">
            <LogOut size={15} />
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                  className="flex-1 rounded-full border border-line bg-surface px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                  className="rounded-full border border-line bg-surface px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {[year - 1, year].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* The number they came for. */}
        <div className="mt-4 rounded-card border border-line bg-surface p-5 text-center dark:border-white/10 dark:bg-[#201c17]">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-muted dark:text-[#a89f93]">
            {isCurrent ? "Earned so far this month" : `Payable for ${MONTHS[month]}`}
          </div>
          <div className="mt-1 text-[34px] font-extrabold leading-none tabular-nums text-ink dark:text-[#f4f1ea]">
            {rs(pay?.payable ?? 0)}
          </div>
          {pay?.is_paid && (
            <div className="mt-2 inline-block rounded-full bg-success-soft px-3 py-1 text-[12px] font-semibold text-emerald-800">
              Paid
            </div>
          )}
          {isCurrent && (
            <p className="mt-2 text-[12px] text-hint dark:text-[#8a8175]">
              Counts days up to today. It grows as the month goes on.
            </p>
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {[["Present", pay?.present ?? 0, "text-emerald-700"],
            ["Half", pay?.half ?? 0, "text-amber-700"],
            ["Absent", pay?.absent ?? 0, "text-red-700"]].map(([l, v, c]) => (
            <div key={l as string} className="rounded-card border border-line bg-surface p-3 text-center dark:border-white/10 dark:bg-[#201c17]">
              <div className={`text-[20px] font-extrabold tabular-nums ${c}`}>{v as number}</div>
              <div className="text-[11.5px] text-muted dark:text-[#a89f93]">{l as string}</div>
            </div>
          ))}
        </div>

        {/* The calendar. Their own record, so a wrong day can be queried early. */}
        <div className="mt-4 rounded-card border border-line bg-surface p-4 dark:border-white/10 dark:bg-[#201c17]">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">
            <CalendarDays size={15} /> {MONTHS[month]} {year}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] text-muted dark:text-[#a89f93]">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1">{d}</div>)}
            {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dnum = i + 1;
              const st = byDay.get(dnum);
              const sunday = new Date(year, month - 1, dnum).getDay() === 0;
              const cls =
                st === "P" ? "bg-success-soft text-emerald-800"
                : st === "H" ? "bg-amber-soft text-amber-900"
                : st === "A" ? "bg-salmon-soft text-red-800"
                : sunday ? "bg-panel text-muted dark:bg-white/[0.06]"
                : "text-hint";
              return (
                <div key={dnum} className={`rounded-lg py-2 text-[12px] font-semibold ${cls}`}>
                  <div>{dnum}</div>
                  <div className="text-[9.5px] font-normal">{st ?? (sunday ? "Sun" : "")}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-hint dark:text-[#8a8175]">
            P present · H half · A absent · Sundays and public holidays are paid
          </div>
        </div>

        {/* Advances: money already received, so it is shown as a deduction and
            never buried inside the payable. */}
        <div className="mt-4 rounded-card border border-line bg-surface p-4 dark:border-white/10 dark:bg-[#201c17]">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">
            <HandCoins size={15} /> Advances taken
          </div>
          {advs.length === 0 ? (
            <p className="text-[13px] text-muted dark:text-[#a89f93]">None this month.</p>
          ) : (
            <div className="space-y-1.5">
              {advs.map((a, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-muted dark:text-[#a89f93]">
                    {a.date}{a.note && <span className="text-hint"> · {a.note}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">− {rs(a.amount)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-line pt-1.5 text-[13px] font-bold dark:border-white/10">
                <span>Total deducted</span>
                <span className="tabular-nums">− {rs(pay?.advances ?? 0)}</span>
              </div>
            </div>
          )}
        </div>

        {/* The working, so the figure at the top is checkable rather than trusted. */}
        <div className="mt-4 rounded-card border border-line bg-panel p-4 text-[12.5px] dark:border-white/10 dark:bg-white/[0.04]">
          <div className="mb-1.5 flex items-center gap-2 font-semibold text-ink dark:text-[#f4f1ea]">
            <Wallet size={14} /> How this is worked out
          </div>
          <div className="space-y-1 text-muted dark:text-[#a89f93]">
            <div className="flex justify-between"><span>Present days</span><span className="tabular-nums">{pay?.present ?? 0}</span></div>
            {Number(pay?.half) > 0 && <div className="flex justify-between"><span>Half days (count as ½)</span><span className="tabular-nums">{pay?.half}</span></div>}
            <div className="flex justify-between"><span>Paid days off</span><span className="tabular-nums">{pay?.paid_off ?? 0}</span></div>
            {Number(pay?.extra_days) > 0 && <div className="flex justify-between"><span>Days off worked (extra)</span><span className="tabular-nums">+{pay?.extra_days}</span></div>}
            <div className="flex justify-between border-t border-line pt-1 font-semibold text-ink dark:border-white/10 dark:text-[#f4f1ea]">
              <span>Counted days</span><span className="tabular-nums">{pay?.counted_days ?? 0}</span>
            </div>
            <div className="flex justify-between"><span>{rs(me.salary)} ÷ 30 × {pay?.counted_days ?? 0}</span>
              <span className="tabular-nums">{rs((Number(me.salary) / 30) * Number(pay?.counted_days ?? 0))}</span></div>
            <div className="flex justify-between"><span>Less advances</span><span className="tabular-nums">− {rs(pay?.advances ?? 0)}</span></div>
            <div className="flex justify-between border-t border-line pt-1 text-[13px] font-bold text-ink dark:border-white/10 dark:text-[#f4f1ea]">
              <span>Payable</span><span className="tabular-nums">{rs(pay?.payable ?? 0)}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
