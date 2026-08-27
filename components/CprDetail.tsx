"use client";
/* One settlement, laid out the way the courier's own receipt lays it out.
 *
 * WHY THIS EXISTS
 *   The CPR list used to show a single amount and nothing else — no shipping,
 *   no GST, no withholding, no working. Worse, that amount was the net of the
 *   parcels we happened to hold, so it disagreed with the courier:
 *
 *       CPR-V5DYF677330   PostEx portal  11,619.34
 *                         our list        8,267
 *
 *   Both figures were computed correctly and neither could be checked against
 *   the other, which is the least useful pair of numbers a finance screen can
 *   produce. This shows the receipt's own arithmetic, line for line, so any row
 *   can be held against the portal and either agree or visibly not.
 *
 * THE GAP IS THE POINT
 *   `net_total` is what the courier paid. `matched_total` is the part we could
 *   attribute to parcels in our own database. The difference is money received
 *   for parcels this system has no record of — a real number worth seeing
 *   rather than a rounding difference to bury.
 */
import { useEffect, useState } from "react";
import { X, Loader2, AlertTriangle, Check, Undo2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Row = Record<string, unknown>;
type Parcel = {
  tracking_id: string; order_number: string | null; store_code: string | null;
  delivery_status: string | null; cod_amount: number | null;
  cpr_net_amount: number | null; courier_fee: number | null;
  courier_tax: number | null; payment_status: string | null;
};

const n = (v: unknown) => Number(v) || 0;
const money = (v: unknown) =>
  v == null ? "—" : "Rs " + n(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* Deductions are shown the way the receipt shows them — in brackets — because
   that is what the person is comparing against on the other screen. */
const less = (v: unknown) => (n(v) ? "(" + n(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ")" : "—");

export default function CprDetail({ row, onClose }: { row: Row; onClose: () => void }) {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const cpr = String(row.cpr_number ?? "");

  /* PER-PARCEL CORRECTION.
   *
   *  The courier and Shopify disagree more often than anyone would like: PostEx
   *  hands a parcel back, and nobody on the team closes the order in Shopify.
   *  The settlement file is then right and our record is wrong, on one parcel,
   *  and there was no way to say so without editing the database by hand.
   *
   *  "Mark paid"      the courier settled it — set Delivered and Paid
   *  "Mark returned"  it came back — restore Returned and REMOVE the payment,
   *                   because a returned COD parcel collected no cash
   *
   *  Marking returned is the one that moves money off the books, so the old
   *  values go into online_payment_corrections first — the same audit table
   *  0084 used, so a mistake here is one query to undo. */
  async function correct(p: Parcel, to: "paid" | "returned") {
    if (!supabase) return;
    setBusy(p.tracking_id); setErr("");
    try {
      if (to === "returned") {
        await supabase.from("online_payment_corrections").insert({
          tracking_id: p.tracking_id, courier: String(row.courier ?? ""),
          delivery_status: p.delivery_status, old_payment_status: p.payment_status,
          old_cpr_number: cpr, cod_amount: p.cod_amount, cpr_net_amount: p.cpr_net_amount,
          reason: "manual: marked as returned from the CPR detail",
        });
      }
      const patch = to === "paid"
        ? { delivery_status: "Delivered", payment_status: "Paid",
            payment_date: String(row.cpr_date ?? new Date().toISOString().slice(0, 10)) }
        : { delivery_status: "Returned", payment_status: null, payment_date: null };
      const { error } = await supabase.from("online_logistics")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("tracking_id", p.tracking_id);
      if (error) throw new Error(error.message);
      setParcels((xs) => xs.map((x) => x.tracking_id === p.tracking_id
        ? { ...x, ...patch, payment_status: to === "paid" ? "Paid" : null } as Parcel : x));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(""); }
  }

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured || !supabase || !cpr) { setLoading(false); return; }
      const { data } = await supabase.from("online_logistics")
        .select("tracking_id,order_number,store_code,delivery_status,cod_amount,cpr_net_amount,courier_fee,courier_tax,payment_status")
        .eq("cpr_number", cpr)
        .order("delivery_status", { ascending: true })
        .limit(1000);
      setParcels((data as Parcel[]) ?? []);
      setLoading(false);
    })();
  }, [cpr]);

  const unmatched = Array.isArray(row.unmatched) ? (row.unmatched as string[]) : [];
  const netTotal = row.net_total ?? row.amount;
  const gap = n(netTotal) - n(row.matched_total);

  const lines: [string, string, boolean][] = [
    ["Total", money(row.gross_total), false],
    ["Shipping Charges", less(row.shipping_charges), true],
    ["GST", less(row.gst), true],
    ["WH Income Tax (2%)", less(row.wh_income_tax), true],
    ["WH Sales Tax (2%)", less(row.wh_sales_tax), true],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
         onClick={onClose}>
      <div className="w-full max-w-4xl rounded-card border border-line bg-surface p-5 shadow-xl dark:border-white/10 dark:bg-[#1a1713]"
           onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between">
          <div>
            <div className="text-[16px] font-bold text-ink dark:text-[#f4f1ea]">{cpr || "Settlement"}</div>
            <div className="text-[12.5px] text-muted dark:text-[#a89f93]">
              {String(row.courier ?? "")} · {String(row.cpr_date ?? "")}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-panel dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        {/* The courier's own arithmetic. Every line should match the portal. */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-line p-3.5 dark:border-white/10">
            <div className="text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">How the courier calculated this</div>
            {row.gross_total == null ? (
              <div className="mt-2 flex gap-2 text-[12px] text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>No breakdown stored. This batch was imported before the receipt
                totals were captured — re-import the file and it will fill in.</span>
              </div>
            ) : (
              <table className="mt-2 w-full text-[13px]">
                <tbody>
                  {lines.map(([label, val, isDeduction]) => (
                    <tr key={label} className="border-b border-line/60 last:border-0 dark:border-white/[0.06]">
                      <td className="py-1.5 text-muted dark:text-[#a89f93]">{label}</td>
                      <td className={`py-1.5 text-right tabular-nums ${isDeduction ? "text-muted dark:text-[#a89f93]" : "font-semibold text-ink dark:text-[#f4f1ea]"}`}>{val}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-2 text-[13px] font-bold text-ink dark:text-[#f4f1ea]">Net Total</td>
                    <td className="pt-2 text-right text-[15px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{money(netTotal)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-card border border-line p-3.5 dark:border-white/10">
            <div className="text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">What it covers</div>
            <div className="mt-2 space-y-1.5 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted dark:text-[#a89f93]">Delivered — paid</span>
                <span className="font-semibold tabular-nums">{n(row.delivered_count).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted dark:text-[#a89f93]">Returned — charged, not paid</span>
                <span className="font-semibold tabular-nums">{n(row.returned_count).toLocaleString()}</span>
              </div>
              {n(row.returns_cost) !== 0 && (
                <div className="flex justify-between">
                  <span className="text-muted dark:text-[#a89f93]">Cost of those returns</span>
                  <span className="tabular-nums text-danger">{money(Math.abs(n(row.returns_cost)))}</span>
                </div>
              )}
              <div className="mt-2 border-t border-line pt-2 dark:border-white/[0.06]" />
              <div className="flex justify-between">
                <span className="text-muted dark:text-[#a89f93]">Matched to our parcels</span>
                <span className="tabular-nums">{n(row.matched_count).toLocaleString()} · {money(row.matched_total)}</span>
              </div>
              {/* Not a discrepancy to hide — it is money received for parcels
                  this system never recorded, and it is worth knowing. */}
              {Math.abs(gap) > 1 && (
                <div className="flex justify-between">
                  <span className="text-muted dark:text-[#a89f93]">Paid for parcels we don&apos;t hold</span>
                  <span className="tabular-nums text-amber-700">{money(gap)}</span>
                </div>
              )}
              {unmatched.length > 0 && (
                <div className="mt-1 text-[11.5px] text-hint dark:text-[#8a8175]">
                  {unmatched.length} tracking number{unmatched.length === 1 ? "" : "s"} in this receipt
                  had no parcel here: {unmatched.slice(0, 3).join(", ")}
                  {unmatched.length > 3 && ` +${unmatched.length - 3} more`}
                </div>
              )}
            </div>
          </div>
        </div>

        {err && (
          <div className="mt-3 flex gap-2 rounded-card border border-red-300 bg-red-50 p-2.5 text-[12px] text-red-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{err}</span>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-1.5 text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">
            Parcels in this settlement {parcels.length > 0 && <span className="font-normal text-muted">({parcels.length.toLocaleString()})</span>}
          </div>
          <div className="max-h-72 overflow-auto rounded-card border border-line dark:border-white/10">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : parcels.length === 0 ? (
              <div className="p-4 text-[13px] text-muted">No parcels here carry this CPR number.</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-panel text-left text-muted dark:bg-[#221e19] dark:text-[#a89f93]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Order</th>
                    <th className="px-3 py-2 font-semibold">Tracking</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">COD</th>
                    <th className="px-3 py-2 text-right font-semibold">Charges</th>
                    <th className="px-3 py-2 text-right font-semibold">Net</th>
                    <th className="px-3 py-2 text-right font-semibold">Fix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                  {parcels.map((p) => {
                    const returned = p.delivery_status === "Returned" || p.delivery_status === "RTS";
                    return (
                      <tr key={p.tracking_id} className="text-ink dark:text-[#e7e2d8]">
                        <td className="px-3 py-1.5 font-medium">{p.order_number ?? "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-[11.5px] text-muted dark:text-[#a89f93]">{p.tracking_id}</td>
                        <td className={`px-3 py-1.5 ${returned ? "text-danger" : "text-muted dark:text-[#a89f93]"}`}>{p.delivery_status ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(p.cod_amount)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted dark:text-[#a89f93]">{less(n(p.courier_fee) + n(p.courier_tax))}</td>
                        <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${returned ? "text-danger" : ""}`}>{money(p.cpr_net_amount)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {busy === p.tracking_id ? <Loader2 size={13} className="inline animate-spin text-muted" /> : (
                            returned
                              ? <button onClick={() => correct(p, "paid")}
                                  className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-panel dark:border-white/15 dark:text-white dark:hover:bg-white/10">
                                  <Check size={11} /> Mark paid
                                </button>
                              : <button onClick={() => correct(p, "returned")}
                                  className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-muted hover:bg-panel dark:border-white/15 dark:text-[#a89f93] dark:hover:bg-white/10">
                                  <Undo2 size={11} /> Mark returned
                                </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-1.5 text-[11.5px] text-hint dark:text-[#8a8175]">
            Use <b>Fix</b> when the courier and Shopify disagree — a parcel PostEx settled but
            nobody closed in Shopify, or one marked paid that actually came back. Marking a
            parcel returned removes its payment and records the old values, so it can be undone.
          </div>
        </div>
      </div>
    </div>
  );
}
