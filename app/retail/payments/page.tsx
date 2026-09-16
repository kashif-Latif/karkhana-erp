"use client";
/* Non-cash — everything that was sold but did not go into the till.
 *
 * WHY THIS SCREEN EXISTS AT ALL
 *   Two jobs, and only one of them is reading.
 *
 *   1. CARD SETTLEMENT PREVIEW. A day's card sales are recorded GROSS at the
 *      till; the acquirer credits NET, a day or so later, into one pooled
 *      account with no shop name on it. So the question "how much should land
 *      tomorrow?" has to be answered here before anybody can tell whether it
 *      did. Without the charge applied, ~1.28% of card turnover reads as
 *      permanently missing money.
 *
 *   2. TAGGING UNCLASSIFIED RECEIPTS. This is the important half, and it is
 *      the reason the screen is not read-only. Nothing else anywhere in the
 *      app can set `payment_method`. A sale line that arrives as
 *      'unclassified' — the import could not tell what it was — therefore
 *      stays unclassified for ever: it is real revenue that never lands in a
 *      payment bucket, never reconciles against the bank, and never shows up
 *      as either cash or card. The Dashboard already tells the user to "tag
 *      them as JazzCash or Card to sharpen the payment split" and until this
 *      screen existed there was nowhere to do it. The four buttons below are
 *      that nowhere.
 *
 * THE RULE THAT COST MONEY
 *   Nimbus MOP "Credit" is UDHAAR — goods taken on account by a customer, to
 *   be paid later. It is NOT a credit card. Counting it as card is what made
 *   FC DHA's 1 Sep card figure read 36,100 instead of 33,400. Card is
 *   payment_method='meezan_card' and nothing else, and only the two Fashion
 *   Collection shops take credit sales at all. Every button and label on this
 *   page spells "Credit (udhaar)" in full for that reason.
 *
 * AMOUNTS COME FROM sales_amount, WITH NO FALLBACK
 *   Not `sales_amount || net_sales`. A line whose sales_amount is genuinely
 *   zero — a full return, a zero-value exchange — is zero, and substituting a
 *   different column because the first one looked falsy invents revenue out of
 *   a discount field.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, CreditCard, Smartphone, Globe, Users, Banknote, HelpCircle, CheckCircle2,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, BranchPicker, PreviewNote, SourceNote,
  useBranches, money, num, text, today, fetchAll, CARD_RATE_PCT, cardExpected,
  type Row, type Col,
} from "@/components/retail/kit";

/* 'cash' is deliberately absent from the mix below — this screen is the other
   side of it. 'unclassified' IS here, because a row nobody has categorised is
   a row nobody is chasing, and hiding it would make the totals look tidier
   than they are. */
const METHODS = [
  { key: "meezan_card", label: "Card", Icon: CreditCard, tone: "info" as const },
  { key: "jazzcash", label: "JazzCash", Icon: Smartphone, tone: "warn" as const },
  { key: "online", label: "Online", Icon: Globe, tone: "info" as const },
  { key: "credit", label: "Credit (udhaar)", Icon: Users, tone: "bad" as const },
  { key: "other", label: "Other", Icon: ArrowLeftRight, tone: "neutral" as const },
  { key: "unclassified", label: "Unclassified", Icon: HelpCircle, tone: "neutral" as const },
];
const LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]));
const TONE = Object.fromEntries(METHODS.map((m) => [m.key, m.tone]));

/* The four things an untagged receipt can turn out to be. 'credit' is udhaar
   and is labelled in full so that nobody tags a Visa payment with it — the two
   are one click apart and the mistake is invisible afterwards. */
const CLASSIFY_AS = [
  { pm: "jazzcash", label: "JazzCash", cls: "bg-amber-soft text-amber-strong hover:opacity-90" },
  { pm: "meezan_card", label: "Card", cls: "bg-periwinkle-soft text-periwinkle-strong hover:opacity-90" },
  { pm: "credit", label: "Credit (udhaar)", cls: "bg-salmon-soft text-salmon-strong hover:opacity-90" },
  { pm: "cash", label: "Cash", cls: "bg-success-soft text-success hover:opacity-90" },
];

