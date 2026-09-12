"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/* THE NOTIFICATION BAR — the same one on both sides.
 *
 * The boss and the employee are told different things, but by the same
 * machinery: hub_my_notifications() returns whatever was addressed to whoever
 * is signed in, and there is no parameter to ask with, so this component
 * cannot show one person another person's work.
 *
 * IT CLEARS ON READING, NOT ON ARRIVING. Opening the panel marks everything in
 * it as read, because that is the moment the person has actually seen it. A
 * badge that clears on page load teaches people to ignore the badge.
 */

type Note = {
  id: number; kind: string; title: string; body: string | null;
  article_id: string | null; task_id: string | null;
  created_at: string; read_at: string | null;
};

const TONE: Record<string, string> = {
  assigned:      "bg-periwinkle-soft text-periwinkle-strong dark:bg-white/[0.10] dark:text-periwinkle",
  returned:      "bg-salmon-soft text-red-800 dark:bg-white/[0.10] dark:text-salmon",
  submitted:     "bg-panel text-muted dark:bg-white/[0.06] dark:text-[#a89f93]",
  completed:     "bg-success-soft text-success dark:bg-white/[0.10]",
  ads_pending:   "bg-amber-soft text-amber-strong dark:bg-white/[0.10] dark:text-amber",
  ads_approved:  "bg-success-soft text-success dark:bg-white/[0.10]",
  ads_rejected:  "bg-salmon-soft text-red-800 dark:bg-white/[0.10] dark:text-salmon",
};

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function HubBell({ dark = false }: { dark?: boolean }) {
  const [items, setItems] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data } = await supabase.rpc("hub_my_notifications", { p_unread_only: false });
    setItems((data as Note[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Checked every minute while somebody is looking at the tab, and not at all
     while they are not. A background tab polling all day costs a free-tier
     quota and tells nobody anything. */
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const unread = items.filter((n) => !n.read_at).length;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0 && supabase) {
      await supabase.rpc("hub_notification_read", { p_id: null });
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    }
  }

  return (
    <div className="relative" ref={box}>
      <button onClick={toggle} aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        className={`relative rounded-full p-2 transition ${dark
          ? "border border-white/20 text-white/70 hover:bg-white/10 hover:text-white"
          : "text-muted hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.08] dark:hover:text-white"}`}>
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[320px] overflow-y-auto rounded-card border border-line bg-surface shadow-card dark:border-white/10 dark:bg-[#201c17] sm:w-[380px]">
          <div className="sticky top-0 border-b border-line bg-surface px-4 py-2.5 text-[12px] font-bold text-ink dark:border-white/10 dark:bg-[#201c17] dark:text-[#f4f1ea]">
            Notifications
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted dark:text-[#a89f93]">Nothing yet.</p>
          ) : (
            items.map((n) => (
              <button key={n.id}
                onClick={() => { setOpen(false); if (n.article_id) router.push(`/online/articles/${n.article_id}`); }}
                className="block w-full border-b border-line px-4 py-3 text-left transition last:border-0 hover:bg-panel/60 dark:border-white/[0.06] dark:hover:bg-white/[0.04]">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[n.kind] ?? TONE.submitted}`}>
                    {n.kind.replace(/_/g, " ")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-[12px] leading-snug text-muted dark:text-[#a89f93]">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-hint dark:text-[#8a8175]">{ago(n.created_at)}</span>
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
