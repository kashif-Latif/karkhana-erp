"use client";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import IconChip from "./IconChip";

const TINT: Record<string, string> = {
  salmon: "#F5D9CE",
  amber: "#F7EAD3",
  lavender: "#ECE1F6",
  periwinkle: "#DCE7F5",
  pink: "#F8DCEE",
};

export default function MetricCard({
  label,
  value,
  delta,
  up = true,
  accent = "salmon",
  Icon,
}: {
  label: string;
  value: string;
  delta?: string;
  up?: boolean;
  accent?: string;
  Icon: LucideIcon;
}) {
  return (
    <div
      className="rounded-card p-5 shadow-soft transition hover:-translate-y-0.5"
      style={{ background: TINT[accent] ?? TINT.salmon }}
    >
      <div className="flex items-start justify-between">
        <IconChip Icon={Icon} />
        <ArrowUpRight size={18} className="text-ink/40" />
      </div>
      <p className="mt-4 text-[13px] font-medium text-ink/70">{label}</p>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-2xl font-extrabold tnum text-ink">{value}</span>
        {delta && (
          <span
            className="mb-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: up ? "rgba(20,16,12,0.06)" : "rgba(229,120,107,0.18)",
              color: up ? "#166534" : "#B4231F",
            }}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
