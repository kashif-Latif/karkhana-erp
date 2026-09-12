"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Search, Loader2, PackagePlus } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { rs } from "@/lib/dateRange";

/* ARTICLES — the boss's list.
 *
 * WHAT THE ADMINISTRATION ACTUALLY ASKS THIS SCREEN
 *   "Where is my article?" Not how many there are. So the column that matters
 *   is WAITING ON — the name of the man holding it and how long he has held
 *   it — and it is the one thing that is never truncated.
 *
 * FOUR FIELDS TO CREATE ONE. Rough name, cost, price, ads budget, plus what he
 * wants made. Sizes, colours, pictures, Shopify details are somebody else's
 * job by design — that is the whole point of the workflow.
 *
 * Every figure comes from hub_articles_list(), counted in the database.
 * PostgREST caps a response at 1,000 rows whatever the page asks for, so a
 * total added up in the browser is the size of the page, not the business.
 */

type Row = {
  id: string; code: string; name: string; status: string; created_at: string;
  exact_cost: number | null; retail_price: number | null; margin: number | null;
  ads_budget: number | null; ads_spent: number; ads_pending: number;
  stages_done: number; stages_total: number;
  waiting_on: string | null; waiting_days: number | null; age: string;
};

const TABS = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function statusChip(s: string) {
  if (s === "completed") return "bg-success-soft text-success dark:bg-white/[0.10]";
  if (s === "approved")  return "bg-success-soft text-emerald-800 dark:bg-white/[0.10]";
  if (s === "rejected")  return "bg-danger-soft text-danger dark:bg-white/[0.10]";
  return "bg-amber-soft text-amber-strong dark:bg-white/[0.10] dark:text-amber";
}

