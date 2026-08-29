"use client";
import { useEffect, useState } from "react";
import { Plus, UserPlus, CalendarCheck, Wallet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";

type Result = { ok: boolean; msg: string } | null;
export type EmpLite = { id: string; name: string };

/* THE CODE IS WHAT GETS STORED, AND IT MUST BE ONE LETTER.
   This wrote the full word — "Present" — while every imported record and the
   payable function use 'P'. Anything marked from today would have been
   invisible to the salary calculation, and nobody would have found out until
   payday. The label is for the person; the code is for the database.

   Leave is PAID: an approved day off should not cost somebody their wage, which
   is the whole difference between leave and absence. It counts as a present day.
   Absent is unpaid — the day simply is not counted, and that is the deduction. */
const STATUSES: { code: string; label: string; hint: string }[] = [
  { code: "P", label: "Present",  hint: "full day, paid" },
  { code: "H", label: "Half day", hint: "counts as ½ a day" },
  { code: "L", label: "Leave",    hint: "approved, paid in full" },
  { code: "A", label: "Absent",   hint: "not counted — a day's pay is lost" },
  /* CLEAR REMOVES THE MARK ENTIRELY, back to blank.
     Every other option OVERWRITES: mark somebody Absent and the day still says
     something. There was no way to say "this day should never have been marked"
     — and on a Sunday that matters, because a Sunday marked Present earns an
     EXTRA day on top of being paid, so one stray tap put Abdul Rehman on 31
     counted days and Rs 62,018 against a Rs 61,000 salary.

     Overwriting with Absent would have been worse: it would have read as a day
     he failed to turn up, on a day nobody was expected to. */
  { code: "",  label: "Clear",    hint: "remove the mark — back to not marked" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const today = () => new Date().toISOString().slice(0, 10);
/** these tables use a TEXT primary key supplied by the app, not a sequence */
const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Feedback({ res }: { res: Result }) {
  if (!res) return null;
  return (
    <p className={`mt-3 flex items-center gap-1.5 text-[13px] font-semibold ${res.ok ? "text-success" : "text-danger"}`}>
      {res.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{res.msg}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Employee                                                           */
/* ------------------------------------------------------------------ */
export function AddEmployee({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const [f, setF] = useState({ name: "", designation: "", department: "", phone: "", sal: "", wd: "26", dtime: "10:00" });

  async function save() {
    if (!supabase) return;
    if (!f.name.trim()) { setRes({ ok: false, msg: "Name is required." }); return; }
    setBusy(true); setRes(null);
    const { error } = await supabase.from("online_att_employees").insert({
      id: newId("emp"),
      name: f.name.trim(),
      designation: f.designation.trim() || null,
      department: f.department.trim() || null,
      phone: f.phone.trim() || null,
      sal: f.sal ? Number(f.sal) : 0,
      wd: f.wd ? Number(f.wd) : 26,
      dtime: f.dtime || "10:00",
    });
    setBusy(false);
    if (error) { setRes({ ok: false, msg: error.message }); return; }
    setRes({ ok: true, msg: `${f.name.trim()} added.` });
    setF({ name: "", designation: "", department: "", phone: "", sal: "", wd: "26", dtime: "10:00" });
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnPrimary}><UserPlus size={15} /> Add employee</button>
      <Modal open={open} onClose={() => setOpen(false)} wide title="Add employee" subtitle="Joins the Hub attendance roster.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name *"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Designation"><input className={inputCls} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
          <Field label="Department"><input className={inputCls} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="03XXXXXXXXX" /></Field>
          <Field label="Monthly salary (Rs)"><input type="number" className={inputCls} value={f.sal} onChange={(e) => setF({ ...f, sal: e.target.value })} /></Field>
          <Field label="Working days / month"><input type="number" className={inputCls} value={f.wd} onChange={(e) => setF({ ...f, wd: e.target.value })} /></Field>
          <Field label="Duty time"><input type="time" className={inputCls} value={f.dtime} onChange={(e) => setF({ ...f, dtime: e.target.value })} /></Field>
        </div>
        <Feedback res={res} />
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save employee</button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Daily attendance                                                   */
/* ------------------------------------------------------------------ */
export function MarkAttendance({ emps, onDone }: { emps: EmpLite[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const [date, setDate] = useState(today());
  /* WHAT IS ALREADY MARKED FOR THIS DAY.
     Marking twice has always corrected the record — the id is built from
     employee and date, so a second save overwrites. What was missing was
     being able to SEE it: the list gave no hint that somebody was already
     marked, so a correction looked identical to a first entry and a mistake
     stayed invisible until it turned up in a salary. */
  const [existing, setExisting] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      if (!supabase || !date) return;
      const d = new Date(date);
      if (isNaN(d.getTime())) return;
      const { data } = await supabase.from("online_att_records")
        .select("emp_id,status")
        .eq("year", d.getFullYear()).eq("month", d.getMonth() + 1).eq("day", d.getDate());
      const m: Record<string, string> = {};
      for (const r of (data ?? []) as { emp_id: string; status: string }[]) m[r.emp_id] = r.status;
      setExisting(m);
    })();
  }, [date, res]);

  const [status, setStatus] = useState("P");
  const [timeIn, setTimeIn] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));




  async function save() {
    if (!supabase) return;
    if (!picked.length) { setRes({ ok: false, msg: "Select at least one employee." }); return; }
    const d = new Date(date);
    if (isNaN(d.getTime())) { setRes({ ok: false, msg: "Pick a valid date." }); return; }
    setBusy(true); setRes(null);

    const [y, m, day] = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    // id is built from employee + date, so marking the same day twice corrects
    // the record instead of creating a second one
    /* Clearing is a delete, not a write. Storing an empty status would leave a
       row that says nothing and still has to be reasoned about. */
    if (status === "") {
      const { error: de } = await supabase.from("online_att_records").delete()
        .in("emp_id", picked).eq("year", y).eq("month", m).eq("day", day);
      setBusy(false);
      if (de) { setRes({ ok: false, msg: de.message }); return; }
      setRes({ ok: true, msg: `${picked.length} mark(s) removed for ${date}. Those days now count as not marked.` });
      setPicked([]);
      onDone();
      return;
    }

    const rowsToSave = picked.map((emp_id) => ({
      id: `${emp_id}-${y}-${m}-${day}`,
      emp_id, year: y, month: m, day,
      status,
      time_in: status === "P" || status === "H" ? timeIn : "",
    }));

    const { error } = await supabase.from("online_att_records").upsert(rowsToSave, { onConflict: "emp_id,year,month,day" });
    setBusy(false);
    if (error) { setRes({ ok: false, msg: error.message }); return; }
    // Say plainly when a save changed something rather than added it.
    const changed = picked.filter((id) => existing[id] && existing[id] !== status).length;
    setRes({ ok: true, msg: `${rowsToSave.length} marked ${status} for ${date}` +
      (changed ? ` — ${changed} of them corrected from a previous mark.` : ".") });
    setPicked([]);
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnPrimary}><CalendarCheck size={15} /> Mark attendance</button>
      <Modal open={open} onClose={() => setOpen(false)} wide title="Mark attendance"
        subtitle="Pick a date and status, then tick everyone it applies to. Re-marking the same day corrects the record.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Status">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label} — {s.hint}</option>)}</select>
          </Field>
          <Field label="Time in">
            <input type="time" className={inputCls} value={timeIn} disabled={status !== "P" && status !== "H"}
              onChange={(e) => setTimeIn(e.target.value)} />
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink dark:text-[#f4f1ea]">Employees ({picked.length} selected)</span>
            <button onClick={() => setPicked(picked.length === emps.length ? [] : emps.map((e) => e.id))}
              className="text-[12px] font-semibold text-muted underline hover:text-ink dark:text-[#a89f93] dark:hover:text-white">
              {picked.length === emps.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto rounded-card border border-line p-1 dark:border-white/[0.06]">
            {emps.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted dark:text-[#a89f93]">No employees yet — add one first.</p>}
            {emps.map((e) => {
              const now = existing[e.id];
              return (
              <label key={e.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl2 px-3 py-2 text-[13px] text-ink transition hover:bg-panel dark:text-[#f4f1ea] dark:hover:bg-white/[0.05]">
                <input type="checkbox" checked={picked.includes(e.id)} onChange={() => toggle(e.id)} className="h-4 w-4 accent-current" />
                <span className="flex-1">{e.name}</span>
                {/* What this day already says, so a correction looks like one. */}
                {now && (
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                    now === "P" ? "bg-success-soft text-emerald-800"
                    : now === "H" ? "bg-amber-soft text-amber-900"
                    : now === "L" ? "bg-periwinkle-soft text-sky-800"
                    : "bg-salmon-soft text-red-800"}`}>
                    already {now}
                  </span>
                )}
              </label>
            );})}
          </div>
          <p className="mt-1.5 text-[11.5px] text-hint dark:text-[#8a8175]">
            Saving again for the same day replaces what is there — that is how a
            wrong mark is corrected.
          </p>
        </div>

        <Feedback res={res} />
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save attendance</button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Advance                                                            */
/* ------------------------------------------------------------------ */
export function AddAdvance({ emps, onDone }: { emps: EmpLite[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const now = new Date();
  const [f, setF] = useState({
    emp_id: "", amount: "", date: today(), note: "",
    deduct_month: String(now.getMonth() + 1), deduct_year: String(now.getFullYear()),
  });

  async function save() {
    if (!supabase) return;
    if (!f.emp_id) { setRes({ ok: false, msg: "Select an employee." }); return; }
    if (!f.amount || Number(f.amount) <= 0) { setRes({ ok: false, msg: "Enter an amount greater than zero." }); return; }
    setBusy(true); setRes(null);
    const { error } = await supabase.from("online_att_advances").insert({
      id: newId("adv"),
      emp_id: f.emp_id,
      amount: Number(f.amount),
      date: f.date,
      note: f.note.trim(),
      deduct_month: Number(f.deduct_month),
      deduct_year: Number(f.deduct_year),
      settled: false,
    });
    setBusy(false);
    if (error) { setRes({ ok: false, msg: error.message }); return; }
    setRes({ ok: true, msg: `Advance of Rs ${Number(f.amount).toLocaleString()} recorded.` });
    setF({ ...f, amount: "", note: "" });
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnGhost}><Wallet size={15} /> Give advance</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record an advance"
        subtitle="Deducted from the chosen month's salary.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee *">
            <select className={inputCls} value={f.emp_id} onChange={(e) => setF({ ...f, emp_id: e.target.value })}>
              <option value="">Select…</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="Amount (Rs) *"><input type="number" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date given"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Deduct from month">
            <select className={inputCls} value={f.deduct_month} onChange={(e) => setF({ ...f, deduct_month: e.target.value })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Deduct from year"><input type="number" className={inputCls} value={f.deduct_year} onChange={(e) => setF({ ...f, deduct_year: e.target.value })} /></Field>
          <Field label="Note"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <Feedback res={res} />
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save advance</button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Salary paid / unpaid                                               */
/* ------------------------------------------------------------------ */
export function MarkSalary({ emps, onDone }: { emps: EmpLite[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [paid, setPaid] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));



  async function save() {
    if (!supabase) return;
    if (!picked.length) { setRes({ ok: false, msg: "Select at least one employee." }); return; }
    setBusy(true); setRes(null);
    const y = Number(year), m = Number(month);
    /* Clearing is a delete, not a write. Storing an empty status would leave a
       row that says nothing and still has to be reasoned about. */

    const rowsToSave = picked.map((emp_id) => ({ id: `${emp_id}-${y}-${m}`, emp_id, year: y, month: m, paid }));
    const { error } = await supabase.from("online_att_salary_status").upsert(rowsToSave, { onConflict: "emp_id,year,month" });
    setBusy(false);
    if (error) { setRes({ ok: false, msg: error.message }); return; }
    setRes({ ok: true, msg: `${rowsToSave.length} salary record(s) marked ${paid ? "paid" : "unpaid"} for ${MONTHS[m - 1]} ${y}.` });
    setPicked([]);
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnGhost}><Plus size={15} /> Salary status</button>
      <Modal open={open} onClose={() => setOpen(false)} wide title="Mark salaries"
        subtitle="One record per employee per month — re-marking corrects it.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Month">
            <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Year"><input type="number" className={inputCls} value={year} onChange={(e) => setYear(e.target.value)} /></Field>
          <Field label="Mark as">
            <select className={inputCls} value={paid ? "paid" : "unpaid"} onChange={(e) => setPaid(e.target.value === "paid")}>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink dark:text-[#f4f1ea]">Employees ({picked.length} selected)</span>
            <button onClick={() => setPicked(picked.length === emps.length ? [] : emps.map((e) => e.id))}
              className="text-[12px] font-semibold text-muted underline hover:text-ink dark:text-[#a89f93] dark:hover:text-white">
              {picked.length === emps.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto rounded-card border border-line p-1 dark:border-white/[0.06]">
            {emps.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted dark:text-[#a89f93]">No employees yet.</p>}
            {emps.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl2 px-3 py-2 text-[13px] text-ink transition hover:bg-panel dark:text-[#f4f1ea] dark:hover:bg-white/[0.05]">
                <input type="checkbox" checked={picked.includes(e.id)} onChange={() => toggle(e.id)} className="h-4 w-4 accent-current" />
                {e.name}
              </label>
            ))}
          </div>
        </div>

        <Feedback res={res} />
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}
