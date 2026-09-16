"use client";
/* END OF DAY — count the office safe, note by note.
 *
 * WHY COUNT BY DENOMINATION AND NOT JUST TYPE A TOTAL
 *   A typed total is a claim. A denomination count is a claim that can be
 *   checked against the drawer without recounting from scratch, and when it is
 *   short by 500 the breakdown usually says which bundle is wrong. It also
 *   takes the same amount of time, because the person is holding the notes
 *   either way.
 *
 * WHAT "EXPECTED" MEANS HERE  (this is the whole screen)
 *   Expected is recomputed from the ENTIRE Head Office cash-flow ledger up to
 *   and including the chosen day:
 *
 *       expected(day) = Σ over retail_ho_cashflow where flow_date <= day
 *                         of (direction === 'in' ? +amount : −amount)
 *
 *   It is NOT "the last physical count plus that one day's movements". That
 *   older definition looked equivalent and was not, in two ways that both cost
 *   real money:
 *
 *     1. A SKIPPED COUNTING DAY DROPPED ITS CASH. Anchoring on the last count
 *        and adding only the CHOSEN day's flows silently discards every entry
 *        on the days in between. Count on Monday, skip Tuesday and Wednesday,
 *        count on Thursday, and Tuesday's and Wednesday's cash simply is not in
 *        the expected figure — the drawer looks over by exactly the money that
 *        moved while nobody was counting.
 *
 *     2. A SHORTFALL WAS LAUNDERED INTO THE NEW BASELINE. If Monday closed
 *        5,000 short, taking Monday's COUNT as Tuesday's opening writes the
 *        missing 5,000 out of existence: Tuesday balances perfectly and the
 *        5,000 is never asked about again. Recomputing from the ledger keeps
 *        that 5,000 in the difference on Tuesday, Wednesday and every day
 *        after, until somebody posts a cash-flow entry that explains it. That
 *        persistence is the point of the screen, not a bug in it.
 *
 *   No shop till is in that sum. Each branch balances separately in its own
 *   cash book against its own physical count; the office is not a till, and
 *   this screen is head-office only (location = 'head_office').
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Coins, Scale, Save, CalendarDays } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { btnPrimary } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, Diff, PreviewNote, SourceNote,
  money, num, text, today, fetchAll, type Col,
} from "@/components/retail/kit";

/* ── the denominations ───────────────────────────────────────────────────────
 * ONE flat list, and everything that adds money up iterates THIS.
 *
 * WHY THAT MATTERS: this screen used to hold two lists —
 *     NOTES = [5000,1000,500,100,50,20,10]   COINS = [10,5,2,1]
 * — and Rs 10 appeared in both. Each list rendered its own input, both bound to
 * counts["10"], and the total reduced over NOTES.concat(COINS), so ten rupees
 * was added twice: five Rs 10 notes counted as Rs 100. Worse, save() wrote a
 * row that contradicted itself — denoms {"10": 5} with total 100 — so the
 * stored evidence disagreed with the stored answer and neither could be used to
 * check the other.
 *
 * The two groups below are a VISUAL split of this one list (Rs 10 circulates as
 * both a note and a coin; it is filed with the notes because that is where it
 * is usually stacked). They partition DENOMS — every denomination appears in
 * exactly one group, and the groups together are exactly DENOMS.
 */
const DENOMS = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];
const NOTE_GROUP = DENOMS.filter((d) => d >= 10);
const COIN_GROUP = DENOMS.filter((d) => d < 10);

/** The day before `ds`, computed from the STRING PARTS.
 *
 *  WHY NOT `new Date(ds + "T00:00:00").getTime() - 86400000` + `toISOString()`:
 *  that parses as LOCAL midnight and then formats as UTC, so in any UTC+
 *  timezone it lands on the day before the day before. In Asia/Karachi
 *  (UTC+05:00) the old line turned 2026-09-16 into 2026-09-14 — a whole day of
 *  office cash flow fell outside every window built from it, and nothing
 *  errored. Date.UTC in and getUTC* out means no timezone is involved at any
 *  point, so the answer is the same in Karachi, London and a CI box on UTC. */
