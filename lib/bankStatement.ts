/* BANK STATEMENT LOGIC.
 *
 * WHY THIS IS A LIBRARY AND NOT PART OF THE SCREEN
 *   Everything in here decides what a statement line IS — whether two lines are
 *   the same payment, which learned rule names it, what the running balance is.
 *   Those are money answers, and a money answer that can only be read by
 *   scrolling past three hundred lines of JSX is a money answer nobody checks.
 *   The screen in app/retail/bank/page.tsx does layout; this file does the
 *   thinking, and every rule below carries the reason it exists.
 *
 * PORTED FROM the old single-file app (bsDedupe, bsGenericRef, bsClean, bsHay,
 * bsRuleHit, bsPattern, bsGroupPat, bsRun, bsOpening, bsSortDay, bsGuessAcct).
 * Where a rule looks odd, it is odd because a real statement made it so.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/* ── small shared bits ───────────────────────────────────────────────────── */

const toNum = (v: unknown) => Number(v) || 0;

/** Collapse every run of whitespace to one space and trim. Statement narrations
 *  arrive with column padding baked in; two lines that differ only by spacing
 *  are the same line, and comparing them raw says they are not. */
export const bsClean = (s: unknown) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ── types ───────────────────────────────────────────────────────────────── */

export type Dir = "credit" | "debit";

/** Everything the logic below needs off a statement line. Deliberately loose:
 *  the same functions run over a row read from a CSV and over a row read back
 *  out of the database, and those two shapes are not identical. */
export type TxnLike = {
  id?: number;
  account_id?: number | null;
  bank?: string | null;
  txn_date?: string | null;
  txn_time?: string | null;
  direction?: string | null;
  amount?: unknown;
  balance?: unknown;
  descr?: string | null;
  ref_no?: string | null;
  ref?: string | null;
  counterparty?: string | null;
  suggest?: string | null;
  needs_ref?: boolean | null;
  branch_id?: number | null;
  category?: string | null;
};

export type RefRule = {
  id?: number;
  account_id?: number | null;
  bank?: string | null;
  direction?: string | null;
  match_type?: string | null;
  pattern: string;
  ref: string;
  branch_id?: number | null;
  category?: string | null;
  priority?: number | null;
  hits?: number | null;
  active?: boolean | null;
};

export type BankAccount = {
  id: number;
  bank: string;
  label: string;
  account_no?: string | null;
  opening_balance?: unknown;
  opening_date?: string | null;
  active?: boolean | null;
  sort?: number | null;
  branch_id?: number | null;
};

/** One line as read out of a dropped file, before it is written anywhere. */
export type ParsedTxn = {
  txn_date: string;
  txn_time: string;
  direction: Dir;
  amount: number;
  balance: number | null;
  descr: string;
  ref_no: string;
  counterparty: string;
  suggest: string;
};

export type ParsedFile = {
  name: string;
  hash: string;
  bank: string;
  account: string;
  rows: ParsedTxn[];
};

/* ── 1. DEDUPLICATION ─────────────────────────────────────────────────────
 *
 * retail_bank_txns.dedupe_key is NOT NULL and (account_id, dedupe_key) is
 * UNIQUE, which is the only thing that makes re-uploading a statement safe.
 * The key is built in four tiers, most trustworthy identifier first, because
 * the bank does not give every line the same quality of identity:
 *
 *   1. The TRANS ID the bank embedded in the narration or reference. If it is
 *      there it IS the payment, whatever else on the line changes between two
 *      exports of the same month.
 *   2. Failing that, a reference number that actually identifies something —
 *      see bsGenericRef for the ones that do not.
 *   3. Failing that, date + direction + amount + the running balance. The
 *      balance is what separates two same-amount payments on one day, since
 *      they cannot both leave the account at the same balance.
 *   4. Failing even that, date + direction + amount + a truncated narration.
 *
 * Then the "#2", "#3" suffix loop. Two genuinely identical payments on one day
 * DO happen — the same customer paying the same amount twice — and collapsing
 * them loses real money off the statement. The loop gives the second one its
 * own key so both survive, while a re-upload of the same file walks the same
 * sequence in the same order and lands on the same keys, so nothing doubles.
 */
