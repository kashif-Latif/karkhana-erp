"use client";
/* GRN — STITCHING UNIT. Every arrival of ready goods from the floor.
 *
 * Its own series (GRS-…) because a number should say what it is. GRN-000145
 * being either a bale of cloth or a box of shirts means every conversation
 * starts by working out which.
 *
 * Nothing is entered here. A row exists because a supervisor recorded pieces
 * coming back; this is the ledger of that, not a second place to type it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Factory, Download, Plus, Loader2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { usePermissions } from "@/lib/usePermissions";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Row = { id: string; grn_no: string; received_at: string; quantity: number;
             rejected: number; unit_rate: number | null; wage: number;
             paid_at: string | null; note: string | null; order_number: string | null;
             article_code: string | null; article: string | null;
             system_barcode: string | null; floor: string | null; worker: string | null };

type Pending = { id: string; assignment_no: string; order_number: string;
                 article: string; assigned: number; pending: number; department: string };
type Staff = { id: string; name: string };

const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString();

export default function GrnStitchingPage() {
  const { can } = usePermissions();
  const canReceive = can(["process.manage"]);

  /* THE FORM LIVES HERE NOW, not on the Stitching unit page. One place per
     thing: you receive goods on the GRN screen, and the unit page reports.
     A receipt must name the assignment it came back against — without that
     the order never closes and the wage attaches to nobody. */
  const [pending, setPending] = useState<Pending[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [open, setOpen] = useState(false);
  const [asg, setAsg] = useState("");
  const [qty, setQty] = useState("");
  const [rej, setRej] = useState("");
  const [emp, setEmp] = useState("");
  const [rate, setRate] = useState("");
  const [rnote, setRnote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [made, setMade] = useState<Record<string, unknown> | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [g, p, e] = await Promise.all([
      supabase.from("v_grn_stitching").select("*").order("received_at", { ascending: false }),
      supabase.from("v_process_pending").select("*"),
      supabase.from("v_factory_employees").select("id,name").order("name"),
    ]);
    if (g.error) setErr(g.error.message);
    setRows((g.data as Row[]) ?? []);
    setPending(((p.data as unknown as Pending[]) ?? []).filter((x) => Number(x.pending) > 0));
    setStaff((e.data as Staff[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    const day = String(r.received_at).slice(0, 10);
    if (days !== null) {
      const edge = new Date(); edge.setHours(0, 0, 0, 0);
      edge.setDate(edge.getDate() - (days - 1));
      if (new Date(day) < edge) return false;
    }
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return [r.grn_no, r.article, r.article_code, r.system_barcode, r.order_number, r.worker]
        .some((x) => String(x ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, q, days, from, to]);

  const pieces = view.reduce((a, r) => a + Number(r.quantity || 0), 0);
  const rejected = view.reduce((a, r) => a + Number(r.rejected || 0), 0);
  const wages = view.reduce((a, r) => a + Number(r.wage || 0), 0);

  const chosen = pending.find((x) => x.id === asg);

  function openForm() {
    setOpen(true); setAsg(""); setQty(""); setRej(""); setEmp(""); setRate("");
    setRnote(""); setFormErr(""); setMade(null);
  }

  async function receive() {
    if (!supabase) return;
    setFormErr("");
    if (!asg) { setFormErr("Which assignment did these come back against?"); return; }
    if (!(parseFloat(qty) > 0)) { setFormErr("How many pieces came back?"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("receive_from_process", {
      p_assignment_id: asg, p_quantity: parseFloat(qty),
      p_employee_id: emp || null, p_rejected: rej ? parseFloat(rej) : 0,
      p_rate: rate ? parseFloat(rate) : null,
      p_received_at: new Date().toISOString(), p_note: rnote.trim() || null,
    });
    setBusy(false);
    if (error) { setFormErr(error.message); return; }
    setMade(data as Record<string, unknown>); load();
  }

  const table = (): ExportTable => ({
    title: "grn-stitching-unit",
    headers: ["GRN", "Date", "Order", "Barcode", "Article", "Pieces", "Rejected", "Rate", "Wage", "Worker", "Paid"],
    rows: view.map((r) => [r.grn_no, when(r.received_at), r.order_number ?? "",
      r.system_barcode ?? "", r.article ?? "", r.quantity, r.rejected,
      r.unit_rate ?? "", r.wage, r.worker ?? "", r.paid_at ? "yes" : "no"]),
  });

  return (
    <>
      <Topbar title="GRN — Stitching Unit" subtitle="Ready goods received from the floor" />
      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Pieces received</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(pieces)}</p>
            <p className="mt-1 text-[12px] text-ink/60">{view.length} receipts</p>
          </div>
          <div className="rounded-card bg-salmon-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Rejected</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(rejected)}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Wages on these</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{rs(wages)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[{ l: "All time", d: null }, { l: "Today", d: 1 }, { l: "5 days", d: 5 },
            { l: "This week", d: 7 }, { l: "30 days", d: 30 }].map((r) => (
            <button key={r.l} onClick={() => { setDays(r.d); setFrom(""); setTo(""); }}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${days === r.d && !from && !to ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {r.l}
            </button>
          ))}
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setDays(null); }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          <span className="text-[12px] text-hint">to</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setDays(null); }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GRN, barcode, article, order…"
            className="w-full max-w-sm rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          {canReceive && (
            <button onClick={openForm} className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
              <Plus size={15} /> New GRN
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Factory size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">Nothing received yet</p>
            <p className="mt-1 text-[13px] text-muted">A GRN appears here each time pieces come back from the stitching unit.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">GRN</th>
                <th className="px-4 py-3 font-bold">Article</th>
                <th className="px-4 py-3 font-bold">Order</th>
                <th className="px-4 py-3 text-right font-bold">Pieces</th>
                <th className="px-4 py-3 text-right font-bold">Rejected</th>
                <th className="px-4 py-3 text-right font-bold">Wage</th>
                <th className="px-4 py-3 font-bold">Worker</th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12.5px] font-bold text-ink">{r.grn_no}</span>
                      <span className="block text-[11px] text-hint">{when(r.received_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.article}</span>
                      <span className="block font-mono text-[11px] text-hint">{r.system_barcode ?? r.article_code}</span>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-muted">{r.order_number ?? "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-[15px] font-extrabold text-ink">{n(r.quantity)}</td>
                    <td className={`px-4 py-3 text-right tnum ${Number(r.rejected) > 0 ? "font-semibold text-danger" : "text-hint/60"}`}>{n(r.rejected)}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">
                      {rs(r.wage)}
                      {r.paid_at
                        ? <span className="block text-[10.5px] font-semibold text-[#166534]">paid</span>
                        : Number(r.wage) > 0 && <span className="block text-[10.5px] font-semibold text-danger">unpaid</span>}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-ink/80">{r.worker ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New GRN — receive from the floor">
        {made ? (
          <div className="text-center">
            <p className="font-mono text-[26px] font-extrabold tracking-tight text-ink">{String(made.receipt ?? made.grn_no ?? "")}</p>
            <p className="mt-1.5 text-[13px] text-ink/75">
              {n(Number(made.received ?? qty))} pieces received{made.wage ? ` · wage ${rs(Number(made.wage))}` : ""}
            </p>
            {made.pending_now != null && (
              <p className="mt-1 text-[12.5px] text-muted">{n(Number(made.pending_now))} still on the floor.</p>
            )}
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={openForm} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Receive more</button>
              <button onClick={() => setOpen(false)} className="rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white">Done</button>
            </div>
          </div>
        ) : (
          <>
            <Field label="Which assignment? *">
              <select value={asg} onChange={(e) => setAsg(e.target.value)} className={inp}>
                <option value="">Choose…</option>
                {pending.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.order_number} · {p.article} — {n(p.pending)} pending
                  </option>
                ))}
              </select>
            </Field>
            {pending.length === 0 && (
              <p className="mt-2 text-[12.5px] text-muted">Nothing is out on the floor. Place an order first.</p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Pieces received *">
                <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
                  className={`${inp} ${chosen && parseFloat(qty) > Number(chosen.pending) ? "border-danger" : ""}`} />
              </Field>
              <Field label="Rejected">
                <input type="number" value={rej} onChange={(e) => setRej(e.target.value)} className={inp} />
              </Field>
              <Field label="Worker">
                <select value={emp} onChange={(e) => setEmp(e.target.value)} className={inp}>
                  <option value="">—</option>
                  {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field label="Rate per piece">
                <input type="number" value={rate} onChange={(e) => setRate(e.target.value)}
                  placeholder="blank uses the set rate" className={inp} />
              </Field>
            </div>

            {chosen && parseFloat(qty) > Number(chosen.pending) && (
              <p className="mt-2 text-[12.5px] text-danger">Only {n(Number(chosen.pending))} are still out on that assignment.</p>
            )}

            <div className="mt-3"><Field label="Note (optional)">
              <input value={rnote} onChange={(e) => setRnote(e.target.value)} className={inp} />
            </Field></div>

            {formErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{formErr}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
              <button onClick={receive} disabled={busy}
                className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {busy && <Loader2 size={15} className="animate-spin" />} Receive
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
