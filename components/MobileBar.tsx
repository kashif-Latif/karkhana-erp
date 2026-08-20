"use client";
import { Menu } from "lucide-react";
export default function MobileBar({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:hidden dark:border-white/[0.06] dark:bg-[#201c17]/95">
      <button onClick={onOpen} aria-label="Open menu" className="flex h-9 w-9 items-center justify-center rounded-xl2 text-ink transition hover:bg-panel dark:text-white dark:hover:bg-white/[0.06]">
        <Menu size={22} />
      </button>
      <span className="text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">{title}</span>
    </div>
  );
}