export function bsGenericRef(n: string): boolean {
  return (
    !n ||
    n.length < 6 ||
    /^PK\d{2}[A-Z]{4}/i.test(n) ||   // an IBAN, i.e. the account, not the payment
    /^FT[\s-]/i.test(n) ||           // Alfalah's per-batch funds-transfer stamp
    /^fund/i.test(n) ||
    /^AC-/i.test(n) ||
    /^year/i.test(n) ||
    /^\d+$/.test(n)                  // a bare serial that restarts every statement
  );
}

export function bsDedupe(r: TxnLike, seen?: Record<string, number>): string {
  const cents = Math.round(toNum(r.amount) * 100);
  const bal = toNum(r.balance);
  const ref = bsClean(r.ref_no);
  const m = (bsClean(r.descr) + " " + ref).match(/TRANS\.?\s*ID[:\s]*([A-Za-z0-9]{6,})/i);

  let k: string;
  if (m) k = m[1].toUpperCase() + "|" + r.direction + "|" + cents;
  else if (!bsGenericRef(ref)) k = ref.toUpperCase() + "|" + r.direction + "|" + cents;
  else if (bal > 0) k = [r.txn_date, r.direction, cents, Math.round(bal * 100)].join("|");
  else k = [r.txn_date, r.direction, cents, bsClean(r.descr).slice(0, 60).toLowerCase()].join("|");

  if (!seen) return k;
  let out = k, i = 1;
  while (seen[out]) { i++; out = k + "#" + i; }
  seen[out] = 1;
  return out;
}

/* ── 2. RULE MATCHING ─────────────────────────────────────────────────────
 *
 * The haystack is the narration AND the reference AND the counterparty. Half
 * the useful patterns — a masked IBAN, a merchant id — live in the reference
 * and not in the narration, so matching on the narration alone quietly never
 * fires those rules.
 *
 * The account / bank / direction guards are the safety rail. A rule written for
 * money going OUT that fires on a credit is a wrong attribution of money, and
 * the wrongness is invisible: the line ends up named, so nobody looks at it
 * again. A rule scoped to one account must not reach into another.
 *
 * Order is priority first, then pattern LENGTH DESCENDING. "K-ELECTRIC BILL"
 * and "BILL" are both rules; the longer one is the more specific one and has to
 * win, otherwise every specific rule anyone writes is dead the moment a short
 * generic one exists.
 */
export const bsHay = (r: TxnLike) =>
  /* Joined with a SINGLE space and no empty parts. The old app concatenated the
     three unconditionally, so a line with no reference and no counterparty
     ended up as "acme  " — which no `exact` rule could ever equal, and which
     broke any `contains` pattern spanning two of the three fields. */
  [bsClean(r.descr), bsClean(r.ref_no), bsClean(r.counterparty)].filter(Boolean).join(" ").toLowerCase();

export function bsRuleHit(r: TxnLike, rules: RefRule[]): RefRule | null {
  const hay = bsHay(r);
  const list = (rules || []).slice().sort(
    (a, b) => (toNum(a.priority ?? 100) - toNum(b.priority ?? 100)) ||
              (String(b.pattern).length - String(a.pattern).length)
  );
  for (const ru of list) {
    if (ru.active === false) continue;
    if (ru.account_id && Number(ru.account_id) !== Number(r.account_id)) continue;
    if (ru.bank && ru.bank !== r.bank) continue;
    if (ru.direction && ru.direction !== r.direction) continue;
    const p = String(ru.pattern || "").toLowerCase();
    if (!p) continue;
    let ok = false;
    if (ru.match_type === "exact") ok = hay === p;
    else if (ru.match_type === "regex") {
      try { ok = new RegExp(ru.pattern, "i").test(hay); } catch { ok = false; }
    } else ok = hay.indexOf(p) >= 0;
    if (ok) return ru;
  }
  return null;
}

