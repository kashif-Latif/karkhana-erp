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
import { useCallback, useEffect, useState } from "react";
import { X, Loader2, AlertTriangle, Check, Undo2, CheckCircle2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";

type Row = Record<string, unknown>;
type Parcel = {
  tracking_id: string; order_number: string | null; store_code: string | null;
  delivery_status: string | null; cod_amount: number | null;
  cpr_net_amount: number | null; courier_fee: number | null;
  courier_tax: number | null; payment_status: string | null;
  return_received_at: string | null;
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
  const confirm = useConfirm();
  /* The uncancelled returns themselves, not just how many.
     A count says something is wrong; the list says which order, in which store,
     for how much — which is what somebody actually needs to go and check before
     agreeing to write to a live shop. */
  const [shop, setShop] = useState<{
    open: { order: string; store: string; cod: number }[];
    delivered: number;
  } | null>(null);
  const [shopMsg, setShopMsg] = useState("");
  const cpr = String(row.cpr_number ?? "");

  /* WHAT THIS SETTLEMENT MEANS FOR SHOPIFY.
     A CPR settles parcels here, but Shopify knows nothing about it: a returned
     order can still be sitting open as a live sale, and a delivered one may
     never have been marked delivered. The two drift apart quietly, and the only
     symptom is Shopify's reports disagreeing with this system.

     Counted here rather than assumed, and acted on by a button rather than
     automatically — writing to a live shop is the one thing in this system that
     cannot be undone by re-running a migration. */
  const loadShopState = useCallback(async (parcels: Parcel[]) => {
    if (!supabase || parcels.length === 0) return;
    const nums = [...new Set(parcels.map((p) => p.order_number).filter(Boolean))] as string[];
    if (!nums.length) return;
    const { data } = await supabase.from("online_orders")
      .select("order_number,store_code,cancelled_at").in("order_number", nums);
    const cancelled = new Set((data ?? [])
      .filter((o) => o.cancelled_at)
      .map((o) => `${o.store_code}|${o.order_number}`));
    const open: { order: string; store: string; cod: number }[] = [];
    let delivered = 0;
    for (const p of parcels) {
      const key = `${p.store_code}|${p.order_number}`;
      if (p.delivery_status === "Returned" || p.delivery_status === "RTS") {
        if (!cancelled.has(key)) {
          open.push({ order: String(p.order_number ?? "—"),
                      store: String(p.store_code ?? "—"),
                      cod: Number(p.cod_amount ?? 0) });
        }
      } else if (p.delivery_status === "Delivered") delivered++;
    }
    // Biggest first: if only some are going to be checked by hand, check those.
    open.sort((a, b) => b.cod - a.cod);
    setShop({ open, delivered });
  }, []);

  async function pushOne(action: "close" | "deliver" | "paid" | "cancel") {
    if (!supabase) return;
    const returns = action === "close" || action === "cancel";
    const wanted = returns
      ? parcels.filter((p) => p.delivery_status === "Returned" || p.delivery_status === "RTS")
      : parcels.filter((p) => p.delivery_status === "Delivered");
    const tracking = [...new Set(wanted.map((p) => p.tracking_id).filter(Boolean))] as string[];
    if (!tracking.length) return;
    const { data, error } = await supabase.functions.invoke("shopify-writeback", {
      body: { action, tracking, dry_run: false, max: 200,
              ...(action === "cancel" ? { confirm: "CANCEL PERMANENTLY" } : {}) },
    });
    if (error) {
      let detail = error.message;
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try { detail = (await ctx.json())?.error ?? detail; } catch { /* keep it */ }
      }
      setErr(detail);
    } else {
      setShopMsg((data as { report?: string })?.report ?? "Done.");
      await loadShopState(parcels);
    }
  }

  async function pushToShopify(action: "close" | "deliver" | "paid" | "cancel") {
    if (!supabase) return;
    setBusy("shopify"); setShopMsg(""); setErr("");
    // "Send again" retries both halves, since the automatic push does both.
    if (action === "paid") { await pushOne("paid"); await pushOne("deliver"); setBusy(""); return; }
    const returns = action === "close" || action === "cancel";
    const wanted = returns
      ? parcels.filter((p) => p.delivery_status === "Returned" || p.delivery_status === "RTS")
      : parcels.filter((p) => p.delivery_status === "Delivered");
    const orders = [...new Set(wanted.map((p) => p.order_number).filter(Boolean))] as string[];
    if (!orders.length) { setBusy(""); setShopMsg("Nothing of that kind in this settlement."); return; }
    const { data, error } = await supabase.functions.invoke("shopify-writeback", {
      body: { action, orders, dry_run: false, max: 200,
              // The function refuses to cancel without this, deliberately.
              ...(action === "cancel" ? { confirm: "CANCEL PERMANENTLY" } : {}) },
    });
    if (error) {
      let detail = error.message;
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try { detail = (await ctx.json())?.error ?? detail; } catch { /* keep it */ }
      }
      setErr(detail);
    } else {
      setShopMsg((data as { report?: string })?.report ?? "Done.");
      await loadShopState(parcels);
    }
    setBusy("");
  }

  /* Load the parcels this settlement covers.
     Lost in an earlier edit, which is why the panel span forever: `loading`
     starts true and nothing was left to set it false. `error` is read rather
     than discarded — a silent failure here looks identical to a slow network,
     and that is exactly the confusion it caused. */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase || !cpr) { setLoading(false); return; }
      const { data, error } = await supabase.from("online_logistics")
        .select("tracking_id,order_number,store_code,delivery_status,cod_amount,cpr_net_amount,courier_fee,courier_tax,payment_status,return_received_at")
        .eq("cpr_number", cpr)
        .order("delivery_status", { ascending: true })
        .limit(1000);
      if (!alive) return;
      if (error) setErr(error.message);
      const list = (data as Parcel[]) ?? [];
      setParcels(list);
      setLoading(false);
      loadShopState(list);
    })();
    return () => { alive = false; };
  }, [cpr, loadShopState]);

  /* NOTE ON SETTLEMENT STATUS (migration 0086, now unused).
     A control here once let you mark a settlement "not yet paid", mirroring
     PostEx's NEW and OwnEx's Unpaid. It was built on a wrong assumption. In
     this business the money arrives FIRST and the courier publishes the CPR a
     day later, so a CPR existing already means you have been paid — the portal
     flag tracks their paperwork catching up, not your cash. The column stays
     (harmless, everything reads Paid); the control is gone rather than left
     there inviting a wrong answer. */

  /* ONE PARCEL AT A TIME, when the bulk buckets are too blunt.
     "Mark paid" sets Delivered + Paid; "Mark returned" restores Returned and
     REMOVES the payment, because a returned COD parcel collected no cash. The
     second writes the old values to online_payment_corrections first — the same
     audit table 0084 used — so it can be undone. */
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
      setParcels((xs) => xs.map((x) => x.tracking_id === p.tracking_id ? { ...x, ...patch } as Parcel : x));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }

  /* ------------------------------------------------------------------------
     RECONCILING THE SETTLEMENT AGAINST OUR OWN RECORD.

     After an import every parcel in a CPR falls into one of four states, and
     only two of them need a person:

       agreed      courier paid, we say Delivered and Paid. Nothing to do.
       closed      courier billed a return, and the return is already closed
                   here — either received, or the agent cancelled it in
                   Shopify. Nothing to do.
       open return courier billed a return we have not closed. THIS is the one
                   that needs asking: is the box actually in your hands?
       still paid  courier billed a return but we still show it Paid. A
                   contradiction — the money was never collected.

     The question that matters is "did you physically receive it", because that
     is the only thing nobody but a person can know. Answering NO is not a
     failure state: it leaves the parcel in Pending returns where it keeps being
     chased, which is exactly right until the box turns up.

     When it does turn up, the agent cancels the order in Shopify as they
     already do, and v_returns_all drops it out of chasing on its own — that
     rule has been in place since 0073 and nothing here changes it.
  ------------------------------------------------------------------------ */
  const isRet = (p: Parcel) => p.delivery_status === "Returned" || p.delivery_status === "RTS";
  const isPaid = (p: Parcel) => (p.payment_status ?? "") === "Paid" || (p.payment_status ?? "") === "Received";
  const agreed     = parcels.filter((p) => !isRet(p) && isPaid(p));
  const closedRet  = parcels.filter((p) => isRet(p) && !isPaid(p) && p.return_received_at);
  const openRet    = parcels.filter((p) => isRet(p) && !isPaid(p) && !p.return_received_at);
  const stillPaid  = parcels.filter((p) => isRet(p) && isPaid(p));

  async function bulk(list: Parcel[], action: "received" | "chase" | "unpay") {
    if (!supabase || !list.length) return;
    setBusy("bulk"); setErr("");
    const ids = list.map((p) => p.tracking_id);
    try {
      if (action === "unpay") {
        await supabase.from("online_payment_corrections").insert(
          list.map((p) => ({
            tracking_id: p.tracking_id, courier: String(row.courier ?? ""),
            delivery_status: p.delivery_status, old_payment_status: p.payment_status,
            old_cpr_number: cpr, cod_amount: p.cod_amount, cpr_net_amount: p.cpr_net_amount,
            reason: "manual: settlement says returned, cleared payment from CPR detail",
          })));
      }
      const patch =
        action === "received" ? { return_received_at: new Date().toISOString() }
        : action === "chase"  ? { return_received_at: null }
        : { payment_status: null, payment_date: null, delivery_status: "Returned" };
      const { error } = await supabase.from("online_logistics")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .in("tracking_id", ids);
      if (error) throw new Error(error.message);
      setParcels((xs) => xs.map((x) => ids.includes(x.tracking_id) ? { ...x, ...patch } as Parcel : x));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }

  const unmatched = Array.isArray(row.unmatched) ? (row.unmatched as string[]) : [];
  const netTotal = row.net_total ?? row.amount;
  const gap = n(netTotal) - n(row.matched_total);

  /* EACH COURIER DEDUCTS DIFFERENT THINGS, SO NAME THEM DIFFERENTLY.
     PostEx deducts GST and withholds income and sales tax. OwnEx charges a fuel
     surcharge and withholds nothing — but the panel printed "GST" over the fuel
     figure and then two withholding rows reading "—" on every single invoice.

     A row that is always empty is worse than no row: the reader has to look at
     it, work out that it means nothing here, and do that again next time. And a
     number under the wrong heading is worse still, because it is quietly
     believed. */
  const isOwnEx = String(row.courier ?? "") === "OwnEx";
  const lines: [string, string, boolean][] = isOwnEx
    ? [
        ["Total", money(row.gross_total), false],
        ["Delivery Charges", less(row.shipping_charges), true],
        ["Fuel Surcharge", less(row.gst), true],
      ]
    : [
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
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="mt-2 w-full text-[13px]">
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
              </table></div>
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

        {!loading && parcels.length > 0 && (
          <div className="mt-4 rounded-card border border-line p-3.5 dark:border-white/10">
            <div className="text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">Reconcile against Shopify</div>

            <div className="mt-2 space-y-2 text-[12.5px]">
              {(agreed.length > 0 || closedRet.length > 0) && (
                <div className="flex items-start gap-2 text-muted dark:text-[#a89f93]">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>
                    <b className="text-ink dark:text-[#f4f1ea]">{(agreed.length + closedRet.length).toLocaleString()}</b> already agree —
                    {agreed.length > 0 && <> {agreed.length} paid and delivered</>}
                    {agreed.length > 0 && closedRet.length > 0 && ","}
                    {closedRet.length > 0 && <> {closedRet.length} returns already closed</>}. Nothing to do.
                  </span>
                </div>
              )}

              {/* The only question a person can answer. Saying no is a real
                  answer, not a failure — it keeps the parcel being chased. */}
              {openRet.length > 0 && (
                <div className="rounded-card border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
                  <div className="font-semibold">
                    {openRet.length} return{openRet.length === 1 ? "" : "s"} the courier billed you for, not closed here.
                  </div>
                  <div className="mt-0.5">Do you physically have {openRet.length === 1 ? "it" : "them"}?</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button disabled={!!busy} onClick={() => bulk(openRet, "received")}
                            className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-[#141414]">
                      Yes — received, close {openRet.length === 1 ? "it" : "them"}
                    </button>
                    <button disabled={!!busy} onClick={() => bulk(openRet, "chase")}
                            className="rounded-full border border-amber-400 px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">
                      No — keep chasing
                    </button>
                  </div>
                  <div className="mt-1.5 text-[11.5px]">
                    Keep chasing leaves them in Pending returns. When the box arrives your agent
                    cancels the order in Shopify as usual and it closes itself.
                  </div>
                </div>
              )}

              {stillPaid.length > 0 && (
                <div className="rounded-card border border-red-300 bg-red-50 p-2.5 text-red-800">
                  <div className="font-semibold">
                    {stillPaid.length} marked Paid, but this settlement says returned.
                  </div>
                  <div className="mt-0.5">
                    A returned COD parcel collected no cash, so the payment is wrong —
                    {" "}{money(stillPaid.reduce((t, p) => t + n(p.cod_amount), 0))} counted as revenue that never arrived.
                  </div>
                  <button disabled={!!busy} onClick={() => bulk(stillPaid, "unpay")}
                          className="mt-2 rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-[#141414]">
                    Clear the payment on {stillPaid.length}
                  </button>
                </div>
              )}
            </div>
            {busy === "bulk" && (
              <div className="mt-2 flex items-center gap-2 text-[12px] text-muted"><Loader2 size={13} className="animate-spin" /> Writing…</div>
            )}
          </div>
        )}

        {shop && (shop.open.length > 0 || shop.delivered > 0) && (
          <div className="mt-4 rounded-card border border-line p-3.5 dark:border-white/10">
            <div className="text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">Shopify</div>
            <p className="mt-0.5 text-[12px] text-muted dark:text-[#a89f93]">
              Delivered parcels were marked paid and delivered automatically when this
              settlement was imported. Anything below still needs a decision.
            </p>
            <div className="mt-2.5 space-y-2 text-[12.5px]">
              {shop.open.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
                  <span>
                    <b>{shop.open.length}</b> return{shop.open.length === 1 ? "" : "s"} in this settlement
                    {shop.open.length === 1 ? " was" : " were"} never cancelled in Shopify by an agent —
                    still counted as live sales in its reports.
                  </span>
                  <span className="flex gap-2 shrink-0">
                    <button disabled={!!busy} onClick={() => pushToShopify("close")}
                            className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-[#141414]">
                      Close them
                    </button>
                    {/* Cancelling is permanent in Shopify — there is no un-cancel,
                        only recreating the order and losing its number. So it asks
                        first, and says what it cannot take back. */}
                    <button disabled={!!busy}
                            onClick={async () => {
                              if (!(await confirm({
                                title: `Cancel ${shop?.open.length} order${shop?.open.length === 1 ? "" : "s"} in Shopify?`,
                                body: "Shopify has no un-cancel. The only way back is recreating the order, losing its number and history. Closing archives them instead and can be reversed.",
                                confirmLabel: "Cancel them permanently",
                              }))) return;
                              pushToShopify("cancel");
                            }}
                            className="rounded-full border border-red-300 px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                      Cancel instead
                    </button>
                  </span>

                  {/* Wraps to a second line on a phone; each order is its own
                      chip so a long list stays readable rather than becoming a
                      wall of commas. */}
                  <ul className="mt-1 flex w-full flex-wrap gap-1.5">
                    {shop.open.map((o) => (
                      <li key={`${o.store}-${o.order}`}
                          className="flex items-baseline gap-1.5 rounded-full border border-amber-300 bg-white/70 px-2.5 py-1 text-[11.5px]">
                        <span className="font-semibold text-amber-900">{o.store}</span>
                        <span className="font-mono text-amber-900">{o.order}</span>
                        <span className="tabular-nums text-amber-700">{money(o.cod)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {shop.delivered > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-panel p-2.5 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="text-muted dark:text-[#a89f93]">
                    <b className="text-ink dark:text-[#f4f1ea]">{shop.delivered}</b> delivered — already sent to Shopify as paid and delivered.
                  </span>
                  {/* Paid and delivered are both sent automatically when the
                      settlement is imported — a CPR IS the payment, so there is
                      nothing to decide. This button only exists to retry if that
                      push failed, which is why it is quiet rather than primary. */}
                  <button disabled={!!busy} onClick={() => pushToShopify("paid")}
                          className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold hover:bg-panel disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10">
                    Send again
                  </button>
                </div>
              )}
              {busy === "shopify" && (
                <div className="flex items-center gap-2 text-[12px] text-muted"><Loader2 size={13} className="animate-spin" /> Writing to Shopify…</div>
              )}
              {shopMsg && <div className="text-[12px] font-medium text-emerald-800">{shopMsg}</div>}
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-hint dark:text-[#8a8175]">
              <b>Mark paid</b> records the COD cash against the order, so Shopify
              stops showing it as payment pending — that is what makes its revenue
              reports agree with what the courier settled.
              <b> Close</b> archives a returned order and can be reversed from the
              Shopify admin. <b>Cancel</b> cannot be reversed at all.
              Orders your agents already handled are skipped, not done twice.
            </p>
          </div>
        )}

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
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-[12.5px]">
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
              </table></div>
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
