"use client";
import { useState } from "react";
import { RefreshCcw, Loader2, CheckCircle2, AlertTriangle, Wallet, Truck, Download, Zap, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { btnPrimary, btnGhost } from "@/components/Modal";

type Res = { ok: boolean; msg: string; detail?: string } | null;

const JOBS = [
  { key: "postex_pull",     label: "Fetch orders",   Icon: Download, hint: "Pulls every PostEx order from the last 7 days — replaces the load-sheet and status-file uploads. Stores are detected from the order number." },
  { key: "postex_track",    label: "Refresh status", Icon: Truck,    hint: "Re-checks delivery status for every parcel still in transit." },
  { key: "postex_payments", label: "Reconcile COD",  Icon: Wallet,   hint: "Reads PostEx payment records and marks delivered orders paid, with their CPR number." },
];

export default function CourierSync({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [res, setRes] = useState<Res>(null);
  const [days, setDays] = useState(7);
  const [steps, setSteps] = useState<{ label: string; ok: boolean; text: string }[]>([]);

  async function run(action: string) {
    if (!supabase) return;
    setBusy(action); setRes(null);
    try {
      // the user's session token is sent automatically; no secret in the browser
      const { data, error } = await supabase.functions.invoke("postex-sync", {
        body: action === "postex_pull" ? { action, days } : { action },
      });
      if (error) throw error;
      const d = data as Record<string, unknown>;
      if (d?.error) { setRes({ ok: false, msg: String(d.error) }); return; }

      if (action === "postex_pull")
        setRes({ ok: true, msg: `Fetched ${Number(d.fetched ?? 0).toLocaleString()} orders · ${Number(d.merged ?? 0).toLocaleString()} saved`, detail: `${d.from} → ${d.to}` });
      else if (action === "postex_track")
        setRes({ ok: true, msg: `Checked ${Number(d.checked ?? 0).toLocaleString()} parcels · ${Number(d.updated ?? 0).toLocaleString()} updated` });
      else
        setRes({ ok: true, msg: `Checked ${Number(d.checked ?? 0).toLocaleString()} · ${Number(d.settled ?? 0).toLocaleString()} newly paid`, detail: Number(d.not_settled_yet ?? 0) ? `${Number(d.not_settled_yet).toLocaleString()} still awaiting PostEx settlement` : undefined });
      onDone();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      setRes({ ok: false, msg: /401|unauthor/i.test(m) ? "You don't have permission to run the courier sync." : m });
    } finally { setBusy(""); }
  }

  /** One button for the whole job. Order matters: orders first so new parcels
   *  exist, then status, then settlement — a payment record is meaningless for
   *  a parcel we have not seen yet. OwnEx status comes from its public tracker. */
  async function runAll() {
    if (!supabase) return;
    setBusy("all"); setRes(null); setSteps([]);
    const push = (label: string, ok: boolean, text: string) =>
      setSteps((p) => [...p, { label, ok, text }]);

    const call = async (fn: string, body: Record<string, unknown>) => {
      const { data, error } = await supabase!.functions.invoke(fn, { body });
      if (error) throw error;
      const d = data as Record<string, unknown>;
      if (d?.error) throw new Error(String(d.error));
      return d;
    };

    const plan: { label: string; fn: string; body: Record<string, unknown>; read: (d: Record<string, unknown>) => string }[] = [
      { label: "PostEx orders", fn: "postex-sync", body: { action: "postex_pull", days },
        read: (d) => `${Number(d.fetched ?? 0).toLocaleString()} fetched · ${Number(d.merged ?? 0).toLocaleString()} saved` },
      { label: "PostEx status", fn: "postex-sync", body: { action: "postex_track" },
        read: (d) => `${Number(d.updated ?? 0).toLocaleString()} updated of ${Number(d.checked ?? 0).toLocaleString()}` },
      { label: "PostEx COD", fn: "postex-sync", body: { action: "postex_payments" },
        read: (d) => `${Number(d.settled ?? 0).toLocaleString()} newly paid` },
      { label: "OwnEx status", fn: "ownex-sync", body: { action: "track", limit: 250, max_seconds: 50 },
        read: (d) => `${Number(d.updated ?? 0).toLocaleString()} updated of ${Number(d.checked ?? 0).toLocaleString()}` },
    ];

    for (const step of plan) {
      try { push(step.label, true, step.read(await call(step.fn, step.body))); }
      catch (e) { push(step.label, false, String((e as Error)?.message ?? e).slice(0, 90)); }
    }
    setBusy("");
    onDone();
  }

  /** Repair parcels filed on the wrong leg.
   *
   *  OwnEx reuses `transit-received` and `in-transit` on BOTH the outbound and
   *  the return journey, and the codes that DO say "returning" are transient —
   *  on one verified parcel the return signal was the current status for only
   *  16 minutes against a 45-minute polling window. Reading the current status
   *  alone therefore misses returns entirely, which is how 34 parcels sat in
   *  the forward bucket while the OwnEx portal counted them as coming back.
   *
   *  The sync now reads the full movement history instead, so direction is a
   *  recorded fact. This pass applies that to parcels imported or tracked
   *  before the fix existed.
   *
   *  The edge function stops on a row limit and a time budget, so one call
   *  rarely clears the whole backlog. Loop until a pass finds nothing left
   *  rather than making anyone press the button over and over. */
  async function runReturnFix() {
    if (!supabase) return;
    setBusy("return_fix"); setRes(null); setSteps([]);
    let pass = 0, corrected = 0, checked = 0;
    try {
      while (pass < 8) {
        pass++;
        const { data, error } = await supabase.functions.invoke("ownex-sync", {
          body: { action: "backfill_return_leg", dry_run: false, limit: 250, concurrency: 8, max_seconds: 100 },
        });
        if (error) throw error;
        const d = data as Record<string, unknown>;
        if (d?.error) throw new Error(String(d.error));

        const fixed = Number(d.direction_corrected ?? 0);
        const seen = Number(d.checked ?? 0);
        corrected += fixed; checked += seen;
        setSteps((p) => [...p, {
          label: `Pass ${pass}`, ok: true,
          text: `${seen.toLocaleString()} checked · ${fixed.toLocaleString()} corrected`,
        }]);
        // nothing corrected, or nothing left to look at — the backlog is clear
        if (fixed === 0 || seen === 0) break;
      }
      setRes({
        ok: true,
        msg: corrected
          ? `${corrected.toLocaleString()} parcel${corrected === 1 ? "" : "s"} moved to the return leg`
          : "Every parcel is already on the correct leg",
        detail: `${checked.toLocaleString()} checked across ${pass} pass${pass === 1 ? "" : "es"}`,
      });
      onDone();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      setRes({ ok: false, msg: /401|unauthor/i.test(m) ? "You don't have permission to run the courier sync." : m });
    } finally { setBusy(""); }
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnPrimary}>
        <RefreshCcw size={15} /> Sync courier
      </button>
      <Modal open={open} onClose={() => setOpen(false)} wide title="Courier sync"
        subtitle="Pull live data straight from PostEx and OwnEx — no files, no uploads.">
        <div className="space-y-2.5">
          {/* the one-click option, first because it is what you want most days */}
          <div className="flex flex-wrap items-start gap-3 rounded-card border-2 border-ink p-3.5 dark:border-white/20">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Zap size={16} /></span>
            <div className="min-w-[180px] flex-1">
              <div className="text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">Fetch everything</div>
              <p className="mt-0.5 text-[12px] leading-snug text-muted dark:text-[#a89f93]">
                Orders, delivery status and COD settlement — PostEx and OwnEx, in one go.
              </p>
            </div>
            <button onClick={runAll} disabled={!!busy} className={`${btnPrimary} shrink-0`}>
              {busy === "all" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Run all
            </button>
          </div>

          {!!steps.length && (
            <div className="space-y-1.5">
              {steps.map((st, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl2 bg-panel px-3 py-2 text-[12.5px] dark:bg-white/[0.05]">
                  {st.ok ? <CheckCircle2 size={14} className="text-success" /> : <AlertTriangle size={14} className="text-danger" />}
                  <span className="font-semibold text-ink dark:text-[#f4f1ea]">{st.label}</span>
                  <span className="text-muted dark:text-[#a89f93]">{st.text}</span>
                </div>
              ))}
              {busy === "all" && <div className="flex items-center gap-2 px-3 text-[12px] text-muted dark:text-[#a89f93]"><Loader2 size={13} className="animate-spin" /> working…</div>}
            </div>
          )}

          {JOBS.map(({ key, label, Icon, hint }) => (
            <div key={key} className="flex flex-wrap items-start gap-3 rounded-card border border-line p-3.5 dark:border-white/[0.06]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
              <div className="min-w-[180px] flex-1">
                <div className="text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">{label}</div>
                <p className="mt-0.5 text-[12px] leading-snug text-muted dark:text-[#a89f93]">{hint}</p>
                {key === "postex_pull" && (
                  <label className="mt-2 flex items-center gap-2 text-[12px] text-muted dark:text-[#a89f93]">
                    Last
                    <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                      className="rounded-full border border-line bg-canvas px-2.5 py-1 text-[12px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
                      {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
                    </select>
                  </label>
                )}
              </div>
              <button onClick={() => run(key)} disabled={!!busy}
                className={`${btnGhost} shrink-0`}>
                {busy === key ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Run
              </button>
            </div>
          ))}

          {/* Occasional repair, not part of the daily run — the nightly sync
              now records direction on its own, so this is only for the backlog
              and for anything Smart import brought in under portal labels. */}
          <div className="flex flex-wrap items-start gap-3 rounded-card border border-dashed border-line p-3.5 dark:border-white/[0.12]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Undo2 size={16} /></span>
            <div className="min-w-[180px] flex-1">
              <div className="text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">Fix return directions</div>
              <p className="mt-0.5 text-[12px] leading-snug text-muted dark:text-[#a89f93]">
                OwnEx uses the same status codes going out and coming back. This reads each
                parcel&apos;s full movement history and moves anything already on its way back
                out of the in-transit count. Repeats by itself until nothing is left to fix.
              </p>
            </div>
            <button onClick={runReturnFix} disabled={!!busy} className={`${btnGhost} shrink-0`}>
              {busy === "return_fix" ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Run
            </button>
          </div>
        </div>

        {res && (
          <div className={`mt-4 flex items-start gap-2 rounded-card border px-4 py-3 text-[13px] ${res.ok ? "border-success/30 bg-success-soft text-ink dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-[#f4f1ea]" : "border-danger/30 bg-danger-soft text-ink dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-[#f4f1ea]"}`}>
            {res.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />}
            <div>
              <div className="font-semibold">{res.msg}</div>
              {res.detail && <div className="mt-0.5 text-[12px] text-muted dark:text-[#a89f93]">{res.detail}</div>}
            </div>
          </div>
        )}

        <p className="mt-4 text-[11.5px] text-hint dark:text-[#8a8175]">
          File upload is still available as a fallback if PostEx is ever unreachable.
        </p>
        <div className="mt-4"><button onClick={() => setOpen(false)} className={btnGhost}>Close</button></div>
      </Modal>
    </>
  );
}