/* ── 3. RULE CREATION ─────────────────────────────────────────────────────
 *
 * What to remember about a line, in order of how well it survives next month:
 *
 *   1. A masked account or IBAN token (PK12ABCDXXX1234, XXXX5840). It is the
 *      other party's account and it does not change.
 *   2. The counterparty name, when the bank gave one and it is a sane length.
 *      Under 4 characters matches everything; over 48 is a whole narration
 *      wearing a name badge and will never match again.
 *   3. The longest word of six characters or more. Long words are names; short
 *      ones are "PAYMENT", "TRANSFER", "ONLINE".
 *   4. Only as a last resort, the first 24 characters of the narration.
 *
 * The old screen went straight to 4 on every single naming, with no guard, and
 * that is how the rules table fills with over-broad patterns that then mis-name
 * every future import.
 */
export function bsPattern(r: TxnLike): string {
  const id = bsClean(r.descr).match(/PK\d{2}[A-Za-z]{4}[Xx]{3}\d{3,6}|[Xx]{4}\d{3,4}/);
  if (id) return id[0];
  const cp = bsClean(r.counterparty);
  if (cp && cp.length >= 4 && cp.length <= 48) return cp;
  const toks = bsClean(r.descr).split(/[^A-Za-z0-9]+/).filter((t) => t.length >= 6 && !/^\d{1,2}$/.test(t));
  toks.sort((a, b) => b.length - a.length);
  return toks[0] || bsClean(r.descr).slice(0, 24);
}

/** The pattern for a whole group of lines that share a counterparty, with the
 *  check that stops a dangerous rule being written at all.
 *
 *  A masked-account token is preferred, but only if EVERY row in the group
 *  carries it — a token that appears on three of five rows would name the other
 *  two wrongly.
 *
 *  Then the safety check: if this party's name is a substring of another
 *  party's name ("AHMED" inside "AHMED TEXTILES"), a contains-rule on it would
 *  swallow the other party's lines forever. In that case write NO rule. An
 *  unnamed line is work; a confidently wrong name is a wrong ledger.
 */
export function bsGroupPat(name: string, rows: TxnLike[], allParties: string[]): string | null {
  const cand = bsClean(rows[0]?.descr).match(/PK\d{2}[A-Za-z]{4}[Xx]{3}\d{3,6}|[Xx]{4}\d{3,4}/g) || [];
  for (const c of cand) {
    if (rows.every((r) => bsClean(r.descr).indexOf(c) >= 0)) return c;
  }
  const low = String(name).toLowerCase();
  return allParties.some((p) => p !== low && p.indexOf(low) >= 0) ? null : name;
}

/* ── 4. RUNNING BALANCE ───────────────────────────────────────────────────
 *
 * The opening figure is the last balance the bank itself printed before this
 * day — not a number we computed, and not the account's opening balance unless
 * there is genuinely nothing before it. Recomputing from the account opening
 * every time compounds every rounding and every missing line.
 */
export async function bsOpening(
  db: SupabaseClient, accountId: number, day: string, fallback: unknown
): Promise<number> {
  const { data } = await db.from("retail_bank_txns")
    .select("balance").eq("account_id", accountId).lt("txn_date", day)
    .not("balance", "is", null)
    .order("txn_date", { ascending: false }).order("id", { ascending: false }).limit(1);
  const rows = (data as { balance: unknown }[] | null) ?? [];
  if (rows[0] && rows[0].balance != null) return toNum(rows[0].balance);
  return toNum(fallback);
}

/** Walk the day adding credits and subtracting debits — but whenever the
 *  statement printed its own balance on a line, that figure wins. The bank is
 *  the authority on its own balance; our arithmetic is only there to fill the
 *  lines where the bank left the column empty. */
export function bsRun<T extends TxnLike>(rows: T[], opening: number): { lines: { row: T; run: number }[]; closing: number } {
  let run = toNum(opening);
  const lines = rows.map((r) => {
    run = String(r.direction) === "credit" ? run + toNum(r.amount) : run - toNum(r.amount);
    if (r.balance != null) run = toNum(r.balance);
    return { row: r, run };
  });
  return { lines, closing: run };
}

