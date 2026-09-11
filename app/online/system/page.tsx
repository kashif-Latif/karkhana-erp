"use client";
import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2,
  CircleAlert, User, Cpu,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/* THE SYSTEM TAB.
 *
 * Every row on this page is counted by hub_system_checks() when the page is
 * opened. Nothing here is stored, and nothing here is written by hand — which
 * is the same rule the rest of the Hub follows, for the same reason: a stored
 * total can disagree with the facts underneath it and nobody can say which is
 * wrong.
 *
 * A NEW CHECK DOES NOT NEED THIS FILE.
 * Add a branch to hub_system_checks() and it appears here. That matters
 * because the checks worth adding are usually thought of at the moment
 * something breaks, and waiting for a deploy is how they get forgotten.
 *
 * THE ONE THING THIS FILE DECIDES is what a person should DO about a row that
 * only Kashif can clear — HOW_TO below. That is instruction, not fact, so it
 * lives with the screen rather than in the database.
 */

type Check = {
  sort_order: number;
  area: string;
  label: string;
  value_text: string;
  status: "ok" | "warn" | "fail";
  owner: "system" | "you";
  detail: string;
};

type Health = {
  fn: string;
  last_called: string | null;
  last_status: number | null;
  last_verdict: string | null;
  ok_24h: number;
  failed_24h: number;
  pruned_24h: number;
};

/* What to actually do, for the rows nobody but Kashif can clear. Keyed by the
   label the function returns. A row with no entry here simply shows its
   detail line. */
const HOW_TO: Record<string, string> = {
  "Write-backs the shop refused (7 days)":
    "TopShop is the one to look at. Its app signs in by client credentials, so it only holds the scopes ticked on it. " +
    "Shopify admin → Settings → Apps and sales channels → the custom app → Configuration → Admin API scopes → tick " +
    "write_fulfillments and read_fulfillments → Save → reinstall. Nothing to redeploy afterwards. " +
    "The “temporarily unavailable” refusals are Shopify’s own lock and clear on a retry.",
  "Settlement disputes open":
    "Open Finance → Disputes. Each row is a return a courier has billed for that nobody has closed. " +
    "Closing or cancelling it from either that page or the CPR panel removes it from here.",
};

const STATUS = {
  ok:   { chip: "bg-success-soft text-success dark:bg-white/[0.08]", Icon: CheckCircle2,   word: "fine" },
  warn: { chip: "bg-amber-soft text-amber-strong dark:bg-white/[0.08] dark:text-amber", Icon: CircleAlert, word: "watch" },
  fail: { chip: "bg-danger-soft text-danger dark:bg-white/[0.08]", Icon: AlertTriangle, word: "needs fixing" },
} as const;

