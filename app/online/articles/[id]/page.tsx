"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Pencil, Trash2, Clock3, CornerUpLeft, Loader2, Plus, Wallet, CheckCircle2, Undo2,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { rs } from "@/lib/dateRange";

/* ONE ARTICLE, END TO END.
 *
 * THE TIMELINE IS THE POINT. Five rows, one per man, each saying what he was
 * given, how long he held it and what he wrote when he submitted. That answers
 * "where is my article" and "who is slow" from the same block of screen, which
 * is the pair of questions the whole workflow exists to answer.
 *
 * TIME IS SHOWN, NEVER JUDGED. No target, no red. The figure is a fact; what
 * it means is the administration's call, not the software's.
 *
 * THE MONEY IS COMPUTED, NEVER STORED. Ads spent is the sum of what the boss
 * approved. Reject an entry and the remaining budget corrects itself, because
 * there is no total sitting anywhere to go stale.
 */

type Stage = {
  stage: string; label: string; person: string | null; task_id: string | null;
  status: string | null; attempt: number | null; opened_at: string | null;
  submitted_at: string | null; submit_note: string | null; returned_note: string | null;
  held: string | null;
  /* Set when the administration recorded the work rather than the man doing
     it himself. The difference matters six months later, so it is shown. */
  submitted_by_name: string | null; on_behalf: boolean;
};
type Ads = {
  id: number; spent_on: string; amount: number; platform: string | null;
  campaign_name: string | null; campaign_id: string | null; notes: string | null;
  status: string; decision_note: string | null;
};
type Ev = { kind: string; detail: string | null; at: string; actor: string | null };

/* A PACK IS A PRICE, NOT AN ARTICLE.
   The same shirt sells as a single, a pack of two and a pack of three. Making
   that three articles would mean three codes, three sets of five stages and
   three notifications to Hamza Mukhtar — for one shirt, one photo shoot and one
   quality check. So the workflow stays single and the prices multiply.
   The single has no pack_id: it is the article's own cost and retail price,
   handed back in the same shape so this screen can draw one ladder. */
