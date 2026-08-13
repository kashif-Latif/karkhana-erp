"use client";
import Topbar from "@/components/Topbar";
import { Scissors, Shirt, Shrink, Flame, ShieldCheck, ChevronRight } from "lucide-react";

// The five departments (seeded in the database). Per-department production
// figures — pieces received / completed / accepted / rejected / rework — are
// built in Phase 4.
const DEPTS = [
  { name: "Cutting", Icon: Scissors, accent: "amber", desc: "Fabric issue → spreading → cutting → cut pieces + wastage" },
  { name: "Stitching", Icon: Shirt, accent: "lavender", desc: "Overlock · flatlock · zip attach — thread & zip consumed" },
  { name: "Clipping / Trimming", Icon: Shrink, accent: "periwinkle", desc: "Trimming, accepted / rejected / rework" },
  { name: "Iron / Pressing", Icon: Flame, accent: "pink", desc: "Pressing, accepted / rejected / rework" },
  { name: "QA/QC & Packing", Icon: ShieldCheck, accent: "salmon", desc: "Inspect → pass/fail → pack (sticker + shopper consumed)" },
] as const;

const DOT: Record<string, string> = {
  amber: "#E4B47E", lavender: "#B693DD", periwinkle: "#7FA3DC", pink: "#E07FBE", salmon: "#E1876B",
};

export default function Production() {
  return (
    <>
      <Topbar title="Production" subtitle="The five-stage workflow" />
      <div className="px-6 pb-10">
        <div className="space-y-3">
          {DEPTS.map((d, i) => (
            <div
              key={d.name}
              className="flex items-center gap-4 rounded-card bg-surface p-4 shadow-soft"
            >
              <span className="w-6 text-center text-[13px] font-bold text-ink/30">{i + 1}</span>
              <span
                className="flex h-11 w-11 items-center justify-center rounded-full text-white"
                style={{ background: DOT[d.accent] }}
              >
                <d.Icon size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-ink">{d.name}</h3>
                <p className="text-[12.5px] text-muted">{d.desc}</p>
              </div>
              <span className="hidden shrink-0 rounded-full bg-panel px-3 py-1 text-[11.5px] font-semibold text-muted sm:inline">
                Figures in Phase 4
              </span>
              <ChevronRight size={18} className="text-ink/30" />
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[12.5px] text-muted">
          Each department will track pieces received, completed, accepted, rejected, and rework —
          all linked to the Production Order and the employee who did the work.
        </p>
      </div>
    </>
  );
}
