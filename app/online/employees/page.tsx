"use client";
/* The Hub's own people.
 *
 * WHY THIS LIVES IN THE DEPARTMENT AND NOT IN ADMINISTRATION
 *   Each business has its own accounts person, and adding a colleague is their
 *   daily work — not something an owner should be doing. Asking them to leave
 *   their department, open Administration and remember to pick the right
 *   business is one step too many, and the step people forget.
 *
 *   So: employees are created where they work. Only LOGINS stay central,
 *   because a login is a key to the building rather than a staff record. If a
 *   department could create logins it could create one that opens Finance —
 *   not from malice, but because nothing would stop it.
 *
 * WHY THE DEPARTMENT IS NEVER CHOSEN HERE
 *   Everyone added on this page is Hub, full stop. A picker would let somebody
 *   file a Hub agent under Karkhana by accident, and nothing downstream would
 *   catch it — they would simply vanish from the list they belong in. The
 *   business comes from the page, so it cannot be got wrong.
 *
 * The same file serves Karkhana and FS Traders later by changing one constant.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Loader2, Plus, Pencil, Trash2, Search, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { btnPrimary, btnGhost, inputCls, Field } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmDialog";

const BUSINESS_CODE = "HUB";

type Emp = {
  id: string; name: string | null; phone: string | null; user_id: string | null;
  department_id: string | null; is_active: boolean | null;
  pay_type: string | null; pay_amount: number | null;
  join_date: string | null; cnic: string | null;
  designations: { name: string | null } | null;
};

const rs = (v: unknown) =>
  v == null || v === "" ? "—" : "Rs " + Math.round(Number(v) || 0).toLocaleString("en-PK");

/* JOIN DATE STARTS EMPTY, NOT AS TODAY.
   It used to default to the current date, so opening somebody's record to
   change their name and pressing save wrote "joined today" as a fact. Since
   0099 pays days off only from the join date, that silently deleted every
   paid Sunday before it — Abdul Rehman's August dropped from 5 paid days off
   to 2 and his salary fell about Rs 8,000, with nothing on screen to say why.

   A blank join date means "here all month", which is true of everyone imported
   from the old system. Guessing was worse than not knowing. */
const blank = {
  name: "", phone: "", cnic: "", designation: "",
  pay_amount: "", join_date: "", pay_from: "",
};

/* WHY AN EDGE FUNCTION FAILURE USED TO SAY NOTHING.
   supabase.functions.invoke rejects with a FunctionsHttpError whose message is
   "Edge Function returned a non-2xx status code" — the fact that something went
   wrong, with the reason stripped out. The reason is in the response body.

   The body is a stream and can be read once, so it is read as TEXT and parsed
   afterwards. Reading it with .json() throws on anything that is not JSON — a
   gateway page, an empty 502 — and the catch then threw the useful text away
   and left the useless sentence on screen. */
async function edgeReason(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : String(error);
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const raw = (await ctx.text()).trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { error?: string; message?: string };
          return parsed?.error ?? parsed?.message ?? raw.slice(0, 300);
        } catch { return raw.slice(0, 300); }
      }
    } catch { /* body already consumed; the fallback is all there is */ }
  }
  return fallback;
}

/* PostgREST answers a call to a function that does not exist with a sentence
   about the schema cache, which tells somebody running a shop nothing at all.
   Say which file is missing instead. */
function needsMigration(msg: string): string | null {
  return /schema cache|does not exist|Could not find the function/i.test(msg)
    ? "This needs migration H234, which has not been run on the database yet. Open Supabase → SQL editor and run H234_hub_employee_login_and_removal.sql, then try again."
    : null;
}