/** Put one day's lines in the order they actually happened.
 *
 *  Time is the obvious answer and is often blank. When every line carries a
 *  balance the real order can be recovered exactly: each line's balance is the
 *  next line's starting point, so the lines chain. If exactly one line has a
 *  starting balance that is nobody's closing balance, that is the first line of
 *  the day and the rest follow from it. Any ambiguity and we fall back to time,
 *  because a guessed order on a balance column is worse than no order. */
export function bsSortDay<T extends TxnLike>(rows: T[]): T[] {
  const byTime = rows.slice().sort(
    (a, b) => String(a.txn_time || "").localeCompare(String(b.txn_time || "")) || toNum(a.id) - toNum(b.id)
  );
  if (rows.length < 2 || !rows.every((r) => r.balance != null)) return byTime;
  const K = (n: unknown) => Math.round(toNum(n) * 100);
  const sig = (r: T) => (String(r.direction) === "credit" ? toNum(r.amount) : -toNum(r.amount));
  const prevOf = (r: T) => K(toNum(r.balance) - sig(r));

  const bal: Record<number, 1> = {};
  rows.forEach((r) => { bal[K(r.balance)] = 1; });
  const heads = rows.filter((r) => !bal[prevOf(r)]);
  if (heads.length !== 1) return byTime;

  const idx: Record<number, T[]> = {};
  rows.forEach((r) => { (idx[prevOf(r)] = idx[prevOf(r)] ?? []).push(r); });
  const out: T[] = [];
  const used: Record<number, 1> = {};
  let cur: T | null = heads[0];
  while (cur && !used[toNum(cur.id)]) {
    out.push(cur); used[toNum(cur.id)] = 1;
    const nxt: T[] = (idx[K(cur.balance)] ?? []).filter((x) => !used[toNum(x.id)]);
    cur = nxt.length === 1 ? nxt[0] : null;
  }
  return out.length === rows.length ? out : byTime;
}

/* ── 5. REPEAT PARTIES ────────────────────────────────────────────────────
 *
 * Forty unnamed lines are rarely forty decisions. They are usually six parties
 * paying repeatedly, and naming them one row at a time is why the queue never
 * gets shorter. Group on the cleaned counterparty, and a party with two or more
 * lines becomes one decision that names all of them.
 */
export type PartyGroup<T extends TxnLike = TxnLike> = { name: string; rows: T[]; inA: number; outA: number };

export function bsGroupParties<T extends TxnLike>(rows: T[]): { groups: PartyGroup<T>[]; singles: T[] } {
  const gm: Record<string, PartyGroup<T>> = {};
  rows.forEach((r) => {
    const k = bsClean(r.counterparty).toLowerCase();
    if (k.length < 3) return;   // "AB" is not a party, it is noise
    const g = (gm[k] = gm[k] ?? { name: bsClean(r.counterparty), rows: [], inA: 0, outA: 0 });
    g.rows.push(r);
    if (String(r.direction) === "credit") g.inA += toNum(r.amount); else g.outA += toNum(r.amount);
  });
  const groups = Object.values(gm)
    .filter((g) => g.rows.length >= 2)
    .sort((a, b) => (b.rows.length - a.rows.length) || ((b.inA + b.outA) - (a.inA + a.outA)));
  const inG = new Set<number>();
  groups.forEach((g) => g.rows.forEach((r) => inG.add(Number(r.id))));
  const singles = rows.filter((r) => !inG.has(Number(r.id)));
  return { groups, singles };
}

/** Every cleaned party name in the queue, lower-cased — the list bsGroupPat
 *  checks a candidate against before it agrees to write a rule. */
export const bsAllParties = (rows: TxnLike[]) =>
  rows.map((r) => bsClean(r.counterparty).toLowerCase()).filter(Boolean);

/* ── 6. ACCOUNTS ─────────────────────────────────────────────────────────── */

export const bsAcctLabel = (a?: BankAccount | null) =>
  a ? a.label + (a.account_no ? " ···" + a.account_no : "") : "—";

