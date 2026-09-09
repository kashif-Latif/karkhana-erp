"use client";
/* ACCOUNT PAYABLE — LABOUR. What the floor is owed for work already done.
 *
 * Every figure comes from pieces a supervisor recorded coming back, priced
 * at the rate in force. Nothing is entered here, and paying settles the
 * receipts themselves (pay_process_wages) rather than writing a number —
 * so a man can never be paid twice for the same pieces.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Loader2, Download, Wallet } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Row = { employee_id: string; employee: string; department: string;
             pieces: number; earned: number; payable: number;
             pieces_unpaid: number; last_delivery: string | null };
/* There is no wage_amount column — the wage IS quantity x unit_rate, held
   that way so a rate change can never silently rewrite past pay. */
type Receipt = { id: string; receipt_no: string; quantity: number;
                 unit_rate: number | null; received_at: string };

const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const n = (v: number) => Number(v || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleDateString();

export default function LabourPayablePage() {
  const { can } = usePermissions();
  const canPay = can(["process.pay"]);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [owingOnly, setOwingOnly] = useState(true);

  const [payFor, setPayFor] = useState<Row | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.from("v_process_payable").select("*");
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows
    .filter((r) => (!owingOnly || Number(r.payable) > 0)
      && (!q.trim() || `${r.employee} ${r.department}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => Number(b.payable) - Number(a.payable)),
    [rows, q, owingOnly]);

  const owed = view.reduce((a, r) => a + Number(r.payable || 0), 0);
  const pieces = view.reduce((a, r) => a + Number(r.pieces_unpaid || 0), 0);

  async function openPay(r: Row) {
    if (!supabase) return;
    setPayFor(r); setPicked([]); setReceipts([]);
    /* Only the man's UNPAID receipts — paying is settling these specific
       pieces, not transferring a lump sum. */
    const { data } = await supabase.from("process_receipts")
      .select("id,receipt_no,quantity,unit_rate,received_at")
      .eq("employee_id", r.employee_id).is("paid_at", null)
      .order("received_at");
    const list = (data as Receipt[]) ?? [];
    setReceipts(list);
    setPicked(list.map((x) => x.id));
  }

  async function pay() {
    if (!supabase || picked.length === 0) return;
    setBusy(true);
    const { error } = await supabase.rpc("pay_process_wages", { p_receipt_ids: picked });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPayFor(null); load();
  }

  const chosenTotal = receipts.filter((r) => picked.includes(r.id))
    .reduce((a, r) => a + Number(r.quantity || 0) * Number(r.unit_rate || 0), 0);

  const table = (): ExportTable => ({
    title: "labour-payable",
    headers: ["Worker", "Floor", "Pieces", "Unpaid pieces", "Earned", "Payable", "Last delivery"],
    rows: view.map((r) => [r.employee, r.department, r.pieces, r.pieces_unpaid,
      r.earned, r.payable, r.last_delivery ? when(r.last_delivery) : ""]),
  });

  return (
    <>
      <Topbar title="Labour Pay" subtitle="What the floor is owed for work already recorded" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Wages payable</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{rs(owed)}</p>
            <p className="mt-1 text-[12px] text-ink/60">{view.filter((r) => Number(r.payable) > 0).length} workers waiting</p>
          </div>
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Unpaid pieces</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{n(pieces)}</p>
          </div>
          <div className="rounded-card bg-success-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Ever earned</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">
              {rs(view.reduce((a, r) => a + Number(r.earned || 0), 0))}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search worker or floor…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => setOwingOnly((v) => !v)}
            className={`rounded-full px-3 py-2 text-[12px] font-semibold transition ${owingOnly ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
            {owingOnly ? "Owed only" : "All workers"}
          </button>
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Users size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">{owingOnly ? "Nobody is owed" : "No work recorded yet"}</p>
            <p className="mt-1 text-[13px] text-muted">Wages appear the moment pieces are recorded coming back from the floor.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">Worker</th>
                <th className="px-4 py-3 text-right font-bold">Unpaid pieces</th>
                <th className="px-4 py-3 text-right font-bold">Earned</th>
                <th className="px-4 py-3 text-right font-bold">Payable</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.employee_id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="text-[14px] font-bold text-ink">{r.employee}</span>
                      <span className="block text-[11px] text-hint">{r.department}
                        {r.last_delivery ? ` · last ${when(r.last_delivery)}` : ""}</span>
                    </td>
                    <td className="px-4 py-3 text-right tnum text-muted">{n(r.pieces_unpaid)}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{rs(r.earned)}</td>
                    <td className={`px-4 py-3 text-right tnum text-[17px] font-extrabold ${Number(r.payable) > 0 ? "text-danger" : "text-hint/60"}`}>
                      {rs(r.payable)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canPay && Number(r.payable) > 0 && (
                        <button onClick={() => openPay(r)}
                          className="flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white">
                          <Wallet size={13} /> Pay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={`Pay ${payFor?.employee ?? ""}`}>
        <p className="text-[13px] text-muted">
          Choose which deliveries this payment settles. Unticking one leaves it owed.
        </p>
        <div className="mt-3 max-h-64 overflow-y-auto rounded-xl2 border border-line">
          {receipts.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center justify-between gap-2 border-b border-line/60 px-3 py-2 last:border-0">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(r.id)}
                  onChange={(e) => setPicked((p) => e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id))} />
                <span className="text-[12.5px] text-ink">
                  <b>{r.receipt_no}</b> · {n(r.quantity)} pieces
                  <span className="ml-1 text-[11px] text-hint">{when(r.received_at)}</span>
                </span>
              </span>
              <span className="tnum text-[12.5px] font-semibold text-ink">{rs(Number(r.quantity || 0) * Number(r.unit_rate || 0))}</span>
            </label>
          ))}
          {receipts.length === 0 && <p className="px-3 py-4 text-center text-[12.5px] text-muted">Nothing unpaid.</p>}
        </div>
        <p className="mt-3 text-right text-[15px] font-extrabold text-ink">Paying {rs(chosenTotal)}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setPayFor(null)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={pay} disabled={busy || picked.length === 0}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Pay {picked.length} delivery{picked.length === 1 ? "" : "s"}
          </button>
        </div>
      </Modal>
    </>
  );
}
