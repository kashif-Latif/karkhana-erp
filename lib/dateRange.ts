export const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "5d", label: "5 days" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "60d", label: "60 days" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Returns [from, to] as YYYY-MM-DD, or [null, null] for "all time". */
export function rangeDates(preset: string, cf?: string, ct?: string): [string | null, string | null] {
  const t = new Date();
  const s = new Date(t);
  if (preset === "today") return [iso(t), iso(t)];
  if (preset === "yesterday") { s.setDate(t.getDate() - 1); return [iso(s), iso(s)]; }
  if (preset === "7d") { s.setDate(t.getDate() - 6); return [iso(s), iso(t)]; }
  if (preset === "5d")  { s.setDate(t.getDate() - 4);  return [iso(s), iso(t)]; }
  if (preset === "30d") { s.setDate(t.getDate() - 29); return [iso(s), iso(t)]; }
  if (preset === "60d") { s.setDate(t.getDate() - 59); return [iso(s), iso(t)]; }
  if (preset === "month") return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
  if (preset === "custom") return [cf || null, ct || null];
  return [null, null]; // all
}

export const num = (v: unknown) => Number(v) || 0;
export const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-PK");
