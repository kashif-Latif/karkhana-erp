"use client";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, CornerUpLeft, CheckCircle2, Loader2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/* WHAT THIS PERSON HAS TO DO — on their own portal, beside their own wages.
 *
 * ONE BUTTON. There is no Start, no Accept, no Reject. The work arrives, the
 * person does it, they write what they did and press Submit. Everything else —
 * who gets it next, what the boss is told, how long it sat here — happens in
 * the database at that moment.
 *
 * THE CLOCK IS NOT SHOWN AS A DEADLINE. It says how long this has been with
 * you, because that is a fact. There is no target and nothing turns red: a
 * limit nobody agreed to only teaches people to ignore the colour.
 *
 * THE ONE EXTRA BUTTON belongs to the quality check alone. Abdul Rehman can
 * hand an article back to Hamza Mukhtar with a reason. Qaswar and Awais
 * deliberately cannot — that was asked for explicitly.
 */

type Task = {
  task_id: string; article_id: string | null; code: string | null;
  article_name: string | null; stage: string | null; title: string;
  detail: string | null; status: string; opened_at: string;
  submitted_at: string | null; submit_note: string | null;
  held: string | null; returned_note: string | null;
};

export default function MyWork() {
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase.rpc("hub_my_work");
    if (error) setErr(error.message);
    setRows((data as Task[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(t: Task, what: "submit" | "send_back") {
    if (!supabase) return;
    const text = (note[t.task_id] ?? "").trim();
    setBusy(t.task_id); setErr("");
    const { data, error } = what === "submit"
      ? await supabase.rpc("hub_task_submit", { p_task_id: t.task_id, p_note: text })
      : await supabase.rpc("hub_task_send_back", { p_task_id: t.task_id, p_reason: text });
    setBusy(null);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error) { setErr(error.message); return; }
    /* The database answers with a reason instead of throwing, so a refusal has
       to be read out of the reply and shown. Swallowing it looks like a button
       that does nothing. */
    if (res && res.ok === false) { setErr(res.error ?? "Refused."); return; }
    setNote((n) => ({ ...n, [t.task_id]: "" }));
    load();
  }

  const open = rows.filter((r) => r.status === "open");
  const done = rows.filter((r) => r.status !== "open").slice(0, 6);

  if (loading) {
    return <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-muted dark:text-[#a89f93]">
      <Loader2 size={14} className="animate-spin" /> Loading your work…</div>;
  }
  /* It used to hide itself when there was nothing assigned. Now it lives
     behind its own tab, so an empty tab has to say it is empty — a blank
     panel reads as a page that failed to load. */

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card dark:border-white/10 dark:bg-[#201c17]">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-bold text-ink dark:border-white/10 dark:text-[#f4f1ea] sm:px-5">
        <ClipboardList size={15} /> Your work
        {open.length > 0 && (
          <span className="rounded-full bg-periwinkle-soft px-2 py-0.5 text-[11px] font-bold text-periwinkle-strong dark:bg-white/[0.10] dark:text-periwinkle">
            {open.length} to do
          </span>
        )}
      </h2>

      {err && <p className="border-b border-line bg-danger-soft px-4 py-2.5 text-[12.5px] font-medium text-danger dark:border-white/10 sm:px-5">{err}</p>}

      {open.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted dark:text-[#a89f93] sm:px-5">
          Nothing waiting on you right now.
        </p>
      ) : open.map((t) => (
        <div key={t.task_id} className="border-b border-line px-4 py-4 last:border-0 dark:border-white/[0.06] sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[14px] font-bold text-ink dark:text-[#f4f1ea]">{t.title}</span>
              {t.code && (
                <span className="ml-2 text-[12.5px] text-muted dark:text-[#a89f93]">
                  {t.code} · {t.article_name}
                </span>
              )}
            </div>
            <span className="shrink-0 rounded-full bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted dark:bg-white/[0.06] dark:text-[#a89f93]">
              with you {t.held}
            </span>
          </div>

          {/* Sent back: the reason is the instruction, so it is loud. */}
          {t.returned_note ? (
            <p className="mt-2 rounded-xl2 bg-salmon-soft px-3 py-2 text-[12.5px] text-red-900 dark:bg-white/[0.06] dark:text-salmon">
              <b>Sent back:</b> {t.returned_note}
            </p>
          ) : t.detail ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted dark:text-[#a89f93]">{t.detail}</p>
          ) : null}

          <textarea
            value={note[t.task_id] ?? ""}
            onChange={(e) => setNote((n) => ({ ...n, [t.task_id]: e.target.value }))}
            rows={2}
            placeholder="What did you do? e.g. 6 pictures, 4 sizes, size chart added, live on Shopify"
            className="mt-3 w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-hint dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f4f1ea]"
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button disabled={busy === t.task_id || !(note[t.task_id] ?? "").trim()}
              onClick={() => act(t, "submit")}
              className="rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-[#141414]">
              {busy === t.task_id ? "Saving…" : "Submit"}
            </button>

            {t.stage === "qc" && (
              <button disabled={busy === t.task_id || !(note[t.task_id] ?? "").trim()}
                onClick={() => act(t, "send_back")}
                className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] font-semibold text-ink disabled:opacity-40 dark:border-white/15 dark:text-white">
                <CornerUpLeft size={13} /> Send back
              </button>
            )}

            <span className="text-[11.5px] text-hint dark:text-[#8a8175]">
              {t.stage === "qc"
                ? "Write what you checked, or what is wrong if you are sending it back."
                : "Write what you did — it goes to the administration with your name on it."}
            </span>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <div className="bg-panel/60 px-4 py-3 dark:bg-white/[0.03] sm:px-5">
          <div className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-hint dark:text-[#8a8175]">Recently submitted</div>
          <ul className="space-y-1.5">
            {done.map((t) => (
              <li key={t.task_id} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                <CheckCircle2 size={12} className="shrink-0 text-success" />
                <span className="font-semibold text-ink dark:text-[#e7e2d8]">{t.code ?? "Task"}</span>
                <span className="min-w-0 flex-1 truncate text-muted dark:text-[#a89f93]">{t.submit_note}</span>
                <span className="shrink-0 text-hint dark:text-[#8a8175]">took {t.held}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
