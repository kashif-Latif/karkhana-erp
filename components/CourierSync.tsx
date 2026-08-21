"use client";
import { useState } from "react";
import { RefreshCcw, Loader2, CheckCircle2, AlertTriangle, Wallet, Truck, Download } from "lucide-react";
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

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnPrimary}>
        <RefreshCcw size={15} /> Sync courier
      </button>
      <Modal open={open} onClose={() => setOpen(false)} wide title="Courier sync"
        subtitle="Pull live data straight from PostEx — no files, no uploads.">
        <div className="space-y-2.5">
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
