/* NimbusRMS export parsing — ported verbatim from the Grohub single-file app.
 *
 * WHY THIS IS A SEPARATE FILE AND WHY IT COPIES RATHER THAN IMPROVES
 *   Every rule in here was learned from a real file that broke something. The
 *   temptation with a CSV importer is to write a tolerant one — fuzzy header
 *   matching, best-effort dates, "looks like a card payment". That is exactly
 *   what produces a silent 3% error in a sales figure nobody can trace.
 *
 *   So this matches the original byte for byte where it matters: the same
 *   column names, the same date format, the same MOP rules, and above all the
 *   same line_hash, because a hash that differs from the old app's is a hash
 *   that will re-import three years of history as new rows.
 */

/* ── dates ────────────────────────────────────────────────────────────────
 * Nimbus writes 13/Jul/2026. Not ISO, not DD/MM/YYYY — a three-letter month.
 * A generic date parser reads "13/Jul/2026" as invalid and returns null, and a
 * row with no date is a row the import skips, so a tolerant parser here means
 * an import that silently drops every line in the file.
 */
const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Sales export: strict 4-digit year. `13/Jul/2026` → `2026-07-13`. */
export function parseNimbusDate(s: unknown): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/(\d{1,2})\/([A-Za-z]{3})\/(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[2].toUpperCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

/** Expense export: the same shape but the year may be two digits. */
export function parseDMY2(s: unknown): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})/);
  if (!m) return null;
  const mo = MONTHS[m[2].toUpperCase()];
  if (!mo) return null;
  let yr = parseInt(m[3], 10);
  if (yr < 100) yr += 2000;
  return `${yr}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

/* ── csv ─────────────────────────────────────────────────────────────────── */

/** Rows as raw arrays. The sales parser needs positions, not a keyed object. */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) {
      if (ch === '"') { if (clean[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
};
export const normStore = (s: unknown) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/* ── which file is this? ──────────────────────────────────────────────────
 * One drop zone, six file types, told apart by EXACT header names. Exact,
 * not fuzzy: two of these files both carry `Store Name` and `Date`, and a
 * matcher loose enough to be helpful is loose enough to run an expense file
 * through the sales importer.
 */
export type NimbusKind =
  | "sales_multi" | "sales_single"
  | "expense_multi" | "expense_single"
  | "comm_master" | "payments" | "unknown";

export function detectKind(headers: string[]): NimbusKind {
  const has = (h: string) => headers.includes(h);
  if (has("Account") && has("Store Name")) return "expense_multi";
  if (has("Account") && !has("Store Name") && (has("Transaction Date") || has("Amount"))) return "expense_single";
  if (has("Item Code") && has("Commission") && has("Percentage")) return "comm_master";
  if (has("Payment Mode") && has("Store Name")) return "payments";
  if (!has("Store") && has("Item Code") && has("Date") && (has("MOP") || has("Sales Amount"))) return "sales_single";
  if (has("Store")) return "sales_multi";
  return "unknown";
}

export const KIND_LABEL: Record<NimbusKind, string> = {
  sales_multi: "Sales — all stores",
  sales_single: "Sales — single store",
  expense_multi: "Account transactions — all stores",
  expense_single: "Account transactions — single store",
  comm_master: "Commission master",
  payments: "Non-cash payments",
  unknown: "Not a Nimbus export",
};

/* ── sales ────────────────────────────────────────────────────────────────── */

export type SaleRow = {
  _store: string; _ns: string;
  branch_id: number | null;
  sale_date: string; sale_time: string; day: string;
  receipt_no: string; receipt_txn: string; online_order_no: string | null;
  salesperson: string | null; customer: string | null;
  item_code: string | null; item_name: string | null;
  department: string | null; size: string | null; color: string | null;
  retail_price: number; quantity: number; sales: number; discount: number;
  cust_discount: number; mkt_discount: number; adj_discount: number;
  net_sales: number; tax: number; sales_amount: number;
  cost_price: number; gross_margin: number;
  mop_raw: string | null; payment_method: string; serial_no: string | null;
  source: "nimbus";
};

/* MOP -> payment_method, exactly as the old app decides it.
 *
 * READ THIS BEFORE "IMPROVING" IT: a Nimbus sales export knows about cash,
 * credit, other and online. It does NOT know card from JazzCash — both arrive
 * as "Other Payment" and are resolved later by the separate Non-cash payments
 * file, matched on store + date + exact time. So a sales row can never map to
 * meezan_card or jazzcash here, and code that tries will mislabel every one of
 * them.
 *
 * `credit` is udhaar — goods on account — not a credit card. Counting it as
 * card is what made FC DHA's 1 Sep card figure read 36,100 instead of 33,400.
 */
export function mapSalesMop(mop: string, onlineOrderNo: string): string {
  if (/credit/i.test(mop)) return "credit";
  if (/other/i.test(mop)) return "unclassified";
  if (/cash/i.test(mop)) return "cash";
  if (onlineOrderNo) return "online";
  return "unclassified";
}

/** `RCP-88(10423)` → `10423`. Falls back to the whole string. */
export function receiptTxn(receipt: string): string {
  const m = receipt.match(/\((\d+)\)/);
  return m ? m[1] : receipt;
}

/* THE NUMERIC BLOCK IS POSITIONAL, ANCHORED ON THE MOP CELL.
 *
 * Not read by header name, on purpose. An item name containing a comma inside
 * an unquoted field shifts every column after it, and a header-indexed read
 * then takes "quantity" from whatever landed in that slot — silently, with a
 * plausible number. Anchoring on the LAST cell that looks like a payment mode
 * and counting backwards survives that, because the shift happens to the left
 * of the anchor and the offsets are measured from the right.
 *
 * Offsets are the original's, unchanged. Note sales_amount and net_sales are
 * deliberately the same cell (mi-5) — that is what the old app stores.
 */
const MOP_CELL = /^(cash|credit|other payment|online)/i;

export function parseSalesRows(rows: string[][], forceBranchId: number | null,
  resolveBranch: (ns: string) => number | null): { parsed: SaleRow[]; unknownStores: Set<string> } {
  const hdr = rows[0].map((h) => h.trim());
  const idx: Record<string, number> = {};
  hdr.forEach((h, i) => { idx[h] = i; });
  const get = (r: string[], name: string) => { const i = idx[name]; return i == null ? "" : (r[i] ?? ""); };

  const parsed: SaleRow[] = [];
  const unknownStores = new Set<string>();

  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const itemCode = (get(r, "Item Code") || "").trim();
    if (/^total/i.test(itemCode)) continue;          // footer row
    if (!r.join("").trim()) continue;                // blank row

    const store = (get(r, "Store") || "").trim();
    if (forceBranchId == null && !store) continue;
    const ns = normStore(store);
    let bid = forceBranchId;
    if (bid == null) {
      bid = resolveBranch(ns);
      if (bid == null) unknownStores.add(store);
    }

    let mi = -1;
    for (let k = r.length - 1; k >= 0; k--) {
      if (MOP_CELL.test(String(r[k] ?? "").trim())) { mi = k; break; }
    }
    if (mi < 0) mi = r.length - 2;
    const nA = (b: number) => num(r[mi - b]);

    const mop = String(r[mi] ?? "").trim();
    const online = (get(r, "Online Order #") || "").trim();
    const receipt = (get(r, "Receipt") || "").trim();
    const sdate = parseNimbusDate(get(r, "Date"));
    if (!sdate) continue;

    parsed.push({
      _store: store, _ns: ns, branch_id: bid,
      sale_date: sdate,
      sale_time: (get(r, "Time") || "").trim(),
      day: (get(r, "Day") || "").trim(),
      receipt_no: receipt, receipt_txn: receiptTxn(receipt),
      online_order_no: online || null,
      salesperson: (get(r, "Salesperson") || "").trim() || null,
      customer: (get(r, "Customer") || "").trim() || null,
      item_code: itemCode || null,
      item_name: (get(r, "Item Name") || "").trim() || null,
      department: (get(r, "Department") || "").trim() || null,
      size: (get(r, "Size") || "").trim() || null,
      color: (get(r, "Color") || "").trim() || null,
      retail_price: nA(12), quantity: nA(11), sales: nA(10), discount: nA(9),
      cust_discount: nA(8), mkt_discount: nA(7), adj_discount: nA(6),
      net_sales: nA(5), tax: nA(4), sales_amount: nA(5),
      cost_price: nA(2), gross_margin: nA(1),
      mop_raw: mop || null,
      payment_method: mapSalesMop(mop, online),
      serial_no: (r[mi + 1] ?? "").trim() || null,
      source: "nimbus",
    });
  }
  return { parsed, unknownStores };
}

/* THE LINE HASH — DO NOT CHANGE THE SHAPE OF THIS STRING.
 *
 * It is a plain joined string, not a digest. That is not laziness: it is what
 * three years of rows in the old database already carry, and the column is
 * unique. Hash the same line differently — reorder a field, swap in SHA-256,
 * use serial_no instead of sale_time — and every migrated row stops matching
 * its own re-import. The file that was a safe no-op yesterday becomes a full
 * duplicate of the history today, and nothing reports an error because from
 * the database's point of view they are new rows.
 *
 * The `|#2`, `|#3` suffix is for genuinely repeated lines on one receipt: two
 * of the same shirt at the same price on the same bill are two real sales, and
 * collapsing them would under-count both the sale and the commission.
 */
