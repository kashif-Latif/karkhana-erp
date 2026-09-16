"use client";
/* Card reconciliation.
 *
 * THE PROBLEM THIS SCREEN EXISTS FOR
 *   All nine shops' POS terminals settle into ONE pooled Bank Alfalah account,
 *   and the bank credit carries no shop name. So the money arrives as a list of
 *   amounts and the question is always the same: which shop is this one?
 *
 * THE FOUR THINGS THAT MAKE THAT ANSWERABLE
 *
 *   1. THE BANK TAKES ITS CUT FIRST. The till records GROSS; the bank credits
 *      NET of the acquirer's percentage. Comparing one against the other
 *      reports ~1.28% of all card turnover as permanently missing, every day,
 *      forever. Every expected figure on this screen is cardExpected(gross).
 *
 *   2. MATCHING IS AN ASSIGNMENT, NOT A LOOKUP. A day's credits and a day's
 *      shop-expectations are two sets that have to be paired 1:1. Picking the
 *      nearest shop for each credit independently lets two credits claim the
 *      same shop and leaves a third shop with nothing — inventing a Short on
 *      one shop and an Extra on another out of thin air. crMatch below pairs
 *      them globally instead, in three passes of decreasing confidence.
 *
 *   3. THE MONEY LANDS LATER. A sale settles a day or more afterwards, and a
 *      weekend settles together on Monday. Both are settings, because both
 *      change when the bank changes its cycle.
 *
 *   4. THE POOL IS FUNGIBLE. Money in this account has no shop written on it.
 *      Once a shop-day has waited longer than CR_AGE_DAYS, it is settled out of
 *      the credits that did arrive but could not be tied to a shop. Only what
 *      is left when that pool runs dry is a real shortage.
 *
 * WHY DUPLICATES CANNOT HAPPEN
 *   Two unique indexes in the database, not a check in this file: one on the
 *   bank's own transaction reference, and one on (date, amount, ref) for rows
 *   that arrive without one. Re-entering the same credit is a no-op.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Landmark, AlertTriangle, CheckCircle2, Link2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Tabs, Pill, Select, PreviewNote, SourceNote,
  useBranches, money, moneyOrDash, num, text, today, fetchAll,
  CARD_RATE_PCT, cardExpected, crTol, CR_AGE_DAYS,
  type Row, type Col,
} from "@/components/retail/kit";

/* "All time" is deliberately absent. The whole screen is a day-by-day walk
   between two dates; an open-ended range has no last day to settle against. */
const CARD_PRESETS = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "1 month" },
  { key: "60d", label: "2 months" },
  { key: "90d", label: "3 months" },
  { key: "custom", label: "Custom" },
];

