/** Minimal, dependency-free CSV parser. Handles quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/^\uFEFF/, ""); // strip BOM
  const out: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i], next = clean[i + 1];
    if (inQ) {
      if (c === '"' && next === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else if (c === "\r") { /* skip */ }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  const nonEmpty = out.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { headers, rows };
}

/** Find the header that best matches any of the given candidate names. */
export function matchHeader(headers: string[], candidates: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const c of candidates) {
    const t = norm(c);
    const exact = headers.find((h) => norm(h) === t);
    if (exact) return exact;
  }
  for (const c of candidates) {
    const t = norm(c);
    const partial = headers.find((h) => norm(h).includes(t));
    if (partial) return partial;
  }
  return "";
}

export const toNum = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
};
/** Normalise many courier date formats to YYYY-MM-DD. */
export const toDate = (v: unknown) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    let y = m[3]; if (y.length === 2) y = "20" + y;
    // Pakistan writes DD/MM/YYYY, but courier exports sometimes use MM/DD/YYYY.
    // Disambiguate: a value above 12 can only be the day.
    let day: number, mon: number;
    if (a > 12) { day = a; mon = b; }          // clearly DD/MM
    else if (b > 12) { day = b; mon = a; }     // clearly MM/DD
    else { day = a; mon = b; }                 // ambiguous -> assume DD/MM (local convention)
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const p = new Date(s);
  return isNaN(p.getTime()) ? null : p.toISOString().slice(0, 10);
};
