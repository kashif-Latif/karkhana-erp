"use client";
/* MACHINE PROCESS — the cutting sheet, as it is kept on paper.
 *
 * Item · barcode · quantity · rate · job person · total labour, with each
 * person's day totalled at the foot. The paper version is hand-totalled,
 * which is where it goes wrong; here the total is quantity x rate, computed,
 * so the column and the sum can never disagree.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Scissors, Download, Loader2, Plus, Printer, Undo2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, printTable, type ExportTable } from "@/lib/export";

type Row = { id: string; entry_no: string; process: string; worked_on: string;
             piece_type: string; paid_at: string | null;
             item_name: string | null; barcode: string | null; manual_barcode: string | null;
             section: string | null; quantity: number; rate: number; total_labour: number;
             worker_name: string; note: string | null; voided_at: string | null;
             on_payroll: boolean };
type Art = { id: string; name: string; system_barcode: string | null;
             section: string | null; source: "factory" | "warehouse" };
type Staff = { id: string; name: string; rate: number | null;
               department: string | null; dept_code: string | null };

/* The four floors the factory actually runs, and nothing else.

   The codes here must match the departments table exactly — the database
   looks a worker's department up by code and refuses an unknown one. Three
   of these were wrong: OVL, FLT and SGL do not exist, the real codes are
   OVERLOCK, FLATLOCK and SINGLELOCK. Adding a man to any of those three
   floors failed outright with "No department with code OVL"; only Cutting
   ever worked.

   Clipping, checking, pressing and packing are not here on purpose: that
   work belongs to Finishing, after inventory, not to the machine floor. */
const DEPTS: [string, string][] = [
  ["CUT", "Cutting"], ["SINGLELOCK", "Singlelock"],
  ["OVERLOCK", "Overlock"], ["FLATLOCK", "Flatlock"]];

/* The process is what was done; the department is where the man sits. They
   line up one-for-one on the four floors, so choosing a tab chooses the
   department too. "Other" is the odd job that belongs to no floor, so it
   leaves the department on whatever was last picked. */
const PROCESSES = ["cutting", "singlelock", "overlock", "flatlock", "other"];
const DEPT_OF: Record<string, string> = {
  cutting: "CUT", singlelock: "SINGLELOCK",
  overlock: "OVERLOCK", flatlock: "FLATLOCK" };
const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);