export function withLineHashes<T extends { branch_id: number | null; sale_date: string; receipt_txn: string; item_code: string | null; quantity: number; sales_amount: number; sale_time: string }>(
  parsed: T[]
): (T & { line_hash: string })[] {
  const seen: Record<string, number> = {};
  return parsed.map((r) => {
    const base = [r.branch_id, r.sale_date, r.receipt_txn, r.item_code, r.quantity, r.sales_amount, r.sale_time].join("|");
    const n = (seen[base] = (seen[base] || 0) + 1);
    return { ...r, line_hash: n === 1 ? base : base + "|#" + n };
  });
}

/* ── expenses ─────────────────────────────────────────────────────────────── */

export type ExpenseRow = {
  _store: string; _ns: string;
  branch_id: number | null;
  expense_date: string; amount: number;
  txn_type: "expense" | "income";
  category: string; description: string | null;
  paid_via: string; source: "nimbus";
};

/* Category guessing, including the misspellings that actually appear in the
   Comments column. "recived" and "receieved" are in here because they are in
   the data, not because anybody approves of them. */
export function guessCat(desc: string | null): string {
  const d = (desc || "").toLowerCase();
  if (/h\.?\s*o\b|head\s*office|receiv|recived|receieved|farooq|yasir|yaser/.test(d)) return "Head Office";
  if (/sal(a|e)ry|salery/.test(d)) return "Salary";
  if (isAdvance(d)) return "Advance";
  if (/purchas|market|trader|neeker|nikar|baik|stock/.test(d)) return "Purchasing";
  return "Expense";
}

