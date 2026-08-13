import type { LucideIcon } from "lucide-react";

export default function IconChip({
  Icon,
  size = 36,
  tone = "ink",
}: {
  Icon: LucideIcon;
  size?: number;
  tone?: "ink" | "light";
}) {
  const bg = tone === "ink" ? "#141414" : "#FFFFFF";
  const fg = tone === "ink" ? "#FFFFFF" : "#141414";
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shadow-soft"
      style={{ width: size, height: size, background: bg, color: fg }}
    >
      <Icon size={size * 0.5} strokeWidth={2} />
    </span>
  );
}
