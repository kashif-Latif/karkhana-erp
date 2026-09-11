"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneCall, RefreshCw, Clock3, Wallet, PackageX, CheckCircle2, MessageSquarePlus } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { rs } from "@/lib/dateRange";

/* THE CHASE LIST.
 *
 * Rs 121,624 sits on 44 parcels — 19 delivered over 90 days ago that no
 * settlement has ever covered, and 25 that left the warehouse and were never
 * seen again, the oldest 651 days ago. Every one of those figures could be
 * counted before this page existed. None of them could be WORKED, because
 * nobody had the parcels in front of them with a phone number and somewhere to
 * write down what the courier said.
 *
 * THE LIST IS NOT STORED. hub_chase_list() computes it from the same facts
 * Finance and Logistics already use, so a parcel disappears the moment it is
 * settled or delivered. Nobody has to remember to take it off.
 *
 * THE NOTES ARE STORED, because they are the one thing the database cannot
 * work out for itself: what a human was told on the telephone. They are
 * append-only. A courier that says "lost, claim filed" in July and "never
 * received it" in September has told you something, and that is only visible
 * if both answers are kept.
 */

type Row = {
  tracking_id: string; courier: string; store_code: string; order_number: string;
  customer_name: string | null; phone: string | null; city: string | null;
  cod_amount: number; age_days: number; reason: string;
  last_note: string | null; last_note_at: string | null;
  note_count: number; closed: boolean;
};

const COURIERS = ["All couriers", "PostEx", "OwnEx"];

/* Old enough to mean something different. A parcel three months late is a
   chase; two years late is a write-off waiting to be admitted. */
function ageTone(days: number) {
  if (days > 365) return "bg-danger-soft text-danger";
  if (days > 120) return "bg-salmon-soft text-red-800";
  return "bg-amber-soft text-amber-strong dark:text-amber";
}