/** Which account a dropped file belongs to. Account digits found in the file
 *  first, because those are the file saying so; then the bank name; then the
 *  file name; and only then the first account on the list, which is a guess the
 *  operator is shown and can change before anything is saved. */
export function bsGuessAcct(f: { account?: string; bank?: string; name?: string }, accounts: BankAccount[], hint?: number | null): number | null {
  if (hint) return Number(hint);
  const an = bsClean(f.account).replace(/\D/g, "");
  if (an) {
    const hit = accounts.find((a) => a.account_no && an.indexOf(String(a.account_no).replace(/\D/g, "")) >= 0);
    if (hit) return hit.id;
  }
  const bk = bsClean(f.bank).toLowerCase();
  if (bk) {
    const hit = accounts.find((a) => bk.indexOf(String(a.bank).toLowerCase()) >= 0 || String(a.bank).toLowerCase().indexOf(bk) >= 0);
    if (hit) return hit.id;
  }
  const nm = bsClean(f.name).toLowerCase();
  const hit2 = accounts.find((a) => nm.indexOf(String(a.bank).toLowerCase()) >= 0 || nm.indexOf(String(a.label).toLowerCase()) >= 0);
  return hit2 ? hit2.id : (accounts[0] ? accounts[0].id : null);
}

/* ── 7. FILE IDENTITY ────────────────────────────────────────────────────
 *
 * The hash is checked against retail_stmt_files BEFORE anything is parsed, so
 * the same statement cannot be loaded twice even by somebody who does not
 * remember loading it. crypto.subtle needs a secure origin; when it is missing
 * the fallback still identifies the file well enough to catch the honest
 * mistake, and the unique index on (account_id, dedupe_key) catches the rest.
 */
export async function sha256File(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const d = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "f:" + (file.name || "file") + "|" + file.size + "|" + (file.lastModified || 0);
  }
}

/* ── 8. CSV PARSING ──────────────────────────────────────────────────────── */