export default function MachineProcessPage() {
  const { can } = usePermissions();
  const canDo = can(["process.manage", "production.entry"]);

  const [rows, setRows] = useState<Row[]>([]);
  const [arts, setArts] = useState<Art[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [proc, setProc] = useState("cutting");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [q, setQ] = useState("");

  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today());
  const [artId, setArtId] = useState("");
  const [code, setCode] = useState("");
  const [pieceType, setPieceType] = useState("fresh");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [empId, setEmpId] = useState("");
  const [deptCode, setDeptCode] = useState("CUT");
  const [worker, setWorker] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [fErr, setFErr] = useState("");
  const [voidRow, setVoidRow] = useState<string | null>(null);
  const [voidWhy, setVoidWhy] = useState("");
  const [payFor, setPayFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [e, a, s] = await Promise.all([
      supabase.from("v_machine_process").select("*").order("worked_on", { ascending: false }),
      /* Both lists: a thing that gets cut may be a factory article or a
         warehouse product. Making someone re-type the other is how a second
         list starts. */
      supabase.from("articles").select("id,name,system_barcode,section,owner")
        .eq("is_active", true).order("system_barcode"),
      /* v_factory_staff carries the rate, so choosing a man fills it in.
         Inactive people are filtered on screen, not in the query — otherwise
         an empty dropdown looks like a broken one. */
      supabase.from("v_factory_staff").select("id,name,rate,department,dept_code,is_active").order("name"),
    ]);
    if (e.error) setErr(e.error.message);
    setRows((e.data as Row[]) ?? []);
    setArts(((a.data as unknown as Record<string, unknown>[]) ?? []).map((r) => ({
      id: String(r.id), name: String(r.name),
      system_barcode: (r.system_barcode as string) ?? null,
      section: (r.section as string) ?? null,
      source: r.owner === "warehouse" ? "warehouse" : "factory",
    })));
    setStaff(((s.data as unknown as Record<string, unknown>[]) ?? [])
      .filter((r) => r.is_active)
      .map((r) => ({ id: String(r.id), name: String(r.name),
        rate: r.rate == null ? null : Number(r.rate),
        department: (r.department as string) ?? null,
        dept_code: (r.dept_code as string) ?? null })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    if (r.process !== proc) return false;
    const d = String(r.worked_on).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return [r.entry_no, r.item_name, r.barcode, r.manual_barcode, r.worker_name]
        .some((x) => String(x ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, proc, from, to, q]);

  const live = view.filter((r) => !r.voided_at);
  const pieces = live.reduce((a, r) => a + Number(r.quantity || 0), 0);
  const labour = live.reduce((a, r) => a + Number(r.total_labour || 0), 0);

  /* The foot of the paper sheet: one line per person, biggest first. */
  const perPerson = useMemo(() => {
    const m = new Map<string, { pieces: number; earned: number; paid: number; entries: number }>();
    live.forEach((r) => {
      const p = m.get(r.worker_name) ?? { pieces: 0, earned: 0, paid: 0, entries: 0 };
      const amt = Number(r.total_labour || 0);
      m.set(r.worker_name, {
        pieces: p.pieces + Number(r.quantity || 0),
        earned: p.earned + amt,
        paid: p.paid + (r.paid_at ? amt : 0),
        entries: p.entries + 1,
      });
    });
    return [...m.entries()]
      .map(([name, v]) => ({ name, ...v, pending: v.earned - v.paid }))
      .sort((a, b) => b.pending - a.pending || b.earned - a.earned);
  }, [live]);

  function openForm() {
    setOpen(true); setDay(today()); setArtId(""); setCode(""); setPieceType("fresh"); setQty(""); setRate("");
    setEmpId(""); setWorker(""); setDeptCode(proc === "cutting" ? "CUT" : "MFSU"); setNote(""); setFErr("");
  }

  /* Adding him here rather than sending someone to another screen and back —
     the moment you are typing his name is the moment you know he is staff. */
  async function addPerson() {
    if (!supabase || !worker.trim()) return;
    setBusy(true); setFErr("");
    const { data, error } = await supabase.rpc("add_factory_employee", {
      p_name: worker.trim(),
      p_department_code: deptCode,
      p_rate: rate === "" ? null : parseFloat(rate),
      p_phone: null, p_cnic: null, p_employment: "casual",
    });
    setBusy(false);
    if (error) { setFErr(error.message); return; }
    const made = data as Record<string, unknown>;
    await load();
    setEmpId(String(made.id));
    setWorker("");
  }

  async function save(again: boolean) {
    if (!supabase) return;
    setFErr("");
    if (!(parseFloat(qty) > 0)) { setFErr("How many pieces?"); return; }
    if (rate === "") { setFErr("Give the rate per piece."); return; }
    if (!empId && !worker.trim()) { setFErr("Who did the work?"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("post_machine_process", {
      p_process: proc, p_worked_on: day, p_article_id: artId || null,
      p_quantity: parseFloat(qty), p_rate: parseFloat(rate),
      p_worker_name: worker.trim() || null, p_worker_employee_id: empId || null,
      p_note: note.trim() || null,
      p_piece_type: pieceType,
      p_item_name: null, p_barcode: null,
    });
    setBusy(false);
    if (error) { setFErr(error.message); return; }
    load();
    /* Keep the person and the article — a sheet is filled in runs, the same
       man cutting the same item at two rates. */
    if (again) { setQty(""); setRate(""); setNote(""); }
    else setOpen(false);
  }

  async function payOff(name: string) {
    if (!supabase) return;
    setErr("");
    const { error } = await supabase.rpc("pay_machine_process", {
      p_worker_name: name, p_process: proc,
      p_from: from || null, p_to: to || null, p_note: null,
    });
    if (error) { setErr(error.message); return; }
    setPayFor(null); load();
  }

  async function doVoid(id: string) {
    if (!supabase || !voidWhy.trim()) return;
    const { error } = await supabase.rpc("void_machine_process", { p_id: id, p_reason: voidWhy.trim() });
    if (error) { setErr(error.message); return; }
    setVoidRow(null); setVoidWhy(""); load();
  }

  const table = (): ExportTable => ({
    title: `Machine Process — ${proc}`,
    headers: ["Entry", "Date", "Item code", "Item description", "Fresh/pieces", "Qty", "Rate", "Job person", "Total labour", "Paid"],
    rows: [
      ...live.map((r) => [r.entry_no, r.worked_on, r.barcode ?? "", r.item_name ?? "",
        r.piece_type, r.quantity, r.rate, r.worker_name, r.total_labour,
        r.paid_at ? "paid" : "pending"]),
      ...(perPerson.length ? [["", "", "", "", "", "", "", "", "", ""]] : []),
      ...perPerson.map((p) => ["", "", "", `TOTAL — ${p.name}`, "", p.pieces, "", "",
        p.earned, p.pending > 0 ? `pending ${p.pending}` : "settled"]),
    ],
  });

  /* Only people from the chosen department - a cutting entry should not
     offer the packing bench. */
  const inDept = useMemo(
    () => staff.filter((x) => !x.dept_code || x.dept_code === deptCode),
    [staff, deptCode]);

  const matches = useMemo(() => {
    const t = code.trim().toLowerCase();
    if (!t) return [];
    return arts.filter((a) =>
      String(a.system_barcode ?? "").toLowerCase().includes(t) ||
      a.name.toLowerCase().includes(t)).slice(0, 10);
  }, [code, arts]);

  const artLabel = (a: Art) => `${a.system_barcode ?? ""} — ${a.name}`;

  return (
    <>
      <Topbar title="Machine Process" subtitle="Cutting and floor work — pieces, rate and who did it" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="flex flex-wrap gap-2">
          {PROCESSES.map((p) => (
            <button key={p} onClick={() => { setProc(p); if (DEPT_OF[p]) { setDeptCode(DEPT_OF[p]); setEmpId(""); } }}
              className={`rounded-full px-4 py-2 text-[13px] font-semibold capitalize transition ${proc === p ? "bg-ink text-white" : "border border-line text-ink/70 hover:bg-panel"}`}>
              {p}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Entries</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{live.length}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Pieces</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(pieces)}</p>
          </div>
          <div className="rounded-card bg-success-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Total labour</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{rs(labour)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, barcode, person…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <button onClick={() => printTable(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Printer size={13} /> Print</button>
          {canDo && (
            <button onClick={openForm} className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
              <Plus size={15} /> New entry
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Scissors size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">No {proc} recorded for these dates</p>
            <p className="mt-1 text-[13px] text-muted">Each entry is one item, one rate, one person.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">Item description</th>
                <th className="px-4 py-3 font-bold">Item code</th>
                <th className="px-4 py-3 text-right font-bold">Qty</th>
                <th className="px-4 py-3 text-right font-bold">Rate</th>
                <th className="px-4 py-3 font-bold">Job person</th>
                <th className="px-4 py-3 text-right font-bold">Total labour</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} className={`border-b border-line/60 last:border-0 ${r.voided_at ? "opacity-45" : ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.item_name ?? "—"}</span>
                      <span className="block text-[11px] text-hint">
                        {r.entry_no} · {r.worked_on} · {r.piece_type === "pieces" ? "pieces" : "fresh"}
                        {r.paid_at && <span className="ml-1 font-semibold text-[#166534]">paid</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-muted">{r.barcode ?? "—"}</td>
                    <td className="px-4 py-3 text-right tnum font-semibold text-ink">{n(r.quantity)}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{n(r.rate)}</td>
                    <td className="px-4 py-3 text-ink/85">
                      {r.worker_name}
                      {!r.on_payroll && <span className="ml-1 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-semibold text-muted">casual</span>}
                    </td>
                    <td className="px-4 py-3 text-right tnum text-[15px] font-extrabold text-ink">{rs(r.total_labour)}</td>
                    <td className="px-4 py-3 text-right">
                      {canDo && !r.voided_at && (voidRow === r.id ? (
                        <span className="flex items-center justify-end gap-1.5">
                          <input value={voidWhy} autoFocus onChange={(e) => setVoidWhy(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") doVoid(r.id); if (e.key === "Escape") setVoidRow(null); }}
                            placeholder="reason" className="w-28 rounded-lg border border-ink/30 px-2 py-1 text-[12px] outline-none" />
                          <button onClick={() => doVoid(r.id)} disabled={!voidWhy.trim()}
                            className="text-[11px] font-bold text-danger disabled:opacity-40">void</button>
                        </span>
                      ) : (
                        <button onClick={() => { setVoidRow(r.id); setVoidWhy(""); }}
                          className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-danger"><Undo2 size={14} /></button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
              {perPerson.length > 0 && (
                <tfoot>
                  {perPerson.map((p) => (
                    <tr key={p.name} className="border-t border-line bg-panel/40 text-[13px] text-ink">
                      <td className="px-4 py-2.5 font-bold" colSpan={2}>
                        {p.name}
                        <span className="ml-2 text-[11px] font-normal text-muted">{p.entries} entr{p.entries === 1 ? "y" : "ies"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tnum font-bold">{n(p.pieces)}</td>
                      <td className="px-4 py-2.5 text-right text-[11.5px] text-muted">earned {rs(p.earned)}</td>
                      <td className="px-4 py-2.5 text-[11.5px] text-muted">
                        {p.paid > 0 ? `paid ${rs(p.paid)}` : "nothing paid"}
                      </td>
                      {/* Pending is the number that matters — it is what you owe
                          him when he asks. */}
                      <td className="px-4 py-2.5 text-right tnum text-[16px] font-extrabold">
                        {p.pending > 0 ? rs(p.pending) : <span className="text-[13px] font-semibold text-[#166534]">settled</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canDo && p.pending > 0 && (payFor === p.name ? (
                          <span className="flex items-center justify-end gap-1.5">
                            <button onClick={() => payOff(p.name)}
                              className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white">pay {rs(p.pending)}</button>
                            <button onClick={() => setPayFor(null)} className="text-[11px] text-ink/50">no</button>
                          </span>
                        ) : (
                          <button onClick={() => setPayFor(p.name)}
                            className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink/70 hover:bg-panel">settle</button>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tfoot>
              )}
            </table></div>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`New ${proc} entry`} wide>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inp} />
          </Field>
          <Field label="Department">
            <select value={deptCode} onChange={(e) => { setDeptCode(e.target.value); setEmpId(""); }} className={inp}>
              {DEPTS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-3"><Field label="Emp name">
          <select value={empId} className={inp}
            onChange={(e) => {
              const id = e.target.value;
              setEmpId(id); setWorker("");
              const p = staff.find((x) => x.id === id);
              if (p?.rate != null) setRate(String(p.rate));
            }}>
            <option value="">Type a name below...</option>
            {inDept.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}{x.rate != null ? ` - ${x.rate}/pc` : ""}
              </option>
            ))}
          </select>
        </Field></div>

        {!empId && (
          <div className="mt-2">
            <input value={worker} onChange={(e) => setWorker(e.target.value)}
              placeholder="or type his name - e.g. Aslam" className={inp} />
            {worker.trim() && (
              <button onClick={addPerson} disabled={busy}
                className="mt-2 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
                + Add {worker.trim()} to {DEPTS.find(([c]) => c === deptCode)?.[1] ?? "staff"}
              </button>
            )}
          </div>
        )}
        {inDept.length === 0 && !worker.trim() && (
          <p className="mt-2 text-[12.5px] text-muted">
            Nobody on payroll in {DEPTS.find(([c]) => c === deptCode)?.[1]} yet - type his name and add him.
          </p>
        )}

        <div className="mt-3"><Field label="Computer code or item name">
          <input value={code} onChange={(e) => { setCode(e.target.value); setArtId(""); }}
            placeholder="type 43-000010 or a name" className={inp} />
        </Field></div>
        {!artId && code.trim() && (
          matches.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-xl2 border border-line">
              <p className="border-b border-line bg-panel/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-hint">
                {matches.length} match{matches.length === 1 ? "" : "es"} — click one
              </p>
              <div className="max-h-40 overflow-y-auto">
                {matches.map((a) => (
                  <button key={a.id} onClick={() => { setArtId(a.id); setCode(artLabel(a)); }}
                    className="flex w-full items-center justify-between gap-3 border-b border-line/60 px-3 py-2 text-left last:border-0 hover:bg-panel">
                    <span>
                      <span className="text-[13px] font-semibold text-ink">{a.name}</span>
                      <span className="block font-mono text-[11px] text-hint">{a.system_barcode ?? "—"}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-semibold text-muted">{a.source}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : <p className="mt-2 text-[12.5px] text-muted">Nothing matches that code or name.</p>
        )}

        <div className="mt-3"><Field label="Fabric was">
          <div className="mt-1 flex gap-2">
            {[["fresh", "Fresh"], ["pieces", "Pieces"]].map(([v, l]) => (
              <button key={v} onClick={() => setPieceType(v)}
                className={`flex-1 rounded-xl2 border px-3 py-2 text-left text-[12.5px] font-semibold transition ${pieceType === v ? "border-ink bg-panel text-ink" : "border-line text-ink/60 hover:bg-panel"}`}>
                {l}
              </button>
            ))}
          </div>
        </Field></div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="Quantity *">
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className={inp} />
          </Field>
          <Field label="Rate per piece *">
            <input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)}
              placeholder="12 or 14.5" className={inp} />
          </Field>
          <div className="flex items-end pb-1">
            {/* Never typed — the paper sheet's hand-totalled column is exactly
                where it goes wrong. */}
            {qty && rate && (
              <p className="text-[13px] text-ink/75">
                Total labour <b className="text-[15px] text-ink">{rs(parseFloat(qty) * parseFloat(rate))}</b>
              </p>
            )}
          </div>
        </div>

        <div className="mt-3"><Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} />
        </Field></div>

        {fErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{fErr}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={() => save(true)} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/75 disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Save &amp; add another
          </button>
          <button onClick={() => save(false)} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Save
          </button>
        </div>
      </Modal>
    </>
  );
}
