"use client";
/* End of day — count the office safe, note by note.
 *
 * WHY COUNT BY DENOMINATION AND NOT JUST TYPE A TOTAL
 *   A typed total is a claim. A denomination count is a claim that can be
 *   checked against the drawer without recounting from scratch, and when it is
 *   short by 500 the breakdown usually says which bundle is wrong. It also
 *   takes the same amount of time, because the person is holding the notes
 *   either way.
 *
 * WHAT "EXPECTED" MEANS HERE
 *   Yesterday's counted total, plus today's office cash in, minus today's
 *   office cash out. It is the office's own running position — it does not
 *   include a single shop till, because those balance in their own cash book
 *   against their own physical count.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Coins, Scale, Save, CalendarDays } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { btnPrimary } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, Diff, PreviewNote, SourceNote,
  money, num, today, iso, type Row,
} from "@/components/retail/kit";

/* Notes first, largest down, then coins. The order people actually stack them. */
const NOTES = [5000, 1000, 500, 100, 50, 20, 10];
const COINS = [10, 5, 2, 1];

export default function EndOfDayPage() {
  const [date, setDate] = useState(today());
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [prevTotal, setPrevTotal] = useState<number | null>(null);
  const [flowIn, setFlowIn] = useState(0);
  const [flowOut, setFlowOut] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");

  const counted = useMemo(
    () => [...NOTES, ...COINS].reduce((t, d) => t + d * (Number(counts[d]) || 0), 0),
    [counts]
  );
  const expected = useMemo(
    () => (prevTotal ?? 0) + flowIn - flowOut,
    [prevTotal, flowIn, flowOut]
  );

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr(""); setSavedAt("");
    const prevDate = iso(new Date(new Date(date + "T00:00:00").getTime() - 86400000));

    const [mine, prev, flows] = await Promise.all([
      supabase.from("retail_cash_count").select("denoms,total,note,created_at").eq("location", "head_office").eq("count_date", date).maybeSingle(),
      supabase.from("retail_cash_count").select("total").eq("location", "head_office").lte("count_date", prevDate).order("count_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("retail_ho_cashflow").select("direction,amount").eq("flow_date", date),
    ]);

    if (mine.error) setErr(mine.error.message);

    const d = (mine.data as { denoms?: Record<string, number>; note?: string; created_at?: string } | null);
    setCounts(
      d?.denoms
        ? Object.fromEntries(Object.entries(d.denoms).map(([k, v]) => [k, String(v)]))
        : {}
    );
    setNote(d?.note ?? "");
    setSavedAt(d?.created_at ? new Date(d.created_at).toLocaleString("en-GB") : "");
    setPrevTotal((prev.data as { total?: number } | null)?.total ?? null);

    const rows = (flows.data as Row[]) ?? [];
    setFlowIn(rows.filter((r) => String(r.direction).toLowerCase() === "in").reduce((t, r) => t + num(r.amount), 0));
    setFlowOut(rows.filter((r) => String(r.direction).toLowerCase() === "out").reduce((t, r) => t + num(r.amount), 0));
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const denoms = Object.fromEntries(
      [...NOTES, ...COINS].map((d) => [String(d), Number(counts[d]) || 0]).filter(([, v]) => Number(v) > 0)
    );
    const { error } = await supabase.from("retail_cash_count").upsert(
      { location: "head_office", count_date: date, denoms, total: counted, note: note.trim() || null },
      { onConflict: "location,count_date" }
    );
    setSaving(false);
    if (error) { setErr(error.message); return; }
    load();
  }

  const stats = [
    { label: "Counted", value: money(counted), Icon: Banknote },
    { label: "Expected", value: prevTotal === null ? "—" : money(expected), Icon: Scale },
    { label: "Opening (last count)", value: prevTotal === null ? "—" : money(prevTotal), Icon: Coins },
    { label: "Today's movement", value: money(flowIn - flowOut), Icon: CalendarDays },
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
        {prevTotal === null
          ? <span className="text-[12.5px] text-muted dark:text-[#a89f93]">No earlier count to compare against — this one becomes the opening figure.</span>
          : <Diff value={counted - expected} />}
        <span className="ml-auto text-[12px] text-hint dark:text-[#8a8175]">
          {savedAt ? `Last saved ${savedAt}` : "Not saved yet"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Grid title="Notes" list={NOTES} />
        <Grid title="Coins" list={COINS} />
      </div>

      <div className="mt-3">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note — anything that explains a difference"
          className="w-full rounded-card border border-line bg-surface px-4 py-3 text-[13px] text-ink outline-none transition focus:border-ink/30 dark:border-white/[0.06] dark:bg-[#201c17] dark:text-white" />
      </div>

      {err && <p className="mt-3 text-[12.5px] font-semibold text-danger">Couldn&apos;t save: {err}</p>}

      <SourceNote>
        <strong>Expected</strong> is the last recorded count, plus today&apos;s office cash in, minus
        today&apos;s office cash out. No shop till is in that sum — each branch balances separately in
        its own cash book against its own physical count. A difference here is an office
        difference and nothing else.
      </SourceNote>

      <PreviewNote />
    </Shell>
  );
}
