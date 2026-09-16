"use client";
/* DAILY CASH BOOK — one shop, one running balance.
 *
 * WHAT THIS SCREEN IS
 *   Not a table of stored rows. A chain. Every day's opening balance is the day
 *   before it, and the number the whole screen exists to produce — the
 *   difference between the cash somebody physically counted and the cash the
 *   book says should be there — is only meaningful if that chain is unbroken
 *   back to a real anchor.
 *
 * THE FORMULA (ported verbatim from renderCashbook / cbRecompute)
 *     openBal  = previous row's physical cash if it was counted, else its computed closing
 *     cashRecv = openBal + cash + splitCash
 *     cb       = cashRecv + misc − ho − exp − party
 *     diff     = phys != null ? phys − cb : null
 *
 *   Card, credit (udhaar) and JazzCash are deliberately absent from that sum.
 *   That money never enters the till, so it cannot be in the till at closing.
 *   They are shown as columns because the shop needs to see them; they are not
 *   added because adding them would report cash that does not exist.
 *
 *   A counted day RE-ANCHORS the chain: `pv = phys ?? cb`. Once somebody has
 *   physically counted the drawer, that count is the truth and the book's
 *   opinion of the previous day stops propagating. This is why a single day's
 *   count repairs everything after it and why the carry must be computed
 *   forward, oldest first, even though the screen reads newest first.
 *
 * WHY THERE IS NO DATE-RANGE PICKER  (rule 2 — do not add one)
 *   A user-chosen start date silently corrupts every opening balance on the
 *   screen. The carry needs a contiguous chain back to a real anchor; start it
 *   on an arbitrary Tuesday and day one opens at zero, so every closing balance
 *   and every cash difference below it is wrong by however much cash was
 *   actually in the drawer that morning — and wrong plausibly, with no error
 *   anywhere. So the window is COMPUTED, never chosen: from the shop's first
 *   ever sale or book entry (floored at 399 days ago) to today, seeded with the
 *   last physical count strictly BEFORE that start.
 *
 *   Every calendar day in that window is rendered, not only the days that have
 *   a stored row, because a day with no row still carries the balance across.
 *   Skipping empty days does not "hide nothing" — it drops a link out of the
 *   chain.
 *
 * WHY THE HO BOX IN THE DAY EDITOR HOLDS ONLY THE TYPED PART  (rule 6)
 *   The HO column on the grid is the typed `ho_payment` PLUS the Head Office
 *   lines that arrived with the Nimbus expense import. Pre-filling the editor's
 *   HO box from that rendered total re-adds the imported part on every single
 *   save. In production this ran 19,770 → 39,540 → 59,310 → 79,080, doubling
 *   every time the day was opened and saved. The box is pre-filled from
 *   `bk.ho_payment` alone and the imported part is shown beside it as text.
 *
 * SCOPE
 *   One branch at a time, always. A running balance across two shops is not a
 *   running balance of anything.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet, Banknote, CreditCard, Receipt, Smartphone, Landmark, Coins, HandCoins,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, Select, PreviewNote, SourceNote,
  useBranches, money, moneyOrDash, num, text, today, iso, fetchAll, Diff,
  type Row, type Col,
} from "@/components/retail/kit";

/* ── what each number is, in words ───────────────────────────────────────────
 * Ported from CB_FIELDS. A total nobody can explain is a total nobody trusts,
 * and the first question about any figure on this screen is "from where?".
 * `ro` means the figure is not editable here and says why; `detail` means the
 * receipts behind it can be listed.
 */
type FieldKey =
  | "ob" | "gross" | "net" | "disc" | "return" | "cash" | "card"
  | "credit" | "jazz" | "ho" | "exp" | "misc" | "cb" | "diff";

const CB_FIELDS: Record<FieldKey, { label: string; ro?: string; detail?: boolean }> = {
  ob: { label: "Opening balance", ro: "This carries from the previous day's physical cash. To change it, correct that day's physical cash." },
  gross: { label: "Gross sale" },
  net: { label: "Net sale" },
  disc: { label: "Discount", ro: "Discount is gross sale minus net sale. Change one of those two.", detail: true },
  return: { label: "Returns", ro: "Returns come from the Nimbus sale lines with a negative quantity.", detail: true },
  cash: { label: "Cash sale" },
  card: { label: "Card sale", detail: true },
  credit: { label: "Credit (udhaar)", detail: true },
  jazz: { label: "JazzCash", detail: true },
  ho: { label: "HO payment", detail: true },
  exp: { label: "Expenses", ro: "Expenses come from the Nimbus expense import. Correct them in the Expenses tab and they update here.", detail: true },
  misc: { label: "Misc income", ro: "Misc income comes from the Nimbus expense import. Correct it in the Expenses tab.", detail: true },
  cb: { label: "Closing balance", ro: "Opening balance + cash sale + misc income − HO payment − expenses − party payment." },
  diff: { label: "Cash difference", ro: "Physical cash counted minus the closing balance. A plus means more cash in hand than the book expects." },
};

/* Nimbus MOP "Credit" is UDHAAR, not a credit card. Card is meezan_card and the
   leftovers ('other', 'unclassified'), exactly as the original bucketed them —
   counting credit as card is what made FC DHA's 1 Sep card figure read 36,100
   instead of 33,400. */
const PM_LABEL: Record<string, string> = {
  cash: "Cash", jazzcash: "JazzCash", meezan_card: "Card", online: "Online",
  credit: "Credit (udhaar)", other: "Other", unclassified: "Unclassified",
};

/* ── types ───────────────────────────────────────────────────────────────── */

type Book = {
  id?: number; branch_id?: number; book_date?: string;
  opening_balance?: number | null; gross_sale?: number | null; net_sale?: number | null;
  cash_sale?: number | null; card_sale?: number | null; jazz_sale?: number | null;
  credit_sale?: number | null; online_sale?: number | null; sales_overridden?: boolean | null;
  ho_payment?: number | null; expense?: number | null; party_payment?: number | null;
  party_name?: string | null; rts?: number | null; return_refund?: number | null;
  split_cash?: number | null; physical_cash?: number | null; note?: string | null;
  updated_at?: string | null;
};

