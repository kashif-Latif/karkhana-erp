"use client";
/* ACCOUNT PAYABLE — SUPPLIERS. What the factory owes for material bought.
 *
 * Purchased comes from every GRN, paid from every payment recorded against
 * that supplier, and outstanding is the difference. Nothing is typed here —
 * a balance you can hand-edit is a balance nobody can defend in an argument
 * with the supplier.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Truck, Loader2, Download, Wallet } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Due = { supplier_id: string; company_name: string;
             purchased: number; paid: number; outstanding: number };

const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();

export default function SupplierPayablePage() {
  const { can } = usePermissions();
  const canPay = can(["payments.manage"]);

  const [dues, setDues] = useState<Due[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [owingOnly, setOwingOnly] = useState(true);

  const [payFor, setPayFor] = useState<Due | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.from("supplier_dues").select("*");
    if (error) setErr(error.message);
    setDues((data as Due[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => dues
    .filter((d) => (!owingOnly || Number(d.outstanding) > 0)
      && (!q.trim() || d.company_name.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => Number(b.outstanding) - Number(a.outstanding)),
    [dues, q, owingOnly]);

  const owed = view.reduce((a, d) => a + Number(d.outstanding || 0), 0);
  const bought = view.reduce((a, d) => a + Number(d.purchased || 0), 0);
  const settled = view.reduce((a, d) => a + Number(d.paid || 0), 0);

  async function pay() {
    if (!supabase || !payFor) return;
    setErr("");
    const amt = parseFloat(amount);
    if (!(amt > 0)) { setErr("Enter an amount."); return; }
    if (amt > Number(payFor.outstanding)) {
      setErr(`That is more than the ${rs(payFor.outstanding)} outstanding. Reduce it, or record the extra as a separate advance.`);
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("record_payment", {
      p_supplier_id: payFor.supplier_id, p_amount: amt, p_method: method,
      p_reference: reference.trim() || null, p_paid_at: new Date().toISOString(),
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPayFor(null); setAmount(""); setReference(""); setNote(""); load();
  }

  const table = (): ExportTable => ({
    title: "supplier-payable",
    headers: ["Supplier", "Purchased", "Paid", "Outstanding"],
    rows: view.map((d) => [d.company_name, d.purchased, d.paid, d.outstanding]),
  });

  return (
    <>
      <Topbar title="Supplier Credit" subtitle="What the factory owes for material bought" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-salmon-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Outstanding</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{rs(owed)}</p>
            <p className="mt-1 text-[12px] text-ink/60">{view.filter((d) => Number(d.outstanding) > 0).length} suppliers</p>
          </div>
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Purchased</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{rs(bought)}</p>
          </div>
          <div className="rounded-card bg-success-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Paid</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{rs(settled)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search supplier…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => setOwingOnly((v) => !v)}
            className={`rounded-full px-3 py-2 text-[12px] font-semibold transition ${owingOnly ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
            {owingOnly ? "Owing only" : "All suppliers"}
          </button>
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Truck size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">{owingOnly ? "Nothing outstanding" : "No suppliers yet"}</p>
            <p className="mt-1 text-[13px] text-muted">{owingOnly ? "Every supplier is settled." : "Suppliers appear here once material has been received from them."}</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">Supplier</th>
                <th className="px-4 py-3 text-right font-bold">Purchased</th>
                <th className="px-4 py-3 text-right font-bold">Paid</th>
                <th className="px-4 py-3 text-right font-bold">Outstanding</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {view.map((d, ix) => (
                  <tr key={d.supplier_id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3 text-[14px] font-bold text-ink">{d.company_name}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{rs(d.purchased)}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{rs(d.paid)}</td>
                    <td className={`px-4 py-3 text-right tnum text-[17px] font-extrabold ${Number(d.outstanding) > 0 ? "text-danger" : "text-hint/60"}`}>
                      {rs(d.outstanding)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canPay && Number(d.outstanding) > 0 && (
                        <button onClick={() => { setPayFor(d); setAmount(String(d.outstanding)); }}
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

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={`Pay ${payFor?.company_name ?? ""}`}>
        <p className="text-[13px] text-muted">Outstanding <b className="text-ink">{rs(Number(payFor?.outstanding ?? 0))}</b></p>
        <div className="mt-3"><Field label="Amount *">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus className={inp} />
        </Field></div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>
              {["cash", "bank", "cheque", "online"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Reference">
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="cheque / transfer no" className={inp} />
          </Field>
        </div>
        <div className="mt-3"><Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} />
        </Field></div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setPayFor(null)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={pay} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Record payment
          </button>
        </div>
      </Modal>
    </>
  );
}
