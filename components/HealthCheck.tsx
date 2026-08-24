"use client";
import { useState } from "react";
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { btnGhost } from "@/components/Modal";

/* Why this exists
   On 22 Aug an OwnEx load sheet held 21 parcels but only 20 reached us: the
   agent had booked #LM15118 with the courier and never marked it fulfilled in
   Shopify, so Shopify — our only source for bookings — never carried its
   tracking number. Nothing was broken; a human step was skipped. This panel
   makes that class of gap visible the same day instead of at month-end. */

type Check = {
  key: string;
  title: string;
  detail: string;
  count: number;
  money?: number;
  rows?: { label: string; sub?: string; link?: string }[];
  severity: "bad" | "warn" | "ok";
};

const money = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

export default function HealthCheck({ days = 7 }: { days?: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [err, setErr] = useState("");

  async function run() {
    if (!supabase) return;
    setBusy(true); setErr(""); setChecks([]);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const out: Check[] = [];

    try {
      /* 1 — the exact failure we just hit: shipped but never marked fulfilled.
         An order still Pending after two days is either not shipped or not
         recorded, and both need a human to look. */
      const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      const { data: pending } = await supabase.from("online_orders")
        .select("order_number,store_code,order_date,amount,customer_name")
        .eq("status", "Pending").gte("order_date", since).lte("order_date", cutoff)
        .order("order_date").limit(200);
      out.push({
        key: "unfulfilled",
        title: "Orders not marked fulfilled",
        detail: "Placed more than 2 days ago and still Pending in Shopify. If one of these was actually booked with a courier, its tracking number never reached us.",
        count: (pending ?? []).length,
        money: (pending ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0),
        rows: (pending ?? []).slice(0, 25).map((r) => ({
          label: `${r.order_number} · ${r.store_code}`,
          sub: `${r.customer_name ?? ""} · ${money(Number(r.amount ?? 0))} · ${r.order_date ?? ""}`,
        })),
        severity: (pending ?? []).length ? "bad" : "ok",
      });

      /* 2 — gaps in the OwnEx tracking sequence. OwnEx issues numbers in a run
         per pickup, so a hole in our range is a parcel we may not have. It is a
         CANDIDATE, not a certainty — other shippers share the number space — so
         each one links to the tracker to confirm. */
      const { data: ox } = await supabase.from("online_logistics")
        .select("tracking_id,dispatch_date")
        .eq("courier", "OwnEx").gte("dispatch_date", since)
        .not("tracking_id", "is", null).order("tracking_id").limit(3000);

      const byDay = new Map<string, number[]>();
      for (const r of ox ?? []) {
        const n = Number(r.tracking_id);
        if (!Number.isFinite(n)) continue;
        const d = r.dispatch_date ?? "unknown";
        byDay.set(d, [...(byDay.get(d) ?? []), n]);
      }
      const gaps: { label: string; sub?: string; link?: string }[] = [];
      for (const [day, nums] of byDay) {
        const sorted = [...new Set(nums)].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
          const step = sorted[i] - sorted[i - 1];
          // only a short hole is worth flagging; a big jump is just another pickup
          if (step > 1 && step <= 6) {
            for (let m = sorted[i - 1] + 1; m < sorted[i]; m++) {
              gaps.push({
                label: String(m), sub: `missing from ${day}`,
                link: `https://ownexpress.pk/?tracking=${m}`,
              });
            }
          }
        }
      }
      out.push({
        key: "gaps",
        title: "Possible gaps in the OwnEx sequence",
        detail: "Tracking numbers we do not have, sitting between numbers we do. Check each on the OwnEx tracker — if it is your parcel, import that day's load sheet.",
        count: gaps.length,
        rows: gaps.slice(0, 25),
        severity: gaps.length ? "warn" : "ok",
      });

      /* 3 — parcels carrying money but not tied to an order */
      const { data: orphan } = await supabase.from("online_logistics")
        .select("tracking_id,courier,cod_amount,dispatch_date")
        .or("order_number.is.null,order_number.eq.#,order_number.eq.")
        .limit(200);
      out.push({
        key: "orphan",
        title: "Parcels with no order number",
        detail: "COD that cannot be traced back to a customer. Run Sync Shopify → Fetch tracking to recover them.",
        count: (orphan ?? []).length,
        money: (orphan ?? []).reduce((s, r) => s + Number(r.cod_amount ?? 0), 0),
        rows: (orphan ?? []).slice(0, 25).map((r) => ({
          label: String(r.tracking_id), sub: `${r.courier ?? "no courier"} · ${money(Number(r.cod_amount ?? 0))}`,
        })),
        severity: (orphan ?? []).length ? "bad" : "ok",
      });

      /* 4 — parcels whose courier we could not name */
      const { data: nocourier } = await supabase.from("online_logistics")
        .select("tracking_id,order_number,cod_amount")
        .or("courier.is.null,courier.not.in.(PostEx,OwnEx)")
        .limit(200);
      out.push({
        key: "courier",
        title: "Parcels with no courier",
        detail: "The Shopify fulfilment did not name a carrier, so these are excluded from courier reconciliation.",
        count: (nocourier ?? []).length,
        money: (nocourier ?? []).reduce((s, r) => s + Number(r.cod_amount ?? 0), 0),
        rows: (nocourier ?? []).slice(0, 25).map((r) => ({
          label: String(r.tracking_id), sub: `${r.order_number ?? "—"} · ${money(Number(r.cod_amount ?? 0))}`,
        })),
        severity: (nocourier ?? []).length ? "warn" : "ok",
      });

      /* 5 — delivered but the courier has not paid */
      const { data: owed } = await supabase.from("online_logistics")
        .select("courier,cod_amount,delivery_date")
        .eq("delivery_status", "Delivered").neq("payment_status", "Paid")
        .limit(5000);
      const byCourier: Record<string, { n: number; sum: number }> = {};
      for (const r of owed ?? []) {
        const c = r.courier ?? "unknown";
        byCourier[c] = byCourier[c] ?? { n: 0, sum: 0 };
        byCourier[c].n++; byCourier[c].sum += Number(r.cod_amount ?? 0);
      }
      out.push({
        key: "owed",
        title: "Delivered but not yet paid",
        detail: "COD the courier has collected and still owes you.",
        count: (owed ?? []).length,
        money: (owed ?? []).reduce((s, r) => s + Number(r.cod_amount ?? 0), 0),
        rows: Object.entries(byCourier).map(([c, v]) => ({ label: c, sub: `${v.n} parcels · ${money(v.sum)}` })),
        severity: (owed ?? []).length ? "warn" : "ok",
      });

      /* 6 — delivery attempts that failed and are going nowhere */
      const { data: stuck } = await supabase.from("online_logistics")
        .select("tracking_id,order_number,cod_amount,dispatch_date,rts_reason")
        .like("rts_reason", "OwnEx:%").order("dispatch_date").limit(200);
      out.push({
        key: "stuck",
        title: "Failed delivery attempts",
        detail: "The customer refused or was unavailable. These need a phone call, not more waiting.",
        count: (stuck ?? []).length,
        money: (stuck ?? []).reduce((s, r) => s + Number(r.cod_amount ?? 0), 0),
        rows: (stuck ?? []).slice(0, 25).map((r) => ({
          label: `${r.order_number ?? r.tracking_id}`,
          sub: `${money(Number(r.cod_amount ?? 0))} · since ${r.dispatch_date ?? "?"}`,
        })),
        severity: (stuck ?? []).length ? "warn" : "ok",
      });

      setChecks(out);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const bad = checks.filter((c) => c.severity === "bad").length;

  return (
    <>
      <button onClick={() => { setOpen(true); run(); }} className={btnGhost}>
        <ShieldCheck size={15} /> Health check
      </button>

      <Modal open={open} onClose={() => setOpen(false)} wide title="Health check"
        subtitle={`Everything that needs a human, across the last ${days} days.`}>
        {busy && <p className="flex items-center gap-2 text-[13px] text-muted dark:text-[#a89f93]"><Loader2 size={15} className="animate-spin" /> Checking…</p>}
        {err && <p className="text-[13px] font-semibold text-danger">{err}</p>}

        {!busy && checks.length > 0 && (
          <>
            <p className={`mb-3 text-[13px] font-semibold ${bad ? "text-danger" : "text-success"}`}>
              {bad ? `${bad} thing(s) need attention` : "Nothing needs attention"}
            </p>
            <div className="space-y-2.5">
              {checks.map((c) => (
                <details key={c.key} className="rounded-card border border-line p-3.5 dark:border-white/[0.06]" open={c.severity === "bad" && c.count > 0}>
                  <summary className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">
                      {c.count === 0
                        ? <CheckCircle2 size={15} className="text-success" />
                        : <AlertTriangle size={15} className={c.severity === "bad" ? "text-danger" : "text-amber-600"} />}
                      {c.title}
                    </span>
                    <span className="shrink-0 text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">
                      {c.count}{c.money ? ` · ${money(c.money)}` : ""}
                    </span>
                  </summary>
                  <p className="mt-2 text-[12px] leading-snug text-muted dark:text-[#a89f93]">{c.detail}</p>
                  {!!c.rows?.length && (
                    <div className="mt-2 max-h-[220px] space-y-1 overflow-y-auto">
                      {c.rows.map((r, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 rounded-xl2 bg-panel px-3 py-1.5 text-[12px] dark:bg-white/[0.05]">
                          <span className="font-semibold text-ink dark:text-[#f4f1ea]">{r.label}</span>
                          <span className="flex items-center gap-2 text-muted dark:text-[#a89f93]">
                            {r.sub}
                            {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="text-ink underline dark:text-white"><ExternalLink size={12} /></a>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              ))}
            </div>
          </>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={run} disabled={busy} className={btnGhost}>{busy && <Loader2 size={14} className="animate-spin" />} Re-check</button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}
