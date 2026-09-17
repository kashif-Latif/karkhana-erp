"use client";
/* Confirm dialog, in the app's own styling.
 *
 * WHY THIS EXISTS
 *   Six places called window.confirm(), which renders Chrome's grey system box
 *   with the site's URL above it. It is jarring in the middle of a designed
 *   interface, and on a phone it appears at the top of the screen far from the
 *   button that triggered it.
 *
 *   It also gives no way to distinguish a destructive action from a routine
 *   one. Deleting an employee and confirming a form look identical, which is
 *   the wrong thing to be identical.
 *
 * DESIGN
 *   Destructive is the default, because every current caller is a delete.
 *   The dangerous button carries the colour; Cancel stays quiet and gets focus
 *   on open, so a stray Enter cancels rather than deletes.
 *   Escape closes. Clicking the backdrop closes. Both mean no.
 *
 * USE
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Remove Ali's account?",
 *                         body: "They will no longer be able to log in.",
 *                         confirmLabel: "Remove" }))) return;
 *
 *   It returns a promise, so an existing `if (!window.confirm(...)) return;`
 *   becomes the line above with almost no restructuring.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type Ask = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "normal";
  /* Ask for a short note as part of confirming. Used where the record of WHY
     matters as much as the act — removing a shipment, writing off a parcel.
     A browser prompt() would do the same job and look nothing like the rest of
     the app, which is reason enough not to use one. */
  reasonLabel?: string;
  reasonDefault?: string;
};

/* Resolves false when dismissed. When a reason was asked for, it resolves to
   the text instead — an empty string still counts as confirmed, so callers test
   for `!== false` rather than truthiness. */
type Answer = boolean | string;
const Ctx = createContext<(a: Ask) => Promise<Answer>>(async () => false);

/** Ask for confirmation. Resolves true (or the reason text) only if confirmed. */
export function useConfirm() {
  return useContext(Ctx);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [reason, setReason] = useState("");
  const resolver = useRef<((v: Answer) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /* close() is memoised with no deps so the Escape handler stays stable; these
     let it read the current values without re-creating it on every keystroke. */
  const askRef = useRef<Ask | null>(null);
  const reasonRef = useRef("");
  askRef.current = ask;
  reasonRef.current = reason;

  const confirm = useCallback((a: Ask) => {
    setAsk(a);
    setReason(a.reasonDefault ?? "");
    return new Promise<Answer>((res) => { resolver.current = res; });
  }, []);

  const close = useCallback((answer: boolean) => {
    resolver.current?.(answer && askRef.current?.reasonLabel ? reasonRef.current : answer);
    resolver.current = null;
    setAsk(null);
  }, []);

  // Escape always means no. Focus starts on Cancel so a stray Enter is safe.
  useEffect(() => {
    if (!ask) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask, close]);

  const danger = ask?.tone !== "normal";

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {ask && (
        <div role="dialog" aria-modal="true"
             className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
             onClick={() => close(false)}>
          <div className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-xl dark:border-white/10 dark:bg-[#1a1713]"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              {danger && (
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-salmon-soft">
                  <AlertTriangle size={16} className="text-red-700" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold text-ink dark:text-[#f4f1ea]">{ask.title}</div>
                {ask.body && (
                  <div className="mt-1 text-[13px] leading-relaxed text-muted dark:text-[#a89f93]">{ask.body}</div>
                )}
              </div>
              <button onClick={() => close(false)} aria-label="Close"
                      className="rounded-full p-1 text-muted hover:bg-panel dark:hover:bg-white/10">
                <X size={16} />
              </button>
            </div>

            {ask.reasonLabel && (
              <div className="mt-4">
                <label className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-hint dark:text-[#8a8175]">
                  {ask.reasonLabel}
                </label>
                <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") close(true); }}
                       className="w-full rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-ink dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button ref={cancelRef} onClick={() => close(false)}
                      className="rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
                {ask.cancelLabel ?? "Cancel"}
              </button>
              <button onClick={() => close(true)}
                      className={`rounded-full px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 ${
                        danger ? "bg-red-600" : "bg-ink dark:bg-white dark:text-[#141414]"}`}>
                {ask.confirmLabel ?? (danger ? "Delete" : "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