export default function ArticlesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ rough_name: "", exact_cost: "", retail_price: "", ads_budget: "", brief: "" });

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("hub_articles_list", {
      p_status: tab === "all" ? null : tab, p_q: q.trim() || null,
    });
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, [tab, q]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!supabase) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("hub_article_create", {
      p_rough_name: form.rough_name,
      p_exact_cost: form.exact_cost === "" ? null : Number(form.exact_cost),
      p_retail_price: form.retail_price === "" ? null : Number(form.retail_price),
      p_ads_budget: form.ads_budget === "" ? null : Number(form.ads_budget),
      p_brief: form.brief || null,
    });
    setBusy(false);
    const res = data as { ok?: boolean; error?: string; code?: string } | null;
    if (error) { setErr(error.message); return; }
    if (res && res.ok === false) { setErr(res.error ?? "Refused."); return; }
    setAdding(false);
    setForm({ rough_name: "", exact_cost: "", retail_price: "", ads_budget: "", brief: "" });
    load();
  }

  const totals = useMemo(() => ({
    live: rows.filter((r) => r.status === "in_progress").length,
    waiting: rows.filter((r) => r.waiting_on).length,
    budget: rows.reduce((a, r) => a + Number(r.ads_budget || 0), 0),
    spent: rows.reduce((a, r) => a + Number(r.ads_spent || 0), 0),
    pending: rows.reduce((a, r) => a + Number(r.ads_pending || 0), 0),
  }), [rows]);

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Articles</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">
            Every product launch, who is holding it, and what the ads have cost.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white dark:bg-white dark:text-[#141414]">
            <Plus size={15} /> New article
          </button>
          <button onClick={load}
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {/* four numbers, and only four */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["In progress", String(totals.live), ""],
          ["Waiting on somebody", String(totals.waiting), ""],
          ["Ads budget given", rs(totals.budget), ""],
          ["Ads approved / waiting", rs(totals.spent), totals.pending > 0 ? `${rs(totals.pending)} to approve` : ""],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
            <div className="text-[18px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
            {sub && <div className="mt-0.5 text-[11px] font-semibold text-amber-strong dark:text-amber">{sub}</div>}
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex w-max gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${tab === t.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
          <Search size={15} className="text-hint dark:text-[#8a8175]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code"
            className="w-40 bg-transparent text-[13px] outline-none placeholder:text-hint sm:w-56 dark:text-[#f4f1ea]" />
        </div>
      </div>

      {err && <p className="mt-4 rounded-card border border-line bg-danger-soft px-4 py-3 text-[12.5px] font-medium text-danger">{err}</p>}

      <div className="mt-4 space-y-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-card bg-panel/70 dark:bg-white/[0.05]" />)
        ) : rows.length === 0 ? (
          <div className="rounded-card border border-line bg-surface px-4 py-16 text-center dark:border-white/[0.06] dark:bg-[#201c17]">
            <PackagePlus size={22} className="mx-auto mb-2 text-muted" />
            <p className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">No articles yet.</p>
            <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">
              Press New article. Hamza Mukhtar and Hamza Khan are told the moment you do.
            </p>
          </div>
        ) : rows.map((r) => (
          <Link key={r.id} href={`/online/articles/${r.id}`}
            className="block rounded-card border border-line bg-surface px-4 py-3.5 transition hover:border-ink/25 hover:shadow-soft dark:border-white/[0.06] dark:bg-[#201c17] dark:hover:border-white/20">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-[150px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">{r.name}</span>
                  <span className="text-[11.5px] font-semibold text-muted dark:text-[#a89f93]">{r.code}</span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-hint dark:text-[#8a8175]">
                  {r.retail_price ? `${rs(r.retail_price)} retail` : "no price"}
                  {r.margin != null && ` · ${r.margin}% margin`} · running {r.age}
                </div>
              </div>

              {/* five dots, one per stage — the whole progress at a glance */}
              <div className="flex items-center gap-1">
                {Array.from({ length: r.stages_total }).map((_, i) => (
                  <span key={i} className={`h-2 w-2 rounded-full ${i < r.stages_done ? "bg-success" : "bg-line dark:bg-white/20"}`} />
                ))}
                <span className="ml-1.5 text-[11.5px] font-semibold tabular-nums text-muted dark:text-[#a89f93]">
                  {r.stages_done}/{r.stages_total}
                </span>
              </div>

              {/* the answer to "where is it" */}
              <div className="min-w-[170px] text-[12.5px]">
                {r.waiting_on ? (
                  <span className="text-ink dark:text-[#e7e2d8]">
                    waiting on <b>{r.waiting_on}</b>
                    {r.waiting_days != null && r.waiting_days > 0 &&
                      <span className="text-muted dark:text-[#a89f93]"> · {r.waiting_days}d</span>}
                  </span>
                ) : (
                  <span className="text-muted dark:text-[#a89f93]">nobody — nothing open</span>
                )}
              </div>

              <div className="text-right">
                <div className="text-[12.5px] font-semibold tabular-nums text-ink dark:text-[#f4f1ea]">
                  {rs(Number(r.ads_spent))} <span className="font-normal text-hint dark:text-[#8a8175]">of {rs(Number(r.ads_budget || 0))}</span>
                </div>
                {Number(r.ads_pending) > 0 && (
                  <div className="text-[11px] font-semibold text-amber-strong dark:text-amber">{rs(Number(r.ads_pending))} to approve</div>
                )}
              </div>

              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${statusChip(r.status)}`}>
                {r.status.replace("_", " ")}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* ── new article ──────────────────────────────────────────────────── */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={() => !busy && setAdding(false)}>
          <div className="w-full max-w-lg rounded-t-card bg-surface p-5 shadow-card dark:bg-[#201c17] sm:rounded-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-extrabold text-ink dark:text-[#f4f1ea]">New article</h2>
            <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">
              Four numbers and what you want made. The names, sizes, pictures and Shopify details are Hamza Mukhtar&rsquo;s job.
            </p>

            <label className="mt-4 block text-[12px] font-semibold text-muted dark:text-[#a89f93]">Rough name</label>
            <input autoFocus value={form.rough_name} onChange={(e) => setForm({ ...form, rough_name: e.target.value })}
              placeholder="Red winter coat"
              className="mt-1 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[14px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />

            <div className="mt-3 grid grid-cols-3 gap-2">
              {([["exact_cost", "Exact cost"], ["retail_price", "Retail price"], ["ads_budget", "Ads budget"]] as const).map(([k, label]) => (
                <div key={k}>
                  <label className="block text-[12px] font-semibold text-muted dark:text-[#a89f93]">{label}</label>
                  <input type="number" inputMode="numeric" value={form[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    className="mt-1 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[14px] tabular-nums text-ink outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
                </div>
              ))}
            </div>

            {/* Shown live, because a margin typed wrong is obvious the moment it
                is worked out and invisible until then. */}
            {Number(form.retail_price) > 0 && (
              <p className="mt-2 text-[12px] text-muted dark:text-[#a89f93]">
                Margin{" "}
                <b className="text-ink dark:text-[#f4f1ea]">
                  {Math.round(((Number(form.retail_price) - Number(form.exact_cost || 0)) / Number(form.retail_price)) * 1000) / 10}%
                </b>{" "}
                · {rs(Number(form.retail_price) - Number(form.exact_cost || 0))} a piece
              </p>
            )}

            <label className="mt-3 block text-[12px] font-semibold text-muted dark:text-[#a89f93]">What do you want made?</label>
            <textarea value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} rows={3}
              placeholder="Shoot 6 pictures and 3 reels, upload to Shopify, then run Meta ads on the cold audience"
              className="mt-1 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-hint dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]" />
            <p className="mt-1 text-[11.5px] text-hint dark:text-[#8a8175]">
              This is what Hamza Mukhtar and Hamza Khan will read on their panel.
            </p>

            {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setAdding(false)} disabled={busy}
                className="rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-ink dark:border-white/15 dark:text-white">Cancel</button>
              <button onClick={create} disabled={busy || !form.rough_name.trim()}
                className="flex items-center gap-2 rounded-full bg-ink px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">
                {busy && <Loader2 size={14} className="animate-spin" />} Create &amp; assign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
