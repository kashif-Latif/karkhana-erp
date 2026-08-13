"use client";
import { Search, Bell, Plus } from "lucide-react";

export default function Topbar({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2">
          <Search size={15} className="text-hint" />
          <input
            placeholder="Search GRN, material, employee…"
            className="w-40 bg-transparent text-[13px] outline-none placeholder:text-hint lg:w-56"
          />
        </div>
        <button className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink">
          <Bell size={17} />
          <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-salmon-strong" />
        </button>
        <button className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
          <Plus size={16} /> New GRN
        </button>
      </div>
    </header>
  );
}