export function isAdvance(desc: string | null): boolean {
  const d = (desc || "").toLowerCase();
  return /\badv/.test(d) || /advanc|advnc|advc\b|adva\b|peshg|paishg|pesh\s*gi/.test(d);
}

export function parseExpenseRows(rows: string[][], forceBranchId: number | null,
  resolveBranch: (ns: string) => number | null): { parsed: ExpenseRow[]; unknown: Set<string>; minD: string | null; maxD: string | null } {
  const hdr = rows[0].map((h) => h.trim());
  const idx: Record<string, number> = {};
  hdr.forEach((h, i) => { idx[h] = i; });
  const get = (r: string[], name: string) => { const i = idx[name]; return i == null ? "" : (r[i] ?? ""); };

  const parsed: ExpenseRow[] = [];
  const unknown = new Set<string>();
  let minD: string | null = null, maxD: string | null = null;

  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const store = (get(r, "Store Name") || "").trim();
    if (forceBranchId == null && !store) continue;

    /* THE SIGN IS THE DIRECTION. Negative is money out, positive is money in.
       The amount is stored absolute with txn_type carrying the sign, because a
       column that is sometimes negative makes every SUM() in the app a
       conditional one. */
    const amt = num(get(r, "Amount"));
    if (amt === 0) continue;

    const dt = parseDMY2(get(r, "Transaction Date"));
    if (!dt) continue;

    const ns = normStore(store);
    let bid = forceBranchId;
    if (bid == null) {
      bid = resolveBranch(ns);
      if (bid == null) unknown.add(store);
    }

    const wallet = (get(r, "Wallet / Card") || "").trim().toLowerCase();
    const pv = /jazz/.test(wallet) ? "jazzcash"
      : /meezan|card/.test(wallet) ? "meezan_card"
      : /bank/.test(wallet) ? "bank" : "cash";

    if (!minD || dt < minD) minD = dt;
    if (!maxD || dt > maxD) maxD = dt;

    const desc = (get(r, "Comments") || "").replace(/\s+/g, " ").trim() || null;
    const acct = (get(r, "Account") || "").trim();
    let cat: string;
    if (amt >= 0) cat = acct || "Misc Income";
    else if (/head\s*office/i.test(acct)) cat = "Head Office";
    else cat = guessCat(desc);

    parsed.push({
      _store: store, _ns: ns, branch_id: bid,
      expense_date: dt, amount: Math.abs(amt),
      txn_type: amt < 0 ? "expense" : "income",
      category: cat, description: desc, paid_via: pv, source: "nimbus",
    });
  }
  return { parsed, unknown, minD, maxD };
}