type Tab = "days" | "loose" | "payments";
const TABS: { key: Tab; label: string }[] = [
  { key: "days", label: "Every day, every shop" },
  { key: "loose", label: "Not tied to a shop" },
  { key: "payments", label: "Payments on file" },
];

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const addDays = (isoDate: string, n: number) => {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const crDay = (isoDate: string) => {
  const d = new Date(isoDate + "T00:00:00");
  return `${DOW[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]}`;
};
const dDiff = (a: string, b: string) =>
  Math.round((new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) / 86400000);

/* ── the matcher ──────────────────────────────────────────────────────────
 *
 * Both sides of one settlement day: the credits that landed, and the shop-days
 * they are meant to be paying for. Three passes, each less certain than the
 * last, and only the first two are allowed to call themselves confident.
 */
type Credit = {
  id: number; amount: number; ref: string; time: string | null; source: string;
  bid: number | null; sd: string | null; credit_date: string; used: number;
};
type Need = {
  id: number; name: string; sale: number; expected: number; saleDate: string;
  got: number; nc: number; conf: boolean; pooled: number;
};

function crMatch(credits: Credit[], needs: Need[]) {
  const c = credits.length, n = needs.length;
  const assign = new Array<number>(c).fill(-1);
  const sums = new Array<number>(n).fill(0);
  const conf = new Array<boolean>(n).fill(false);
  if (!c || !n) return { assign, sums, conf, unmatched: credits.map((_, i) => i) };

  const usedC = new Array<boolean>(c).fill(false);
  const doneN = new Array<boolean>(n).fill(false);

  /* PASS 1 — global greedy 1:1.
     Every credit/shop pair that is within tolerance, sorted by how close it is,
     taken best-first with BOTH sides marked used. Global, not per-row: the
     closest pair in the whole day wins first, so a credit cannot be spent on a
     shop that a nearer credit was going to fit exactly. */
  const pairs: { k: number; i: number; d: number }[] = [];
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < c; i++) {
      const d = Math.abs(credits[i].amount - needs[k].expected);
      if (d <= crTol(needs[k].expected)) pairs.push({ k, i, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  pairs.forEach((p) => {
    if (usedC[p.i] || doneN[p.k]) return;
    usedC[p.i] = true; doneN[p.k] = true; assign[p.i] = p.k;
    sums[p.k] += credits[p.i].amount; conf[p.k] = true;
  });

  /* PASS 2 — subset sum over two or three unused credits.
     A shop's day genuinely arrives split: two terminals, or a batch that closed
     over midnight. A sum that lands inside the same tolerance is as good an
     identification as a single credit, so it is confident too. Two and three
     only — beyond that the number of combinations that hit any tolerance is
     large enough that a hit stops being evidence of anything. */
  for (let k = 0; k < n; k++) {
    if (doneN[k]) continue;
    const want = needs[k].expected, t = crTol(want);
    const free: number[] = [];
    for (let i = 0; i < c; i++) if (!usedC[i] && credits[i].amount < want + t) free.push(i);
    let found: number[] | null = null;
    for (let a = 0; a < free.length && !found; a++) {
      for (let b = a + 1; b < free.length && !found; b++) {
        const s2 = credits[free[a]].amount + credits[free[b]].amount;
        if (Math.abs(s2 - want) <= t) { found = [free[a], free[b]]; break; }
        for (let d = b + 1; d < free.length; d++) {
          if (Math.abs(s2 + credits[free[d]].amount - want) <= t) { found = [free[a], free[b], free[d]]; break; }
        }
      }
    }
    if (found) {
      doneN[k] = true; conf[k] = true;
      found.forEach((i) => { usedC[i] = true; assign[i] = k; sums[k] += credits[i].amount; });
    }
  }

  /* PASS 3 — largest-first nearest guess, and NOT confident.
     Largest first because a big credit placed wrongly does the most damage, so
     it gets the pick of what is left.

     THE GUARD IS THE POINT. Only guess when the amount is in the same ballpark.
     Forcing a far-off payment onto a shop invents an "Extra" on one shop and a
     "Short" on another out of nothing — two wrong numbers where there was one
     honest unknown. Anything outside the guard stays unassigned and is shown as
     money not yet tied to a shop, which is the truth. */
  const leftC: number[] = [];
  for (let i = 0; i < c; i++) if (!usedC[i]) leftC.push(i);
  leftC.sort((a, b) => credits[b].amount - credits[a].amount);
  leftC.forEach((i) => {
    let best = -1, bd = Infinity;
    for (let k = 0; k < n; k++) {
      if (doneN[k]) continue;
      const d = Math.abs(needs[k].expected - credits[i].amount);
      if (d < bd) { bd = d; best = k; }
    }
    if (best >= 0 && bd <= Math.max(50, needs[best].expected * 0.25)) {
      doneN[best] = true; usedC[i] = true; assign[i] = best; sums[best] += credits[i].amount;
    }
  });

  const unmatched: number[] = [];
  for (let i = 0; i < c; i++) if (!usedC[i]) unmatched.push(i);
  return { assign, sums, conf, unmatched };
}

/* ── the whole reconciliation, as one pure function ───────────────────────── */

type Tone = "good" | "bad" | "warn" | "info" | "neutral";
type Line = {
  kind: "day" | "shop" | "total";
  label: string; note: string;
  sale: number | null; expected: number | null; got: number | null;
  nc: number; diff: number | null; status: string; tone: Tone;
};
type MatchInfo = { branch: string; date: string; sure: boolean; outside?: boolean };

function buildRecon(p: {
  sales: Row[]; sets: Row[]; branchName: (id: unknown) => string;
  from: string; to: string; lag: number; roll: number; rate: number;
}) {
  const { sales, sets, branchName, from, to, lag, roll, rate } = p;

  /* GROSS card sales per shop per day. 'meezan_card' only — widening this to
     "anything that looks like a card" is what made FC DHA's 1 Sep figure read
     36,100 instead of 33,400, because Nimbus MOP "Credit" is udhaar. */
  const saleBy: Record<string, Record<number, number>> = {};
  sales.forEach((r) => {
    const d = String(r.sale_date);
    const b = Number(r.branch_id);
    const m = (saleBy[d] = saleBy[d] ?? {});
    m[b] = (m[b] ?? 0) + num(r.sales_amount);
  });

  const credBy: Record<string, Credit[]> = {};
  sets.forEach((r) => {
    const D = String(r.credit_date);
    (credBy[D] = credBy[D] ?? []).push({
      id: Number(r.id), amount: num(r.amount), ref: String(r.ref ?? ""),
      time: r.credit_time ? String(r.credit_time) : null,
      source: String(r.source ?? ""),
      bid: r.branch_id == null ? null : Number(r.branch_id),
      sd: r.sale_date ? String(r.sale_date) : null,
      credit_date: D, used: 0,
    });
  });
  const credDates = Object.keys(credBy).sort();

  /* A credit that already knows which shop-day it is paying for — a statement
     row carrying branch_id AND sale_date — pins that sale day to the day the
     money actually landed. A shop whose money took six days is then not read as
     a shortage. Everything else falls back to lag/roll. */
  const pinnedDay: Record<string, Record<string, number>> = {};
  sets.forEach((r) => {
    if (r.sale_date && r.credit_date) {
      const m = (pinnedDay[String(r.sale_date)] = pinnedDay[String(r.sale_date)] ?? {});
      const D = String(r.credit_date);
      m[D] = (m[D] ?? 0) + 1;
    }
  });

  /* A sale day settles on the next day money actually arrived, but only if that
     day is inside the roll-up window — Saturday and Sunday landing together on
     Monday needs +1. Outside the window, it has not settled yet, which is a
     different statement from "it is short". */
  const settleFor = (d: string): string | null => {
    const m = pinnedDay[d];
    if (m) {
      let best: string | null = null, n = -1;
      for (const D of Object.keys(m)) if (credBy[D] && m[D] > n) { n = m[D]; best = D; }
      if (best) return best;
    }
    const t = addDays(d, lag), lim = addDays(t, roll);
    for (const D of credDates) if (D >= t) return D <= lim ? D : null;
    return null;
  };

  const days: string[] = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) days.push(d);

  const dayInfo: Record<string, { shops: Need[]; D: string | null }> = {};
  const needsByD: Record<string, Need[]> = {};
  days.forEach((d) => {
    const byB = saleBy[d] ?? {};
    const shops: Need[] = Object.keys(byB).map(Number).filter((id) => byB[id] > 0)
      .map((id) => ({
        id, name: branchName(id), sale: byB[id],
        /* THE BANK CHARGE. Net, not gross. */
        expected: cardExpected(byB[id], rate),
        saleDate: d, got: 0, nc: 0, conf: false, pooled: 0,
      }))
      .sort((a, b) => b.sale - a.sale);
    const D = shops.length ? settleFor(d) : null;
    dayInfo[d] = { shops, D };
    if (D) shops.forEach((s) => { (needsByD[D] = needsByD[D] ?? []).push(s); });
  });

  const matchOf: Record<number, MatchInfo> = {};
  const unmatchedByD: Record<string, Credit[]> = {};
  let outAmt = 0, outN = 0;

  credDates.forEach((D) => {
    const needs = needsByD[D] ?? [];
    const creds = credBy[D];
    const freeC: Credit[] = [];
    const pinnedK: Record<number, boolean> = {};

    creds.forEach((c) => {
      /* Pays for a sale day outside the window being looked at. Counted and
         reported separately rather than dropped, because otherwise the totals
         on this screen quietly disagree with the bank's. */
      if (c.sd && (c.sd < from || c.sd > to)) {
        outAmt += c.amount; outN++;
        matchOf[c.id] = { branch: "", date: c.sd, sure: true, outside: true };
        return;
      }
      let k = -1;
      if (c.bid && c.sd) k = needs.findIndex((nd) => nd.id === c.bid && nd.saleDate === c.sd);
      if (k >= 0) {
        needs[k].got += c.amount; needs[k].nc++; needs[k].conf = true; pinnedK[k] = true;
        matchOf[c.id] = { branch: needs[k].name, date: needs[k].saleDate, sure: true };
      } else freeC.push(c);
    });

    const openN = needs.filter((_, k) => !pinnedK[k]);
    const r = crMatch(freeC, openN);
    openN.forEach((nd, k) => { nd.got += r.sums[k]; if (r.conf[k]) nd.conf = true; });
    freeC.forEach((c, i) => {
      const k = r.assign[i];
      if (k >= 0) {
        openN[k].nc++;
        matchOf[c.id] = { branch: openN[k].name, date: openN[k].saleDate, sure: r.conf[k] };
      }
    });
    if (r.unmatched.length) unmatchedByD[D] = r.unmatched.map((i) => freeC[i]);
  });

  /* THE AGEING POOL.
     The money in this account is pooled and unnamed, so it is fungible. Once a
     shop-day has waited more than CR_AGE_DAYS for its payment, settle it out of
     the credits that did arrive but could not be tied to a shop — oldest
     shop-day first, and NEVER from money that landed before the sale, which
     would be paying for a sale out of a payment that predates it. Only what is
     left when that pool runs dry is a real shortage. */
  const lastCred = credDates.length ? credDates[credDates.length - 1] : to;
  const pool: { D: string; c: Credit }[] = [];
  Object.keys(unmatchedByD).sort().forEach((D) => {
    unmatchedByD[D].forEach((c) => { c.used = 0; pool.push({ D, c }); });
  });
  let poolUsed = 0;
  const aged: { s: Need; d: string; gap: number }[] = [];
  days.forEach((d) => {
    const inf = dayInfo[d];
    if (!inf || !inf.D) return;
    if (dDiff(lastCred, d) <= CR_AGE_DAYS) return;
    inf.shops.forEach((s) => {
      const gap = s.expected - s.got;
      if (gap > crTol(s.expected)) aged.push({ s, d, gap });
    });
  });
  aged.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : b.gap - a.gap));
  aged.forEach((a) => {
    let need = a.gap;
    for (let i = 0; i < pool.length && need > 0.01; i++) {
      const pl = pool[i], free = pl.c.amount - pl.c.used;
      if (free <= 0.01 || pl.D < a.d) continue;
      const take = Math.min(free, need);
      pl.c.used += take; need -= take; a.s.got += take; a.s.pooled += take; poolUsed += take;
    }
  });

  /* ── the table, newest day first ──────────────────────────────────────── */
  let tSale = 0, tExp = 0, tGot = 0, tShort = 0, shortDays = 0, waitDays = 0;
  let wSale = 0, wExp = 0, cSale = 0, cGot = 0;
  const lines: Line[] = [];

  days.slice().reverse().forEach((d) => {
    const inf = dayInfo[d], shops = inf.shops, D = inf.D;
    if (!shops.length) return;
    const daySale = shops.reduce((a, s) => a + s.sale, 0);
    const dayExp = shops.reduce((a, s) => a + s.expected, 0);
    const dayGot = shops.reduce((a, s) => a + s.got, 0);
    const nPay = shops.reduce((a, s) => a + s.nc, 0);

    if (D) { tSale += daySale; tExp += dayExp; tGot += dayGot; }
    else { wSale += daySale; wExp += dayExp; waitDays++; }

    lines.push({
      kind: "day", label: crDay(d),
      note: D ? `landed ${crDay(D)} · ${nPay} payment${nPay === 1 ? "" : "s"}` : "not settled yet",
      sale: null, expected: null, got: null, nc: 0, diff: null, status: "", tone: "neutral",
    });

    let dayShort = 0;
    shops.forEach((s) => {
      const diff = s.got - s.expected, tol = crTol(s.expected);
      /* The real acquirer cut can only be read off the shop-days whose payment
         was identified with confidence. A guessed match would be measuring the
         guess, not the bank. */
      if (D && s.nc && s.conf) { cSale += s.sale; cGot += s.got; }

      let status: string, tone: Tone;
      if (!D) { status = "Not received yet"; tone = "neutral"; }
      else if (!s.nc && !s.pooled && dDiff(lastCred, d) <= CR_AGE_DAYS) {
        status = `Still due — inside the ${CR_AGE_DAYS}-day window`; tone = "neutral";
      } else if (!s.nc && !s.pooled) {
        status = `Nothing received — short ${money(s.expected)}`; tone = "bad"; dayShort += s.expected;
      } else if (diff < -tol && dDiff(lastCred, d) <= CR_AGE_DAYS) {
        status = `${money(-diff)} still due — inside the ${CR_AGE_DAYS}-day window`; tone = "neutral";
      } else if (diff < -tol) {
        status = `Short ${money(-diff)}`; tone = "bad"; dayShort += -diff;
      } else if (s.pooled > 1) {
        status = `Paid from pooled money${s.nc ? " (part)" : ""}`; tone = "info";
      } else if (s.conf) { status = "OK"; tone = "good"; }
      else if (diff > tol) { status = `Extra ${money(diff)}`; tone = "warn"; }
      else { status = "Best guess"; tone = "warn"; }

      lines.push({
        kind: "shop", label: s.name, note: "",
        sale: s.sale, expected: s.expected,
        got: s.nc || s.pooled ? s.got : null,
        nc: s.nc, diff: s.nc || s.pooled ? diff : null,
        status, tone,
      });
    });

    if (dayShort > 1) { tShort += dayShort; shortDays++; }
    lines.push({
      kind: "total", label: "Day total", note: "",
      sale: daySale, expected: dayExp, got: dayGot || null, nc: 0,
      diff: dayGot ? dayGot - dayExp : null,
      status: "", tone: dayShort > 1 ? "bad" : "good",
    });
  });

  const missing = tExp - tGot;
  const loose = Object.keys(unmatchedByD)
    .reduce((a, D) => a + unmatchedByD[D].reduce((x, c) => x + (c.amount - c.used), 0), 0);
  const looseRows = Object.keys(unmatchedByD).sort()
    .flatMap((D) => unmatchedByD[D].filter((c) => c.amount - c.used > 1).map((c) => ({ ...c, amount: c.amount - c.used })));

  /* THE IMPLIED RATE. What the acquirer actually kept, over the shop-days whose
     payment was identified with confidence, to three decimals — so the figure
     in the Bank charge box can be checked against reality instead of believed. */
  const impliedRate = cSale > 0 && cGot > 0 ? (1 - cGot / cSale) * 100 : null;

  return {
    lines, needsByD, matchOf, looseRows, days,
    tSale, tExp, tGot, tShort, shortDays, waitDays, wSale, wExp,
    missing, loose, looseN: looseRows.length, outAmt, outN, poolUsed, impliedRate,
    netShort: missing - loose,
  };
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export default function CardReconPage() {
  const { branches, branchName } = useBranches();
  const [tab, setTab] = useState<Tab>("days");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [rateIn, setRateIn] = useState(String(CARD_RATE_PCT));
  const [lagIn, setLagIn] = useState("1");
  const [rollIn, setRollIn] = useState("1");

  const [sets, setSets] = useState<Row[]>([]);
  const [sales, setSales] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ credit_date: today(), sale_date: today(), amount: "", ref: "", bank: "Bank Alfalah", branch_id: "", descr: "" });

  const lag = Math.max(0, Math.min(7, num(lagIn)));
  const roll = Math.max(0, Math.min(3, num(rollIn)));
  const rate = num(rateIn);

  /* A reversed custom range is a typo, not a request for no data — swap it. */
  const [from, to] = useMemo(() => {
    const [a, b] = rangeDates(preset, cf, ct);
    const hi = b ?? today();
    const lo = a ?? addDays(hi, -29);
    return lo <= hi ? [lo, hi] : [hi, lo];
  }, [preset, cf, ct]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const db = supabase;
    setLoading(true); setErr("");

    /* PostgREST caps a response at 1000 rows and does not say so. A shop-day
       silently missing its last sale lines is a shortage this screen would then
       report as real money gone. fetchAll pages. */
    const { rows: saleRows, error: se } = await fetchAll<Row>((a, b) =>
      db.from("retail_sale_lines").select("branch_id,sale_date,sales_amount")
        .eq("payment_method", "meezan_card")
        .gte("sale_date", from).lte("sale_date", to)
        .order("sale_date").range(a, b));

    /* THE CREDIT WINDOW IS WIDER THAN THE SALES WINDOW, by lag + roll + 4 days.
       Sales on the last day of the range settle after the last day of the range.
       Query the two windows as though they were the same and the first and last
       day of every range you ever pick are structurally unmatchable. */
    const { data: setRows, error: ce } = await db.from("retail_card_settlements")
      .select("id,branch_id,credit_date,credit_time,sale_date,amount,ref,bank,descr,source")
      .gte("credit_date", from).lte("credit_date", addDays(to, lag + roll + 4))
      .order("credit_date").limit(5000);

    if (se || ce) setErr(se || ce?.message || "");
    setSales(saleRows);
    setSets((setRows as Row[]) ?? []);
    setLoading(false);
  }, [from, to, lag, roll]);
  useEffect(() => { load(); }, [load]);

  const R = useMemo(
    () => buildRecon({ sales, sets, branchName, from, to, lag, roll, rate }),
    [sales, sets, branchName, from, to, lag, roll, rate]
  );

  /* THE DAY THE SALES HAPPENED, never the day the money landed.
     Stamping sale_date = credit_date on a match that was made against the
     previous day puts the receipt on the wrong day: a phantom short on one day
     and a phantom surplus on the next, on two shops that are both fine. */
  const saleDayFor = useCallback((creditDate: string, branchId: number) => {
    const hit = (R.needsByD[creditDate] ?? []).find((n) => n.id === branchId);
    if (hit) return hit.saleDate;
    return addDays(creditDate, -lag);
  }, [R, lag]);

  async function assign(id: unknown, creditDate: string, branchId: string) {
    if (!supabase || !branchId) return;
    const bid = Number(branchId);
    const patch = { branch_id: bid, sale_date: saleDayFor(creditDate, bid) };
    const { error } = await supabase.from("retail_card_settlements").update(patch).eq("id", Number(id));
    if (error) { setErr(error.message); return; }
    setSets((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function save() {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { setErr("Enter an amount above zero."); return; }
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("retail_card_settlements").insert({
      credit_date: form.credit_date,
      sale_date: form.sale_date || null,
      amount: amt,
      ref: form.ref.trim(),
      bank: form.bank.trim() || null,
      descr: form.descr.trim() || null,
      branch_id: form.branch_id ? Number(form.branch_id) : null,
      source: "manual",
    });
    setSaving(false);
    if (error) {
      /* The unique indexes speak here. Saying "already recorded" is the whole
         point of them — a duplicate is a success, not a failure. */
      setErr(/duplicate|unique/i.test(error.message)
        ? "That credit is already recorded — the duplicate guard caught it."
        : error.message);
      return;
    }
    setOpen(false);
    setForm((f) => ({ ...f, amount: "", ref: "", descr: "" }));
    load();
  }

  /* ── stats ────────────────────────────────────────────────────────────── */
  const stats = [
    { label: "Card sales settled", value: money(R.tSale), Icon: CreditCard },
    { label: "Should receive (net)", value: money(R.tExp), Icon: Landmark },
    { label: "Received & named", value: money(R.tGot), Icon: CheckCircle2 },
    { label: "Shortage", value: R.netShort > 1 ? money(R.netShort) : "None", Icon: AlertTriangle },
  ];

  const extras: { l: string; v: string }[] = [
    { l: `Bank charge at ${rate}%`, v: "−" + money(R.tSale - R.tExp) },
    { l: "Charge the bank actually took", v: R.impliedRate === null ? "—" : R.impliedRate.toFixed(3) + "%" },
  ];
  if (R.poolUsed > 1) extras.push({ l: "Paid from the pool", v: money(R.poolUsed) });
  if (R.loose > 1) extras.push({ l: `Not tied to a shop (${R.looseN})`, v: money(R.loose) });
  if (R.outAmt > 1) extras.push({ l: `Pays for dates outside this range (${R.outN})`, v: money(R.outAmt) });
  if (R.wExp > 1) extras.push({ l: `Not settled yet (${R.waitDays} day${R.waitDays === 1 ? "" : "s"})`, v: money(R.wExp) });

  const toneCls = (t: Tone) =>
    t === "bad" ? "text-danger" : t === "good" ? "text-success"
    : t === "warn" ? "text-amber-strong dark:text-amber"
    : t === "info" ? "text-periwinkle-strong dark:text-periwinkle"
    : "text-muted dark:text-[#a89f93]";

  const dayCols: Col<Line>[] = [
    { head: "Shop", cell: (l) =>
        l.kind === "day"
          ? <span className="flex flex-wrap items-center gap-2"><span className="font-extrabold">{l.label}</span><span className="text-[11.5px] text-muted dark:text-[#a89f93]">{l.note}</span></span>
          : <span className={l.kind === "total" ? "font-semibold" : ""}>{l.label}</span> },
    { head: "Card sales", right: true, cell: (l) => (l.sale === null ? "" : money(l.sale)) },
    { head: "Charge", right: true, cell: (l) =>
        l.sale === null || l.expected === null ? "" : <span className="text-danger">−{money(l.sale - l.expected)}</span> },
    { head: "Should get", right: true, bold: true, cell: (l) => (l.expected === null ? "" : money(l.expected)) },
    { head: "Received", right: true, cell: (l) => (
        l.got === null ? <span className="text-muted dark:text-[#a89f93]">—</span>
        : <>{money(l.got)}{l.nc > 1 && <span className="ml-1 text-[11px] text-muted dark:text-[#a89f93]">({l.nc})</span>}</>
      ) },
    { head: "Diff", right: true, cell: (l) =>
        l.diff === null ? "" : <span className={toneCls(l.tone)}>{l.diff > 0 ? "+" : ""}{money(l.diff)}</span> },
    { head: "Status", cell: (l) => (l.status ? <span className={`text-[12px] font-semibold ${toneCls(l.tone)}`}>{l.status}</span> : null) },
  ];

  const looseCols: Col<Credit>[] = [
    { head: "Received on", muted: true, cell: (c) => `${c.credit_date}${c.time ? " " + String(c.time).slice(0, 5) : ""}` },
    { head: "Amount", right: true, bold: true, cell: (c) => money(c.amount) },
    { head: "Tx ID", muted: true, cell: (c) => text(c.ref) },
    { head: "Give it a shop", right: true, cell: (c) => (
        <Select value="" onChange={(v) => assign(c.id, c.credit_date, v)}>
          <option value="">Pick a shop…</option>
          {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </Select>
      ) },
  ];

  const payRows = useMemo(
    () => sets.slice().sort((a, b) =>
      String(`${b.credit_date}${b.credit_time ?? ""}`).localeCompare(String(`${a.credit_date}${a.credit_time ?? ""}`))),
    [sets]
  );

  const payCols: Col<Row>[] = [
    { head: "Received on", muted: true, cell: (r) => `${text(r.credit_date)}${r.credit_time ? " " + String(r.credit_time).slice(0, 5) : ""}` },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.amount) },
    { head: "Matched to", cell: (r) => {
        const m = R.matchOf[Number(r.id)];
        if (!m) return <Pill tone="warn">not tied to a shop</Pill>;
        if (m.outside) return <span className="text-[12px] text-muted dark:text-[#a89f93]">pays for {m.date} — outside this range</span>;
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{m.branch}</span>
            <span className="text-[11.5px] text-muted dark:text-[#a89f93]">{m.date}</span>
            {!m.sure && <Pill tone="warn">best guess</Pill>}
          </span>
        );
      } },
    { head: "Sale day on file", muted: true, cell: (r) => text(r.sale_date) },
    { head: "Tx ID", muted: true, cell: (r) => text(r.ref) },
    { head: "Source", cell: (r) => (String(r.source) === "manual" ? <Pill>By hand</Pill> : String(r.source) === "statement" ? <Pill tone="info">Statement</Pill> : <Pill tone="info">Slip</Pill>) },
    { head: "Shop", right: true, cell: (r) => (
        r.branch_id != null ? <span className="font-semibold">{branchName(r.branch_id)}</span> : (
          <Select value="" onChange={(v) => assign(r.id, String(r.credit_date), v)}>
            <option value="">Pick a shop…</option>
            {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </Select>
        )
      ) },
  ];

  /* ── the one sentence at the top that says whether money is missing ────── */
  const verdict = (() => {
    const extra = (R.loose > 1 ? ` Another ${money(R.loose)} arrived in ${R.looseN} payment(s) that could not be tied to a shop.` : "")
      + (R.outAmt > 1 ? ` ${money(R.outAmt)} in ${R.outN} payment(s) pays for sale days outside this range.` : "");
    const wait = R.waitDays ? ` ${R.waitDays} day(s) haven't settled yet.` : "";
    if (R.netShort > 1) return { tone: "bad" as const, text: `Short by ${money(R.netShort)} between ${from} and ${to}. Expected ${money(R.tExp)}, received ${money(R.tGot)}.${extra}${wait}` };
    if (R.tGot && R.tShort > 1) return { tone: "good" as const, text: `Nothing is missing overall. Expected ${money(R.tExp)}, received ${money(R.tGot)}.${extra} ${R.shortDays} day(s) show a gap on one shop with a matching extra on another — that is how the pooled money was split between the shops, not money the bank held back.${wait}` };
    if (!R.tGot) return { tone: "warn" as const, text: "No payments loaded for this range yet. Add one by hand, or import the settlement lines from the bank statement screen." };
    if (R.waitDays) return { tone: "warn" as const, text: `No shortage so far — everything that has settled matches. ${R.waitDays} day(s) still waiting to settle.` };
    return { tone: "good" as const, text: `All settled. Expected ${money(R.tExp)}, received ${money(R.tGot)}.` };
  })();

  return (
    <Shell>
      <PageHeader title="Card Reconciliation"
        subtitle="Pooled Alfalah credits, matched back to the shop that earned them — net of the bank's cut."
        onRefresh={load} loading={loading}>
        <button onClick={() => { setErr(""); setOpen(true); }} className={btnPrimary}><Plus size={15} /> Add a credit</button>
      </PageHeader>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} presets={CARD_PRESETS} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold text-ink dark:border-white/10 dark:bg-white/[0.06] dark:text-white">
          Bank charge %
          <input type="number" step="0.001" value={rateIn} onChange={(e) => setRateIn(e.target.value)}
            className="w-20 bg-transparent text-right tabular-nums outline-none" />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">
          Money lands after
          <Select value={String(lag)} onChange={setLagIn}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={String(n)}>{n === 0 ? "same day" : `${n} day${n > 1 ? "s" : ""}`}</option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">
          Weekend roll-up
          <Select value={String(roll)} onChange={setRollIn}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={String(n)}>{n === 0 ? "none" : `+${n} day${n > 1 ? "s" : ""}`}</option>
            ))}
          </Select>
        </label>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <StatCards stats={stats} loading={loading} />

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {extras.map(({ l, v }, i) => (
          <div key={i} className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
            <div className="text-[17px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : v}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{l}</div>
          </div>
        ))}
      </div>

      {!loading && (
        <div className={`mt-4 flex gap-3 rounded-card border p-4 ${
          verdict.tone === "bad" ? "border-danger/30 bg-danger-soft dark:border-danger/30 dark:bg-danger/10"
          : verdict.tone === "good" ? "border-success/30 bg-success-soft dark:border-success/30 dark:bg-success/10"
          : "border-line bg-amber-soft dark:border-white/[0.06] dark:bg-amber/10"}`}>
          {verdict.tone === "good" ? <CheckCircle2 size={18} className="mt-0.5 flex-none text-success" />
            : verdict.tone === "bad" ? <AlertTriangle size={18} className="mt-0.5 flex-none text-danger" />
            : <Link2 size={18} className="mt-0.5 flex-none text-amber-strong dark:text-amber" />}
          <p className="text-[13px] font-medium leading-relaxed text-ink dark:text-[#e7e2d8]">{verdict.text}</p>
        </div>
      )}

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}

      {tab === "days" && (
        <DataTable cols={dayCols} rows={R.lines} loading={loading} minWidth={1020}
          empty="No card sales in this range."
          footer={
            <>
              <tr className="font-extrabold text-ink dark:text-[#f4f1ea]">
                <td className="px-4 py-3">SETTLED TOTAL</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(R.tSale)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-danger">−{money(R.tSale - R.tExp)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(R.tExp)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(R.tGot)}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${R.tShort > 1 ? "text-danger" : "text-success"}`}>
                  {R.missing > 1 ? "−" + money(R.missing) : "+" + money(-R.missing)}
                </td>
                <td className="px-4 py-3">
                  {R.tShort > 1 ? <span className="text-[12px] text-danger">short {money(R.tShort)}</span>
                    : <span className="text-[12px] text-success">matched</span>}
                </td>
              </tr>
              {R.wExp > 1 && (
                <tr className="font-semibold text-muted dark:text-[#a89f93]">
                  <td className="px-4 py-3">NOT SETTLED YET</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(R.wSale)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-danger">−{money(R.wSale - R.wExp)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(R.wExp)}</td>
                  <td className="px-4 py-3 text-right">—</td>
                  <td className="px-4 py-3 text-right">—</td>
                  <td className="px-4 py-3 text-[12px]">waiting</td>
                </tr>
              )}
            </>
          } />
      )}

      {tab === "loose" && (
        <>
          <p className="mt-4 text-[12.5px] text-muted dark:text-[#a89f93]">
            {money(R.loose)} left over after covering every shop-day that had waited more than {CR_AGE_DAYS} days
            — either extra money, or that day&apos;s sales have not been imported yet. Nothing here has been
            forced onto a shop, because a forced match invents a shortage somewhere else.
          </p>
          <DataTable cols={looseCols} rows={R.looseRows} loading={loading} minWidth={760}
            empty="Every payment in this range is tied to a shop." />
        </>
      )}

      {tab === "payments" && (
        <DataTable cols={payCols} rows={payRows} loading={loading} minWidth={1060}
          empty="Nothing loaded for this range yet." />
      )}

      <SourceNote>
        <strong>Card sales</strong> counts only <code>meezan_card</code> lines; Nimbus MOP
        &ldquo;Credit&rdquo; is udhaar and is excluded. The expected figure is <strong>net of the
        acquirer&apos;s {rate}%</strong> — the till records gross, the bank credits net, and comparing the
        two directly reports about 1.28% of all card turnover as missing every single day. The
        &ldquo;charge the bank actually took&rdquo; figure above is measured from the shop-days whose
        payment was identified with confidence, so the rate box can be checked rather than believed.
        Matching is done per settlement day as a whole: exact pairs first, then sums of two or three
        credits, and only then a nearest guess — and a guess more than 25% (or Rs 50) away is refused
        outright, because forcing a far-off payment onto a shop creates an Extra on one shop and a
        Short on another out of nothing. Shop-days older than {CR_AGE_DAYS} days are then settled out
        of the untied pool, oldest first and never from money that landed before the sale:{" "}
        <strong>{moneyOrDash(R.poolUsed > 1 ? R.poolUsed : null)}</strong> in this range.
      </SourceNote>

      <Modal open={open} onClose={() => setOpen(false)} title="Record a card credit"
        subtitle="Type what the bank shows. Duplicates are refused by the database, so it is safe to add one you are unsure about.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Credit date"><input type="date" value={form.credit_date} onChange={(e) => setForm({ ...form, credit_date: e.target.value })} className={inputCls} /></Field>
            <Field label="Sale day it covers"><input type="date" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} autoFocus /></Field>
            <Field label="Bank reference / TXID"><input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} className={inputCls} placeholder="Blank is allowed" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank"><input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className={inputCls} /></Field>
            <Field label="Shop (optional)">
              <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className={inputCls}>
                <option value="">Leave unassigned</option>
                {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="What the statement says"><input value={form.descr} onChange={(e) => setForm({ ...form, descr: e.target.value })} className={inputCls} /></Field>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Record credit"}</button>
          </div>
        </div>
      </Modal>

      <PreviewNote />
    </Shell>
  );
}