type SaleLine = { sale_date: string; sales: number | null; sales_amount: number | null; payment_method: string | null; quantity: number | null };
type ExpLine = { expense_date: string; amount: number | null; txn_type: string | null; category: string | null };

/** What Nimbus reported for a day, before any manual override. */
type Agg = { gross: number; net: number; cash: number; card: number; credit: number; jazz: number; online: number; rtn: number };
/** What the expense import reported for a day. `ho` is split out of `exp`. */
type EAgg = { exp: number; inc: number; ho: number };

const ZERO_AGG = (): Agg => ({ gross: 0, net: 0, cash: 0, card: 0, credit: 0, jazz: 0, online: 0, rtn: 0 });
const ZERO_EAGG = (): EAgg => ({ exp: 0, inc: 0, ho: 0 });

/** One calendar day, as stored. The chain is NOT in here — see `chain()`. */
type Day = { ds: string; bk: Book | null; auto: Agg; eA: EAgg };

/** One calendar day, resolved and chained. This is what the grid renders. */
type CBRow = {
  ds: string; bk: Book | null; auto: Agg; eA: EAgg;
  gross: number; net: number; disc: number; rtn: number;
  cash: number; card: number; credit: number; jazz: number;
  ho: number; party: number; rts: number; ret: number;
  exp: number; misc: number; phys: number | null; splitCash: number;
  openBal: number; cashRecv: number; cb: number; diff: number | null;
};

/* ── the window ──────────────────────────────────────────────────────────── */

/** 399 days back. The floor on how far the chain is rebuilt — far enough to
 *  cover a year of trading, short enough that one shop's history is one page
 *  of requests rather than four. */
const isoNDaysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

/** Every calendar day from `from` to `to`, inclusive. Built from local date
 *  parts rather than by adding milliseconds so a DST shift cannot drop or
 *  duplicate a day, which on a carried balance would be a wrong number rather
 *  than a cosmetic glitch. */
function calendarDays(from: string, to: string): string[] {
  const out: string[] = [];
  const dt = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  let guard = 0;
  while (dt <= end && guard++ < 400) {
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
    dt.setDate(dt.getDate() + 1);
  }
  return out;
}

/* ── resolving one day ───────────────────────────────────────────────────── */

/** Turn what is stored into what is shown, for a single day.
 *
 *  `sales_overridden` is the switch: off, the sales figures are whatever Nimbus
 *  imported; on, the typed ones win. JazzCash and credit fall back to the
 *  imported figure even when overridden if their column is null, because those
 *  two columns were added later and an older overridden row has nothing in
 *  them — reading null as zero would silently delete a real udhaar figure. */
function materialise(d: Day): Omit<CBRow, "openBal" | "cashRecv" | "cb" | "diff"> {
  const { ds, bk, auto: a, eA } = d;
  const ov = !!(bk && bk.sales_overridden);
  const gross = ov ? num(bk?.gross_sale) : a.gross;
  const net = ov ? num(bk?.net_sale) : a.net;
  const cash = ov ? num(bk?.cash_sale) : a.cash;
  const card = ov ? num(bk?.card_sale) : a.card;
  const jazz = ov && bk && bk.jazz_sale != null ? num(bk.jazz_sale) : a.jazz;
  const credit = ov && bk && bk.credit_sale != null ? num(bk.credit_sale) : a.credit;

  /* HO is the typed figure PLUS the Head Office lines that came in with the
     expense import. Both are real payments to head office; they arrive by two
     routes. The day editor may only ever pre-fill from the typed half — see
     the header comment for what happens when it does not. */
  const ho = num(bk?.ho_payment) + eA.ho;

  return {
    ds, bk, auto: a, eA,
    gross, net,
    disc: gross - net,              // Disc is derived, never stored.
    rtn: a.rtn,                     // Returns: sale lines with a negative quantity.
    cash, card, credit, jazz, ho,
    party: num(bk?.party_payment),
    rts: num(bk?.rts),
    ret: num(bk?.return_refund),
    exp: eA.exp,                    // expense rows, Head Office already taken out
    misc: eA.inc,                   // txn_type = 'income'
    phys: bk && bk.physical_cash != null ? num(bk.physical_cash) : null,
    splitCash: num(bk?.split_cash),
  };
}

/** THE CARRY. Verbatim from cbRecompute — four lines, computed forward.
 *
 *  `basePrev` is the seed: the last physical count strictly before the window
 *  opens. Without it day one opens at zero and every row below inherits the
 *  error. */
function chain(days: Day[], basePrev: number): CBRow[] {
  let pv = basePrev;
  return days.map((d) => {
    const r = materialise(d);
    const openBal = pv;
    const cashRecv = openBal + r.cash + r.splitCash;
    const cb = cashRecv + r.misc - r.ho - r.exp - r.party;
    const diff = r.phys != null ? r.phys - cb : null;
    pv = r.phys != null ? r.phys : cb;   // a counted day re-anchors the chain
    return { ...r, openBal, cashRecv, cb, diff };
  });
}

/** The value behind a tapped cell. Cash shows cash + splitCash and card shows
 *  card − splitCash: a "split" is card money the shop took out as cash, so it
 *  moves from one column to the other without changing the day's total. */
function cbVal(r: CBRow, t: FieldKey): number {
  switch (t) {
    case "ob": return r.openBal;
    case "gross": return r.gross;
    case "net": return r.net;
    case "disc": return r.disc;
    case "return": return r.rtn;
    case "cash": return r.cash + r.splitCash;
    case "card": return r.card - r.splitCash;
    case "credit": return r.credit;
    case "jazz": return r.jazz;
    case "ho": return r.ho;
    case "exp": return r.exp;
    case "misc": return r.misc;
    case "cb": return r.cb;
    case "diff": return r.diff ?? 0;
    default: return 0;
  }
}

/* ── the screen ──────────────────────────────────────────────────────────── */

const TH = "px-2.5 py-2.5 text-right font-semibold whitespace-nowrap";
const TD = "px-2.5 py-2 text-right tabular-nums whitespace-nowrap";

