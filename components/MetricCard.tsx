"use client";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import IconChip from "./IconChip";
import { useCountUp } from "@/lib/useCountUp";

// Variables, so .dark can redefine them — see globals.css.
const TINT: Record<string, string> = {
  salmon: "var(--tint-salmon)",
  amber: "var(--tint-amber)",
  lavender: "var(--tint-lavender)",
  periwinkle: "var(--tint-periwinkle)",
  pink: "var(--tint-pink)",
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
  // Parse a value like "Rs 4,182,500" or "7" into prefix + number + suffix so
  // we can count the number up while keeping the currency/units around it.
  const m = value.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  const target = m ? parseFloat(m[2].replace(/,/g, "")) : 0;
  const decimals = m && m[2].includes(".") ? (m[2].split(".")[1]?.length ?? 0) : 0;
  const n = useCountUp(target);
  const display = m
    ? `${m[1]}${n.toLocaleString("en-PK", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${m[3]}`
    : value;
  return (
    <div
      className="rounded-card p-5 shadow-soft transition hover:-translate-y-0.5"
      style={{ background: TINT[accent] ?? TINT.salmon }}
    >
      <div className="flex items-start justify-between">
        <IconChip Icon={Icon} />
        <ArrowUpRight size={18} style={{ color: "var(--tint-ink)", opacity: 0.4 }} />
      </div>
      <p className="mt-4 text-[13px] font-medium" style={{ color: "var(--tint-ink)", opacity: 0.7 }}>{label}</p>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-2xl font-extrabold tnum" style={{ color: "var(--tint-ink)" }}>{display}</span>
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
