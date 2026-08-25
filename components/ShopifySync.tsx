"use client";
import { useState } from "react";
import { RefreshCcw, Loader2, CheckCircle2, AlertTriangle, ShoppingBag, Truck, History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { btnPrimary, btnGhost } from "@/components/Modal";

type Line = { store: string; ok: boolean; text: string };
const STORES = ["LM", "TS", "TRZ"];
const LABEL: Record<string, string> = { LM: "Little Minors", TS: "TopShop", TRZ: "Trenzee" };

const JOBS = [
  {
    key: "pull_orders", label: "Fetch orders", Icon: ShoppingBag,
    hint: "Pulls every order from all three Shopify stores — customer, city, amount and status.",
  },
  {
    key: "pull_fulfillments", label: "Fetch tracking numbers", Icon: Truck,
    hint: "Reads the tracking number and courier the agent chose in Shopify, so PostEx and OwnEx parcels both land in Logistics automatically.",
  },
];

export default function ShopifySync({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [days, setDays] = useState(14);

  async function run(action: string) {
    if (!supabase) return;
    setBusy(action);
    setLines([]);

    // one store at a time — each call stays well inside the time limit, and you
    // see progress instead of waiting on a single long request
    for (const store of STORES) {
      try {
        const { data, error } = await supabase.functions.invoke("shopify-sync", {
          body: { action, store, days, pages: 16, dry_run: false },
        });
        if (error) throw error;
        const s = (data as { summary?: Record<string, unknown>[] })?.summary?.[0] ?? {};
        if (s.ok === false) {
          setLines((p) => [...p, { store, ok: false, text: String(s.error ?? "failed") }]);
          continue;
        }
        const text = action === "pull_orders"
          ? `${Number(s.saved ?? 0).toLocaleString()} orders saved of ${Number(s.fetched ?? 0).toLocaleString()} fetched`
          : `${Number(s.new_parcels ?? 0).toLocaleString()} new parcels of ${Number(s.parcels ?? 0).toLocaleString()} checked`;
        setLines((p) => [...p, { store, ok: true, text }]);
      } catch (e) {
        const m = String((e as Error)?.message ?? e);
        setLines((p) => [...p, { store, ok: false, text: /401|unauthor/i.test(m) ? "Not permitted." : m }]);
      }
    }

    setBusy("");
    onDone();
  }

  /** Full history cannot be pulled in one request — Shopify paginates and the
   *  function has a time budget — so we walk backwards a month at a time.
   *
   *  WHAT WAS WRONG BEFORE
   *    60 months x 3 stores x 2 actions, all sequential at up to 90s each, is
   *    360 calls and potentially hours. It looked frozen because it effectively
   *    was. And the per-store lines all printed the SAME number: `found` summed
   *    every store and both actions, so "3,300 orders" was the combined total
   *    repeated three times, not Little Minors' count.
   *
   *  NOW
   *    Stores run in parallel within a window (three calls at once, not nine in
   *    a row), each store keeps its own count, the walk is capped at 24 months,
   *    and it stops once two consecutive windows are empty for every store.
   *
   *  Safe to re-run: orders match on store + order number, parcels on tracking
   *  number, so nothing is duplicated. */
  async function backfill() {
    if (!supabase) return;
    setBusy("backfill"); setLines([]);
    const start = new Date();
    const MAX_MONTHS = 24;
    let empties = 0, windows = 0;
    const totals: Record<string, number> = { LM: 0, TS: 0, TRZ: 0 };

    for (let i = 0; i < MAX_MONTHS && empties < 2; i++) {
      const end = new Date(start); end.setMonth(end.getMonth() - i);
      const from = new Date(start); from.setMonth(from.getMonth() - (i + 1));
      const s1 = from.toISOString().slice(0, 10), s2 = end.toISOString().slice(0, 10);

      // three stores at once — the slow part is Shopify, not us
      const perStore = await Promise.all(STORES.map(async (store) => {
        let n = 0;
        for (const action of ["pull_orders", "pull_fulfillments"]) {
          try {
            const { data, error } = await supabase!.functions.invoke("shopify-sync", {
              body: { action, store, start_date: s1, end_date: s2, pages: 20, max_seconds: 60, dry_run: false },
            });
            if (error) throw error;
            const r = (data as { summary?: Record<string, unknown>[] })?.summary?.[0] ?? {};
            // only pull_orders reports orders; pull_fulfillments reports parcels
            if (action === "pull_orders") n += Number(r.fetched ?? 0);
          } catch { /* one store failing must not stop the walk */ }
        }
        return { store, n };
      }));

      windows++;
      const windowTotal = perStore.reduce((a, x) => a + x.n, 0);
      empties = windowTotal === 0 ? empties + 1 : 0;
      for (const x of perStore) totals[x.store] += x.n;

      setLines(perStore.map((x) => ({
        store: x.store, ok: true,
        text: `${s1} → ${s2} · ${x.n.toLocaleString()} orders  (running total ${totals[x.store].toLocaleString()})`,
      })));
    }

    setBusy("");
    setLines(STORES.map((st) => ({
      store: st, ok: true,
      text: `Finished — ${totals[st].toLocaleString()} orders across ${windows} month(s).`,
    })));
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setLines([]); }} className={btnPrimary}>
        <RefreshCcw size={15} /> Sync Shopify
      </button>

      <Modal open={open} onClose={() => setOpen(false)} wide title="Shopify sync"
        subtitle="Pulls straight from Little Minors, TopShop and Trenzee — no file downloads.">
        <label className="mb-3 flex items-center gap-2 text-[12.5px] text-muted dark:text-[#a89f93]">
          Look back
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-full border border-line bg-canvas px-2.5 py-1 text-[12px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
            {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>

        <div className="space-y-2.5">
          {JOBS.map(({ key, label, Icon, hint }) => (
            <div key={key} className="flex flex-wrap items-start gap-3 rounded-card border border-line p-3.5 dark:border-white/[0.06]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
              <div className="min-w-[180px] flex-1">
                <div className="text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">{label}</div>
                <p className="mt-0.5 text-[12px] leading-snug text-muted dark:text-[#a89f93]">{hint}</p>
              </div>
              <button onClick={() => run(key)} disabled={!!busy} className={`${btnGhost} shrink-0`}>
                {busy === key ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Run
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap items-start gap-3 rounded-card border border-line p-3.5 dark:border-white/[0.06]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><History size={16} /></span>
          <div className="min-w-[180px] flex-1">
            <div className="text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">Fetch all history</div>
            <p className="mt-0.5 text-[12px] leading-snug text-muted dark:text-[#a89f93]">
              Walks back month by month to the very first order in every store. Takes several minutes — leave this window open.
            </p>
          </div>
          <button onClick={backfill} disabled={!!busy} className={`${btnGhost} shrink-0`}>
            {busy === "backfill" ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />} Run
          </button>
        </div>

        {(busy || lines.length > 0) && (
          <div className="mt-4 space-y-1.5">
            {STORES.map((s) => {
              const line = lines.find((l) => l.store === s);
              const running = !!busy && !line;
              return (
                <div key={s} className="flex items-center gap-2 rounded-xl2 bg-panel px-3 py-2 text-[12.5px] dark:bg-white/[0.05]">
                  {line ? (line.ok ? <CheckCircle2 size={14} className="text-success" /> : <AlertTriangle size={14} className="text-danger" />)
                        : running ? <Loader2 size={14} className="animate-spin text-muted" />
                        : <span className="h-3.5 w-3.5" />}
                  <span className="font-semibold text-ink dark:text-[#f4f1ea]">{LABEL[s]}</span>
                  <span className="text-muted dark:text-[#a89f93]">{line ? line.text : running ? "working…" : "waiting"}</span>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-4 text-[11.5px] leading-snug text-hint dark:text-[#8a8175]">
          Safe to run as often as you like — orders match on store + order number and parcels on tracking number,
          so nothing is ever duplicated or overwritten.
        </p>
        <div className="mt-4"><button onClick={() => setOpen(false)} className={btnGhost}>Close</button></div>
      </Modal>
    </>
  );
}