export default function CashBookPage() {
  const { branches } = useBranches();
  const [bid, setBid] = useState<number | null>(null);

  const [days, setDays] = useState<Day[]>([]);
  const [basePrev, setBasePrev] = useState(0);
  const [window_, setWindow] = useState<[string, string]>([today(), today()]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [popup, setPopup] = useState<{ r: CBRow; t: FieldKey } | null>(null);
  const [detail, setDetail] = useState<{ ds: string; t: FieldKey; r: CBRow } | null>(null);
  const [dayRow, setDayRow] = useState<CBRow | null>(null);
  const [hiCol, setHiCol] = useState<number | null>(null);

  /* Land on a shop as soon as there is one, and never sit on a shop that has
     gone from the list. Inactive shops are kept: a closed branch still has a
     cash book worth reading back. */
  useEffect(() => {
    if (!branches.length) return;
    setBid((cur) => (cur && branches.some((b) => b.id === cur) ? cur : branches[0].id));
  }, [branches]);

  const chains = useMemo(() => [...new Set(branches.map((b) => b.chain ?? "").filter(Boolean))], [branches]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !bid) { setLoading(false); return; }
    setLoading(true); setErr("");

    /* THE WINDOW IS COMPUTED, NOT CHOSEN. from = this shop's earliest sale or
       book entry, floored at 399 days ago; to = today. See the header comment
       for why offering the user a start date would corrupt the whole screen. */
    const [{ data: minS }, { data: minB }] = await Promise.all([
      supabase.from("retail_sale_lines").select("sale_date").eq("branch_id", bid).order("sale_date", { ascending: true }).limit(1),
      supabase.from("retail_daily_book").select("book_date").eq("branch_id", bid).order("book_date", { ascending: true }).limit(1),
    ]);
    const to = today();
    const starts: string[] = [];
    const s0 = (minS as { sale_date: string }[] | null)?.[0]?.sale_date;
    const b0 = (minB as { book_date: string }[] | null)?.[0]?.book_date;
    if (s0) starts.push(s0);
    if (b0) starts.push(b0);
    let from = starts.length ? starts.slice().sort()[0] : to;
    const cap = isoNDaysAgo(399);
    if (from < cap) from = cap;

    const [bookRes, prevRes, expRes] = await Promise.all([
      supabase.from("retail_daily_book").select("*").eq("branch_id", bid).gte("book_date", from).lte("book_date", to),
      /* THE SEED. Strictly before the window: the last drawer count this shop
         has on record. Start the chain without it and day one opens at zero. */
      supabase.from("retail_daily_book").select("physical_cash,book_date").eq("branch_id", bid).lt("book_date", from).order("book_date", { ascending: false }).limit(1),
      supabase.from("retail_expenses").select("expense_date,amount,txn_type,category").eq("branch_id", bid).gte("expense_date", from).lte("expense_date", to),
    ]);

    /* PostgREST caps a response at 1000 rows and a .limit(5000) does not raise
       that — it just returns what it returns. A silently truncated day of sale
       lines here is a wrong cash position that looks entirely plausible, so
       this pages. Ordered by id because an unordered .range() may repeat or
       skip rows across pages. */
    const { rows: sales, error: salesErr } = await fetchAll<SaleLine>((f, t) =>
      supabase!.from("retail_sale_lines")
        .select("sale_date,sales,sales_amount,payment_method,quantity")
        .eq("branch_id", bid).gte("sale_date", from).lte("sale_date", to)
        .order("id", { ascending: true }).range(f, t)
    );

    /* A partial load is not shown. Half a chain reads exactly like a whole one
       and every balance under the gap would be wrong without saying so. */
    const firstErr = bookRes.error?.message || prevRes.error?.message || expRes.error?.message || salesErr;
    if (firstErr) { setErr("Couldn't load: " + firstErr); setDays([]); setLoading(false); return; }

    const agg: Record<string, Agg> = {};
    sales.forEach((r) => {
      const a = agg[r.sale_date] ?? (agg[r.sale_date] = ZERO_AGG());
      a.gross += num(r.sales);
      const amt = num(r.sales_amount);
      a.net += amt;
      /* A return is a sale line with a negative quantity. Its amount is already
         negative, so it nets itself out of the day — this column only exists to
         show how much of the day was given back. */
      if (num(r.quantity) < 0) a.rtn += amt;
      const pm = r.payment_method;
      if (pm === "cash") a.cash += amt;
      else if (pm === "online") a.online += amt;
      else if (pm === "jazzcash") a.jazz += amt;
      else if (pm === "credit") a.credit += amt;
      else a.card += amt;
    });

    const bd: Record<string, Book> = {};
    ((bookRes.data as Book[]) ?? []).forEach((b) => { if (b.book_date) bd[b.book_date] = b; });

    const eAgg: Record<string, EAgg> = {};
    ((expRes.data as ExpLine[]) ?? []).forEach((x) => {
      const a = eAgg[x.expense_date] ?? (eAgg[x.expense_date] = ZERO_EAGG());
      /* Order matters: income is income even if somebody filed it under Head
         Office. Only an expense row can be an HO payment. */
      if (x.txn_type === "income") a.inc += num(x.amount);
      else if (x.category === "Head Office") a.ho += num(x.amount);
      else a.exp += num(x.amount);
    });

    /* EVERY calendar day, not only the days with a stored row. A day with
       nothing on it still carries the balance across. */
    setDays(calendarDays(from, to).map((ds) => ({
      ds, bk: bd[ds] ?? null, auto: agg[ds] ?? ZERO_AGG(), eA: eAgg[ds] ?? ZERO_EAGG(),
    })));
    const prev0 = (prevRes.data as { physical_cash: number | null }[] | null)?.[0];
    setBasePrev(prev0 ? num(prev0.physical_cash) : 0);
    setWindow([from, to]);
    setLoading(false);
  }, [bid]);

  useEffect(() => { load(); }, [load]);

  /* The carry runs here. Because the chain is derived rather than stored,
     changing one day's physical cash repaints that row AND every row below it
     with no refetch — which is exactly what rule 5 asks for. */
  const rows = useMemo(() => chain(days, basePrev), [days, basePrev]);

  /* Computed oldest-first (the carry has no choice), read newest-first.
     A future day with nothing on it is not a day yet, so it is not shown. */
  const shown = useMemo(() => {
    const t = today();
    return rows.filter((r) => !(r.ds > t && !r.bk && !r.gross && !r.net)).slice().reverse();
  }, [rows]);

  const T = useMemo(() => shown.reduce((t, r) => ({
    gross: t.gross + r.gross,
    cash: t.cash + r.cash + r.splitCash,
    card: t.card + r.card - r.splitCash,
    credit: t.credit + r.credit,
    jazz: t.jazz + r.jazz,
    ho: t.ho + r.ho,
    exp: t.exp + r.exp,
    misc: t.misc + r.misc,
    party: t.party + r.party,
  }), { gross: 0, cash: 0, card: 0, credit: 0, jazz: 0, ho: 0, exp: 0, misc: 0, party: 0 }), [shown]);

  const stats = [
    { label: "Gross sale", value: money(T.gross), Icon: Wallet },
    { label: "Cash sale", value: money(T.cash), Icon: Banknote },
    { label: "Card sale", value: money(T.card), Icon: CreditCard },
    { label: "Credit (udhaar)", value: money(T.credit), Icon: HandCoins },
    { label: "JazzCash", value: money(T.jazz), Icon: Smartphone },
    { label: "Expenses", value: money(T.exp), Icon: Receipt },
    { label: "Misc income", value: money(T.misc), Icon: Coins },
    { label: "HO payment", value: money(T.ho), Icon: Landmark },
  ];

  /* ── inline physical cash ───────────────────────────────────────────────
   * Optimistic: local state first so the carry repaints instantly, then the
   * upsert. Refetching the screen for one typed number would throw away the
   * other numbers the user is mid-way through typing. */
  /* `prior` is passed in by the caller rather than read out of a state updater:
     a setState updater does not run until the next render, so anything read
     inside one is still undefined on the line after it. */
  const savePhysical = useCallback(async (ds: string, val: number | null, prior: Book | null) => {
    if (!bid) return;
    setDays((ds0) => ds0.map((d) => (d.ds === ds ? { ...d, bk: { ...(d.bk ?? {}), physical_cash: val } } : d)));
    if (!supabase) return;
    /* The existing row is spread in so the upsert lands on a complete row
       rather than a four-column fragment. */
    const rec = { ...(prior ?? {}), branch_id: bid, book_date: ds, physical_cash: val, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("retail_daily_book")
      .upsert(rec, { onConflict: "branch_id,book_date" }).select().maybeSingle();
    if (error) {
      /* Put the old count back. Leaving the optimistic one on screen would show
         a difference of zero for a count that was never saved. */
      setErr("Couldn't save " + ds + ": " + error.message);
      setDays((ds0) => ds0.map((d) => (d.ds === ds ? { ...d, bk: prior } : d)));
      return;
    }
    setErr("");
    if (data) setDays((ds0) => ds0.map((d) => (d.ds === ds ? { ...d, bk: data as Book } : d)));
  }, [bid]);

  /* A saved day replaces that day's book row in place. Everything the editor
     can change lives on that row, so the local chain is complete afterwards and
     there is nothing to refetch. */
  const applySavedDay = useCallback((ds: string, bk: Book) => {
    setDays((ds0) => ds0.map((d) => (d.ds === ds ? { ...d, bk } : d)));
  }, []);

  const cell = (r: CBRow, t: FieldKey, col: number, extra = "") => (
    <td className={`${TD} ${hiCol === col ? "bg-amber-soft dark:bg-white/[0.07]" : ""} cursor-pointer ${extra}`}
      onClick={() => setPopup({ r, t })}>
      {Math.round(cbVal(r, t)).toLocaleString("en-PK")}
    </td>
  );

  const HEADS = ["Date", "O/B", "Gross", "Net", "Disc", "Return", "Cash", "Card", "Credit", "JazzCash", "HO", "Exp", "Misc", "C/B", "Physical", "Diff"];

  return (
    <Shell>
      <PageHeader
        title="Daily Cash Book"
        subtitle="One shop, one running balance. Opening carries from the day before."
        onRefresh={load}
        loading={loading}
      >
        {/* One branch at a time — a running balance across two shops is not a
            running balance of anything. Grouped by chain when there is more
            than one chain to group. */}
        <Select value={bid ? String(bid) : ""} onChange={(v) => setBid(v ? Number(v) : null)}>
          {chains.length > 1
            ? chains.map((ch) => (
                <optgroup key={ch} label={ch}>
                  {branches.filter((b) => (b.chain ?? "") === ch).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                </optgroup>
              ))
            : branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </Select>
      </PageHeader>

      <SourceNote>
        Sales fill in from the Nimbus imports. Type the <strong>physical cash</strong> straight into its box —
        the day it is counted becomes the new anchor and every day below it re-opens from there.
        Tap the <strong>date</strong> to edit anything else on that day, or tap any <strong>number</strong> to
        see what it is made of. Tap a column heading to pick that column out. Newest day first.
        {!loading && (
          <> {" "}Showing <strong>{window_[0]}</strong> to <strong>{window_[1]}</strong>, opening at{" "}
          <strong>{money(basePrev)}</strong> — the last count before this window. The range is worked out, not
          chosen: a hand-picked start date would open day one at zero and quietly falsify every balance under it.</>
        )}
      </SourceNote>

      <StatCards stats={stats} loading={loading} />

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}

      {!bid && !loading && isSupabaseConfigured && (
        <div className="mt-4 rounded-card border border-line bg-surface p-6 text-center text-[13px] text-muted dark:border-white/[0.06] dark:bg-[#201c17] dark:text-[#a89f93]">
          Add a shop on the Branches screen first — a cash book belongs to one shop.
        </div>
      )}

      {bid && (
        <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
          <div className="max-h-[70dvh] overflow-auto">
            <table className="w-full min-w-[1180px] text-left text-[12.5px]">
              <thead className="sticky top-0 z-10 bg-surface dark:bg-[#201c17]">
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                  {HEADS.map((h, i) => (
                    <th key={h}
                      onClick={() => setHiCol((c) => (c === i ? null : i))}
                      className={`${i === 0 ? "px-3 py-2.5 text-left font-semibold" : TH} cursor-pointer select-none ${hiCol === i ? "bg-amber-soft dark:bg-white/[0.07]" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}><td colSpan={16} className="px-3 py-2.5"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>
                  ))
                ) : shown.length === 0 ? (
                  <tr><td colSpan={16} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">
                    No trading days yet for this shop — the book fills once sales are imported.
                  </td></tr>
                ) : (
                  shown.map((r) => (
                    <tr key={r.ds} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                      <td onClick={() => setDayRow(r)}
                        className={`px-3 py-2 font-bold whitespace-nowrap cursor-pointer underline decoration-dotted underline-offset-2 ${hiCol === 0 ? "bg-amber-soft dark:bg-white/[0.07]" : ""}`}>
                        {r.ds.slice(8)}/{r.ds.slice(5, 7)}
                      </td>
                      {cell(r, "ob", 1, "font-semibold")}
                      {cell(r, "gross", 2)}
                      {cell(r, "net", 3)}
                      {cell(r, "disc", 4)}
                      {cell(r, "return", 5, r.rtn ? "text-danger" : "")}
                      {cell(r, "cash", 6)}
                      {cell(r, "card", 7)}
                      {cell(r, "credit", 8)}
                      {cell(r, "jazz", 9)}
                      {cell(r, "ho", 10)}
                      {cell(r, "exp", 11)}
                      {cell(r, "misc", 12)}
                      {cell(r, "cb", 13, "font-bold")}
                      <td className={`px-1.5 py-1.5 ${hiCol === 14 ? "bg-amber-soft dark:bg-white/[0.07]" : ""}`}>
                        <PhysInput value={r.phys} onCommit={(v) => savePhysical(r.ds, v, r.bk)} />
                      </td>
                      <td className={`${TD} cursor-pointer ${hiCol === 15 ? "bg-amber-soft dark:bg-white/[0.07]" : ""}`}
                        onClick={() => setPopup({ r, t: "diff" })}>
                        {/* Blank, not zero, when nobody has counted: an uncounted
                            drawer is not a drawer that agrees. */}
                        {r.diff == null ? "" : <Diff value={r.diff} />}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && shown.length > 0 && (
                <tfoot className="sticky bottom-0 border-t-2 border-line bg-panel/80 backdrop-blur dark:border-white/[0.08] dark:bg-[#201c17]">
                  <tr className="font-bold text-ink dark:text-[#f4f1ea]">
                    <td className="px-3 py-2.5">Total</td>
                    <td className={TD}>—</td>
                    <td className={TD}>{Math.round(T.gross).toLocaleString("en-PK")}</td>
                    <td className={TD}>—</td>
                    <td className={TD}>—</td>
                    <td className={TD}>—</td>
                    <td className={TD}>{Math.round(T.cash).toLocaleString("en-PK")}</td>
                    <td className={TD}>{Math.round(T.card).toLocaleString("en-PK")}</td>
                    <td className={TD}>{Math.round(T.credit).toLocaleString("en-PK")}</td>
                    <td className={TD}>{Math.round(T.jazz).toLocaleString("en-PK")}</td>
                    <td className={TD}>{Math.round(T.ho).toLocaleString("en-PK")}</td>
                    <td className={TD}>{Math.round(T.exp).toLocaleString("en-PK")}</td>
                    <td className={TD}>{Math.round(T.misc).toLocaleString("en-PK")}</td>
                    <td className={TD}>—</td>
                    <td className={TD}>—</td>
                    <td className={TD}>—</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      <PreviewNote />

      {popup && (
        <FieldPopup
          r={popup.r} t={popup.t}
          onClose={() => setPopup(null)}
          onDetail={() => { setDetail({ ds: popup.r.ds, t: popup.t, r: popup.r }); setPopup(null); }}
        />
      )}

      {detail && bid && (
        <DetailModal bid={bid} ds={detail.ds} t={detail.t} r={detail.r} onClose={() => setDetail(null)} />
      )}

      {dayRow && bid && (
        <DayModal
          bid={bid} r={dayRow}
          onClose={() => setDayRow(null)}
          onSaved={(bk) => { applySavedDay(dayRow.ds, bk); setDayRow(null); }}
        />
      )}
    </Shell>
  );
}

/* ── the physical cash box ───────────────────────────────────────────────────
 * Commits on blur or Enter, not on every keystroke. A keystroke commit would
 * write "1", "12", "123" to the database on the way to 1234 and re-chain the
 * whole screen three times for nothing.
 */
function PhysInput({ value, onCommit }: { value: number | null; onCommit: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => { setDraft(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    const v = draft.trim() === "" ? null : num(draft);
    if (v === value) return;
    onCommit(v);
  };
  return (
    <input
      type="number" inputMode="numeric" value={draft} placeholder="count"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-full min-w-[74px] rounded-xl2 border border-line bg-canvas px-1.5 py-1.5 text-center text-[12.5px] tabular-nums text-ink outline-none transition focus:border-ink/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
    />
  );
}

/* ── tap a number ────────────────────────────────────────────────────────────
 * The value, large, and where it came from in plain words. For HO it also has
 * to say which half is which, because "HO 39,540" with no breakdown is exactly
 * the screen on which the double-count went unnoticed.
 */
function FieldPopup({ r, t, onClose, onDetail }: { r: CBRow; t: FieldKey; onClose: () => void; onDetail: () => void }) {
  const f = CB_FIELDS[t];
  const typedHo = num(r.bk?.ho_payment);
  const autoHo = r.eA.ho;
  return (
    <Modal open onClose={onClose} title={f.label} subtitle={r.ds}>
      <div className="rounded-xl2 border border-line bg-panel/50 px-4 py-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <div className="text-[28px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{money(cbVal(r, t))}</div>
      </div>

      <p className="mt-3 rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-[#a89f93]">
        {f.ro
          ? f.ro
          : t === "ho" && autoHo > 0
            ? <>{money(autoHo)} of this came in with the Nimbus expense import; {money(typedHo)} was typed into the day. Tap the date on this row to change the typed part — only the typed part.</>
            : <>To change this, tap the date on this row and edit the day.</>}
      </p>

      {t === "cash" && r.splitCash !== 0 && (
        <p className="mt-2 text-[12px] text-muted dark:text-[#a89f93]">
          Includes {money(r.splitCash)} of split cash — card money taken out of the till as cash, so it is added
          here and taken off the card column.
        </p>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {f.detail && <button onClick={onDetail} className={btnPrimary}>Show the entries</button>}
        <button onClick={onClose} className={btnGhost}>Close</button>
      </div>
    </Modal>
  );
}

/* ── the drill-downs ─────────────────────────────────────────────────────────
 * One day, one table, one total. Receipts are rolled up by receipt_txn because
 * a sale is one bill to the shop and eight item lines to Nimbus, and a list of
 * item lines is not a list anybody can check against a drawer.
 */
type DetailRow = Row;

function DetailModal({ bid, ds, t, r, onClose }: { bid: number; ds: string; t: FieldKey; r: CBRow; onClose: () => void }) {
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  /* Pulled out of the effect so the dependency is a number, not the row object.
     The row object is rebuilt every time the chain recomputes, and depending on
     it would re-run this query each time anybody typed a cash count. */
  const typedHo = num(r.bk?.ho_payment);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      setLoading(true); setErr("");
      const out: DetailRow[] = [];
      const push = (o: Record<string, unknown>) => out.push(o as DetailRow);

      if (t === "card") {
        /* Everything that is not cash, minus the three that have columns of
           their own. Credit is excluded here on purpose — udhaar is not a card
           sale and no bank will ever credit it. */
        const { data, error } = await supabase.from("retail_sale_lines")
          .select("receipt_no,receipt_txn,payment_method,sales_amount")
          .eq("branch_id", bid).eq("sale_date", ds).neq("payment_method", "cash");
        if (error) setErr(error.message);
        const recs: Record<string, { no: string; pm: string; amt: number }> = {};
        ((data as Row[]) ?? []).forEach((x, i) => {
          const pm = String(x.payment_method ?? "");
          if (pm === "online" || pm === "jazzcash" || pm === "credit") return;
          const k = String(x.receipt_txn || x.receipt_no || `r${i}`);
          const g = recs[k] ?? (recs[k] = { no: String(x.receipt_no || k), pm, amt: 0 });
          g.amt += num(x.sales_amount);
        });
        Object.values(recs).sort((a, b) => b.amt - a.amt).forEach((g) => push({ a: g.no, b: PM_LABEL[g.pm] ?? g.pm, amt: g.amt }));
      }

      else if (t === "credit") {
        /* The udhaar debtor list. The party column is the whole point of it —
           a credit total with no names is a number the shop cannot chase. */
        const { data, error } = await supabase.from("retail_sale_lines")
          .select("receipt_no,receipt_txn,customer,sales_amount")
          .eq("branch_id", bid).eq("sale_date", ds).eq("payment_method", "credit");
        if (error) setErr(error.message);
        const recs: Record<string, { no: string; party: string; amt: number }> = {};
        ((data as Row[]) ?? []).forEach((x, i) => {
          const k = String(x.receipt_txn || x.receipt_no || `r${i}`);
          const g = recs[k] ?? (recs[k] = { no: String(x.receipt_no || k), party: "", amt: 0 });
          if (!g.party && x.customer) g.party = String(x.customer);
          g.amt += num(x.sales_amount);
        });
        Object.values(recs).sort((a, b) => b.amt - a.amt).forEach((g) => push({ a: g.no, b: g.party || "—", amt: g.amt }));
      }

      else if (t === "jazz") {
        const { data, error } = await supabase.from("retail_sale_lines")
          .select("receipt_no,receipt_txn,sales_amount")
          .eq("branch_id", bid).eq("sale_date", ds).eq("payment_method", "jazzcash");
        if (error) setErr(error.message);
        const recs: Record<string, { no: string; amt: number }> = {};
        ((data as Row[]) ?? []).forEach((x, i) => {
          const k = String(x.receipt_txn || x.receipt_no || `r${i}`);
          const g = recs[k] ?? (recs[k] = { no: String(x.receipt_no || k), amt: 0 });
          g.amt += num(x.sales_amount);
        });
        Object.values(recs).sort((a, b) => b.amt - a.amt).forEach((g) => push({ a: g.no, amt: g.amt }));
      }

      else if (t === "exp" || t === "misc") {
        const income = t === "misc";
        const { data, error } = await supabase.from("retail_expenses")
          .select("description,paid_via,amount,category")
          .eq("branch_id", bid).eq("expense_date", ds).eq("txn_type", income ? "income" : "expense");
        if (error) setErr(error.message);
        ((data as Row[]) ?? [])
          /* Head Office expense rows belong to the HO column, so they are not
             listed here — the grid's Exp figure has already taken them out. */
          .filter((x) => income || String(x.category ?? "") !== "Head Office")
          .sort((a, b) => num(b.amount) - num(a.amount))
          .forEach((x) => push({ a: text(x.description, "no note in Nimbus"), b: text(x.paid_via), amt: num(x.amount) }));
      }

      else if (t === "disc") {
        const { data, error } = await supabase.from("retail_sale_lines")
          .select("receipt_no,item_name,item_code,quantity,sales,sales_amount")
          .eq("branch_id", bid).eq("sale_date", ds);
        if (error) setErr(error.message);
        ((data as Row[]) ?? [])
          .map((x) => ({ x, d: num(x.sales) - num(x.sales_amount) }))
          .filter((o) => o.d > 0.001)
          .sort((a, b) => b.d - a.d)
          .forEach((o) => push({ a: text(o.x.receipt_no, ""), b: text(o.x.item_name || o.x.item_code, ""), qty: num(o.x.quantity), amt: o.d }));
      }

      else if (t === "return") {
        const { data, error } = await supabase.from("retail_sale_lines")
          .select("receipt_no,item_name,item_code,quantity,sales_amount")
          .eq("branch_id", bid).eq("sale_date", ds).lt("quantity", 0);
        if (error) setErr(error.message);
        ((data as Row[]) ?? [])
          .sort((a, b) => num(a.sales_amount) - num(b.sales_amount))
          .forEach((x) => push({ a: text(x.receipt_no, ""), b: text(x.item_name || x.item_code, ""), qty: num(x.quantity), amt: num(x.sales_amount) }));
      }

      else if (t === "ho") {
        /* Both halves, labelled. The imported lines and the one typed figure —
           which is the breakdown that makes the double-count visible. */
        const { data, error } = await supabase.from("retail_expenses")
          .select("description,amount")
          .eq("branch_id", bid).eq("expense_date", ds).eq("category", "Head Office");
        if (error) setErr(error.message);
        if (typedHo) push({ a: "Typed into the day editor", b: "typed", amt: typedHo });
        ((data as Row[]) ?? [])
          .sort((a, b) => num(b.amount) - num(a.amount))
          .forEach((x) => push({ a: text(x.description, "no note"), b: "from the import", amt: num(x.amount) }));
      }

      if (!live) return;
      setRows(out);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [bid, ds, t, typedHo]);

  const TITLES: Partial<Record<FieldKey, string>> = {
    card: "Card sales", credit: "Credit (udhaar) sales", jazz: "JazzCash sales",
    ho: "HO payment", exp: "Expenses", misc: "Misc income", return: "Returns", disc: "Discounts",
  };
  const HEADS: Partial<Record<FieldKey, [string, string?]>> = {
    card: ["Receipt", "Method"], credit: ["Receipt", "Party"], jazz: ["Receipt"],
    exp: ["Details / note", "Paid via"], misc: ["Details / note", "Paid via"],
    disc: ["Receipt", "Item"], return: ["Receipt", "Item"], ho: ["Details / note", "Where from"],
  };
  const hasQty = t === "disc" || t === "return";
  const [h1, h2] = HEADS[t] ?? ["Details"];

  const cols: Col<DetailRow>[] = [
    { head: h1, bold: true, cell: (x) => text(x.a) },
    ...(h2 ? [{ head: h2, muted: true, cell: (x: DetailRow) => text(x.b) } as Col<DetailRow>] : []),
    ...(hasQty ? [{ head: "Qty", right: true, cell: (x: DetailRow) => Math.round(num(x.qty)).toLocaleString("en-PK") } as Col<DetailRow>] : []),
    { head: "Amount", right: true, bold: true, cell: (x) => <span className={num(x.amt) < 0 ? "text-danger" : ""}>{money(x.amt)}</span> },
  ];
  const total = rows.reduce((a, x) => a + num(x.amt), 0);

  return (
    <Modal open onClose={onClose} wide title={TITLES[t] ?? "Details"} subtitle={ds}>
      {t === "credit" && (
        <p className="mb-3 text-[12.5px] text-muted dark:text-[#a89f93]">
          Sales taken on credit (udhaar). These are <strong>not</strong> card sales and no money is expected
          from the bank for them.
        </p>
      )}
      <DataTable
        cols={cols} rows={rows} loading={loading} err={err} minWidth={480}
        empty="Nothing of this kind on this day."
        footer={
          <tr className="font-bold text-ink dark:text-[#f4f1ea]">
            <td className="px-4 py-3" colSpan={cols.length - 1}>Total · {rows.length} entr{rows.length === 1 ? "y" : "ies"}</td>
            <td className="px-4 py-3 text-right tabular-nums">{money(total)}</td>
          </tr>
        }
      />
      <div className="mt-4 flex justify-end"><button onClick={onClose} className={btnGhost}>Close</button></div>
    </Modal>
  );
}

/* ── the day editor ──────────────────────────────────────────────────────────
 * Everything on one day that a person is allowed to type.
 */
function DayModal({ bid, r, onClose, onSaved }: { bid: number; r: CBRow; onClose: () => void; onSaved: (bk: Book) => void }) {
  const bk = r.bk ?? {};

  /* THE ONE THAT COST MONEY. `hoAuto` is the part of the HO column that came
     from the expense import; the box below is seeded with bk.ho_payment — the
     TYPED part — and never with r.ho. Seed it with the rendered total and every
     save re-adds the imported half: 19,770 → 39,540 → 59,310 → 79,080, with no
     error message at any point, because each save was arithmetically valid.
     hoAuto is added back only when recalculating for display, never written. */
  const hoAuto = r.eA.ho;

  const [ov, setOv] = useState(!!bk.sales_overridden);
  const [f, setF] = useState({
    ob: String(Math.round(r.openBal)),
    phys: r.phys == null ? "" : String(r.phys),
    gross: String(r.gross), net: String(r.net), cash: String(r.cash), card: String(r.card),
    jazz: String(r.jazz), credit: String(r.credit),
    nimexp: String(Math.round(r.cb)),
    splitCash: r.splitCash ? String(r.splitCash) : "",
    ho: num(bk.ho_payment) ? String(num(bk.ho_payment)) : "",   // TYPED PART ONLY
    party: r.party ? String(r.party) : "",
    pname: bk.party_name ?? "",
    rts: r.rts ? String(r.rts) : "",
    ret: r.ret ? String(r.ret) : "",
    note: bk.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));

  /* Live panel. Same four lines as the grid, so what the editor promises and
     what the row will show cannot disagree. */
  const calc = useMemo(() => {
    const ob = num(f.ob), cash = num(f.cash), sc = num(f.splitCash);
    const ho = num(f.ho) + hoAuto;                    // typed + imported, for display only
    const party = num(f.party), exp = r.exp, misc = r.misc;
    const cashRecv = ob + cash + sc;
    const cb = cashRecv + misc - ho - exp - party;
    const phys = f.phys.trim() === "" ? null : num(f.phys);
    const diff = phys == null ? null : phys - cb;
    const splitSum = cash + num(f.card) + num(f.credit) + num(f.jazz);
    const gap = splitSum - num(f.net);
    return { cashRecv, cb, diff, splitSum, gap, ho, exp, misc };
  }, [f, hoAuto, r.exp, r.misc]);

  /* "Nimbus expected cash" is what the EOD report says should be in the till.
     The gap between that and what the book computes IS the split — card money
     handed over as cash — so typing the expected figure derives split cash
     rather than making somebody work it out. */
  const fromNimbusExpected = (v: string) => {
    const ob = num(f.ob), cash = num(f.cash), ho = num(f.ho) + hoAuto, party = num(f.party);
    setF((o) => ({ ...o, nimexp: v, splitCash: String(Math.round(num(v) - (ob + cash + r.misc - ho - r.exp - party))) }));
  };

  async function save() {
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const rec: Book = {
      branch_id: bid, book_date: r.ds,
      opening_balance: num(f.ob),
      sales_overridden: ov,
      gross_sale: num(f.gross), net_sale: num(f.net), cash_sale: num(f.cash),
      card_sale: num(f.card), jazz_sale: num(f.jazz), credit_sale: num(f.credit),
      ho_payment: num(f.ho),               // typed part only — never r.ho
      party_payment: num(f.party), party_name: f.pname.trim() || null,
      rts: num(f.rts), return_refund: num(f.ret), split_cash: num(f.splitCash),
      physical_cash: f.phys.trim() === "" ? null : num(f.phys),
      note: f.note.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("retail_daily_book")
      .upsert(rec, { onConflict: "branch_id,book_date" }).select().maybeSingle();
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved((data as Book) ?? rec);
  }

  const roCls = `${inputCls} ${ov ? "" : "opacity-60"}`;

  return (
    <Modal open onClose={onClose} wide title={`Cash book — ${r.ds}`} subtitle="Sales fill in from Nimbus unless you override them.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opening balance"><input className={inputCls} type="number" value={f.ob} onChange={(e) => set("ob", e.target.value)} /></Field>
        <Field label="Physical cash counted"><input className={inputCls} type="number" value={f.phys} onChange={(e) => set("phys", e.target.value)} placeholder="not counted" /></Field>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-ink dark:text-[#e7e2d8]">
        <input type="checkbox" checked={ov} onChange={(e) => setOv(e.target.checked)} className="h-4 w-4 accent-[#141414] dark:accent-white" />
        Override sales (otherwise auto from Nimbus)
      </label>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Gross sale"><input className={roCls} type="number" readOnly={!ov} value={f.gross} onChange={(e) => set("gross", e.target.value)} /></Field>
        <Field label="Net sale"><input className={roCls} type="number" readOnly={!ov} value={f.net} onChange={(e) => set("net", e.target.value)} /></Field>
        <Field label="Cash sale"><input className={roCls} type="number" readOnly={!ov} value={f.cash} onChange={(e) => set("cash", e.target.value)} /></Field>
        <Field label="Card sale"><input className={roCls} type="number" readOnly={!ov} value={f.card} onChange={(e) => set("card", e.target.value)} /></Field>
        <Field label="JazzCash sale"><input className={roCls} type="number" readOnly={!ov} value={f.jazz} onChange={(e) => set("jazz", e.target.value)} /></Field>
        <Field label="Credit (udhaar) sale"><input className={roCls} type="number" readOnly={!ov} value={f.credit} onChange={(e) => set("credit", e.target.value)} /></Field>

        <Field label="Nimbus expected cash (EOD)"><input className={inputCls} type="number" value={f.nimexp} onChange={(e) => fromNimbusExpected(e.target.value)} placeholder="0" /></Field>
        <Field label="Split cash (worked out from the above)"><input className={inputCls} type="number" value={f.splitCash} onChange={(e) => set("splitCash", e.target.value)} placeholder="0" /></Field>
        <Field label={hoAuto > 0 ? `HO payment typed here (+ ${money(hoAuto)} already in from the import)` : "HO payment typed here"}>
          <input className={inputCls} type="number" value={f.ho} onChange={(e) => set("ho", e.target.value)} placeholder="0" />
        </Field>

        <Field label="Party payment"><input className={inputCls} type="number" value={f.party} onChange={(e) => set("party", e.target.value)} placeholder="0" /></Field>
        <Field label="Party name"><input className={inputCls} value={f.pname} onChange={(e) => set("pname", e.target.value)} /></Field>
        <Field label="RTS"><input className={inputCls} type="number" value={f.rts} onChange={(e) => set("rts", e.target.value)} placeholder="0" /></Field>
        <Field label="Return / refund"><input className={inputCls} type="number" value={f.ret} onChange={(e) => set("ret", e.target.value)} placeholder="0" /></Field>
      </div>

      <div className="mt-3"><Field label="Note"><input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="anything worth remembering about this day" /></Field></div>

      <div className="mt-4 rounded-card border border-line bg-panel/60 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <p className="text-[12px] text-muted dark:text-[#a89f93]">
          Auto expenses <strong className="text-ink dark:text-[#f4f1ea]">{money(calc.exp)}</strong>
          {" · "}Misc income <strong className="text-ink dark:text-[#f4f1ea]">{money(calc.misc)}</strong>
          {" · "}HO from the import <strong className="text-ink dark:text-[#f4f1ea]">{money(hoAuto)}</strong>
          {" "}<span className="text-hint dark:text-[#8a8175]">(edit those on the Expenses screen)</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <span>Cash receivable <strong className="tabular-nums text-ink dark:text-[#f4f1ea]">{money(calc.cashRecv)}</strong></span>
          <span>Closing balance <strong className="tabular-nums text-ink dark:text-[#f4f1ea]">{money(calc.cb)}</strong></span>
          <span className="flex items-center gap-2">Cash difference{" "}
            {calc.diff == null
              ? <Pill tone="neutral">{moneyOrDash(null)}</Pill>
              : <Diff value={calc.diff} />}
          </span>
        </div>
        {/* A warning, never a block. The split not adding up to net is usually a
            real mis-keyed payment method, but it is sometimes the shop's day and
            refusing to save it would just push the error somewhere worse. */}
        {Math.abs(calc.gap) > 1 && (
          <p className="mt-2 text-[12.5px] font-semibold text-danger">
            Cash + card + credit + JazzCash is {money(calc.splitSum)} but net sale is {money(num(f.net))} —{" "}
            {money(Math.abs(calc.gap))} {calc.gap > 0 ? "too much" : "missing"}. You can still save.
          </p>
        )}
      </div>

      {err && <p className="mt-3 text-[12.5px] font-semibold text-danger">{err}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className={btnGhost}>Cancel</button>
        <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save day"}</button>
      </div>
    </Modal>
  );
}