export default function HubEmployeesPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Emp[]>([]);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");   // what was removed, said out loud
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Emp | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<Emp | null>(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("123456");
  const [made, setMade] = useState("");

  /* GIVING SOMEBODY A LOGIN.
     Two steps that have to happen together, or the result is an account that
     signs in and sees nothing, or an employee nobody can find:
       create the auth account with a temporary password
       attach it to this employee, put them in the Employee role, and mark the
       password as temporary so the first sign-in demands a new one

     The Employee role grants nothing at all. They reach /me and are refused
     everywhere else — no orders, no logistics, no money.

     WHY THIS KEPT FAILING WITH A MESSAGE ABOUT THE EMAIL ADDRESS
       The two steps are not one transaction and cannot be. The account is made
       by an edge function on Supabase's servers, because creating one needs the
       service key; the linking happens in the database. When step two failed —
       and it always failed for anybody added on this page, because the old
       lookup searched a table new employees were never written to — the account
       from step one was already there.

       Press the button again and step one now reports that the address is
       already registered. So the visible error moved to the email address,
       which was never the problem, and the button could never work again for
       that person no matter how many times it was tried.

       An address that already has an account is therefore not treated as a
       failure here. It is the previous attempt's leftovers, and the right thing
       to do with it is carry on and finish the job. */
  async function createLogin() {
    if (!supabase || !login) return;
    const addr = email.trim().toLowerCase();
    if (!addr) { setErr("An email is required."); return; }
    if (pw.length < 6) { setErr("Supabase refuses a password shorter than 6 characters."); return; }
    setBusy(true); setErr(""); setMade("");
    try {
      let reused = false;
      const { data, error } = await supabase.functions.invoke("create-user", {
        body: { action: "create", email: addr, password: pw,
                full_name: login.name ?? addr },
      });
      const d = data as { error?: string } | null;
      const failure = error ? await edgeReason(error) : (d?.error ?? "");
      if (failure) {
        if (/already.*(registered|exists)|duplicate|User already/i.test(failure)) {
          reused = true;
        } else if (/permission|not allowed|Not signed in|403|401/i.test(failure)) {
          throw new Error(
            "Your account is not allowed to create logins — that right is held centrally. " +
            "An owner can add the account in Administration → Users, and then this button " +
            "will attach it to " + (login.name ?? "them") + ".");
        } else {
          throw new Error(failure);
        }
      }

      /* Attached by ID, not by name. The old call looked the person up by name
         in the attendance table: it could not find anybody added on this page,
         and on the day two people are both called Hamza it would find the wrong
         one. An id is not ambiguous and does not change when somebody fixes a
         spelling. */
      const { data: linked, error: le } = await supabase.rpc("hub_give_login", {
        p_employee_id: login.id, p_email: addr,
      });
      if (le) throw new Error(needsMigration(le.message) ?? le.message);
      const r = linked as { ok?: boolean; error?: string };
      if (!r?.ok) throw new Error(r?.error ?? "The account was created but could not be attached.");

      setMade(
        `${login.name} can sign in with ${addr} and the password ${pw}. ` +
        `They will be asked to set their own before anything opens.` +
        (reused ? " (The account already existed from an earlier attempt, so it was attached rather than created again — the password above is the one it already had.)" : ""));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");

    const { data: d, error: de } = await supabase
      .from("departments").select("id").eq("code", BUSINESS_CODE).maybeSingle();
    if (de) { setErr(de.message); setLoading(false); return; }
    if (!d) {
      // Better to say what is missing than to show an empty list that looks fine.
      setErr(`No department with code ${BUSINESS_CODE}. Run migration 0091.`);
      setLoading(false); return;
    }
    setDeptId(d.id as string);

    const { data, error } = await supabase.from("employees")
      .select("id,name,phone,department_id,is_active,pay_type,pay_amount,join_date,cnic,user_id,designations(name)")
      .eq("department_id", d.id)
      .order("name").limit(1000);
    if (error) setErr(error.message);
    // An embedded relation comes back as an array even when it is one row.
    setRows(((data ?? []) as Record<string, unknown>[]).map((r) => ({
      ...r, designations: Array.isArray(r.designations) ? r.designations[0] ?? null : r.designations,
    })) as unknown as Emp[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return !n ? rows : rows.filter((r) =>
      (r.name ?? "").toLowerCase().includes(n) ||
      (r.designations?.name ?? "").toLowerCase().includes(n) ||
      (r.phone ?? "").includes(n));
  }, [rows, q]);

  const payroll = shown.reduce((t, r) => t + (Number(r.pay_amount) || 0), 0);

  function startAdd() { setEditing(null); setForm({ ...blank }); setOpen(true); }
  function startEdit(e: Emp) {
    setEditing(e);
    setForm({
      name: e.name ?? "", phone: e.phone ?? "", cnic: e.cnic ?? "",
      designation: e.designations?.name ?? "",
      pay_amount: e.pay_amount == null ? "" : String(e.pay_amount),
      pay_from: "",
      join_date: e.join_date ?? "",
    });
    setOpen(true);
  }

  async function save() {
    if (!supabase || !deptId) return;
    if (!form.name.trim()) { setErr("A name is required."); return; }
    setBusy(true); setErr("");

    /* department_id is fixed to this page's business and monthly is fixed as
       the pay type: Hub staff are salaried, and a piece-rate field here would
       only be a way to enter something the payroll cannot use. */
    /* THE ROLE IS SAVED NOW.
       The form has always collected it and the payload never carried it, so
       typing a new role changed nothing and gave no error — the modal simply
       closed and the old role was still there.

       employees stores a designation_id, so the text has to become a row first.
       An unrecognised role is added rather than rejected: a business names its
       own jobs, and refusing "Dispatch Manager" because nobody typed it before
       would be the software arguing with the company. */
    let designation_id: string | null = null;
    const roleText = form.designation.trim();
    if (roleText) {
      const { data: found } = await supabase.from("designations")
        .select("id").ilike("name", roleText).limit(1).maybeSingle();
      if (found?.id) designation_id = found.id as string;
      else {
        const { data: made } = await supabase.from("designations")
          .insert({ name: roleText }).select("id").single();
        designation_id = (made?.id as string) ?? null;
      }
    }

    const payload = {
      name: form.name.trim(),
      designation_id,
      phone: form.phone.trim() || null,
      cnic: form.cnic.trim() || null,
      department_id: deptId,
      pay_type: "Monthly",
      pay_amount: form.pay_amount === "" ? null : Number(form.pay_amount),
      // Empty stays empty. Never today.
      join_date: form.join_date || null,
      is_active: true,
    };

    const { data: saved, error } = editing
      ? await supabase.from("employees").update(payload).eq("id", editing.id).select("id").maybeSingle()
      : await supabase.from("employees").insert(payload).select("id").maybeSingle();

    /* online_att_employees is what the attendance and payroll screens read, and
       it carries its own copy of the name, role and salary. Updating one and not
       the other is how the same person ends up with two job titles.

       A NEW PERSON NEVER GOT A ROW HERE AT ALL.
       This ran only when editing, so everyone added on this page existed on the
       employees list and nowhere a day could be marked or a wage paid. They
       could not be given a login either, because the linking step looked for
       them in exactly the table they were missing from. One call now covers
       both cases: it creates the row when it is absent and brings it back into
       step when it is not. */
    const empId = (saved?.id as string | undefined) ?? editing?.id ?? null;
    /* Held in a variable rather than set straight away, because load() clears
       the banner on its way in and would wipe the warning before anybody read
       it. A half-saved person has to be said out loud. */
    let warn = "";
    if (!error && empId) {
      const { data: m, error: me } = await supabase.rpc("hub_sync_employee_mirror", { p_employee_id: empId });
      const mr = m as { ok?: boolean; error?: string } | null;
      if (me) warn = needsMigration(me.message) ?? `Saved, but attendance was not updated: ${me.message}`;
      else if (mr && !mr.ok) warn = `Saved, but attendance was not updated: ${mr.error}`;
    }

    if (!error && editing) {
      /* A SALARY CHANGE IS A FACT ABOUT A PERSON AND A DATE.
         Updating only the number left the rate history untouched, so the header
         said Rs 45,000 while every day was still valued at Rs 35,000 — the page
         disagreed with itself and nothing said why. Qaswar's September was
         Rs 2,333 when it should have been Rs 3,000.

         Now the new rate is written to the history from the date given. Days
         before it keep the old rate, so months already paid never move. */
      const newSal = Number(payload.pay_amount ?? 0);
      const oldSal = Number(editing.pay_amount ?? 0);
      if (newSal > 0 && newSal !== oldSal) {
        await supabase.from("online_att_salary_history").upsert({
          emp_id: editing.id,
          effective_from: form.pay_from || new Date().toISOString().slice(0, 10),
          sal: newSal,
          note: oldSal ? `changed from ${oldSal}` : "rate set",
        }, { onConflict: "emp_id,effective_from" });
      }
    }

    if (error) setErr(error.message);
    else if (!saved && !editing) {
      /* An insert that comes back with no row was refused by row-level
         security. PostgREST reports that as success with nothing in it, which
         is how somebody adds a colleague, sees the modal close, and finds the
         list unchanged with no explanation anywhere. */
      setErr("The database refused to add that person and gave no reason — most likely a permissions rule. Nothing was saved.");
    } else {
      setOpen(false);
      await load();
      if (warn) setErr(warn);
    }
    setBusy(false);
  }

  /* REMOVING SOMEBODY.
     A person is four tables, and sometimes a login on top of that. The page
     used to run one delete against `employees`, which went wrong in both
     directions: row-level security refuses it and PostgREST answers 204 with
     no rows and no error — so the page reloaded, the name was still there, and
     nothing said why — or it succeeded and left their attendance, advances and
     salary history behind, still being counted for a person who no longer
     appears anywhere.

     One call now does all of it and reports how much it removed, so a refusal
     can no longer look identical to a success. The login is asked for
     separately because removing one needs the service key, and if that part is
     refused it is named as the one thing left rather than making the whole
     removal look as though it failed. */
  async function remove(e: Emp) {
    if (!supabase) return;
    if (!(await confirm({
      title: `Remove ${e.name ?? "this person"}?`,
      body: "Their attendance, advances and salary history go with them. This cannot be undone.",
      confirmLabel: "Remove",
    }))) return;

    setErr(""); setMsg("");
    const { data, error } = await supabase.rpc("hub_remove_employee", { p_employee_id: e.id });
    if (error) { setErr(needsMigration(error.message) ?? error.message); return; }

    const r = data as { ok?: boolean; error?: string; report?: string; user_id?: string | null } | null;
    if (!r?.ok) { setErr(r?.error ?? "The removal was refused and gave no reason."); return; }

    let note = r.report ?? `${e.name ?? "They"} was removed.`;
    if (r.user_id) {
      const { data: dd, error: de } = await supabase.functions.invoke("create-user", {
        body: { action: "delete", user_id: r.user_id },
      });
      const failed = de ? await edgeReason(de) : ((dd as { error?: string } | null)?.error ?? "");
      note += failed
        ? ` Their Hub record is gone, but the login itself could not be removed (${failed}) — an owner can remove it in Administration → Users.`
        : " Their login was removed too.";
    }
    await load();
    setMsg(note);
  }

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink dark:text-[#f4f1ea]">Hub employees</h1>
          <p className="text-[13px] text-muted dark:text-[#a89f93]">
            Everyone working in the Hub department. Attendance and salary are calculated from here.
          </p>
        </div>
        <button onClick={startAdd} className={btnPrimary}><Plus size={15} /> Add employee</button>
      </div>

      {err && (
        <div className="mt-3 flex gap-2 rounded-card border border-red-300 bg-red-50 p-3 text-[13px] text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{err}</span>
        </div>
      )}

      {msg && (
        <div className="mt-3 flex items-start justify-between gap-2 rounded-card border border-emerald-300 bg-emerald-50 p-3 text-[13px] text-emerald-900">
          <span>{msg}</span>
          <button onClick={() => setMsg("")} className="shrink-0 font-semibold opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white dark:bg-white dark:text-[#141414]">
          <Users size={12} className="mr-1 inline" />{rows.length} {rows.length === 1 ? "person" : "people"}
        </span>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-hint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role or phone"
                 className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-3 text-[13px] outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
        </div>
      </div>

      <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[680px] text-[13px]">
          <thead className="border-b border-line text-left text-muted dark:border-white/10 dark:text-[#a89f93]">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Phone</th>
              <th className="px-4 py-3 font-semibold">Joined</th>
              <th className="px-4 py-3 text-right font-semibold">Monthly salary</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-white/[0.05]">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">
                <Loader2 size={15} className="mr-2 inline animate-spin" /> Loading…
              </td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-14 text-center text-[13px] text-muted dark:text-[#a89f93]">
                {rows.length === 0
                  ? "No Hub employees yet. Add the first one, or import them from the old attendance app."
                  : "Nobody matches that search."}
              </td></tr>
            ) : shown.map((e) => (
              <tr key={e.id} className="text-ink dark:text-[#e7e2d8]">
                <td className="px-4 py-3 font-semibold">{e.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{e.designations?.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{e.phone ?? "—"}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{e.join_date ?? "—"}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{rs(e.pay_amount)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {e.user_id ? (
                    <span className="mr-1 rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-emerald-800">Has login</span>
                  ) : (
                    <button onClick={() => { setLogin(e); setEmail(""); setPw("123456"); setMade(""); setErr(""); }}
                      className="mr-1 rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold hover:bg-panel dark:border-white/15 dark:hover:bg-white/10">
                      Give login
                    </button>
                  )}
                  <button onClick={() => startEdit(e)} className="mr-1 rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold hover:bg-panel dark:border-white/15 dark:hover:bg-white/10">
                    <Pencil size={11} className="mr-1 inline" />Edit
                  </button>
                  <button onClick={() => remove(e)} className="rounded-full border border-line px-2 py-1 text-[11.5px] text-red-700 hover:bg-red-50 dark:border-white/15">
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t border-line dark:border-white/10">
              <tr className="font-semibold text-ink dark:text-[#f4f1ea]">
                <td className="px-4 py-3" colSpan={4}>{shown.length} shown</td>
                <td className="px-4 py-3 text-right tabular-nums">{rs(payroll)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Modal open={!!login} onClose={() => !busy && setLogin(null)}
             title={`Give ${login?.name ?? ""} a login`}
             subtitle="They will see only their own attendance, advances and salary.">
        {made ? (
          <div className="rounded-card border border-emerald-300 bg-emerald-50 p-3 text-[13px] text-emerald-900">{made}</div>
        ) : (
          <div className="grid gap-3">
            <Field label="Their email"><input className={inputCls} value={email} type="email"
                   onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
            <Field label="Temporary password"><input className={inputCls} value={pw}
                   onChange={(e) => setPw(e.target.value)} /></Field>
            {pw.length < 6 && (
              <p className="-mt-1 text-[12px] font-medium text-red-700">
                At least 6 characters — Supabase refuses anything shorter.
              </p>
            )}
            <p className="text-[12px] text-hint dark:text-[#8a8175]">
              Give them this password once. The first time they sign in they must set
              their own before anything opens, so the shared one stops working — and
              from then on what an account does is traceable to a person.
            </p>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className={btnGhost} disabled={busy} onClick={() => setLogin(null)}>
            {made ? "Done" : "Cancel"}
          </button>
          {!made && (
            <button className={btnPrimary} disabled={busy || pw.length < 6 || !email.trim()} onClick={createLogin}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} Create login
            </button>
          )}
        </div>
      </Modal>

      <Modal open={open} onClose={() => !busy && setOpen(false)}
             title={editing ? `Edit ${editing.name ?? "employee"}` : "Add a Hub employee"}
             subtitle="They will appear in Hub attendance from today.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className={inputCls} value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></Field>
          <Field label="Role"><input className={inputCls} value={form.designation}
                 onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Dispatch Manager" /></Field>
          <Field label="Monthly salary (Rs)"><input className={inputCls} inputMode="numeric" value={form.pay_amount}
                 onChange={(e) => setForm({ ...form, pay_amount: e.target.value })} placeholder="50000" /></Field>
          <Field label="Phone"><input className={inputCls} value={form.phone}
                 onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03xx…" /></Field>
          <Field label="CNIC"><input className={inputCls} value={form.cnic}
                 onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="optional" /></Field>
          <Field label="Salary applies from">
              <input type="date" className={inputCls} value={form.pay_from}
                     onChange={(e) => setForm({ ...form, pay_from: e.target.value })} />
              <p className="mt-1 text-[11.5px] text-hint dark:text-[#8a8175]">
                Only needed when you change the salary. Days before this date keep the
                old rate, so months already paid do not move. Blank means today.
              </p>
            </Field>
            <Field label="Joined"><input type="date" className={inputCls} value={form.join_date}
                 onChange={(e) => setForm({ ...form, join_date: e.target.value })} />
            <p className="mt-1 text-[11.5px] text-hint dark:text-[#8a8175]">
              Leave blank unless they started this month. A join date stops Sundays
              before it being paid.
            </p></Field>
        </div>
        <p className="mt-3 text-[12px] text-hint dark:text-[#8a8175]">
          A login is not created here. Adding someone to the payroll and giving them
          access to the system are different decisions — logins live in Administration.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className={btnGhost} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          <button className={btnPrimary} disabled={busy} onClick={save}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            {editing ? "Save changes" : "Add employee"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
