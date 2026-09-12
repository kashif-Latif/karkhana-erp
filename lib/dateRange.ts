/* THE DEFAULT SET. Unchanged — every screen that was using it keeps exactly
   the ranges it had. Orders, shipments, retail sales and the cashbook all move
   daily, so Today and Yesterday mean something there. */
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

/* FOR MONEY SCREENS ONLY, and passed in explicitly by the page that wants it.
   A courier settles on a cycle of days or weeks, so "yesterday" on a payments
   screen is almost always empty and reads as though the money has vanished.
   A receivable is judged over months.

   Kept separate rather than swapped in, because changing a shared list to suit
   one page changes every other page that never asked. */
export const MONEY_PRESETS = [
  { key: "60d", label: "2 months" },
  { key: "90d", label: "3 months" },
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
  if (preset === "90d")  { s.setDate(t.getDate() - 89);  return [iso(s), iso(t)]; }
  if (preset === "180d") { s.setDate(t.getDate() - 179); return [iso(s), iso(t)]; }
  if (preset === "month") return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
  if (preset === "custom") return [cf || null, ct || null];
  return [null, null]; // all
}

export const num = (v: unknown) => Number(v) || 0;
export const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-PK");
