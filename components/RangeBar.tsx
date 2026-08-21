"use client";
import { PRESETS } from "@/lib/dateRange";

export default function RangeBar({
  preset, setPreset, cf, setCf, ct, setCt, right,
}: {
  preset: string; setPreset: (v: string) => void;
  cf: string; setCf: (v: string) => void;
  ct: string; setCt: (v: string) => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <div className="-mx-4 w-full overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:px-0">
        <div className="flex w-max gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${preset === p.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={cf} onChange={(e) => setCf(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
          <span className="text-[12px] text-hint">to</span>
          <input type="date" value={ct} onChange={(e) => setCt(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
        </div>
      )}
      {right && <div className="flex flex-1 flex-wrap items-center justify-end gap-2">{right}</div>}
    </div>
  );
}