export default function ChasePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [courier, setCourier] = useState("All couriers");
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);   // expanded tracking_id
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("hub_chase_list", {
      p_days_unsettled: 90, p_days_transit: 30, p_include_closed: showClosed,
    });
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [showClosed]);

  useEffect(() => { load(); }, [load]);

  async function save(tracking: string, kind: "note" | "closed" | "reopened") {
    if (!supabase) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("hub_chase_note", {
      p_tracking_id: tracking, p_note: draft, p_kind: kind,
    });
    setBusy(false);
    /* The function answers with a reason rather than throwing, so a refusal —
       no permission, closing with no reason — has to be read out of the reply
       and shown. Swallowing it would look like the button did nothing. */
    const res = data as { ok?: boolean; error?: string } | null;
    if (error) { setErr(error.message); return; }
    if (res && res.ok === false) { setErr(res.error ?? "Refused."); return; }
    setDraft(""); setOpen(null);
    load();
  }

  const shown = useMemo(
    () => rows.filter((r) => courier === "All couriers" || r.courier === courier),
    [rows, courier],
  );

  const totals = useMemo(() => {
    const money = shown.reduce((a, r) => a + Number(r.cod_amount || 0), 0);
    const oldest = shown.reduce((a, r) => Math.max(a, r.age_days || 0), 0);
    const untouched = shown.filter((r) => r.note_count === 0).length;
    return { money, oldest, untouched, count: shown.length };
  }, [shown]);

  /* By courier, because the call is made to a courier, not to a parcel. */
  const byCourier = useMemo(() => {
    const m: Record<string, { n: number; money: number }> = {};
    shown.forEach((r) => {
      (m[r.courier] ||= { n: 0, money: 0 });
      m[r.courier].n += 1;
      m[r.courier].money += Number(r.cod_amount || 0);
    });
    return Object.entries(m).sort((a, b) => b[1].money - a[1].money);
  }, [shown]);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">
            Chase list
          </h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">
            Parcels the courier still owes you money on, or never delivered. Oldest first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={courier} onChange={(e) => setCourier(e.target.value)}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
            {COURIERS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button onClick={() => setShowClosed((v) => !v)}
            className={`rounded-full border px-3.5 py-2 text-[13px] font-semibold transition ${showClosed ? "border-ink bg-ink text-white dark:border-white dark:bg-white dark:text-[#141414]" : "border-line bg-surface text-ink dark:border-white/10 dark:bg-white/[0.06] dark:text-white"}`}>
            {showClosed ? "Showing closed" : "Show closed"}
          </button>
          <button onClick={load}
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {/* totals */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-salmon-soft p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Wallet size={16} /></span>
          <div className="mt-3 text-[18px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : rs(totals.money)}</div>
          <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">still owed</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><PackageX size={16} /></span>
          <div className="mt-3 text-[18px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : totals.count}</div>
          <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">parcels</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Clock3 size={16} /></span>
          <div className="mt-3 text-[18px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : totals.oldest}</div>
          <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">days, the oldest</div>
        </div>
        {/* The number that says whether this page is being used at all. */}
        <div className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><PhoneCall size={16} /></span>
          <div className="mt-3 text-[18px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : totals.untouched}</div>
          <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">never chased once</div>
        </div>
      </div>

      {byCourier.length > 0 && !loading && (
        <div className="mt-3 flex flex-wrap gap-2">
          {byCourier.map(([c, v]: [string, { n: number; money: number }]) => (
            <span key={c} className="rounded-full bg-panel px-3 py-1 text-[12px] font-semibold text-ink dark:bg-white/[0.06] dark:text-[#e7e2d8]">
              {c} · {v.n} parcels · {rs(v.money)}
            </span>
          ))}
        </div>
      )}

      {err && <p className="mt-4 rounded-card border border-line bg-danger-soft px-4 py-3 text-[12.5px] font-medium text-danger">{err}</p>}

      {/* the list */}
      <div className="mt-5 space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-card bg-panel/70 dark:bg-white/[0.05]" />
          ))
        ) : shown.length === 0 ? (
          <div className="rounded-card border border-line bg-success-soft px-4 py-14 text-center dark:border-white/[0.06] dark:bg-[#201c17]">
            <CheckCircle2 size={22} className="mx-auto mb-2 text-success" />
            <p className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Nothing to chase.</p>
            <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">
              Every parcel over 90 days has been settled, and nothing has been in transit more than 30 days.
            </p>
          </div>
        ) : (
          shown.map((r) => {
            const isOpen = open === r.tracking_id;
            return (
              <div key={r.tracking_id}
                className={`rounded-card border bg-surface transition dark:bg-[#201c17] ${isOpen ? "border-ink dark:border-white/25" : "border-line dark:border-white/[0.06]"} ${r.closed ? "opacity-60" : ""}`}>
                <button
                  onClick={() => { setOpen(isOpen ? null : r.tracking_id); setDraft(""); setErr(""); }}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left">
                  <div className="min-w-[140px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">{r.order_number || "—"}</span>
                      <span className="text-[11.5px] text-muted dark:text-[#a89f93]">{r.store_code}</span>
                      {r.closed && <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-bold uppercase text-hint dark:bg-white/[0.06]">closed</span>}
                    </div>
                    <div className="mt-0.5 select-all font-mono text-[11.5px] text-muted dark:text-[#a89f93]">{r.tracking_id}</div>
                  </div>

                  <div className="min-w-[130px] flex-1">
                    <div className="text-[13px] text-ink dark:text-[#e7e2d8]">{r.customer_name || "—"}</div>
                    <div className="text-[11.5px] text-muted dark:text-[#a89f93]">{r.city || "—"}</div>
                  </div>

                  <div className="min-w-[110px] text-[12.5px] text-muted dark:text-[#a89f93]">{r.courier}</div>

                  <div className="text-right">
                    <div className="text-[15px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{rs(Number(r.cod_amount || 0))}</div>
                    <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${ageTone(r.age_days)}`}>
                      {r.age_days} days
                    </span>
                  </div>
                </button>

                <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 text-[12px] dark:border-white/[0.06]">
                  <span className="text-muted dark:text-[#a89f93]">{r.reason}</span>
                  {r.last_note ? (
                    <span className="text-ink dark:text-[#e7e2d8]">
                      · <b>last:</b> “{r.last_note}”
                      {r.last_note_at && <span className="text-hint dark:text-[#8a8175]"> ({new Date(r.last_note_at).toLocaleDateString("en-PK")})</span>}
                      {r.note_count > 1 && <span className="text-hint dark:text-[#8a8175]"> · {r.note_count} notes</span>}
                    </span>
                  ) : (
                    <span className="font-semibold text-amber-strong dark:text-amber">· never chased</span>
                  )}
                  {r.phone && r.phone.replace(/\D/g, "").length >= 10 && (
                    <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()}
                      className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:text-white dark:hover:bg-white/[0.08]">
                      <PhoneCall size={12} /> {r.phone}
                    </a>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-line px-4 py-3 dark:border-white/[0.06]">
                    <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-muted dark:text-[#a89f93]">
                      <MessageSquarePlus size={13} /> What did the courier say?
                    </label>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={2}
                      placeholder="PostEx says parcel lost, claim filed 12 Sep — ref 44821"
                      className="w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-hint dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button disabled={busy || !draft.trim()} onClick={() => save(r.tracking_id, "note")}
                        className="rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">
                        {busy ? "Saving…" : "Save note"}
                      </button>
                      {!r.closed ? (
                        /* Closing needs a reason — the database refuses without
                           one, so the button is disabled rather than letting
                           someone press it and be told off. */
                        <button disabled={busy || !draft.trim()} onClick={() => save(r.tracking_id, "closed")}
                          className="rounded-full border border-line px-4 py-2 text-[12.5px] font-semibold text-ink disabled:opacity-40 dark:border-white/10 dark:text-white">
                          Give up on this one
                        </button>
                      ) : (
                        <button disabled={busy} onClick={() => save(r.tracking_id, "reopened")}
                          className="rounded-full border border-line px-4 py-2 text-[12.5px] font-semibold text-ink disabled:opacity-40 dark:border-white/10 dark:text-white">
                          Chase it again
                        </button>
                      )}
                      <span className="self-center text-[11.5px] text-hint dark:text-[#8a8175]">
                        Notes are kept forever and never overwritten.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load the list.</p>
      )}
    </div>
  );
}