/** ISO date + n days, built from the string's own parts.
 *  Not the kit's `iso()`, which goes through toISOString() and therefore
 *  converts to UTC — in Pakistan (UTC+5) that turns local midnight into the
 *  previous day, and a settlement date that is one day early is worse than no
 *  settlement date at all. */
const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00");
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

type UncLine = {
  id: number; branch_id: number | null; sale_date: string | null; sale_time: string | null;
  receipt_no: string | null; receipt_txn: string | null; sales_amount: number | null;
};
/** One physical receipt: every line the customer paid for in one go. Tagging is
 *  per receipt, never per line — half a bill on card and half on cash is not a
 *  thing that happens, and offering it would only create wrong data. */
type UncGroup = {
  key: string; branch_id: number | null; date: string; time: string;
  receipt: string; amt: number; ids: number[];
};

type Agg = { branch_id: number; method: string; amount: number; lines: number };

const dateInputCls =
  "rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink outline-none transition dark:border-white/10 dark:bg-white/[0.06] dark:text-white";

export default function NonCashPage() {
  const { branches, branchName } = useBranches();
  const [branch, setBranch] = useState("");

  /* ── section 1 state: one day, one rate ────────────────────────────────── */
  const [day, setDay] = useState(() => addDays(today(), -1));
  /* Editable, because an acquirer's rate is renegotiated and a screen that
     hard-codes it becomes wrong quietly. Defaults to the one constant the
     whole app agrees on. */
  const [rate, setRate] = useState(String(CARD_RATE_PCT));
  const [cardRows, setCardRows] = useState<Row[]>([]);
  const [loadingCard, setLoadingCard] = useState(true);
  const [errCard, setErrCard] = useState("");

  /* ── section 2 state: the backlog ──────────────────────────────────────── */
  const [unc, setUnc] = useState<UncGroup[]>([]);
  const [loadingUnc, setLoadingUnc] = useState(true);
  const [errUnc, setErrUnc] = useState("");
  const [busy, setBusy] = useState("");

  /* ── section 3 state: the mix over a range ─────────────────────────────── */
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [mix, setMix] = useState<Row[]>([]);
  const [loadingMix, setLoadingMix] = useState(true);
  const [errMix, setErrMix] = useState("");

  /* ── 1. card settlement preview ────────────────────────────────────────── */

  const loadCard = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoadingCard(false); return; }
    const db = supabase;
    setLoadingCard(true); setErrCard("");
    const { rows, error } = await fetchAll<Row>((lo, hi) => {
      let q = db.from("retail_sale_lines")
        .select("branch_id,sales_amount")
        /* 'meezan_card' and nothing else. Widening this to "anything that
           looks like a card" is exactly how the FC DHA figure went wrong. */
        .eq("payment_method", "meezan_card")
        .eq("sale_date", day);
      if (branch) q = q.eq("branch_id", Number(branch));
      return q.order("id", { ascending: true }).range(lo, hi);
    });
    if (error) setErrCard(error);
    setCardRows(rows);
    setLoadingCard(false);
  }, [day, branch]);
  useEffect(() => { loadCard(); }, [loadCard]);

  const ratePct = num(rate);

  const cardByBranch = useMemo(() => {
    const m = new Map<string, number>();
    cardRows.forEach((r) => {
      const k = String(r.branch_id);
      m.set(k, (m.get(k) ?? 0) + num(r.sales_amount));
    });
    return m;
  }, [cardRows]);

  const chains = useMemo(
    () => [...new Set(branches.map((b) => String(b.chain ?? "")).filter(Boolean))],
    [branches]
  );
  const multiChain = chains.length > 1;

  type CardRow =
    | { kind: "chain"; key: string; label: string; gross: number; net: number }
    | { kind: "store"; key: string; label: string; gross: number; net: number };

  const cardTable = useMemo(() => {
    const out: CardRow[] = [];
    let gross = 0, net = 0;
    chains.forEach((ch) => {
      const stores = branches
        .filter((b) => String(b.chain ?? "") === ch && (cardByBranch.get(String(b.id)) ?? 0) !== 0)
        .map((b) => {
          const g = cardByBranch.get(String(b.id)) ?? 0;
          /* net = gross × (1 − rate/100), straight from the kit so this screen
             and the card-reconciliation screen cannot drift apart. The charge
             column is the difference, never a second multiplication. */
          return { key: "b:" + b.id, label: b.name, gross: g, net: cardExpected(g, ratePct) };
        });
      if (!stores.length) return;
      const cg = stores.reduce((t, s) => t + s.gross, 0);
      const cn = stores.reduce((t, s) => t + s.net, 0);
      if (multiChain) out.push({ kind: "chain", key: "c:" + ch, label: ch, gross: cg, net: cn });
      stores.forEach((s) => out.push({ kind: "store", ...s }));
      gross += cg; net += cn;
    });
    return { out, gross, net };
  }, [chains, branches, cardByBranch, ratePct, multiChain]);

  /* ── 2. receipts still to classify ─────────────────────────────────────── */

  /* Deliberately NOT bounded by the range bar. An unclassified line from three
     months ago is still stuck revenue, and a date filter that hides it is a
     filter that makes the backlog look finished. */
  const loadUnc = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoadingUnc(false); return; }
    const db = supabase;
    setLoadingUnc(true); setErrUnc("");
    const { rows, error } = await fetchAll<UncLine>((lo, hi) => {
      let q = db.from("retail_sale_lines")
        .select("id,branch_id,sale_date,sale_time,receipt_no,receipt_txn,sales_amount")
        .eq("payment_method", "unclassified");
      if (branch) q = q.eq("branch_id", Number(branch));
      return q.order("id", { ascending: true }).range(lo, hi);
    });
    if (error) { setErrUnc(error); setLoadingUnc(false); return; }

    /* Grouped by branch + receipt + date, exactly as the old app did. The
       fallback to the line's own id matters: a line with no receipt_txn is its
       own receipt, and collapsing all of them into one key would offer a
       single button that retags an entire day. */
    const m = new Map<string, UncGroup>();
    rows.forEach((r) => {
      const k = `${r.branch_id}|${r.receipt_txn || r.id}|${r.sale_date}`;
      const g = m.get(k) ?? {
        key: k, branch_id: r.branch_id,
        date: String(r.sale_date ?? ""), time: String(r.sale_time ?? ""),
        receipt: String(r.receipt_no ?? r.receipt_txn ?? ""),
        amt: 0, ids: [],
      };
      g.amt += num(r.sales_amount);
      g.ids.push(Number(r.id));
      m.set(k, g);
    });
    const groups = [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
    setUnc(groups);
    setLoadingUnc(false);
  }, [branch]);
  useEffect(() => { loadUnc(); }, [loadUnc]);

  async function classify(g: UncGroup, pm: string) {
    if (!supabase) return;
    setBusy(g.key); setErrUnc("");
    /* Chunked at 300 ids. PostgREST turns .in() into a query-string list, and
       a busy receipt can be dozens of lines — a large group sent in one go
       trips the URL length limit and comes back as a 414 that reads like a
       network blip. Chunking also means a partial failure leaves a visibly
       half-tagged receipt rather than silently doing nothing. */
    for (let i = 0; i < g.ids.length; i += 300) {
      const chunk = g.ids.slice(i, i + 300);
      const { error } = await supabase.from("retail_sale_lines")
        .update({ payment_method: pm }).in("id", chunk);
      if (error) { setErrUnc(error.message); setBusy(""); return; }
    }
    /* Removed from the list rather than re-fetched: the row is done, and a
       full reload here would scroll the operator away from the next one. */
    setUnc((gs) => gs.filter((x) => x.key !== g.key));
    setBusy("");
    loadMix();
  }

  const uncTotal = useMemo(() => unc.reduce((t, g) => t + g.amt, 0), [unc]);

  /* ── 3. the mix over a range ───────────────────────────────────────────── */

  const loadMix = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoadingMix(false); return; }
    const db = supabase;
    setLoadingMix(true); setErrMix("");
    const [from, to] = rangeDates(preset, cf, ct);
    /* Paged, not .limit(20000): PostgREST caps a response at 1000 rows
       whatever the limit says, and a share bar computed off a silently
       truncated fetch is a percentage of the wrong denominator.
       The .or() rather than a plain .neq('cash') is because `neq` drops NULLs
       in SQL, and a line with no payment_method at all is precisely the kind
       of row this screen is supposed to surface. */
    const { rows, error } = await fetchAll<Row>((lo, hi) => {
      let q = db.from("retail_sale_lines")
        .select("branch_id,payment_method,sales_amount")
        .or("payment_method.neq.cash,payment_method.is.null");
      if (from) q = q.gte("sale_date", from);
      if (to) q = q.lte("sale_date", to);
      if (branch) q = q.eq("branch_id", Number(branch));
      return q.order("id", { ascending: true }).range(lo, hi);
    });
    if (error) setErrMix(error);
    setMix(rows);
    setLoadingMix(false);
  }, [preset, cf, ct, branch]);
  useEffect(() => { loadMix(); }, [loadMix]);

  /* Aggregated in the browser rather than by a view, because the line grain is
     what makes a drill-down possible later and a view would throw it away. */
  const agg: Agg[] = useMemo(() => {
    const map = new Map<string, Agg>();
    mix.forEach((r) => {
      const bid = Number(r.branch_id);
      const m = String(r.payment_method || "unclassified");
      const k = `${bid}:${m}`;
      /* sales_amount only — see the note at the top of this file. */
      const amt = num(r.sales_amount);
      const cur = map.get(k) ?? { branch_id: bid, method: m, amount: 0, lines: 0 };
      cur.amount += amt; cur.lines += 1;
      map.set(k, cur);
    });
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [mix]);

  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    agg.forEach((a) => m.set(a.method, (m.get(a.method) ?? 0) + a.amount));
    return m;
  }, [agg]);

  const total = useMemo(() => [...byMethod.values()].reduce((t, v) => t + v, 0), [byMethod]);

  const stats = [
    { label: `To classify · ${unc.length} receipt${unc.length === 1 ? "" : "s"}`, value: money(uncTotal), Icon: HelpCircle },
    { label: "Card", value: money(byMethod.get("meezan_card") ?? 0), Icon: CreditCard },
    { label: "JazzCash", value: money(byMethod.get("jazzcash") ?? 0), Icon: Smartphone },
    { label: "Credit (udhaar)", value: money(byMethod.get("credit") ?? 0), Icon: Users },
  ];

  const cols: Col<Agg>[] = [
    { head: "Branch", bold: true, cell: (a) => branchName(a.branch_id) },
    { head: "Method", cell: (a) => <Pill tone={TONE[a.method] ?? "neutral"}>{LABEL[a.method] ?? text(a.method)}</Pill> },
    { head: "Lines", right: true, muted: true, cell: (a) => a.lines.toLocaleString() },
    { head: "Amount", right: true, bold: true, cell: (a) => money(a.amount) },
    { head: "Share", right: true, muted: true, cell: (a) => (total ? ((a.amount / total) * 100).toFixed(1) + "%" : "—") },
  ];

  const refreshAll = () => { loadCard(); loadUnc(); loadMix(); };

  return (
    <Shell>
      <PageHeader title="Non-cash" subtitle="Card, JazzCash, online and udhaar — sales that never reached the till."
        onRefresh={refreshAll} loading={loadingCard || loadingUnc || loadingMix}>
        <BranchPicker branches={branches} value={branch} onChange={setBranch} />
      </PageHeader>

      <StatCards stats={stats} loading={loadingUnc || loadingMix} />

      {/* ── 1. CARD SETTLEMENT PREVIEW ──────────────────────────────────── */}
      <section className="mt-7">
        <h2 className="text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Card settlement preview</h2>
        <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">
          Card sales per shop for one day. The till records gross; the acquirer credits net, so this is
          what should actually arrive.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">
            Day
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={dateInputCls} />
          </label>
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">
            Bank charge %
            <input type="number" step="0.001" value={rate} onChange={(e) => setRate(e.target.value)}
              className={`${dateInputCls} w-[92px] tabular-nums`} />
          </label>
        </div>

        <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                  <th className="px-4 py-3 font-semibold">Store</th>
                  <th className="px-4 py-3 text-right font-semibold">Card sales (gross)</th>
                  <th className="px-4 py-3 text-right font-semibold">Bank charge {ratePct}%</th>
                  <th className="px-4 py-3 text-right font-semibold">Net expected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                {loadingCard ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={4} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>
                  ))
                ) : errCard ? (
                  <tr><td colSpan={4} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load: {errCard}</td></tr>
                ) : cardTable.out.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-14 text-center text-[13px] text-muted dark:text-[#a89f93]">No card sales on {day}.</td></tr>
                ) : (
                  cardTable.out.map((r) =>
                    r.kind === "chain" ? (
                      <tr key={r.key} className="bg-periwinkle-soft text-ink dark:bg-white/[0.05] dark:text-[#f4f1ea]">
                        <td className="px-4 py-2.5 font-extrabold">{r.label}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums">{money(r.gross)}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-danger">−{money(r.gross - r.net)}</td>
                        <td className="px-4 py-2.5 text-right font-extrabold tabular-nums">{money(r.net)}</td>
                      </tr>
                    ) : (
                      <tr key={r.key} className="text-ink dark:text-[#e7e2d8]">
                        <td className={`px-4 py-3 font-semibold ${multiChain ? "pl-8" : ""}`}>{r.label}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(r.gross)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-danger">−{money(r.gross - r.net)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.net)}</td>
                      </tr>
                    )
                  )
                )}
              </tbody>
              {!loadingCard && !errCard && cardTable.out.length > 0 && (
                <tfoot className="border-t-2 border-line dark:border-white/[0.08]">
                  <tr className="bg-panel/70 font-bold text-ink dark:bg-white/[0.04] dark:text-[#f4f1ea]">
                    <td className="px-4 py-3">All stores</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(cardTable.gross)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-danger">−{money(cardTable.gross - cardTable.net)}</td>
                    <td className="px-4 py-3 text-right font-extrabold tabular-nums">{money(cardTable.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {!loadingCard && cardTable.net > 0 && (
          <div className="mt-3 rounded-card border border-line bg-periwinkle-soft px-4 py-3 text-[13px] text-ink dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-[#e7e2d8]">
            Net card expected for <strong>{day}</strong>: <strong className="tabular-nums">{money(cardTable.net)}</strong>
            {" "}— this should settle into the account on <strong>{addDays(day, 1)}</strong>.
          </div>
        )}
      </section>

      {/* ── 2. RECEIPTS STILL TO CLASSIFY ───────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Receipts still to classify</h2>
        <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">
          Sales the import could not tag. Nothing else in the app can set a payment method, so until one
          of these buttons is pressed this money belongs to no bucket at all — it is neither cash nor
          card, and it reconciles against nothing. Not filtered by any date range on purpose.
        </p>

        {errUnc && <p className="mt-3 text-[12.5px] font-semibold text-danger">Couldn&apos;t update: {errUnc}</p>}

        <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">Branch</th>
                  <th className="px-4 py-3 font-semibold">Receipt</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 text-right font-semibold">Lines</th>
                  <th className="px-4 py-3 font-semibold">Set as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                {loadingUnc ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>
                  ))
                ) : unc.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-14 text-center text-[13px] text-muted dark:text-[#a89f93]">
                    <span className="inline-flex items-center gap-2 font-semibold text-success"><CheckCircle2 size={16} /> Nothing to classify</span>
                    <span className="mt-1 block">Every non-cash sale is tagged.</span>
                  </td></tr>
                ) : (
                  unc.map((g) => (
                    <tr key={g.key} className={`text-ink transition dark:text-[#e7e2d8] ${busy === g.key ? "opacity-40" : "hover:bg-panel/50 dark:hover:bg-white/[0.03]"}`}>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{text(g.date)}</td>
                      <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{text(g.time)}</td>
                      <td className="px-4 py-3 font-semibold">{branchName(g.branch_id)}</td>
                      <td className="px-4 py-3">{text(g.receipt)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(g.amt)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted dark:text-[#a89f93]">{g.ids.length}</td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap gap-1.5">
                          {CLASSIFY_AS.map((c) => (
                            <button key={c.pm} onClick={() => classify(g, c.pm)} disabled={busy === g.key}
                              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 dark:bg-white/[0.08] dark:text-white ${c.cls}`}>
                              {c.label}
                            </button>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {!loadingUnc && unc.length > 0 && (
                <tfoot className="border-t-2 border-line dark:border-white/[0.08]">
                  <tr className="bg-panel/70 font-bold text-ink dark:bg-white/[0.04] dark:text-[#f4f1ea]">
                    <td className="px-4 py-3" colSpan={4}>{unc.length} receipt{unc.length === 1 ? "" : "s"} waiting</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(uncTotal)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{unc.reduce((t, g) => t + g.ids.length, 0).toLocaleString()}</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <SourceNote>
          <strong>&ldquo;Credit&rdquo; here means udhaar — goods taken on account, to be paid later. It is
          not a credit card.</strong> A card payment is <code>meezan_card</code> and nothing else. The two
          buttons sit next to each other and the mistake leaves no trace afterwards, which is how FC
          DHA&apos;s 1 Sep card figure came to read 36,100 instead of 33,400. Only the two Fashion
          Collection shops take credit sales at all. Tagging writes to every line on the receipt at once,
          because half a bill on card and half on cash is not a thing that happens.
        </SourceNote>
      </section>

      {/* ── 3. THE MIX ──────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Where the non-cash money went</h2>
        <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">
          The split across methods for a range, and the same numbers broken out per shop below.
        </p>

        <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {METHODS.map(({ key, label, Icon }) => {
            const v = byMethod.get(key) ?? 0;
            const pct = total ? (v / total) * 100 : 0;
            return (
              <div key={key} className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-ink dark:bg-white/[0.08] dark:text-white"><Icon size={15} /></span>
                  <span className="text-[13px] font-semibold text-ink dark:text-[#e7e2d8]">{label}</span>
                  <span className="ml-auto text-[13px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loadingMix ? "—" : money(v)}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
                  <div className="h-full rounded-full bg-ink dark:bg-white" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <div className="mt-1.5 text-[11.5px] font-medium text-muted dark:text-[#a89f93]">{pct.toFixed(1)}% of non-cash</div>
              </div>
            );
          })}
        </div>

        <DataTable cols={cols} rows={agg} loading={loadingMix} err={errMix} minWidth={720}
          empty="No non-cash sales in this range." />
      </section>

      <SourceNote>
        Amounts come from <code>sales_amount</code> only, with no fallback to <code>net_sales</code> — a
        line that is genuinely zero is zero, and substituting a different column because the first looked
        falsy invents revenue. None of these figures move the cash book, because none of this money
        enters the till. <Banknote size={12} className="inline align-[-1px]" /> Cash is the other side of
        this screen and lives in the cash book.
      </SourceNote>

      <PreviewNote />
    </Shell>
  );
}