type Pack = {
  pack_id: string | null; label: string; units: number;
  exact_cost: number | null; retail_price: number | null;
  is_single: boolean; margin: number | null; per_unit: number | null;
};
type Detail = {
  article: Record<string, unknown> & {
    id: string; code: string; rough_name: string; final_name: string | null;
    exact_cost: number | null; retail_price: number | null; ads_budget: number | null;
    ads_basis: string; ads_spent: number; ads_spent_period: number; ads_pending: number;
    period_label: string; status: string; brief: string | null;
    created_by_name: string | null; created_at: string; age: string;
  };
  stages: Stage[]; ads: Ads[]; events: Ev[]; packs: Pack[];
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function ArticleDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [addSpend, setAddSpend] = useState(false);
  const [spend, setSpend] = useState({ spent_on: new Date().toISOString().slice(0, 10), amount: "", campaign_name: "", campaign_id: "", notes: "" });
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [edit, setEdit] = useState({ rough_name: "", final_name: "", exact_cost: "", retail_price: "", ads_budget: "", brief: "", ads_basis: "total" });

  /* RECORDING WORK THAT HAPPENED OFF THE SYSTEM.
     Most of this work is arranged by talking — the boss tells Hamza to make an
     article, Hamza makes it, and neither is at a screen when it happens. So
     any open stage can be closed from here, on that man's behalf, with the
     date it was really done. The database records whose hand was on the
     button, and the article routes on exactly as if he had pressed it. */
  const [marking, setMarking] = useState<string | null>(null);   // task_id being recorded
  const [mark, setMark] = useState({ note: "", done_on: new Date().toISOString().slice(0, 10) });

  /* Which submitted task is being undone, and why. */
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoWhy, setUndoWhy] = useState("");

  /* Which pack row is being edited: a pack_id, or "new" for the add row. */
  const [packRow, setPackRow] = useState<string | null>(null);
  const [pack, setPack] = useState({ label: "", units: "2", exact_cost: "", retail_price: "" });

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !id) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("hub_article_detail", { p_article_id: id });
    if (error) setErr(error.message);
    setD((data as Detail) ?? null);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  /* Returns whether it actually went through, so a caller can keep its form
     open on a refusal instead of throwing away what the person typed. */
  async function call(fn: string, args: Record<string, unknown>): Promise<boolean> {
    if (!supabase) return false;
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error) { setErr(error.message); return false; }
    if (res && res.ok === false) { setErr(res.error ?? "Refused."); return false; }
    load();
    return true;
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={18} className="animate-spin text-muted" /></div>;
  }
  if (!d?.article) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">That article is not available to you.</p>
        <button onClick={() => router.push("/online/articles")} className="mt-3 text-[13px] font-semibold underline">Back to articles</button>
      </div>
    );
  }

  const a = d.article;
  const budget = Number(a.ads_budget || 0);
  const spent = Number(a.ads_spent || 0);                    // everything ever approved
  const spentNow = Number(a.ads_spent_period ?? a.ads_spent); // what counts against the cap
  const pending = Number(a.ads_pending || 0);
  /* The bar measures the period the boss chose, not all time — on a daily cap
     an all-time bar is past 100% by the second day and says nothing. */
  const pct = budget > 0 ? Math.min(100, Math.round((spentNow / budget) * 100)) : 0;
  const basisWord = a.ads_basis === "daily" ? "a day" : a.ads_basis === "monthly" ? "a month" : "in total";
  /* NO COST, NO MARGIN. This used to read coalesce(cost, 0), so an article whose
     cost had not been entered yet reported a 100% margin — a made-up figure that
     happens to look like the answer and happens to be good news. A dash is the
     honest version. */
  const margin = Number(a.retail_price) > 0 && a.exact_cost != null
    ? Math.round(((Number(a.retail_price) - Number(a.exact_cost)) / Number(a.retail_price)) * 1000) / 10 : null;

  /* The single's price lives on the article, so its pencil opens the article
     form — the same one the Edit button opens. One price, one place to change
     it, wherever you press from. */
  function openEdit() {
    setEdit({
      rough_name: String(a.rough_name ?? ""), final_name: String(a.final_name ?? ""),
      exact_cost: a.exact_cost == null ? "" : String(a.exact_cost),
      retail_price: a.retail_price == null ? "" : String(a.retail_price),
      ads_budget: a.ads_budget == null ? "" : String(a.ads_budget),
      brief: String(a.brief ?? ""),
      ads_basis: String(a.ads_basis ?? "total"),
    });
    setEditing(true);
  }

  const packs = d.packs ?? [];
  const priced = packs.filter((p) => p.retail_price != null).map((p) => Number(p.retail_price));
  const lo = priced.length ? Math.min(...priced) : null;
  const hi = priced.length ? Math.max(...priced) : null;
  const hasPacks = packs.length > 1;

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <button onClick={() => router.push("/online/articles")}
        className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted transition hover:text-ink dark:text-[#a89f93] dark:hover:text-white">
        <ArrowLeft size={14} /> All articles
      </button>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[21px] font-extrabold tracking-tight text-ink sm:text-[24px] dark:text-[#f4f1ea]">
            {a.final_name || a.rough_name}
          </h1>
          <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">
            {a.code} · created by {a.created_by_name ?? "—"} on {when(a.created_at)} · running <b className="text-ink dark:text-[#e7e2d8]">{a.age}</b>
          </p>
        </div>
        {/* EDIT AND DELETE, and nothing else. Approving a finished article told
            nobody anything and left a word on the list that disagreed with the
            five stages underneath it. What is actually needed is the ordinary
            pair: fix a number typed wrong, or remove an article that should
            never have been created. Both administrator-only — the employees
            never reach this page at all. */}
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy} onClick={openEdit}
            className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">
            <Pencil size={14} /> Edit
          </button>
          <button disabled={busy} onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] font-semibold text-danger disabled:opacity-40 dark:border-white/15">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {err && <p className="mt-3 rounded-card border border-line bg-danger-soft px-4 py-3 text-[12.5px] font-medium text-danger">{err}</p>}

      {/* ── edit ─────────────────────────────────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={() => !busy && setEditing(false)}>
          <div className="w-full max-w-lg rounded-t-card bg-surface p-5 shadow-card dark:bg-[#201c17] sm:rounded-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-extrabold text-ink dark:text-[#f4f1ea]">Edit {a.code}</h2>
            <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">
              Changing a figure here is written into the history with your name on it. It does not move the work.
            </p>

            <label className="mt-4 block text-[12px] font-semibold text-muted dark:text-[#a89f93]">Name</label>
            <input value={edit.rough_name} onChange={(e) => setEdit({ ...edit, rough_name: e.target.value })}
              className="mt-1 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[14px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />

            <label className="mt-3 block text-[12px] font-semibold text-muted dark:text-[#a89f93]">Final name (once Hamza Mukhtar has set it)</label>
            <input value={edit.final_name} onChange={(e) => setEdit({ ...edit, final_name: e.target.value })}
              className="mt-1 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[14px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />

            <div className="mt-3 grid grid-cols-3 gap-2">
              {([["exact_cost", "Cost"], ["retail_price", "Retail"], ["ads_budget", "Ads budget"]] as const).map(([k, label]) => (
                <div key={k}>
                  <label className="block text-[12px] font-semibold text-muted dark:text-[#a89f93]">{label}</label>
                  <input type="number" inputMode="numeric" value={edit[k]}
                    onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                    className="mt-1 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[14px] tabular-nums text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
                </div>
              ))}
            </div>

            <label className="mt-3 block text-[12px] font-semibold text-muted dark:text-[#a89f93]">That ads budget is…</label>
            <div className="mt-1 flex w-full gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.06]">
              {([["total", "In total"], ["daily", "Per day"], ["monthly", "Per month"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setEdit({ ...edit, ads_basis: k })}
                  className={`flex-1 rounded-full px-3 py-2 text-[12.5px] font-semibold transition ${
                    edit.ads_basis === k ? "bg-ink text-white dark:bg-white dark:text-[#141414]"
                                         : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* Changing this re-reads every spend already entered against the
                new period — no figure is stored, so nothing has to be fixed up. */}
            <p className="mt-1 text-[11.5px] text-hint dark:text-[#8a8175]">
              Changing this changes what the figures mean straight away. Nothing already entered is lost.
            </p>

            <label className="mt-3 block text-[12px] font-semibold text-muted dark:text-[#a89f93]">Brief</label>
            <textarea value={edit.brief} onChange={(e) => setEdit({ ...edit, brief: e.target.value })} rows={3}
              className="mt-1 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
            <p className="mt-1 text-[11.5px] text-hint dark:text-[#8a8175]">
              Changing the brief does not change what is already on somebody&rsquo;s panel — tell him, or send the work back.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(false)} disabled={busy}
                className="rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-ink dark:border-white/15 dark:text-white">Cancel</button>
              <button disabled={busy || !edit.rough_name.trim()}
                onClick={() => call("hub_article_update", {
                  p_article_id: a.id,
                  p_rough_name: edit.rough_name,
                  p_final_name: edit.final_name || null,
                  p_exact_cost: edit.exact_cost === "" ? null : Number(edit.exact_cost),
                  p_retail_price: edit.retail_price === "" ? null : Number(edit.retail_price),
                  p_ads_budget: edit.ads_budget === "" ? null : Number(edit.ads_budget),
                  p_brief: edit.brief || null,
                  p_ads_basis: edit.ads_basis,
                }).then(() => setEditing(false))}
                className="flex items-center gap-2 rounded-full bg-ink px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">
                {busy && <Loader2 size={14} className="animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── delete ───────────────────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => !busy && setConfirmDelete(false)}>
          <div className="w-full max-w-sm rounded-card bg-surface p-5 shadow-card dark:bg-[#201c17]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-extrabold text-ink dark:text-[#f4f1ea]">Delete {a.code}?</h2>
            {/* Said plainly, because the five men have this on their panels and
                it disappears from all of them at once. */}
            <p className="mt-2 text-[13px] leading-relaxed text-muted dark:text-[#a89f93]">
              This removes the article, everything anybody has submitted on it, its history and its ad entries.
              It vanishes from the men&rsquo;s panels too. It cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} disabled={busy}
                className="rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-ink dark:border-white/15 dark:text-white">Keep it</button>
              <button disabled={busy}
                onClick={async () => {
                  if (!supabase) return;
                  setBusy(true);
                  const { data, error } = await supabase.rpc("hub_article_delete", { p_article_id: a.id });
                  setBusy(false);
                  const res = data as { ok?: boolean; error?: string } | null;
                  if (error) { setErr(error.message); setConfirmDelete(false); return; }
                  if (res && res.ok === false) { setErr(res.error ?? "Refused."); setConfirmDelete(false); return; }
                  router.push("/online/articles");
                }}
                className="flex items-center gap-2 rounded-full bg-danger px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                {busy && <Loader2 size={14} className="animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {a.brief && (
        <p className="mt-3 rounded-card border border-line bg-periwinkle-soft px-4 py-3 text-[13px] leading-relaxed text-ink dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-[#e7e2d8]">
          <b>Brief:</b> {a.brief}
        </p>
      )}

      {/* money */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Cost", a.exact_cost != null ? rs(Number(a.exact_cost)) : "—", a.exact_cost == null ? "not entered yet" : "single"],
          /* With packs on it, the headline is the range — a single figure would
             be the cheapest of several and would read as the price. */
          ["Retail",
            hasPacks && lo != null && hi != null && lo !== hi ? `${rs(lo)} – ${rs(hi)}`
              : a.retail_price != null ? rs(Number(a.retail_price)) : "—",
            hasPacks ? `${packs.length} packs`
              : margin != null ? `${margin}% margin` : a.retail_price != null ? "enter a cost for the margin" : ""],
          ["Ads budget", rs(budget), basisWord],
          [`Approved ${a.period_label}`, rs(spentNow),
            pending > 0 ? `${rs(pending)} waiting on you`
                        : `${rs(Math.max(0, budget - spentNow))} left${a.ads_basis === "total" ? "" : ` ${a.period_label}`}`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
            <div className="text-[17px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
            {sub && <div className="mt-0.5 text-[11px] text-hint dark:text-[#8a8175]">{sub}</div>}
          </div>
        ))}
      </div>

      {budget > 0 && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-panel dark:bg-white/[0.08]">
            <div className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : "bg-ink dark:bg-white"}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11.5px] text-hint dark:text-[#8a8175]">
            {pct}% of the {rs(budget)} {basisWord}
            {a.ads_basis !== "total" && ` · ${rs(spent)} approved in total since this started`}
          </div>
        </div>
      )}

      {/* ── PACKS & PRICES ───────────────────────────────────────────────────
          One shirt, one workflow, several prices. Per-unit is shown beside each
          pack because that is the only figure that says whether a pack is
          actually a discount — a pack of three at Rs 3,990 is Rs 1,330 a shirt,
          and if the pack of two is Rs 1,300 a shirt then the bigger pack is the
          worse deal and nobody would have noticed. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Packs &amp; prices</h2>
        {packRow !== "new" && (
          <button onClick={() => { setPackRow("new"); setPack({ label: "", units: "2", exact_cost: "", retail_price: "" }); }}
            className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/15 dark:text-white dark:hover:bg-white/[0.06]">
            <Plus size={13} /> Add a pack
          </button>
        )}
      </div>

      <div className="mt-2 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="hidden border-b border-line px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175] sm:grid sm:grid-cols-[1.4fr_0.7fr_0.9fr_0.9fr_1fr_auto] sm:gap-3">
          <span>Pack</span><span className="text-right">Units</span><span className="text-right">Cost</span>
          <span className="text-right">Retail</span><span className="text-right">Each · margin</span><span />
        </div>

        {packs.map((p) => {
          const key = p.pack_id ?? "single";
          const editingThis = packRow === key;
          return (
            <div key={key} className="border-b border-line px-4 py-2.5 last:border-0 dark:border-white/[0.06]">
              {!editingThis ? (
                <div className="grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[1.4fr_0.7fr_0.9fr_0.9fr_1fr_auto] sm:items-center">
                  <span className="font-bold text-ink dark:text-[#f4f1ea]">
                    {p.label}
                    {p.is_single && <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hint dark:bg-white/[0.06] dark:text-[#8a8175]">base</span>}
                  </span>
                  <span className="tabular-nums text-muted dark:text-[#a89f93] sm:text-right">{p.units}</span>
                  <span className="tabular-nums text-muted dark:text-[#a89f93] sm:text-right">{p.exact_cost != null ? rs(Number(p.exact_cost)) : "—"}</span>
                  <span className="font-semibold tabular-nums text-ink dark:text-[#f4f1ea] sm:text-right">{p.retail_price != null ? rs(Number(p.retail_price)) : "—"}</span>
                  <span className="tabular-nums text-[12px] text-muted dark:text-[#a89f93] sm:text-right">
                    {p.per_unit != null ? `${rs(p.per_unit)} each` : "—"}
                    {p.margin != null && <span className="text-hint dark:text-[#8a8175]"> · {p.margin}%</span>}
                  </span>
                  <span className="flex items-center gap-1 sm:justify-end">
                    <button aria-label={`Edit ${p.label}`}
                      onClick={() => {
                        if (p.is_single) { openEdit(); return; }
                        setPackRow(key);
                        setPack({ label: p.label, units: String(p.units),
                                  exact_cost: p.exact_cost == null ? "" : String(p.exact_cost),
                                  retail_price: p.retail_price == null ? "" : String(p.retail_price) });
                      }}
                      className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.08] dark:hover:text-white">
                      <Pencil size={13} />
                    </button>
                    {/* The base has no delete: an article without a price is not
                        a thing. Remove the article instead. */}
                    {!p.is_single && p.pack_id && (
                      <button aria-label={`Remove ${p.label}`} disabled={busy}
                        onClick={() => call("hub_pack_delete", { p_pack_id: p.pack_id })}
                        className="rounded-full p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-40 dark:text-[#a89f93]">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </span>
                </div>
              ) : (
                <PackForm value={pack} onChange={setPack} busy={busy}
                  onCancel={() => setPackRow(null)}
                  onSave={() => call("hub_pack_update", {
                    p_pack_id: p.pack_id, p_label: pack.label,
                    p_units: Number(pack.units) || 1,
                    p_cost: pack.exact_cost === "" ? null : Number(pack.exact_cost),
                    p_price: pack.retail_price === "" ? null : Number(pack.retail_price),
                  }).then((ok) => { if (ok) setPackRow(null); })} />
              )}
            </div>
          );
        })}

        {packRow === "new" && (
          <div className="border-t border-line bg-canvas px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <PackForm value={pack} onChange={setPack} busy={busy}
              onCancel={() => setPackRow(null)}
              onSave={() => call("hub_pack_add", {
                p_article_id: a.id, p_label: pack.label,
                p_units: Number(pack.units) || 1,
                p_cost: pack.exact_cost === "" ? null : Number(pack.exact_cost),
                p_price: pack.retail_price === "" ? null : Number(pack.retail_price),
              }).then((ok) => { if (ok) setPackRow(null); })} />
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] text-hint dark:text-[#8a8175]">
        The base is the article&rsquo;s own cost and price — its pencil opens Edit. Packs never change the workflow:
        the five men see one article and are told once, however many prices sit on it.
      </p>

      {/* the timeline */}
      <h2 className="mt-6 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Who has it been with</h2>
      <div className="mt-2 space-y-2">
        {d.stages.map((s) => {
          const open = s.status === "open";
          const doneOk = s.status === "submitted";
          const back = s.status === "returned";
          return (
            <div key={s.stage}
              className={`rounded-card border bg-surface px-4 py-3 dark:bg-[#201c17] ${open ? "border-ink/40 dark:border-white/25" : "border-line dark:border-white/[0.06]"}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <span className="text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">{s.person ?? "nobody assigned"}</span>
                  <span className="ml-2 text-[12px] text-muted dark:text-[#a89f93]">{s.label}</span>
                  {(s.attempt ?? 1) > 1 && (
                    <span className="ml-2 rounded-full bg-salmon-soft px-2 py-0.5 text-[10.5px] font-bold text-red-800 dark:bg-white/[0.08] dark:text-salmon">
                      attempt {s.attempt}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                  {s.held && (
                    <span className="flex items-center gap-1 text-muted dark:text-[#a89f93]"><Clock3 size={12} /> {s.held}</span>
                  )}
                  <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                    doneOk ? "bg-success-soft text-success dark:bg-white/[0.10]"
                    : back ? "bg-salmon-soft text-red-800 dark:bg-white/[0.10] dark:text-salmon"
                    : open ? "bg-amber-soft text-amber-strong dark:bg-white/[0.10] dark:text-amber"
                    : "bg-panel text-hint dark:bg-white/[0.06]"}`}>
                    {doneOk ? "submitted" : back ? "sent back" : open ? "with him now" : "not started"}
                  </span>
                </div>
              </div>

              {s.submit_note && (
                <p className="mt-1.5 text-[12.5px] text-ink dark:text-[#e7e2d8]">&ldquo;{s.submit_note}&rdquo;</p>
              )}
              {s.on_behalf && s.submitted_by_name && (
                <p className="mt-1 text-[11.5px] font-semibold text-periwinkle-strong dark:text-periwinkle">
                  recorded by {s.submitted_by_name}, not submitted by {s.person}
                </p>
              )}

              {/* UNDOING A SUBMISSION.
                  The button above makes it easy to close a man's work from
                  here. It makes it just as easy to close the wrong man's work,
                  so the way back has to be on the same row — not a thing you
                  ask somebody to fix in the database.
                  The undo does not erase anything: the reason and your name go
                  into the history, and the man is told it is back with him. */}
              {doneOk && s.task_id && (
                undoing === s.task_id ? (
                  <div className="mt-3 rounded-xl2 border border-salmon-soft bg-salmon-soft/40 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                    <label className="block text-[12px] font-semibold text-red-800 dark:text-salmon">
                      Put this back with {s.person}. Why?
                    </label>
                    <input autoFocus value={undoWhy} onChange={(e) => setUndoWhy(e.target.value)}
                      placeholder="He had not actually posted anything"
                      className="mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-hint dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button disabled={busy}
                        onClick={() => call("hub_task_reopen", { p_task_id: s.task_id, p_reason: undoWhy })
                          .then((ok) => { if (ok) { setUndoing(null); setUndoWhy(""); } })}
                        className="rounded-full bg-danger px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40">
                        {busy ? "Undoing…" : `Put it back with ${s.person}`}
                      </button>
                      <button disabled={busy} onClick={() => setUndoing(null)}
                        className="rounded-full border border-line px-4 py-1.5 text-[12.5px] font-semibold text-ink dark:border-white/15 dark:text-white">
                        Cancel
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-hint dark:text-[#8a8175]">
                      The submission is removed and the stage goes back to him with this reason on it.
                      It stays in the history under your name.
                      {s.stage !== "social" && s.stage !== "ads" &&
                        " Anything that opened because of this submission stays open — undoing a click should not throw away work somebody has already started."}
                    </p>
                  </div>
                ) : (
                  <button onClick={() => { setUndoing(s.task_id); setUndoWhy(""); }}
                    className="mt-2 flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12px] font-semibold text-muted transition hover:border-danger/40 hover:bg-salmon-soft hover:text-danger dark:border-white/15 dark:text-[#a89f93]">
                    <Undo2 size={13} /> Undo — it wasn&rsquo;t done
                  </button>
                )
              )}

              {/* Any open stage can be closed from here, for that man. */}
              {open && s.task_id && (
                marking === s.task_id ? (
                  <div className="mt-3 rounded-xl2 border border-line bg-canvas p-3 dark:border-white/10 dark:bg-white/[0.03]">
                    <label className="block text-[12px] font-semibold text-muted dark:text-[#a89f93]">
                      What did {s.person} do?
                    </label>
                    <textarea autoFocus rows={2} value={mark.note}
                      onChange={(e) => setMark({ ...mark, note: e.target.value })}
                      placeholder="Pictures, sizes and size chart done, uploaded to Shopify"
                      className="mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-hint dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="text-[12px] font-semibold text-muted dark:text-[#a89f93]">Done on</label>
                      <input type="date" value={mark.done_on} max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setMark({ ...mark, done_on: e.target.value })}
                        className="rounded-xl2 border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
                      <button disabled={busy || !mark.note.trim()}
                        onClick={() => call("hub_task_submit", {
                          p_task_id: s.task_id, p_note: mark.note,
                          /* Midday, so the date reads the same whichever way the
                             timezone leans. Nobody is recording an hour here. */
                          p_done_on: new Date(`${mark.done_on}T12:00:00`).toISOString(),
                        }).then((ok) => { if (ok) { setMarking(null); setMark({ note: "", done_on: new Date().toISOString().slice(0, 10) }); } })}
                        className="rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">
                        {busy ? "Saving…" : "Record it"}
                      </button>
                      <button disabled={busy} onClick={() => setMarking(null)}
                        className="rounded-full border border-line px-4 py-1.5 text-[12.5px] font-semibold text-ink dark:border-white/15 dark:text-white">
                        Cancel
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-hint dark:text-[#8a8175]">
                      Saved under your name as recorded for {s.person}, and {s.person} is told. The article moves on exactly as if he had pressed it.
                    </p>
                  </div>
                ) : (
                  <button onClick={() => { setMarking(s.task_id); setMark({ note: "", done_on: new Date().toISOString().slice(0, 10) }); }}
                    className="mt-2 flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/15 dark:text-white dark:hover:bg-white/[0.06]">
                    <CheckCircle2 size={13} /> Mark done for {s.person}
                  </button>
                )
              )}
              {s.returned_note && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-red-800 dark:text-salmon">
                  <CornerUpLeft size={12} className="mt-0.5 shrink-0" /> {s.returned_note}
                </p>
              )}
              <p className="mt-1 text-[11px] text-hint dark:text-[#8a8175]">
                {s.opened_at ? `given ${when(s.opened_at)}` : "not opened yet"}
                {s.submitted_at ? ` · submitted ${when(s.submitted_at)}` : ""}
              </p>
            </div>
          );
        })}
      </div>

      {/* ads */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Ads spending</h2>
        <button onClick={() => setAddSpend((v) => !v)}
          className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-semibold text-ink dark:border-white/15 dark:text-white">
          <Plus size={13} /> Record a spend
        </button>
      </div>

      {addSpend && (
        <div className="mt-2 rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input type="date" value={spend.spent_on} onChange={(e) => setSpend({ ...spend, spent_on: e.target.value })}
              className="rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
            <input type="number" placeholder="Amount" value={spend.amount} onChange={(e) => setSpend({ ...spend, amount: e.target.value })}
              className="rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] tabular-nums dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
            <input placeholder="Campaign name" value={spend.campaign_name} onChange={(e) => setSpend({ ...spend, campaign_name: e.target.value })}
              className="rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
            <input placeholder="Campaign ID (optional)" value={spend.campaign_id} onChange={(e) => setSpend({ ...spend, campaign_id: e.target.value })}
              className="rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
            <input placeholder="Note" value={spend.notes} onChange={(e) => setSpend({ ...spend, notes: e.target.value })}
              className="rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
          </div>
          <button disabled={busy || !spend.amount}
            onClick={() => call("hub_ads_expense_add", {
              p_article_id: a.id, p_spent_on: spend.spent_on, p_amount: Number(spend.amount),
              p_platform: "Meta", p_campaign_name: spend.campaign_name || null,
              p_campaign_id: spend.campaign_id || null, p_proof_url: null, p_notes: spend.notes || null,
            }).then(() => setSpend({ ...spend, amount: "", campaign_name: "", campaign_id: "", notes: "" }))}
            className="mt-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">
            Add — waits for approval
          </button>
        </div>
      )}

      <div className="mt-2 space-y-2">
        {d.ads.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted dark:border-white/[0.06] dark:bg-[#201c17] dark:text-[#a89f93]">
            Nothing spent yet.
          </p>
        ) : d.ads.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface px-4 py-3 dark:border-white/[0.06] dark:bg-[#201c17]">
            <div className="min-w-0 flex-1">
              <span className="text-[13.5px] font-bold tabular-nums text-ink dark:text-[#f4f1ea]">{rs(Number(x.amount))}</span>
              <span className="ml-2 text-[12px] text-muted dark:text-[#a89f93]">
                {x.spent_on}{x.campaign_name ? ` · ${x.campaign_name}` : ""}{x.notes ? ` · ${x.notes}` : ""}
              </span>
            </div>
            {x.status === "pending" ? (
              <div className="flex items-center gap-2">
                <button disabled={busy} onClick={() => call("hub_ads_expense_decide", { p_id: x.id, p_approve: true, p_note: null })}
                  className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">Approve</button>
                <button disabled={busy} onClick={() => {
                    const why = window.prompt("Why is it rejected?");
                    if (why && why.trim()) call("hub_ads_expense_decide", { p_id: x.id, p_approve: false, p_note: why.trim() });
                  }}
                  className="rounded-full border border-line px-3.5 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40 dark:border-white/15 dark:text-white">Reject</button>
              </div>
            ) : (
              <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${x.status === "approved"
                ? "bg-success-soft text-success dark:bg-white/[0.10]" : "bg-danger-soft text-danger dark:bg-white/[0.10]"}`}>
                {x.status}{x.decision_note ? ` — ${x.decision_note}` : ""}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* history */}
      <h2 className="mt-6 flex items-center gap-2 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">
        <Wallet size={15} className="opacity-0" /> History
      </h2>
      <div className="mt-2 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        {d.events.map((e, i) => (
          <div key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-line px-4 py-2 text-[12.5px] last:border-0 dark:border-white/[0.05]">
            <span className="w-[110px] shrink-0 text-hint dark:text-[#8a8175]">{when(e.at)}</span>
            <span className="font-semibold text-ink dark:text-[#e7e2d8]">{e.kind.replace(/_/g, " ")}</span>
            {e.actor && <span className="text-muted dark:text-[#a89f93]">by {e.actor}</span>}
            {e.detail && <span className="min-w-0 flex-1 text-muted dark:text-[#a89f93]">— {e.detail}</span>}
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[11.5px] text-hint dark:text-[#8a8175]">
        Every line above was written by the database when the button was pressed. Nobody can edit a time.
      </p>
    </div>
  );
}

/* ONE FORM, USED FOR ADDING AND FOR EDITING.
   A pack has four facts and they are the same four whether the row is new or
   old, so there is one form rather than two that drift apart. The per-unit
   figure updates as the price is typed — the point of a pack is the discount,
   and this is where you find out whether there is one. */
function PackForm({
  value, onChange, busy, onSave, onCancel,
}: {
  value: { label: string; units: string; exact_cost: string; retail_price: string };
  onChange: (v: { label: string; units: string; exact_cost: string; retail_price: string }) => void;
  busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  const units = Number(value.units) || 0;
  const price = value.retail_price === "" ? null : Number(value.retail_price);
  const each = units > 0 && price != null ? Math.round(price / units) : null;
  const cost = value.exact_cost === "" ? null : Number(value.exact_cost);
  const margin = price != null && price > 0 && cost != null
    ? Math.round(((price - cost) / price) * 1000) / 10 : null;

  const box = "w-full rounded-xl2 border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-hint dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]";
  const cap = "block text-[11px] font-semibold text-muted dark:text-[#a89f93]";

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-[1.4fr_0.7fr_0.9fr_0.9fr]">
        <div>
          <label className={cap}>Pack</label>
          <input autoFocus value={value.label} placeholder="Pack of 2"
            onChange={(e) => onChange({ ...value, label: e.target.value })} className={`mt-1 ${box}`} />
        </div>
        <div>
          <label className={cap}>Units</label>
          <input type="number" inputMode="numeric" min={1} value={value.units}
            onChange={(e) => onChange({ ...value, units: e.target.value })} className={`mt-1 ${box}`} />
        </div>
        <div>
          <label className={cap}>Cost</label>
          <input type="number" inputMode="numeric" value={value.exact_cost} placeholder="optional"
            onChange={(e) => onChange({ ...value, exact_cost: e.target.value })} className={`mt-1 ${box}`} />
        </div>
        <div>
          <label className={cap}>Retail</label>
          <input type="number" inputMode="numeric" value={value.retail_price}
            onChange={(e) => onChange({ ...value, retail_price: e.target.value })} className={`mt-1 ${box}`} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button disabled={busy || !value.label.trim()} onClick={onSave}
          className="rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">
          {busy ? "Saving…" : "Save pack"}
        </button>
        <button disabled={busy} onClick={onCancel}
          className="rounded-full border border-line px-4 py-1.5 text-[12.5px] font-semibold text-ink dark:border-white/15 dark:text-white">
          Cancel
        </button>
        {each != null && (
          <span className="text-[12px] text-muted dark:text-[#a89f93]">
            {rs(each)} per shirt{margin != null && ` · ${margin}% margin`}
          </span>
        )}
      </div>
    </div>
  );
}
