"use client";
/* One employee, one month, everything — opened by clicking a row in the summary.
 *
 * The summary answers "what is everyone owed". This answers "why is THIS person
 * owed that", which is the question actually asked when somebody queries their
 * pay. Without it the only reply is a total, and a total cannot be argued with
 * or agreed to — it can only be accepted.
 *
 * So it shows the working: every day of the month, every advance, and the
 * arithmetic laid out line by line. Anyone can follow it to the same answer.
 *
 * Same calculation as the summary — hub_monthly_payable — because a detail view
 * that recomputed would eventually disagree with the list it opened from, and
 * whichever number was wrong, nobody would know which.
 */
import { useCallback, useEffect, useState } from "react";
import { X, Loader2, Check, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Row = {
  emp_id: string; name: string; designation: string | null; salary: number;
  present: number; half: number; absent: number; leave_days: number;
  absent_deduction: number; paid_off: number; extra_days: number;
  counted_days: number; advances: number; payable: number; is_paid: boolean;
};
type Day = { day: number; status: string };
type Adv = { date: string; amount: number; note: string | null };

const MONTHS = ["", "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
const rs = (v: unknown) => "Rs " + Math.round(Number(v) || 0).toLocaleString("en-PK");

export default function EmployeeMonthDetail({
  row, year, month, onClose, onChanged,
}: { row: Row; year: number; month: number; onClose: () => void; onChanged: () => void }) {
  const [days, setDays] = useState<Day[]>([]);
  const [advs, setAdvs] = useState<Adv[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(row.is_paid);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [d, a] = await Promise.all([
      supabase.from("online_att_records").select("day,status")
        .eq("emp_id", row.emp_id).eq("year", year).eq("month", month).order("day"),
      supabase.from("online_att_advances").select("date,amount,note")
        .eq("emp_id", row.emp_id).eq("deduct_year", year).eq("deduct_month", month).order("date"),
    ]);
    if (d.error) setErr(d.error.message);
    setDays((d.data as Day[]) ?? []);
    setAdvs((a.data as Adv[]) ?? []);
    setLoading(false);
  }, [row.emp_id, year, month]);
  useEffect(() => { load(); }, [load]);

  async function togglePaid() {
    if (!supabase) return;
    setBusy(true); setErr("");
    const { error } = await supabase.from("online_att_salary_status")
      .upsert({ id: `${row.emp_id}-${year}-${month}`, emp_id: row.emp_id,
                year, month, paid: !paid }, { onConflict: "id" });
    if (error) setErr(error.message); else { setPaid(!paid); onChanged(); }
    setBusy(false);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const byDay = new Map(days.map((d) => [d.day, (d.status || "").toUpperCase()]));
  const gross = (Number(row.salary) / 30) * Number(row.counted_days);

  const cards: [string, string, string][] = [
    ["Present", String(row.present), "text-emerald-700"],
    ["Half", String(row.half), "text-amber-700"],
    ["Leave", String(row.leave_days ?? 0), "text-sky-700"],
    ["Absent", String(row.absent), "text-red-700"],
    ["Paid off", String(row.paid_off), "text-ink dark:text-[#f4f1ea]"],
    ["Extra days", `+${row.extra_days}`, "text-emerald-700"],
    ["Counted", String(row.counted_days), "text-ink dark:text-[#f4f1ea]"],
    ["Payable", rs(row.payable), "text-ink dark:text-[#f4f1ea]"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
         onClick={onClose}>
      <div className="w-full max-w-3xl rounded-card border border-line bg-surface p-5 shadow-xl dark:border-white/10 dark:bg-[#1a1713]"
           onClick={(e) => e.stopPropagation()}>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[17px] font-extrabold text-ink dark:text-[#f4f1ea]">{row.name}</div>
            <div className="text-[12.5px] text-muted dark:text-[#a89f93]">
              {row.designation ?? "—"} · {rs(row.salary)}/month · {MONTHS[month]} {year}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={togglePaid} disabled={busy}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-50 ${
                paid ? "bg-success-soft text-emerald-800"
                     : "bg-ink text-white dark:bg-white dark:text-[#141414]"}`}>
              {busy ? <Loader2 size={12} className="animate-spin" />
                : paid ? <><Check size={12} className="mr-1 inline" />Paid</> : "Mark paid"}
            </button>
            <button onClick={onClose} aria-label="Close"
                    className="rounded-full p-1.5 text-muted hover:bg-panel dark:hover:bg-white/10"><X size={17} /></button>
          </div>
        </div>

        {err && (
          <div className="mt-3 flex gap-2 rounded-card border border-red-300 bg-red-50 p-2.5 text-[12px] text-red-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{err}</span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {cards.map(([label, value, tone]) => (
            <div key={label} className="rounded-card border border-line p-2.5 dark:border-white/10">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted dark:text-[#a89f93]">{label}</div>
              <div className={`mt-0.5 text-[17px] font-extrabold tabular-nums ${tone}`}>{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">
            Attendance — {MONTHS[month]} {year}
          </div>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] text-muted dark:text-[#a89f93]">
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => <div key={d} className="py-1">{d}</div>)}
                {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const dnum = i + 1;
                  const st = byDay.get(dnum);
                  const sunday = new Date(year, month - 1, dnum).getDay() === 0;
                  const workedOff = sunday && (st === "P" || st === "H" || st === "L");
                  const cls =
                    workedOff ? "bg-success-soft text-emerald-800 font-bold"
                    : st === "P" ? "bg-success-soft text-emerald-800"
                    : st === "L" ? "bg-periwinkle-soft text-sky-800"
                    : st === "H" ? "bg-amber-soft text-amber-900"
                    : st === "A" ? "bg-salmon-soft text-red-800"
                    : sunday ? "bg-panel text-muted dark:bg-white/[0.06]"
                    : "text-hint";
                  return (
                    <div key={dnum} className={`rounded-lg py-1.5 text-[11.5px] font-semibold ${cls}`}>
                      <div>{dnum}</div>
                      <div className="text-[9px] font-normal">
                        {workedOff ? "Sun+" : st ?? (sunday ? "Sun" : "")}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[10.5px] text-hint dark:text-[#8a8175]">
                P present · H half · L leave (paid) · A absent · Sun paid Sunday ·
                Sun+ worked a day off (+1) · blank not marked
              </div>
            </>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-1.5 text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">
            Advances deducted this month
          </div>
          {advs.length === 0 ? (
            <p className="text-[13px] text-muted dark:text-[#a89f93]">None.</p>
          ) : (
            <div className="overflow-hidden rounded-card border border-line dark:border-white/10">
              <table className="w-full text-[12.5px]">
                <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                  {advs.map((a, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-muted dark:text-[#a89f93]">{a.date}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums">{rs(a.amount)}</td>
                      <td className="px-3 py-2 text-muted dark:text-[#a89f93]">{a.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* The arithmetic, line by line. A total nobody can follow can only be
            accepted, never agreed to. */}
        <div className="mt-4 rounded-card border border-line bg-panel p-3.5 text-[12.5px] dark:border-white/10 dark:bg-white/[0.04]">
          <div className="mb-1.5 font-semibold text-ink dark:text-[#f4f1ea]">Payable breakdown</div>
          <div className="space-y-1 text-muted dark:text-[#a89f93]">
            <div className="flex justify-between">
              <span>{rs(row.salary)} ÷ 30 × {row.counted_days} counted days</span>
              <span className="tabular-nums">{rs(gross)}</span>
            </div>
            {Number(row.extra_days) > 0 && (
              <div className="text-[11.5px] text-emerald-700">
                includes {row.extra_days} day{Number(row.extra_days) > 1 ? "s" : ""} off worked (+{row.extra_days})
              </div>
            )}
            {Number(row.absent) > 0 && (
              <div className="flex justify-between text-red-700">
                <span>{row.absent} absent day{Number(row.absent) > 1 ? "s" : ""} — not counted</span>
                <span className="tabular-nums">− {rs(row.absent_deduction)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Less advances</span>
              <span className="tabular-nums">− {rs(row.advances)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5 text-[14px] font-bold text-ink dark:border-white/10 dark:text-[#f4f1ea]">
              <span>Net payable</span><span className="tabular-nums">{rs(row.payable)}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