/* ── non-cash payments ────────────────────────────────────────────────────
 * This file is what turns "Other Payment" into card or JazzCash. It carries no
 * amounts — only store, a combined date+time stamp, and the mode — and is
 * matched against already-imported sale lines on branch + date + EXACT time.
 * So the shop's sales have to be imported first; otherwise there is nothing to
 * tag and the run reports zero.
 */
export type PaymentRow = { ns: string; store: string; date: string; time: string; pm: string; modeRaw: string };

export function parsePaymentRows(rows: string[][]): PaymentRow[] {
  const hdr = rows[0].map((h) => h.trim());
  const idx: Record<string, number> = {};
  hdr.forEach((h, i) => { idx[h] = i; });
  const get = (r: string[], name: string) => { const i = idx[name]; return i == null ? "" : (r[i] ?? ""); };

  const out: PaymentRow[] = [];
  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const store = (get(r, "Store Name") || "").trim();
    const dt = (get(r, "Date") || "").trim();
    if (!store || !dt) continue;
    /* One cell holds "13/Jul/2026 14:32:07" — the date and the time it will be
       matched on. The time must survive exactly; it is the join key. */
    const mm = dt.match(/(\d{1,2}\/[A-Za-z]{3}\/\d{4})\s+(.+)/);
    if (!mm) continue;
    const dISO = parseNimbusDate(mm[1]);
    if (!dISO) continue;
    const modeRaw = (get(r, "Payment Mode") || "").trim();
    /* Any card acquirer — Meezan, Standard Chartered, whoever — goes in the
       card bucket. Only JazzCash is its own thing. */
    const pm = /jazz/i.test(modeRaw) ? "jazzcash" : "meezan_card";
    out.push({ ns: normStore(store), store, date: dISO, time: mm[2].trim(), pm, modeRaw });
  }
  return out;
}

/* ── commission master ────────────────────────────────────────────────────── */

export type CommRow = { item_code: string; item_name: string | null; retail_price: number; commission: number; percentage: number };

export function parseCommRows(rows: string[][]): CommRow[] {
  const hdr = rows[0].map((h) => h.trim());
  const idx: Record<string, number> = {};
  hdr.forEach((h, i) => { idx[h] = i; });
  const get = (r: string[], name: string) => { const i = idx[name]; return i == null ? "" : (r[i] ?? ""); };

  const out: CommRow[] = [];
  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const code = (get(r, "Item Code") || "").trim();
    if (!code || /^total/i.test(code)) continue;
    out.push({
      item_code: code,
      item_name: (get(r, "Item Name") || "").trim() || null,
      retail_price: num(get(r, "Retail Price") || get(r, "Rate")),
      commission: num(get(r, "Commission")),
      percentage: num(get(r, "Percentage")),
    });
  }
  return out;
}
