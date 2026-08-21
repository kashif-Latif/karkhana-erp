"use client";
import { X } from "lucide-react";
import { useEffect } from "react";

export default function Modal({ open, onClose, title, subtitle, children, wide }:
  { open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-card border border-line bg-surface p-5 shadow-xl sm:rounded-card dark:border-white/[0.08] dark:bg-[#201c17] ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-muted dark:text-[#a89f93]">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[12.5px] font-semibold text-ink dark:text-[#e7e2d8]">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
export const inputCls = "w-full rounded-xl2 border border-line bg-canvas px-3 py-2 text-[13px] font-normal text-ink outline-none transition focus:border-ink/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-white";
export const btnPrimary = "flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-[#141414]";
export const btnGhost = "flex items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]";