function prevDay(ds: string): string {
  const [y, m, d] = ds.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

type Flow = { flow_date: string; direction: string | null; amount: number | null };
type Count = { count_date: string; total: number | null };

export default function EndOfDayPage() {
  const [date, setDate] = useState(today());
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [ledger, setLedger] = useState<Flow[]>([]);
  const [history, setHistory] = useState<Count[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");
  /* False when retail_cash_count has no updated_at column on this database. A
     count that was corrected at 6pm must not be stamped with the time it was
     first keyed in at 9am — that reads as "nobody has touched this since this
     morning" and is how a stale figure gets trusted. Where the column is
     missing we say plainly that the stamp is the FIRST save rather than
     quietly mislabelling it. */
  const [hasUpdatedAt, setHasUpdatedAt] = useState(true);

  /* Every money figure on this screen iterates DENOMS, once. */
  const counted = useMemo(
    () => DENOMS.reduce((t, d) => t + d * (Number(counts[d]) || 0), 0),
    [counts]
  );

  /** The ledger balance as at `ds`. flow_date is 'YYYY-MM-DD', so a string
   *  compare is a date compare — no Date object, no timezone. */
  const expectedAt = useCallback(
    (ds: string) =>
      ledger.reduce(
        (t, r) =>
          String(r.flow_date) <= ds
            ? t + (String(r.direction).toLowerCase() === "in" ? num(r.amount) : -num(r.amount))
            : t,
        0
      ),
    [ledger]
  );

  const expected = useMemo(() => expectedAt(date), [expectedAt, date]);

  /* Today's movement, for the card. Informational only — it is NOT how
     `expected` is built, and must not become how it is built again. */
  const movement = useMemo(
    () =>
      ledger.reduce(
        (t, r) =>
          String(r.flow_date) === date
            ? t + (String(r.direction).toLowerCase() === "in" ? num(r.amount) : -num(r.amount))
            : t,
        0
      ),
    [ledger, date]
  );

  /* What yesterday's count was out by, if it was counted. Shown because that
     difference is still inside today's — see the header comment. */
  const carried = useMemo(() => {
    const pd = prevDay(date);
    const last = history.find((h) => String(h.count_date) <= pd);
    if (!last) return null;
    return { on: String(last.count_date), diff: num(last.total) - expectedAt(String(last.count_date)) };
  }, [history, date, expectedAt]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr(""); setSavedAt("");

    /* The whole ledger up to the chosen day, paged. A `.limit()` here would cap
       the sum silently and expected would drift low for ever after. */
    const ledgerP = fetchAll<Flow>((lo, hi) =>
      supabase!.from("retail_ho_cashflow").select("flow_date,direction,amount")
        .lte("flow_date", date).order("flow_date").range(lo, hi));

    /* Ask for updated_at; fall back once if this database does not have it, and
       remember, so Refresh does not keep firing a request that cannot succeed. */
    const mineP = supabase.from("retail_cash_count")
      .select(hasUpdatedAt ? "denoms,total,note,created_at,updated_at" : "denoms,total,note,created_at")
      .eq("location", "head_office").eq("count_date", date).maybeSingle();

    const histP = supabase.from("retail_cash_count").select("count_date,total")
      .eq("location", "head_office").order("count_date", { ascending: false }).limit(60);

    const [led, mine0, hist] = await Promise.all([ledgerP, mineP, histP]);

    let mine = mine0;
    if (mine.error && (mine.error.code === "42703" || /updated_at/.test(mine.error.message))) {
      setHasUpdatedAt(false);
      mine = await supabase.from("retail_cash_count")
        .select("denoms,total,note,created_at")
        .eq("location", "head_office").eq("count_date", date).maybeSingle();
    }

    if (led.error) setErr(led.error);
    else if (mine.error) setErr(mine.error.message);

    setLedger(led.rows);
    setHistory((hist.data as Count[]) ?? []);

    const d = mine.data as
      { denoms?: Record<string, number>; note?: string; created_at?: string; updated_at?: string } | null;
    setCounts(d?.denoms ? Object.fromEntries(Object.entries(d.denoms).map(([k, v]) => [k, String(v)])) : {});
    setNote(d?.note ?? "");
    const stamp = d?.updated_at ?? d?.created_at ?? "";
    setSavedAt(stamp ? new Date(stamp).toLocaleString("en-GB") : "");
    setLoading(false);
  }, [date, hasUpdatedAt]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    /* Written from the same single list the total is summed over, so the row
       can never disagree with itself the way the two-list version did. */
    const denoms = Object.fromEntries(
      DENOMS.map((d) => [String(d), Number(counts[d]) || 0]).filter(([, v]) => Number(v) > 0)
    );
    const { error } = await supabase.from("retail_cash_count").upsert(
      { location: "head_office", count_date: date, denoms, total: counted, note: note.trim() || null },
      /* retail_cash_count has UNIQUE (location, count_date), so this resolves. */
      { onConflict: "location,count_date" }
    );
    setSaving(false);
    if (error) { setErr(error.message); return; }
    load();
  }

  const stats = [
    { label: "Counted", value: money(counted), Icon: Banknote },
    { label: "Expected (whole ledger)", value: money(expected), Icon: Scale },
    { label: "Difference", value: money(counted - expected), Icon: Coins },
    { label: "This day's movement", value: money(movement), Icon: CalendarDays },
  ];

  function Grid({ title, list }: { title: string; list: number[] }) {
    return (
      <div className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-hint dark:text-[#8a8175]">{title}</div>
        <div className="space-y-2">
          {list.map((d) => {
            const n = Number(counts[d]) || 0;
            return (
              <div key={d} className="flex items-center gap-3">
                <span className="w-16 text-right text-[13px] font-bold tabular-nums text-ink dark:text-[#e7e2d8]">{d.toLocaleString()}</span>
                <span className="text-[12px] text-hint">×</span>
                <input type="number" min={0} inputMode="numeric" value={counts[d] ?? ""}
                  onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value }))}
                  className="w-20 rounded-xl2 border border-line bg-canvas px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none transition focus:border-ink/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-white" />
                <span className="flex-1 text-right text-[13px] tabular-nums text-muted dark:text-[#a89f93]">{n ? money(d * n) : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* CASH HISTORY — the last 60 counts, any of which can be pulled back up.
     Without it a saved count is write-only: there is no way to see what the
     safe held on the 3rd, and no way to correct it. */
  const histCols: Col<Count>[] = [
    { head: "Date", bold: true, cell: (r) => text(r.count_date) },
    { head: "Cash counted", right: true, cell: (r) => money(r.total) },
    { head: "", right: true, cell: (r) =>
        String(r.count_date) === date
          ? <Pill tone="info">Viewing</Pill>
          : (
            <button onClick={() => { setDate(String(r.count_date)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
              View
            </button>
          ) },
  ];

  return (
    <Shell>
      <PageHeader title="End of Day" subtitle="Count the office safe and record what is actually there."
        onRefresh={load} loading={loading}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink outline-none dark:border-white/10 dark:bg-white/[0.06] dark:text-white" />
        <button onClick={save} disabled={saving} className={btnPrimary}>
          <Save size={15} /> {saving ? "Saving…" : "Save count"}
        </button>
      </PageHeader>

      <StatCards stats={stats} loading={loading} />

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel/50 px-5 py-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <span className="text-[13px] font-semibold text-ink dark:text-[#e7e2d8]">Difference</span>
        <Diff value={counted - expected} />
        {carried && Math.abs(carried.diff) >= 1 && (
          <span className="text-[12.5px] text-muted dark:text-[#a89f93]">
            {carried.on} closed {money(Math.abs(carried.diff))} {carried.diff < 0 ? "short" : "over"} — that difference is still inside this one.
          </span>
        )}
        <span className="ml-auto text-[12px] text-hint dark:text-[#8a8175]">
          {savedAt ? `${hasUpdatedAt ? "Last saved" : "First saved"} ${savedAt}` : "Not saved yet"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Grid title="Notes" list={NOTE_GROUP} />
        <Grid title="Coins" list={COIN_GROUP} />
      </div>

      <div className="mt-3">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note — anything that explains a difference"
          className="w-full rounded-card border border-line bg-surface px-4 py-3 text-[13px] text-ink outline-none transition focus:border-ink/30 dark:border-white/[0.06] dark:bg-[#201c17] dark:text-white" />
      </div>

      {err && <p className="mt-3 text-[12.5px] font-semibold text-danger">Couldn&apos;t save: {err}</p>}

      <SourceNote>
        <strong>Expected</strong> is the whole Head Office cash-flow ledger added up to {date} — every
        &ldquo;in&rdquo; less every &ldquo;out&rdquo;, not yesterday&apos;s count plus today&apos;s movements. A day nobody
        counted therefore keeps its cash in the figure, and a shortfall stays in the difference every
        day until an entry explains it rather than disappearing into the next opening balance.
        No shop till is in that sum — each branch balances in its own cash book against its own count.
      </SourceNote>

      <h3 className="mt-8 text-[14px] font-bold text-ink dark:text-[#f4f1ea]">Cash history</h3>
      <DataTable cols={histCols} rows={history} loading={loading} minWidth={420}
        empty="No cash counts saved yet." />
      <p className="mt-2 text-[12px] text-hint dark:text-[#8a8175]">
        The last {history.length.toLocaleString()} counts. These are balances, not takings — they are
        deliberately not added up, because adding a Monday safe to a Tuesday safe counts the same
        money twice.
      </p>

      <PreviewNote />
    </Shell>
  );
}