export default function SystemPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [c, h] = await Promise.all([
      supabase.rpc("hub_system_checks"),
      supabase.from("v_sync_health_summary").select("*"),
    ]);
    if (c.error) setErr(c.error.message);
    setChecks(((c.data as Check[]) ?? []).sort((a, b) => a.sort_order - b.sort_order));
    setHealth((h.data as Health[]) ?? []);
    setRanAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Checked again every two minutes while the tab is in front of someone.
     Hidden tabs are left alone — a background tab repainting itself all day is
     how the Logistics page spent hundreds of megabytes on nobody. */
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 120000);
    return () => clearInterval(t);
  }, [load]);

  const yours = checks.filter((c) => c.owner === "you" && c.status !== "ok");
  const broken = checks.filter((c) => c.owner === "system" && c.status === "fail");
  const rest = checks.filter((c) => !yours.includes(c) && !broken.includes(c));
  const worst: Check["status"] =
    checks.some((c: Check) => c.status === "fail") ? "fail"
    : checks.some((c: Check) => c.status === "warn") ? "warn" : "ok";

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">
            System
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted dark:text-[#a89f93]">
            What is running, what is stuck, and whose job it is.
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[worst].chip}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {loading ? "checking…" : `Everything ${STATUS[worst].word}`}
            </span>
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Check again
        </button>
      </div>

      {/* ── YOURS ──────────────────────────────────────────────────────────── */}
      {yours.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">
            <User size={16} /> Waiting on you
            <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger">{yours.length}</span>
          </h2>
          <div className="space-y-3">
            {yours.map((c) => (
              <div key={c.label} className="rounded-card border border-line bg-salmon-soft p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">{c.label}</span>
                  <span className="text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{c.value_text}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">{c.detail}</p>
                {HOW_TO[c.label] && (
                  <p className="mt-2.5 border-t border-black/[0.06] pt-2.5 text-[12.5px] leading-relaxed text-ink dark:border-white/[0.08] dark:text-[#e7e2d8]">
                    {HOW_TO[c.label]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── BROKEN, BUT NOT YOURS ──────────────────────────────────────────── */}
      {broken.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">
            <AlertTriangle size={16} /> Not running
          </h2>
          <div className="space-y-3">
            {broken.map((c) => (
              <div key={c.label} className="rounded-card border border-line bg-danger-soft p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">{c.label}</span>
                  <span className="text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{c.value_text}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">{c.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── THE SYNCS ──────────────────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">
          <Cpu size={16} /> The syncs, last 24 hours
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {health.map((h) => (
            <div key={h.fn} className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-bold text-ink dark:text-[#f4f1ea]">{h.fn}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${h.failed_24h > 0 ? STATUS.fail.chip : STATUS.ok.chip}`}>
                  {h.last_status ?? "—"}
                </span>
              </div>
              <div className="mt-2 text-[12.5px] text-muted dark:text-[#a89f93]">
                <b className="text-ink dark:text-[#f4f1ea]">{h.ok_24h}</b> answered ·{" "}
                <b className={h.failed_24h > 0 ? "text-danger" : "text-ink dark:text-[#f4f1ea]"}>{h.failed_24h}</b> refused
              </div>
              {/* A reply pg_net has since thrown away is not a failure. This
                  screen used to count those as failures — 472 a day of them —
                  and a page that cries wolf daily is not read on the day it is
                  right. */}
              <div className="mt-0.5 text-[11.5px] text-hint dark:text-[#8a8175]">
                {h.pruned_24h} replies no longer kept · last {h.last_called ? new Date(h.last_called).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }) : "—"}
              </div>
            </div>
          ))}
          {!loading && health.length === 0 && (
            <p className="text-[13px] text-muted dark:text-[#a89f93]">No sync has been called yet.</p>
          )}
        </div>
      </section>

      {/* ── EVERYTHING ELSE ────────────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">
          <ShieldCheck size={16} /> Everything checked
        </h2>
        <div className="overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                  <th className="px-4 py-3 font-semibold">Area</th>
                  <th className="px-4 py-3 font-semibold">Check</th>
                  <th className="px-4 py-3 text-right font-semibold">Now</th>
                  <th className="px-4 py-3 font-semibold">State</th>
                  <th className="hidden px-4 py-3 font-semibold md:table-cell">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>
                  ))
                ) : rest.length === 0 && checks.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-14 text-center text-[13px] text-muted dark:text-[#a89f93]">
                    No checks came back. Your role may not include the Hub.
                  </td></tr>
                ) : (
                  rest.map((c) => {
                    /* A status the function invents tomorrow must not blank
                       the row out. Anything unrecognised reads as "watch",
                       which is the safe direction to be wrong in. */
                    const S = STATUS[c.status] ?? STATUS.warn;
                    return (
                      <tr key={c.label} className="text-ink dark:text-[#e7e2d8]">
                        <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{c.area}</td>
                        <td className="px-4 py-3 font-semibold">{c.label}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums">{c.value_text}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${S.chip}`}>
                            <S.Icon size={12} /> {S.word}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 text-[12.5px] text-muted md:table-cell dark:text-[#a89f93]">{c.detail}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-[12px] text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
            <span>Counted from the database each time this page is opened. Nothing here is stored.</span>
            <span>{ranAt ? `checked ${ranAt.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
          </div>
        </div>
      </section>

      {err && <p className="mt-4 text-[12.5px] font-medium text-danger">Couldn&apos;t run the checks: {err}</p>}
      {!isSupabaseConfigured && (
        <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to run the checks.</p>
      )}
    </div>
  );
}
