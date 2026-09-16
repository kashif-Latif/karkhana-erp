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
             item_name: string | null; barcode: string | null; manual_barcode: string | null;
             section: string | null; quantity: number; rate: number; total_labour: number;
             worker_name: string; note: string | null; voided_at: string | null;
             on_payroll: boolean };
type Art = { id: string; name: string; system_barcode: string | null; section: string | null };
type Staff = { id: string; name: string };

const PROCESSES = ["cutting", "stitching", "overlock", "flatlock", "singlelock", "other"];
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
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [empId, setEmpId] = useState("");
  const [worker, setWorker] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [fErr, setFErr] = useState("");
  const [voidRow, setVoidRow] = useState<string | null>(null);
  const [voidWhy, setVoidWhy] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [e, a, s] = await Promise.all([
      supabase.from("v_machine_process").select("*").order("worked_on", { ascending: false }),
      supabase.from("articles").select("id,name,system_barcode,section")
        .eq("is_active", true).eq("owner", "factory").order("system_barcode"),
      supabase.from("v_factory_employees").select("id,name").order("name"),
    ]);
    if (e.error) setErr(e.error.message);
    setRows((e.data as Row[]) ?? []);
    setArts((a.data as Art[]) ?? []);
    setStaff((s.data as Staff[]) ?? []);
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
    const m = new Map<string, { pieces: number; labour: number; entries: number }>();
    live.forEach((r) => {
      const p = m.get(r.worker_name) ?? { pieces: 0, labour: 0, entries: 0 };
      m.set(r.worker_name, {
        pieces: p.pieces + Number(r.quantity || 0),
        labour: p.labour + Number(r.total_labour || 0),
        entries: p.entries + 1,
      });
    });
    return [...m.entries()].map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.labour - a.labour);
  }, [live]);

  function openForm() {
    setOpen(true); setDay(today()); setArtId(""); setQty(""); setRate("");
    setEmpId(""); setWorker(""); setNote(""); setFErr("");
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
    });
    setBusy(false);
    if (error) { setFErr(error.message); return; }
    load();
    /* Keep the person and the article — a sheet is filled in runs, the same
       man cutting the same item at two rates. */
    if (again) { setQty(""); setRate(""); setNote(""); }
    else setOpen(false);
  }

  async function doVoid(id: string) {
    if (!supabase || !voidWhy.trim()) return;
    const { error } = await supabase.rpc("void_machine_process", { p_id: id, p_reason: voidWhy.trim() });
    if (error) { setErr(error.message); return; }
    setVoidRow(null); setVoidWhy(""); load();
  }

  const table = (): ExportTable => ({
    title: `Machine Process — ${proc}`,
    headers: ["Entry", "Date", "Item code", "Barcode", "Item description", "Qty", "Rate", "Job person", "Total labour"],
    rows: [
      ...live.map((r) => [r.entry_no, r.worked_on, r.barcode ?? "", r.manual_barcode ?? "",
        r.item_name ?? "", r.quantity, r.rate, r.worker_name, r.total_labour]),
      ...(perPerson.length ? [["", "", "", "", "", "", "", "", ""]] : []),
      ...perPerson.map((p) => ["", "", "", "", `TOTAL — ${p.name}`, p.pieces, "", "", p.labour]),
    ],
  });

  const artLabel = (a: Art) => `${a.system_barcode ?? ""} — ${a.name}`;

  return (
    <>
      <Topbar title="Machine Process" subtitle="Cutting and floor work — pieces, rate and who did it" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="flex flex-wrap gap-2">
          {PROCESSES.map((p) => (
            <button key={p} onClick={() => setProc(p)}
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
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          <span className="text-[12px] text-hint">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
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
                      <span className="block text-[11px] text-hint">{r.entry_no} · {r.worked_on}</span>
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
                    <tr key={p.name} className="border-t border-line bg-panel/40 text-[13px] font-bold text-ink">
                      <td className="px-4 py-2.5" colSpan={2}>Total — {p.name}</td>
                      <td className="px-4 py-2.5 text-right tnum">{n(p.pieces)}</td>
                      <td className="px-4 py-2.5"></td>
                      <td className="px-4 py-2.5 text-[12px] font-normal text-muted">{p.entries} entr{p.entries === 1 ? "y" : "ies"}</td>
                      <td className="px-4 py-2.5 text-right tnum text-[15px] font-extrabold">{rs(p.labour)}</td>
                      <td className="px-4 py-2.5"></td>
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
          <Field label="Job person *">
            <select value={empId} onChange={(e) => setEmpId(e.target.value)} className={inp}>
              <option value="">Not on payroll…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        {!empId && (
          <div className="mt-3"><Field label="His name *">
            <input value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="e.g. Aslam" className={inp} />
          </Field></div>
        )}

        <div className="mt-3"><Field label="Item">
          <select value={artId} onChange={(e) => setArtId(e.target.value)} className={inp}>
            <option value="">Choose…</option>
            {arts.map((a) => <option key={a.id} value={a.id}>{artLabel(a)}</option>)}
          </select>
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
