"use client";
import { Boxes, FileText, ArrowRight, Flame } from "lucide-react";
import IconChip from "./IconChip";
import { materials, approvals } from "@/lib/sampleData";

const DOT: Record<string, string> = {
  salmon: "#E1876B",
  amber: "#E4B47E",
  lavender: "#B693DD",
  periwinkle: "#7FA3DC",
  pink: "#E07FBE",
};
const TILE: Record<string, string> = {
  salmon: "#F5D9CE",
  amber: "#F7EAD3",
  lavender: "#ECE1F6",
  periwinkle: "#DCE7F5",
  pink: "#F8DCEE",
};

export function StockPanel() {
  return (
    <div className="rounded-card bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center gap-3">
        <IconChip Icon={Boxes} size={32} />
        <h3 className="text-[15px] font-bold">Raw-Material Stock</h3>
      </div>
      <div className="space-y-3.5">
        {materials.map((m) => (
          <div key={m.name} className="flex items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: DOT[m.accent] }}
            />
            <span className="w-32 shrink-0 text-[13.5px] font-medium text-ink">{m.name}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full"
                style={{ width: `${m.pct}%`, background: DOT[m.accent] }}
              />
            </div>
            <span className="w-28 shrink-0 text-right text-[12.5px] tnum text-muted">
              {m.qty}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApprovalsPanel() {
  return (
    <div className="rounded-card bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IconChip Icon={FileText} size={32} />
          <h3 className="text-[15px] font-bold">Pending Approvals</h3>
        </div>
        <button className="flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-ink">
          View all <ArrowRight size={14} />
        </button>
      </div>
      <div className="space-y-2.5">
        {approvals.map((a) => (
          <div
            key={a.no}
            className="flex items-center gap-3 rounded-xl2 p-3"
            style={{ background: TILE[a.accent] }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-ink">
              {a.urgent ? (
                <Flame size={15} className="text-salmon-strong" />
              ) : (
                <FileText size={15} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold text-ink">{a.no}</div>
              <div className="truncate text-[11.5px] text-ink/70">{a.who}</div>
            </div>
            <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-[10.5px] font-semibold text-ink/80">
              {a.tag}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
