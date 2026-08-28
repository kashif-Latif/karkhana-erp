"use client";
import { useEffect, useState, useCallback } from "react";
import Topbar from "@/components/Topbar";
import IconChip from "@/components/IconChip";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Loader2, Wallet, X, HandCoins, ScrollText, Trash2, AlertTriangle } from "lucide-react";

type Due = { supplier_id: string; company_name: string; purchased: number; paid: number; outstanding: number };
type StmtRow = { date: string; desc: string; isPurchase: boolean; amount: number; balance: number; paymentId?: string };

function todayInput() { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function dateToISO(dateStr: string) { const now = new Date(); const [y, m, d] = dateStr.split("-").map(Number); return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString(); }
const fmt = (n: number) => "Rs " + (n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const fmtDate = (s: string) => new Date(s).toLocaleString("en-PK", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

export default function Payments() {
  const [dues, setDues] = useState<Due[]>([]);
  const [loading, setLoading] = useState(true);
  const [canPay, setCanPay] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  const [confirmPay, setConfirmPay] = useState<{ id: string; label: string } | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState("");

  const [payFor, setPayFor] = useState<Due | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(() => todayInput());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [stmtFor, setStmtFor] = useState<Due | null>(null);
  const [stmt, setStmt] = useState<StmtRow[] | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("supplier_dues").select("*");
    const rows = ((data as Record<string, unknown>[]) ?? []).map((d) => ({
      supplier_id: d.supplier_id as string,
      company_name: d.company_name as string,
      purchased: Number(d.purchased), paid: Number(d.paid), outstanding: Number(d.outstanding),
    })) as Due[];
    rows.sort((a, b) => b.outstanding - a.outstanding);
    setDues(rows);
    const { data: can } = await supabase.rpc("has_permission", { p_permission_code: "payments.manage" });
    setCanPay(!!can);
    const { data: su } = await supabase.rpc("is_super_admin");
    setIsSuper(!!su);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openPay(d: Due) {
    setPayFor(d);
    setAmount(d.outstanding > 0 ? String(d.outstanding) : "");
    setMethod("cash"); setReference(""); setPaidAt(todayInput()); setNote(""); setError("");
  }
  async function submitPay() {
    if (!supabase || !payFor) return;
    if (!(parseFloat(amount) > 0)) { setError("Enter an amount greater than zero."); return; }
    setSaving(true); setError("");
    const { error } = await supabase.rpc("record_payment", {
      p_supplier_id: payFor.supplier_id, p_amount: parseFloat(amount), p_method: method,
      p_reference: reference, p_paid_at: dateToISO(paidAt), p_note: note,
    });
    setSaving(false);
    if (error) { setError(error.message.toLowerCase().includes("row-level") ? "You don't have permission to record payments." : error.message); return; }
    setPayFor(null); load();
  }

  async function openStmt(d: Due) {
    setStmtFor(d); setStmt(null);
    if (!supabase) return;
    const [led, grn, pay] = await Promise.all([
      supabase.from("supplier_ledger").select("entry_type, amount, created_at, ref_table, ref_id").eq("supplier_id", d.supplier_id).order("created_at", { ascending: true }),
      supabase.from("grns").select("id, grn_number").eq("supplier_id", d.supplier_id),
      supabase.from("payments").select("id, payment_number").eq("supplier_id", d.supplier_id),
    ]);
    const grnMap = new Map(((grn.data as { id: string; grn_number: string }[]) ?? []).map((g) => [g.id, g.grn_number]));
    const payMap = new Map(((pay.data as { id: string; payment_number: string }[]) ?? []).map((p) => [p.id, p.payment_number]));
    let bal = 0;
    const rows = ((led.data as Record<string, unknown>[]) ?? []).map((e) => {
      const isPurchase = e.entry_type === "purchase";
      const amt = Number(e.amount);
      bal += isPurchase ? amt : -amt;
      const ref = e.ref_table === "grns" ? grnMap.get(e.ref_id as string) : e.ref_table === "payments" ? payMap.get(e.ref_id as string) : null;
      return { date: e.created_at as string, desc: ref || (isPurchase ? "Purchase" : "Payment"), isPurchase, amount: amt, balance: bal, paymentId: e.ref_table === "payments" ? (e.ref_id as string) : undefined };
    });
    setStmt(rows);
  }

  async function deletePayment() {
    if (!supabase || !confirmPay) return;
    setPayBusy(true); setPayErr("");
    const { error } = await supabase.rpc("delete_payment", { p_payment_id: confirmPay.id });
    setPayBusy(false);
    if (error) { setPayErr(error.message); return; }
    setConfirmPay(null);
    load();
    if (stmtFor) openStmt(stmtFor);
  }

  const totalOwed = dues.reduce((s, d) => s + Math.max(d.outstanding, 0), 0);

  return (
    <>
      <Topbar title="Payments" subtitle="Supplier balances & payments" />
      <div className="px-6 pb-12">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to manage payments.</div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="rounded-card bg-surface px-5 py-3 shadow-card">
                <div className="text-[11.5px] uppercase tracking-wide text-muted">Total outstanding</div>
                <div className="text-[20px] font-extrabold tnum text-ink">{fmt(totalOwed)}</div>
              </div>
              {!canPay && <p className="text-[12.5px] text-muted">You can view balances. Recording payments needs the payments permission.</p>}
            </div>
            <p className="mb-3 text-[12.5px] text-muted">Use <b>Record payment</b> to log money you&rsquo;ve paid a supplier (cash, online/bank, or cheque) — it reduces their outstanding balance. <b>Statement</b> shows every receipt and payment for that supplier.</p>

            <div className="overflow-hidden rounded-card bg-surface shadow-card">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
              ) : dues.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <IconChip Icon={Wallet} size={44} />
                  <p className="text-[14px] font-semibold text-ink">No suppliers yet</p>
                  <p className="text-[12.5px] text-muted">Add suppliers and receive stock to see balances here.</p>
                </div>
              ) : (
                <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-semibold">Supplier</th>
                      <th className="px-5 py-3 text-right font-semibold">Purchased</th>
                      <th className="px-5 py-3 text-right font-semibold">Paid</th>
                      <th className="px-5 py-3 text-right font-semibold">Outstanding</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {dues.map((d) => (
                      <tr key={d.supplier_id} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                        <td className="px-5 py-3 font-semibold text-ink">{d.company_name}</td>
                        <td className="px-5 py-3 text-right tnum text-ink/80">{fmt(d.purchased)}</td>
                        <td className="px-5 py-3 text-right tnum text-ink/80">{fmt(d.paid)}</td>
                        <td className="px-5 py-3 text-right tnum font-bold" style={{ color: d.outstanding > 0 ? "#B45309" : "#166534" }}>{fmt(d.outstanding)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => openStmt(d)} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-ink/70 hover:bg-panel">
                              <ScrollText size={13} /> Statement
                            </button>
                            {canPay && (
                              <button onClick={() => openPay(d)} className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-[12px] font-semibold text-white">
                                <HandCoins size={13} /> Record payment
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Record payment modal */}
      {payFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !saving && setPayFor(null)}>
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-3"><IconChip Icon={HandCoins} size={38} /><h2 className="text-[17px] font-extrabold">Record payment</h2></div>
              <button onClick={() => setPayFor(null)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>
            <p className="mb-4 text-[12.5px] text-muted">{payFor.company_name} · outstanding <b>{fmt(payFor.outstanding)}</b></p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="mb-1 block text-[12px] font-medium text-muted">Amount (Rs) *</span>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inp} /></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Method</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>
                  <option value="cash">Cash</option><option value="bank">Online / Bank</option><option value="cheque">Cheque</option>
                </select></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">Date</span>
                <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inp} /></label>
              <label className="block sm:col-span-2"><span className="mb-1 block text-[12px] font-medium text-muted">Reference (cheque no, txn id…)</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} /></label>
              <label className="block sm:col-span-2"><span className="mb-1 block text-[12px] font-medium text-muted">Note (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} /></label>
            </div>

            {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPayFor(null)} disabled={saving} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={submitPay} disabled={saving} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {saving && <Loader2 size={15} className="animate-spin" />}Save payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Statement modal */}
      {stmtFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => setStmtFor(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3"><IconChip Icon={ScrollText} size={38} /><div><h2 className="text-[17px] font-extrabold">{stmtFor.company_name}</h2><p className="text-[12px] text-muted">Statement · outstanding {fmt(stmtFor.outstanding)}</p></div></div>
              <button onClick={() => setStmtFor(null)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>
            {stmt === null ? (
              <div className="flex items-center justify-center gap-2 py-10 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
            ) : stmt.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted">No transactions yet.</p>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Detail</th>
                    <th className="px-3 py-2 text-right font-semibold">Purchase</th>
                    <th className="px-3 py-2 text-right font-semibold">Payment</th>
                    <th className="px-3 py-2 text-right font-semibold">Balance</th>
                    {isSuper && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {stmt.map((r, i) => (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2 text-muted">{fmtDate(r.date)}</td>
                      <td className="px-3 py-2 font-medium text-ink">{r.desc}</td>
                      <td className="px-3 py-2 text-right tnum text-ink/80">{r.isPurchase ? fmt(r.amount) : ""}</td>
                      <td className="px-3 py-2 text-right tnum text-[#166534]">{!r.isPurchase ? fmt(r.amount) : ""}</td>
                      <td className="px-3 py-2 text-right tnum font-semibold text-ink">{fmt(r.balance)}</td>
                      {isSuper && (
                        <td className="px-3 py-2 text-right">
                          {r.paymentId && (
                            <button onClick={() => setConfirmPay({ id: r.paymentId as string, label: r.desc })} title="Delete this payment"
                              className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger"><Trash2 size={13} /></button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {confirmPay && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4" onClick={() => !payBusy && setConfirmPay(null)}>
          <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-3"><span className="flex h-[38px] w-[38px] items-center justify-center rounded-2xl bg-danger-soft text-danger"><AlertTriangle size={18} /></span><h2 className="text-[16px] font-extrabold">Delete payment</h2></div>
            <p className="text-[13px] text-muted">Permanently remove <b>{confirmPay.label}</b>? The supplier&rsquo;s balance will go back up by this amount. This cannot be undone.</p>
            {payErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{payErr}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmPay(null)} disabled={payBusy} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={deletePayment} disabled={payBusy} className="flex items-center gap-1.5 rounded-xl2 bg-danger px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{payBusy && <Loader2 size={15} className="animate-spin" />}Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