/** Dependency-free CSV split. Handles quotes, escaped quotes and CRLF. */
export function parseCSV(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) {
      if (ch === '"') { if (clean[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch === "\r") { /* skip */ }
    else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const MO: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Every date shape a Pakistani bank export has been seen to use, resolved to
 *  YYYY-MM-DD. Day-first, because that is what the banks here write. */
export function matchDate(s: unknown): string | null {
  const str = String(s ?? "");
  let m = str.match(/\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = str.match(/\b(\d{1,2})[/\-.\s]([A-Za-z]{3,9}|\d{1,2})[/\-.\s](\d{2,4})\b/);
  if (m) {
    const dd = +m[1];
    const mo = /^\d+$/.test(m[2]) ? +m[2] : MO[m[2].slice(0, 3).toLowerCase()];
    let yy = +m[3];
    if (yy < 100) yy += 2000;
    if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) return `${yy}-${pad2(mo)}-${pad2(dd)}`;
  }
  return null;
}

const money = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[()]/g, "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
};

const findCol = (hdr: string[], ...names: string[]) =>
  hdr.findIndex((h) => names.some((n) => h.includes(n)));

/** Read a whole bank statement CSV.
 *
 *  The header row is found rather than assumed, because every bank puts three
 *  to eight lines of account preamble above it — and that preamble is where the
 *  account number and the bank name are, which is what bsGuessAcct needs.
 *
 *  Direction comes from whichever the file offers: separate debit/credit
 *  columns, an explicit Dr/Cr column, or the sign of a single amount column.
 *  Guessing wrong here is a wrong sign on real money, so a row whose direction
 *  cannot be established from any of those is left as a credit only when the
 *  amount is positive, and dropped when it is not readable at all.
 */
export function parseStatementCSV(text: string, fileName = ""): { bank: string; account: string; rows: ParsedTxn[] } {
  const grid = parseCSV(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!grid.length) return { bank: "", account: "", rows: [] };

  let hi = -1, hdr: string[] = [];
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const low = grid[i].map((c) => String(c).toLowerCase().trim());
    const hasDate = low.some((h) => h.includes("date"));
    const hasMoney = low.some((h) => /amount|debit|credit|withdraw|deposit|dr\b|cr\b/.test(h));
    if (hasDate && hasMoney) { hi = i; hdr = low; break; }
  }
  /* The preamble above the header is where the account identity lives. */
  const preamble = grid.slice(0, hi < 0 ? Math.min(grid.length, 12) : hi).map((r) => r.join(" ")).join(" ");
  const accM = (preamble + " " + fileName).match(/\b\d{4,}[-\d]*\b/);
  const bankM = (preamble + " " + fileName).toLowerCase().match(/alfalah|meezan|jazzcash|habib|hbl|ubl|askari|faysal|bank\s*al\s*habib/);
  const bank = bankM ? bankM[0] : "";
  const account = accM ? accM[0] : "";
  if (hi < 0) return { bank, account, rows: [] };

  const di = findCol(hdr, "value date", "txn date", "transaction date", "date");
  const ti = findCol(hdr, "time");
  const ni = findCol(hdr, "narration", "particular", "description", "details", "remarks", "descr");
  const ri = findCol(hdr, "trans id", "transaction id", "reference", "ref no", "ref_no", "cheque", "instrument", "ref");
  const cpi = findCol(hdr, "counterparty", "beneficiary", "payer", "payee", "party", "sender", "title");
  const dbi = findCol(hdr, "debit", "withdraw", "paid out", "dr amount");
  const cri = findCol(hdr, "credit", "deposit", "paid in", "cr amount");
  const ai = findCol(hdr, "amount");
  const bi = findCol(hdr, "balance");
  const dri = findCol(hdr, "direction", "dr/cr", "cr/dr", "type");

  const rows: ParsedTxn[] = [];
  for (let i = hi + 1; i < grid.length; i++) {
    const c = grid[i];
    const joined = c.join(" ");
    const date = matchDate(di >= 0 ? c[di] : joined) ?? matchDate(joined);
    if (!date) continue;                                    // totals, footers, page breaks

    const dbAmt = dbi >= 0 ? Math.abs(money(c[dbi])) : 0;
    const crAmt = cri >= 0 ? Math.abs(money(c[cri])) : 0;
    const raw = ai >= 0 ? money(c[ai]) : 0;
    const drTxt = dri >= 0 ? String(c[dri] ?? "").toLowerCase() : "";

    let direction: Dir;
    let amount: number;
    if (dbAmt > 0 && crAmt <= 0) { direction = "debit"; amount = dbAmt; }
    else if (crAmt > 0 && dbAmt <= 0) { direction = "credit"; amount = crAmt; }
    else if (drTxt) { direction = /deb|^dr|withdraw|out/.test(drTxt) ? "debit" : "credit"; amount = Math.abs(raw) || dbAmt || crAmt; }
    else { direction = raw < 0 ? "debit" : "credit"; amount = Math.abs(raw); }
    if (!(amount > 0)) continue;

    const balRaw = bi >= 0 ? money(c[bi]) : 0;
    rows.push({
      txn_date: date,
      txn_time: ti >= 0 ? bsClean(c[ti]) : "",
      direction,
      amount,
      balance: bi >= 0 && String(c[bi] ?? "").trim() !== "" && balRaw !== 0 ? balRaw : null,
      descr: ni >= 0 ? bsClean(c[ni]) : bsClean(joined),
      ref_no: ri >= 0 ? bsClean(c[ri]) : "",
      counterparty: cpi >= 0 ? bsClean(c[cpi]) : "",
      suggest: "",
    });
  }
  return { bank, account, rows };
}

/* ── 9. WHAT IS AND IS NOT SHOP MONEY ─────────────────────────────────────
 *
 * The pooled Alfalah account carries the owner's personal movement alongside
 * the business's. Flagged, never hidden: a line you cannot see is a line you
 * cannot correct, and hiding it is also how a personal transfer quietly ends up
 * in a shop's takings.
 */
export const PERSONAL = /raast\s*p2p|premier\s*payfast|raast\s*onus/i;
export const SHOP_MONEY = /merchant\s*payment|ibft/i;
