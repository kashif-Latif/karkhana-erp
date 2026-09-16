"use client";
/* COMMISSIONS — what each SHOP is owed, per shop per day.
 *
 * WHO GETS PAID
 *   A shop-day, not a person. The original keys every figure on
 *   `branch_id | sale_date` and pays the shop; `salesperson` is recorded on the
 *   line and is never a payee. An earlier port of this screen grouped by
 *   `salesperson` instead — that is a different payroll, not a refactor, and
 *   because the column is nullable a Nimbus export without it collapsed the
 *   whole company into one "—" row. So this screen is a GRID: days down,
 *   branches across, one table per chain, column totals, row totals, grand
 *   total. Tap any figure for the receipts behind it.
 *
 * THE THREE RULES THAT CARRY MONEY
 *
 *   1. PER-PIECE RATE IS ALWAYS retail_price × percentage / 100 × quantity.
 *      `retail_commission_master.commission` is a REFERENCE column — the rate
 *      sheet prints it, the importer fills it, and no payout has ever read it.
 *      Paying `commission × quantity` (as the previous port did whenever that
 *      column was non-zero, which the importer makes the common case) pays a
 *      completely different number from the one the shops have been agreeing
 *      to for years. It is displayed below, greyed, and never multiplied.
 *
 *   2. FC DHA IS A FLAT PER-BARCODE SHEET AND RETURNS EARLY.
 *      A DHA line adds fc_dha_comm[item_code] × quantity and the function
 *      returns. Three things follow, and all three are the point:
 *        · no fallback to the master rate — an unlisted DHA barcode earns
 *          exactly 0, because DHA's agreement is the rate sheet and nothing
 *          else;
 *        · the line never reaches the receipt or day sales totals;
 *        · therefore FC DHA can NEVER earn a bonus.
 *      Removing the early return quietly gives DHA both a Top Shop rate and a
 *      bonus it has never been owed.
 *
 *   3. THE BONUS IS FED RUPEES, NEVER A COUNT.
 *      commBonus() slabs a RUPEE total: Rs 50 for every Rs 5,000. The previous
 *      port passed it `receipts.size` — a count — so a shop needed 5,000
 *      receipts to earn Rs 50 and the Bonus column read Rs 0 forever with
 *      nothing on screen saying why. `bonus_basis` decides which rupee figure:
 *        'receipt' → run commBonus per receipt_txn and SUM (+=) into the day
 *        'day'     → run commBonus once on the day's sales total and ASSIGN (=)
 *      There is no 'sales' basis and no 'round' mode. Both were invented by the
 *      port; the formula cannot read them, so offering them in Settings only
 *      lets somebody switch the bonus off by accident.
 *
 * WHY EVERY FIGURE IS PAGED
 *   PostgREST caps a response at 1000 rows and `.limit(5000)` does not raise
 *   that — it returns what it returns. A commission total that is quietly a
 *   lower bound is worse than one that errors, because nobody re-checks a
 *   number that looks plausible. Sale lines, the master and the DHA sheet all
 *   go through fetchAll.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Percent, Gift, Plus, Search, Save, Trash2, AlertTriangle, Pencil } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, StatCards, DataTable, Tabs, Pill, Select, PreviewNote, SourceNote,
  money, num, text, today, iso, fetchAll, commBonus,
  type CommCfg, type Row, type Col,
} from "@/components/retail/kit";

/* ── types ───────────────────────────────────────────────────────────────── */

type Tab = "grid" | "rates" | "fcdha" | "settings";
const TABS: { key: Tab; label: string }[] = [
  { key: "grid", label: "Commissions" },
  { key: "rates", label: "Item Rates" },
  { key: "fcdha", label: "FC DHA" },
  { key: "settings", label: "Settings" },
];

type Branch = { id: number; name: string; code?: string | null; chain?: string | null; active?: boolean | null };
type Master = { item_code: string; item_name?: string | null; retail_price?: number | null; commission?: number | null; percentage?: number | null };
type FcRate = { item_code: string; commission: number | null };
type Stale = { item_code: string; commission: number | null; last_sold: string | null };

/** One shop-day. `pp` is per-piece money, `bonus` is slab money; the payout is
 *  Math.round(pp + bonus) and nothing else. */
type Cell = { pp: number; bonus: number };
type DayRow = { ds: string; vals: number[]; total: number };
/** One receipt in the drill-down — the audit trail for a payout dispute. */
type Rec = { no: string; short: number; pp: number; total: number; codes: string[]; comm: number };

/* ── small local helpers ─────────────────────────────────────────────────── */

/** Next calendar day. Parsed as UTC and formatted as UTC so the two agree —
 *  a local-midnight parse formatted back through toISOString() lands on the
 *  previous day everywhere east of Greenwich, which in Karachi silently drops
 *  a day off every range. */
const addDays = (ds: string, n: number) => iso(new Date(Date.parse(ds + "T00:00:00Z") + n * 86400000));
/** Grid cells are dense; "Rs" in every one of them is noise. Totals keep it. */
const n0 = (v: number) => Math.round(v).toLocaleString("en-PK");
const dayLabel = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`;

/** A typo'd year ("2026" → "2016") would otherwise ask the database for a
 *  decade of sale lines and the browser for 3,600 table rows. */
const MAX_DAYS = 400;

const pillCls = "rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink outline-none transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white";

/** Column headers repeat the chain otherwise: "Top Shop Tariq Road" ×6. */
const shortName = (name: string, chain?: string | null) => {
  let s = String(name ?? "");
  const c = String(chain ?? "").trim();
  if (c && s.toLowerCase().startsWith(c.toLowerCase())) s = s.slice(c.length).trim();
  return (s || String(name ?? "")).replace(/Fashion Collection/i, "FC");
};

/* Top Shop first, then alphabetical — it is the biggest chain and the one
   people open this screen to look at. */
const chainRank = (s: string) => (/top\s*shop/i.test(s) ? 0 : 1);

const DEFAULT_CFG: CommCfg = { bonus_mode: "floor", bonus_basis: "receipt", bonus_slab: 5000, bonus_per_slab: 50 };

type RateForm = { isEdit: boolean; item_code: string; item_name: string; retail_price: string; commission: string; percentage: string };
type DhaForm = { isEdit: boolean; item_code: string; commission: string };

/* ── page ────────────────────────────────────────────────────────────────── */

export default function CommissionsPage() {
  const [tab, setTab] = useState<Tab>("grid");
  const [loading, setLoading] = useState(true);
  const [refLoading, setRefLoading] = useState(true);
  const [err, setErr] = useState("");

  /* reference data */
  const [branches, setBranches] = useState<Branch[]>([]);
  const [master, setMaster] = useState<Master[]>([]);
  const [fc, setFc] = useState<FcRate[]>([]);
  const [cfg, setCfg] = useState<CommCfg>(DEFAULT_CFG);

  /* the grid */
  const t0 = today();
  const [from, setFrom] = useState(t0.slice(0, 8) + "01"); // month-to-date, like the original
  const [to, setTo] = useState(t0);
  const [chainFilter, setChainFilter] = useState("");
  const [lines, setLines] = useState<Row[]>([]);

  /* drill-down */
  const [drill, setDrill] = useState<{ bid: number; ds: string; name: string } | null>(null);
  const [drillRows, setDrillRows] = useState<Rec[] | null>(null);

  /* editors */
  const [q, setQ] = useState("");
  const [rateForm, setRateForm] = useState<RateForm | null>(null);
  const [dhaForm, setDhaForm] = useState<DhaForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCfg, setSavedCfg] = useState("");

  /* stale DHA rates */
  const [stale, setStale] = useState<Stale[] | null>(null);
  const [staleOpen, setStaleOpen] = useState(false);
  const [staleSel, setStaleSel] = useState<string[]>([]);
  const [staleBusy, setStaleBusy] = useState(false);

  /* ── FC DHA, resolved from the data ────────────────────────────────────
   * The original hardcodes `const DHA_ID = 11`. That was FC DHA's primary key
   * in the old Grohub database and there is no reason for it to survive the
   * migration into this one — if the ids shift, a hardcoded 11 silently starts
   * paying some other shop the DHA rate sheet and paying DHA a bonus it must
   * never get. So the branch is looked up by name or code instead: whatever row
   * is actually called DHA is the DHA branch, before and after any migration.
   * If two shops ever match, the lowest id wins and the UI says which it chose.
   */
  const dhaMatches = useMemo(
    () => branches.filter((b) => /dha/i.test(String(b.name ?? "")) || /dha/i.test(String(b.code ?? "")))
      .sort((a, b) => a.id - b.id),
    [branches]
  );
  const dhaBranch = dhaMatches[0] ?? null;
  const dhaId = dhaBranch ? Number(dhaBranch.id) : null;

  /* ── loaders ───────────────────────────────────────────────────────────── */

  const loadRef = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setRefLoading(false); return; }
    setRefLoading(true);
    const db = supabase;
    const [b, c] = await Promise.all([
      db.from("retail_branches").select("id,name,code,chain,active").order("name"),
      db.from("retail_commission_config").select("bonus_mode,bonus_basis,bonus_slab,bonus_per_slab").eq("id", 1).maybeSingle(),
    ]);
    /* Both rate sheets are paged. An un-paged master stops at row 1000 and
       every item past it silently earns nothing — the failure looks exactly
       like "that article has no commission set". */
    const [m, f] = await Promise.all([
      fetchAll<Master>((lo, hi) => db.from("retail_commission_master")
        .select("item_code,item_name,retail_price,commission,percentage").order("item_code").range(lo, hi)),
      fetchAll<FcRate>((lo, hi) => db.from("retail_fc_dha_comm")
        .select("item_code,commission").order("item_code").range(lo, hi)),
    ]);
    setBranches((b.data as Branch[]) ?? []);
    setCfg((c.data as CommCfg) ?? DEFAULT_CFG);
    setMaster(m.rows); setFc(f.rows);
    const e = b.error?.message || m.error || f.error || "";
    if (e) setErr(e);
    setRefLoading(false);
  }, []);
  useEffect(() => { loadRef(); }, [loadRef]);

  /* The rendered window: clamped to today, then capped. The query uses the
     capped end too, so the tiles can never total days the grid does not show. */
  const dTo = to > t0 ? t0 : to;
  const days = useMemo(() => {
    const out: string[] = [];
    if (!from || !dTo || from > dTo) return out;
    for (let ds = from; ds <= dTo && out.length < MAX_DAYS; ds = addDays(ds, 1)) out.push(ds);
    return out;
  }, [from, dTo]);
  const capped = days.length === MAX_DAYS && days[days.length - 1] < dTo;
  const qTo = days.length ? days[days.length - 1] : dTo;
  const hasDays = days.length > 0;

  const loadLines = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    if (!hasDays) { setLines([]); setLoading(false); return; }
    setLoading(true); setErr("");
    const db = supabase;
    const { rows, error } = await fetchAll<Row>((lo, hi) => db.from("retail_sale_lines")
      .select("branch_id,sale_date,item_code,quantity,sales_amount,receipt_txn")
      .gte("sale_date", from).lte("sale_date", qTo).range(lo, hi));
    if (error) setErr(error);
    setLines(rows);
    setLoading(false);
  }, [from, qTo, hasDays]);
  useEffect(() => { loadLines(); }, [loadLines]);

  /* ── the calculation, ported line for line ─────────────────────────────── */

  const masterMap = useMemo(() => {
    const m = new Map<string, Master>();
    master.forEach((r) => m.set(String(r.item_code), r));
    return m;
  }, [master]);
  const fcMap = useMemo(() => {
    const m = new Map<string, number>();
    fc.forEach((r) => m.set(String(r.item_code), num(r.commission)));
    return m;
  }, [fc]);

  const cell = useMemo(() => {
    const out: Record<string, Cell> = {};
    const recTot: Record<string, number> = {};
    const dayTot: Record<string, number> = {};

    lines.forEach((l) => {
      const k = `${Number(l.branch_id)}|${String(l.sale_date)}`;
      const c = (out[k] ??= { pp: 0, bonus: 0 });

      /* RULE 2 — FC DHA: flat rate sheet, then RETURN. Not a shortcut. The
         return is what keeps DHA out of recTot/dayTot below, which is what
         keeps DHA out of the bonus; and the missing `else` fallback is what
         makes an unlisted DHA barcode earn 0 rather than a Top Shop rate. */
      if (dhaId != null && Number(l.branch_id) === dhaId) {
        const r = fcMap.get(String(l.item_code));
        if (r != null) c.pp += r * num(l.quantity);
        return;
      }

      /* RULE 1 — retail_price × percentage, never the `commission` column. */
      const m = masterMap.get(String(l.item_code));
      if (m) c.pp += num(m.retail_price) * (num(m.percentage) / 100) * num(l.quantity);

      /* The bonus is slabbed on SALES, so every line of a commissionable shop
         counts toward it — including lines whose item is not on the master.
         A blank receipt_txn collapses the day into one "receipt", exactly as
         the original does: with no receipt to slab on, the day IS the receipt. */
      const rk = `${k}|${text(l.receipt_txn, "")}`;
      recTot[rk] = (recTot[rk] ?? 0) + num(l.sales_amount);
      dayTot[k] = (dayTot[k] ?? 0) + num(l.sales_amount);
    });

    /* RULE 3 — commBonus takes RUPEES. 'day' assigns once; 'receipt' sums. */
    if (cfg.bonus_basis === "day") {
      Object.keys(dayTot).forEach((k) => { if (out[k]) out[k].bonus = commBonus(dayTot[k], cfg); });
    } else {
      Object.keys(recTot).forEach((rk) => {
        const k = rk.split("|").slice(0, 2).join("|");
        if (out[k]) out[k].bonus += commBonus(recTot[rk], cfg);
      });
    }
    return out;
  }, [lines, masterMap, fcMap, dhaId, cfg]);

  /* ── grid shape ────────────────────────────────────────────────────────── */

  /* A closed shop keeps its history: a branch is shown if it is still active or
     if it sold anything in this window. Dropping a closed shop would make an
     old month re-read lower than it was actually paid. */
  const shownBranches = useMemo(() => {
    const traded = new Set<string>();
    Object.keys(cell).forEach((k) => traded.add(k.split("|")[0]));
    return branches.filter((b) => b.active !== false || traded.has(String(b.id)));
  }, [branches, cell]);

  const chains = useMemo(() => {
    const set = new Set(shownBranches.map((b) => String(b.chain ?? "").trim() || "Other"));
    return [...set].sort((a, b) => chainRank(a) - chainRank(b) || a.localeCompare(b));
  }, [shownBranches]);

  const blocks = useMemo(() => {
    return chains
      .filter((chn) => !chainFilter || chn === chainFilter)
      .map((chn) => {
        const brs = shownBranches
          .filter((b) => (String(b.chain ?? "").trim() || "Other") === chn)
          .sort((a, b) => a.id - b.id);
        const rows: DayRow[] = days.map((ds) => {
          const vals = brs.map((b) => {
            const c = cell[`${b.id}|${ds}`];
            return c ? Math.round(c.pp + c.bonus) : 0; // the payout, per the original
          });
          return { ds, vals, total: vals.reduce((a, x) => a + x, 0) };
        });
        const colTot = brs.map((_, i) => rows.reduce((a, r) => a + r.vals[i], 0));
        return { chain: chn, brs, rows, colTot, grand: colTot.reduce((a, x) => a + x, 0) };
      })
      .filter((blk) => blk.brs.length > 0);
  }, [chains, chainFilter, shownBranches, days, cell]);

  /* Tiles sum the raw pp/bonus, as the original does, so Per-piece + Bonus is
     exactly Total. The grid rounds each cell, so the two can differ by a rupee
     or two over a long range. The cell is the payout; the tile is the summary. */
  const totals = useMemo(() => {
    let pp = 0, bonus = 0;
    blocks.forEach((blk) => blk.brs.forEach((b) => days.forEach((ds) => {
      const c = cell[`${b.id}|${ds}`];
      if (c) { pp += c.pp; bonus += c.bonus; }
    })));
    return { pp, bonus, total: pp + bonus };
  }, [blocks, days, cell]);

  const stats = [
    { label: "Total commission", value: money(totals.total), Icon: Coins },
    { label: "Per-piece", value: money(totals.pp), Icon: Percent },
    { label: "Bonus", value: money(totals.bonus), Icon: Gift },
  ];

  /* ── drill-down: the receipts behind one cell ──────────────────────────── */

  useEffect(() => {
    if (!drill) { setDrillRows(null); return; }
    let live = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase) { setDrillRows([]); return; }
      const db = supabase;
      setDrillRows(null);
      const { rows, error } = await fetchAll<Row>((lo, hi) => db.from("retail_sale_lines")
        .select("receipt_no,receipt_txn,item_code,quantity,sales_amount")
        .eq("branch_id", drill.bid).eq("sale_date", drill.ds).range(lo, hi));
      if (!live) return;
      if (error) { setErr(error); setDrillRows([]); return; }

      const isDHA = dhaId != null && drill.bid === dhaId;
      const recs: Record<string, Rec> = {};
      rows.forEach((l) => {
        /* Blank falls through to the next candidate, as in the original — a
           receipt keyed on "" would merge unrelated bills into one row. */
        const key = text(l.receipt_txn, text(l.receipt_no, "?"));
        const r = (recs[key] ??= {
          no: text(l.receipt_no, key), short: parseInt(text(l.receipt_no, "0"), 10) || 0,
          pp: 0, total: 0, codes: [], comm: 0,
        });
        r.total += num(l.sales_amount);
        const code = String(l.item_code ?? "");
        if (isDHA) {
          const cm = fcMap.get(code);
          if (cm != null) { r.pp += cm * num(l.quantity); if (!r.codes.includes(code)) r.codes.push(code); }
        } else {
          const m = masterMap.get(code);
          if (m) { r.pp += num(m.retail_price) * (num(m.percentage) / 100) * num(l.quantity); if (!r.codes.includes(code)) r.codes.push(code); }
        }
      });
      /* FC DHA never gets a bonus here either — same rule, same reason. */
      const out = Object.values(recs)
        .map((r) => ({ ...r, comm: Math.round(r.pp + (!isDHA && cfg.bonus_basis === "receipt" ? commBonus(r.total, cfg) : 0)) }))
        .filter((r) => r.comm !== 0)
        .sort((a, b) => b.short - a.short);
      setDrillRows(out);
    })();
    return () => { live = false; };
  }, [drill, dhaId, fcMap, masterMap, cfg]);

  /* ── stale FC DHA rates ────────────────────────────────────────────────── */

  const loadStale = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || dhaId == null) { setStale(null); return; }
    /* The RPC takes the branch id as a PARAMETER precisely so nobody has to
       hardcode 11 again — it is handed the branch resolved above. */
    const { data, error } = await supabase.rpc("retail_fc_dha_stale_comm", { p_branch_id: dhaId, p_months: 3 });
    if (error) { setStale(null); return; }
    setStale((data as Stale[]) ?? []);
  }, [dhaId]);
  useEffect(() => { loadStale(); }, [loadStale]);

  async function deleteCodes(codes: string[]) {
    if (!supabase || !codes.length) return;
    setStaleBusy(true); setErr("");
    /* 100 at a time: `delete().in(...)` puts every value in the query string,
       and a few thousand barcodes is a URL the server refuses outright. */
    for (let i = 0; i < codes.length; i += 100) {
      const { error } = await supabase.from("retail_fc_dha_comm").delete().in("item_code", codes.slice(i, i + 100));
      if (error) { setErr(error.message); setStaleBusy(false); return; }
    }
    const gone = new Set(codes);
    setStale((s) => (s ?? []).filter((r) => !gone.has(String(r.item_code))));
    setFc((s) => s.filter((r) => !gone.has(String(r.item_code))));
    setStaleSel([]);
    setStaleBusy(false);
    if ((stale ?? []).length <= codes.length) setStaleOpen(false);
  }

  /* ── rate editing ──────────────────────────────────────────────────────── */

  async function saveRate() {
    if (!supabase || !rateForm) return;
    const code = rateForm.item_code.trim();
    if (!code) { setErr("Item code is required."); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("retail_commission_master").upsert({
      item_code: code,
      item_name: rateForm.item_name.trim() || null,
      retail_price: num(rateForm.retail_price),
      commission: num(rateForm.commission),
      /* 5 is the house rate. A blank percentage saved as 0 would silently take
         the item off commission while still looking like it is on the list. */
      percentage: num(rateForm.percentage) || 5,
    }, { onConflict: "item_code" });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setRateForm(null);
    loadRef();
  }

  async function deleteRate(code: string) {
    if (!supabase || !window.confirm(`Delete ${code} from the commission master?`)) return;
    setSaving(true);
    const { error } = await supabase.from("retail_commission_master").delete().eq("item_code", code);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setRateForm(null);
    loadRef();
  }

  async function saveDha() {
    if (!supabase || !dhaForm) return;
    const code = dhaForm.item_code.trim();
    if (!code) { setErr("Barcode is required."); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("retail_fc_dha_comm")
      .upsert({ item_code: code, commission: num(dhaForm.commission) }, { onConflict: "item_code" });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setDhaForm(null);
    loadRef();
  }

  async function deleteDha(code: string) {
    if (!supabase || !window.confirm(`Delete ${code} from the FC DHA rate sheet?`)) return;
    setSaving(true);
    const { error } = await supabase.from("retail_fc_dha_comm").delete().eq("item_code", code);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setDhaForm(null);
    loadRef();
  }

  async function saveCfg() {
    if (!supabase) return;
    setSavedCfg("saving");
    /* upsert, not update: on a fresh database row 1 does not exist yet and an
       update would report success while changing nothing. */
    const { error } = await supabase.from("retail_commission_config").upsert({
      id: 1,
      bonus_mode: cfg.bonus_mode, bonus_basis: cfg.bonus_basis,
      bonus_slab: num(cfg.bonus_slab), bonus_per_slab: num(cfg.bonus_per_slab),
    }, { onConflict: "id" });
    setSavedCfg(error ? "error" : "saved");
    if (error) setErr(error.message);
    setTimeout(() => setSavedCfg(""), 2500);
  }

  /* ── filtered lists ────────────────────────────────────────────────────── */

  const filteredMaster = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return master;
    return master.filter((m) => `${m.item_code} ${m.item_name ?? ""}`.toLowerCase().includes(n));
  }, [master, q]);
  const filteredFc = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return fc;
    return fc.filter((f) => String(f.item_code).toLowerCase().includes(n));
  }, [fc, q]);

  /* ── columns ───────────────────────────────────────────────────────────── */

  const rateCols: Col<Master>[] = [
    { head: "Item code", bold: true, cell: (r) => r.item_code },
    { head: "Name", muted: true, cell: (r) => text(r.item_name) },
    { head: "Retail price", right: true, cell: (r) => money(r.retail_price) },
    { head: "%", right: true, bold: true, cell: (r) => `${num(r.percentage)}%` },
    { head: "Earns / piece", right: true, cell: (r) => money(num(r.retail_price) * (num(r.percentage) / 100)) },
    { head: "Comm. column", right: true, muted: true, cell: (r) => <span title="Reference only — never used in a payout">{money(r.commission)}</span> },
    { head: "", right: true, cell: (r) => (
        <button onClick={() => setRateForm({
          isEdit: true, item_code: String(r.item_code), item_name: String(r.item_name ?? ""),
          retail_price: String(r.retail_price ?? ""), commission: String(r.commission ?? ""),
          percentage: String(r.percentage ?? 5),
        })} className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white" aria-label="Edit"><Pencil size={14} /></button>
      ) },
  ];

  const fcCols: Col<FcRate>[] = [
    { head: "Barcode", bold: true, cell: (r) => r.item_code },
    { head: "Commission per piece", right: true, cell: (r) => money(r.commission) },
    { head: "", right: true, cell: (r) => (
        <button onClick={() => setDhaForm({ isEdit: true, item_code: String(r.item_code), commission: String(r.commission ?? "") })}
          className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white" aria-label="Edit"><Pencil size={14} /></button>
      ) },
  ];

  const drillCols: Col<Rec>[] = [
    { head: "Receipt", bold: true, cell: (r) => r.no },
    { head: "Total amount", right: true, cell: (r) => money(r.total) },
    { head: "Commissionable items", muted: true, cell: (r) => (r.codes.length ? r.codes.join(", ") : "—") },
    { head: "Commission", right: true, bold: true, cell: (r) => (
        <span className={r.comm < 0 ? "text-danger" : undefined}>{money(r.comm)}</span>
      ) },
  ];

  const staleCols: Col<Stale>[] = [
    { head: "", cell: (r) => (
        <input type="checkbox" checked={staleSel.includes(String(r.item_code))}
          onChange={(e) => setStaleSel((s) => e.target.checked ? [...s, String(r.item_code)] : s.filter((x) => x !== String(r.item_code)))}
          className="h-4 w-4 accent-current" />
      ) },
    { head: "Barcode", bold: true, cell: (r) => r.item_code },
    { head: "Rate", right: true, cell: (r) => money(r.commission) },
    { head: "Last sold", muted: true, cell: (r) => (r.last_sold ? String(r.last_sold) : "never sold") },
    { head: "", right: true, cell: (r) => (
        <button disabled={staleBusy} onClick={() => deleteCodes([String(r.item_code)])}
          className="rounded-full p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-40 dark:text-[#a89f93]" aria-label="Delete"><Trash2 size={14} /></button>
      ) },
  ];

  /* ── render ────────────────────────────────────────────────────────────── */

  return (
    <Shell>
      <PageHeader
        title="Commissions"
        subtitle="Per-piece from the rate sheet plus the slab bonus, minus returns — per shop, per day."
        onRefresh={() => { loadRef(); loadLines(); loadStale(); }}
        loading={loading || refLoading}
      >
        {tab === "rates" && (
          <button onClick={() => setRateForm({ isEdit: false, item_code: "", item_name: "", retail_price: "", commission: "", percentage: "5" })} className={btnPrimary}>
            <Plus size={15} /> Add item
          </button>
        )}
        {tab === "fcdha" && (
          <button onClick={() => setDhaForm({ isEdit: false, item_code: "", commission: "" })} className={btnPrimary}>
            <Plus size={15} /> Add barcode
          </button>
        )}
      </PageHeader>

      <Tabs tabs={TABS} value={tab} onChange={(t) => { setTab(t); setQ(""); }} />

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}

      {/* ══ THE GRID ══════════════════════════════════════════════════════ */}
      {tab === "grid" && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">From</span>
            <input type="date" value={from} max={t0} onChange={(e) => setFrom(e.target.value)} className={pillCls} />
            <span className="text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">To</span>
            {/* Clamped to today: a range ending in the future adds empty rows
                and invites somebody to read them as "no commission earned". */}
            <input type="date" value={dTo} max={t0} onChange={(e) => setTo(e.target.value)} className={pillCls} />
            {chains.length > 1 && (
              <Select value={chainFilter} onChange={setChainFilter} className="ml-auto">
                <option value="">All chains</option>
                {chains.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </div>

          {from > dTo && <p className="mt-3 text-[12.5px] font-semibold text-danger">From is after To — nothing to show.</p>}
          {capped && (
            <p className="mt-3 text-[12.5px] font-semibold text-amber-strong dark:text-amber">
              Showing the first {MAX_DAYS} days ({from} to {qTo}). Narrow the range to see the rest.
            </p>
          )}

          <StatCards stats={stats} loading={loading} />

          {!loading && master.length === 0 && (
            <div className="mt-4 flex items-start gap-3 rounded-card border border-amber/30 bg-amber-soft p-4 dark:border-amber/30 dark:bg-amber/10">
              <AlertTriangle size={17} className="mt-0.5 flex-none text-amber-strong dark:text-amber" />
              <p className="text-[13px] text-ink dark:text-[#e7e2d8]">
                The commission master is empty, so no Top Shop line can earn a per-piece rate.
                Import a Commission Master CSV from the Import screen, or add items under <strong>Item Rates</strong>.
              </p>
            </div>
          )}

          {blocks.map((blk) => {
            const cols: Col<DayRow>[] = [
              { head: "Date", muted: true, cell: (r) => dayLabel(r.ds) },
              ...blk.brs.map((b, i): Col<DayRow> => ({
                head: shortName(b.name, b.chain),
                right: true,
                cell: (r) => r.vals[i]
                  ? (
                    <button
                      onClick={() => setDrill({ bid: b.id, ds: r.ds, name: b.name })}
                      className={`border-b border-dotted border-current font-semibold underline-offset-2 transition hover:opacity-70 ${r.vals[i] < 0 ? "text-danger" : "text-ink dark:text-[#f4f1ea]"}`}
                      title="Show the receipts behind this figure"
                    >{n0(r.vals[i])}</button>
                  )
                  : <span className="text-hint dark:text-[#6f675c]">·</span>,
              })),
              { head: "Total", right: true, bold: true, cell: (r) => (r.total ? n0(r.total) : "") },
            ];
            const footer = (
              <tr className="bg-panel/70 text-ink dark:bg-white/[0.04] dark:text-[#f4f1ea]">
                <td className="px-4 py-3 text-[12.5px] font-bold">Total</td>
                {blk.colTot.map((v, i) => <td key={i} className="px-4 py-3 text-right text-[12.5px] font-bold tabular-nums">{money(v)}</td>)}
                <td className="px-4 py-3 text-right text-[12.5px] font-extrabold tabular-nums">{money(blk.grand)}</td>
              </tr>
            );
            return (
              <section key={blk.chain} className="mt-7">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">{blk.chain}</h2>
                  <span className="text-[13px] font-bold tabular-nums text-ink dark:text-[#f4f1ea]">{money(blk.grand)}</span>
                </div>
                <DataTable cols={cols} rows={blk.rows} loading={loading} minWidth={Math.max(560, 190 + blk.brs.length * 108)}
                  empty="Pick a date range to see the days." footer={footer} />
              </section>
            );
          })}

          {!loading && blocks.length === 0 && (
            <p className="mt-6 text-center text-[13px] text-muted dark:text-[#a89f93]">No shops to show for this chain filter.</p>
          )}

          <SourceNote>
            Per-piece is <strong>retail price × percentage ÷ 100 × quantity</strong> from{" "}
            <code>retail_commission_master</code>. The <code>commission</code> column on that table
            is printed on the rate sheet and is <strong>never</strong> multiplied into a payout — paying it
            instead would pay a different number from the one the shops agreed to.{" "}
            {dhaBranch
              ? <><strong>{dhaBranch.name}</strong> is paid from the flat per-barcode sheet only: an unlisted barcode
                earns Rs 0, and because its lines never reach a receipt or day total it <strong>never earns a bonus</strong>.</>
              : <>No FC DHA branch was found in <code>retail_branches</code>, so every shop is on the master rate.</>}{" "}
            The bonus slabs <strong>rupees</strong> — {money(cfg.bonus_per_slab)} per {money(cfg.bonus_slab)} of sales,
            {cfg.bonus_basis === "day" ? " on the day's total" : " on each receipt"} — never a receipt count.
            Each cell is <code>Math.round(per-piece + bonus)</code>. Sale lines are paged, so no figure here is a lower bound.
          </SourceNote>
        </>
      )}

      {/* ══ ITEM RATES ════════════════════════════════════════════════════ */}
      {tab === "rates" && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12.5px] text-muted dark:text-[#a89f93]">
              {master.length.toLocaleString()} items{q && ` · ${filteredMaster.length.toLocaleString()} matching`}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <Search size={15} className="text-hint dark:text-[#8a8175]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or name"
                className="w-48 bg-transparent text-[13px] outline-none placeholder:text-hint dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
            </div>
          </div>
          <DataTable cols={rateCols} rows={filteredMaster.slice(0, 600)} loading={refLoading} minWidth={880}
            empty="No item rates yet — add one, or import a Commission Master CSV." />
          {filteredMaster.length > 600 && (
            <p className="mt-2 text-[12px] text-hint dark:text-[#8a8175]">
              Showing the first 600 of {filteredMaster.length.toLocaleString()} — search for a specific code.
            </p>
          )}
          <SourceNote>
            <strong>Earns / piece</strong> is what actually gets paid: retail price × percentage.
            <strong> Comm. column</strong> is the figure the rate sheet prints; it is stored, shown and edited here for
            reference and no calculation reads it. A new item with a blank percentage is saved at 5%.
          </SourceNote>
        </>
      )}

      {/* ══ FC DHA ════════════════════════════════════════════════════════ */}
      {tab === "fcdha" && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted dark:text-[#a89f93]">
              <span>{fc.length.toLocaleString()} barcodes{q && ` · ${filteredFc.length.toLocaleString()} matching`}</span>
              {dhaBranch
                ? <Pill tone="info">{dhaBranch.name} · id {dhaBranch.id}</Pill>
                : <Pill tone="bad">no DHA branch found</Pill>}
              {dhaMatches.length > 1 && <Pill tone="warn">{dhaMatches.length} branches match &ldquo;DHA&rdquo;</Pill>}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
              <Search size={15} className="text-hint dark:text-[#8a8175]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search barcode"
                className="w-48 bg-transparent text-[13px] outline-none placeholder:text-hint dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]" />
            </div>
          </div>

          {/* Stale rates. Barcodes still on the sheet that have earned nothing
              for three months are dead weight: they make the sheet unreadable
              and hide the articles that are actually selling. */}
          {stale && stale.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-amber/30 bg-amber-soft p-4 dark:border-amber/30 dark:bg-amber/10">
              <AlertTriangle size={17} className="flex-none text-amber-strong dark:text-amber" />
              <p className="flex-1 text-[13px] text-ink dark:text-[#e7e2d8]">
                <strong>{stale.length}</strong> barcode{stale.length > 1 ? "s have" : " has"} earned no commission at{" "}
                {dhaBranch?.name ?? "FC DHA"} in the last 3 months.
              </p>
              <button onClick={() => { setStaleSel([]); setStaleOpen(true); }} className={btnGhost}>Review &amp; clean up</button>
            </div>
          )}

          <DataTable cols={fcCols} rows={filteredFc.slice(0, 600)} loading={refLoading} minWidth={560}
            empty="No FC DHA barcodes yet — add one, or import the DHA rate sheet." />
          {filteredFc.length > 600 && (
            <p className="mt-2 text-[12px] text-hint dark:text-[#8a8175]">
              Showing the first 600 of {filteredFc.length.toLocaleString()} — search for a specific barcode.
            </p>
          )}
          <SourceNote>
            FC DHA is paid a flat amount per barcode, not a percentage. A barcode that is not on this
            sheet earns <strong>Rs 0</strong> at DHA — there is deliberately no fallback to the Top Shop
            master, because DHA&apos;s agreement is this sheet. DHA sales also never enter a receipt or day
            total, so DHA never earns the slab bonus.
          </SourceNote>
        </>
      )}

      {/* ══ SETTINGS ══════════════════════════════════════════════════════ */}
      {tab === "settings" && (
        <div className="mt-5 max-w-2xl rounded-card border border-line bg-surface p-6 dark:border-white/[0.06] dark:bg-[#201c17]">
          <h2 className="text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Bonus rules</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted dark:text-[#a89f93]">
            The bonus is slabbed on <strong>rupees of sales</strong>, on top of the per-piece rate. It is
            never a count of receipts — {money(cfg.bonus_per_slab)} per {money(cfg.bonus_slab)} of sales is the
            rule, and feeding the slab a receipt count would mean a shop needed {num(cfg.bonus_slab).toLocaleString()} bills
            to earn {money(cfg.bonus_per_slab)}.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Bonus basis">
              <select value={cfg.bonus_basis ?? "receipt"} onChange={(e) => setCfg({ ...cfg, bonus_basis: e.target.value })} className={inputCls}>
                <option value="receipt">Per receipt</option>
                <option value="day">Per shop-day</option>
              </select>
            </Field>
            <Field label="Slab mode">
              <select value={cfg.bonus_mode ?? "floor"} onChange={(e) => setCfg({ ...cfg, bonus_mode: e.target.value })} className={inputCls}>
                <option value="floor">Floor — every completed slab</option>
                <option value="exact">Exact — only exact multiples</option>
              </select>
            </Field>
            <Field label="Slab size (Rs of sales)">
              <input type="number" value={String(cfg.bonus_slab ?? "")} onChange={(e) => setCfg({ ...cfg, bonus_slab: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Bonus per slab (Rs)">
              <input type="number" value={String(cfg.bonus_per_slab ?? "")} onChange={(e) => setCfg({ ...cfg, bonus_per_slab: Number(e.target.value) })} className={inputCls} />
            </Field>
          </div>

          <div className="mt-5 space-y-2.5 rounded-xl2 border border-line bg-panel/60 px-3.5 py-3 text-[12px] leading-relaxed text-muted dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-[#a89f93]">
            <p><strong className="text-ink dark:text-[#e7e2d8]">Per receipt</strong> runs the slab on each bill and adds the results up over the day —
              a shop with two Rs 5,000 bills earns two bonuses. <strong className="text-ink dark:text-[#e7e2d8]">Per shop-day</strong> runs it once on the
              day&apos;s whole sales total, so how the sales were split across bills makes no difference.</p>
            <p><strong className="text-ink dark:text-[#e7e2d8]">Floor</strong> pays every completed slab: Rs 12,400 of sales at a Rs 5,000 slab pays two.
              <strong className="text-ink dark:text-[#e7e2d8]"> Exact</strong> pays only when the total is an exact multiple — Rs 10,000 pays two, Rs 12,400 pays
              nothing. It looks like a bug and is not; it is a rule some shops run, and floor would overpay them on every bill that lands between slabs.</p>
            <p>There is no &ldquo;per sales amount&rdquo; basis and no &ldquo;round nearest&rdquo; mode. Both were invented by an earlier
              version of this screen; the formula cannot read either, so offering them only let somebody switch the bonus off by accident.</p>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button onClick={saveCfg} className={btnPrimary}><Save size={14} /> Save rules</button>
            {savedCfg === "saved" && <span className="text-[13px] font-semibold text-success">Saved</span>}
            {savedCfg === "saving" && <span className="text-[13px] text-muted dark:text-[#a89f93]">Saving…</span>}
            {savedCfg === "error" && <span className="text-[13px] font-semibold text-danger">Couldn&apos;t save</span>}
          </div>
        </div>
      )}

      {/* ══ DRILL-DOWN ════════════════════════════════════════════════════ */}
      <Modal open={!!drill} onClose={() => setDrill(null)} wide
        title={drill ? `${drill.name} — ${drill.ds}` : ""}
        subtitle="Receipt by receipt. This is the audit trail behind that figure.">
        <DataTable cols={drillCols} rows={drillRows ?? []} loading={drillRows === null} minWidth={640}
          empty="No commission earned on this day."
          footer={
            <tr className="bg-panel/70 text-ink dark:bg-white/[0.04] dark:text-[#f4f1ea]">
              <td className="px-4 py-3 text-[12.5px] font-bold">{(drillRows ?? []).length} bill{(drillRows ?? []).length === 1 ? "" : "s"}</td>
              <td className="px-4 py-3 text-right text-[12.5px] font-bold tabular-nums">{money((drillRows ?? []).reduce((a, r) => a + r.total, 0))}</td>
              <td />
              <td className="px-4 py-3 text-right text-[12.5px] font-extrabold tabular-nums">{money((drillRows ?? []).reduce((a, r) => a + r.comm, 0))}</td>
            </tr>
          } />
        <p className="mt-3 text-[12px] leading-relaxed text-muted dark:text-[#a89f93]">
          Receipts that earned nothing are left out. <strong>Commission</strong> is this bill&apos;s per-piece total
          {cfg.bonus_basis === "receipt" ? " plus its slab bonus" : ""}, rounded — the day figure in the grid is the sum of these
          {cfg.bonus_basis === "day" ? ", plus one slab bonus on the day's sales total" : ""}.
        </p>
        <div className="mt-4 flex justify-end"><button onClick={() => setDrill(null)} className={btnGhost}>Close</button></div>
      </Modal>

      {/* ══ ITEM RATE EDITOR ══════════════════════════════════════════════ */}
      <Modal open={!!rateForm} onClose={() => setRateForm(null)}
        title={rateForm?.isEdit ? "Edit commission item" : "Add commission item"}
        subtitle="What gets paid is retail price × percentage × quantity.">
        {rateForm && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Item code">
                <input value={rateForm.item_code} readOnly={rateForm.isEdit}
                  onChange={(e) => setRateForm({ ...rateForm, item_code: e.target.value })}
                  className={`${inputCls} ${rateForm.isEdit ? "opacity-60" : ""}`} autoFocus={!rateForm.isEdit} />
              </Field>
              <Field label="Retail price">
                <input type="number" value={rateForm.retail_price} onChange={(e) => setRateForm({ ...rateForm, retail_price: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <Field label="Item name">
              <input value={rateForm.item_name} onChange={(e) => setRateForm({ ...rateForm, item_name: e.target.value })} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Percentage (this is what pays)">
                <input type="number" value={rateForm.percentage} onChange={(e) => setRateForm({ ...rateForm, percentage: e.target.value })} className={inputCls} placeholder="5" />
              </Field>
              <Field label="Commission column (reference only)">
                <input type="number" value={rateForm.commission} onChange={(e) => setRateForm({ ...rateForm, commission: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <p className="rounded-xl2 border border-line bg-panel/60 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-[#a89f93]">
              This item earns <strong className="text-ink dark:text-[#e7e2d8]">{money(num(rateForm.retail_price) * ((num(rateForm.percentage) || 5) / 100))}</strong> per piece.
              The commission column is stored for the printed rate sheet and never enters a payout. A blank percentage saves as 5%.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              {rateForm.isEdit && (
                <button onClick={() => deleteRate(rateForm.item_code)} disabled={saving}
                  className="flex items-center justify-center gap-2 rounded-full border border-danger/30 bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger transition hover:opacity-90 disabled:opacity-50 dark:border-danger/30 dark:bg-danger/10">
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button onClick={() => setRateForm(null)} className={btnGhost}>Cancel</button>
              <button onClick={saveRate} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ══ FC DHA EDITOR ═════════════════════════════════════════════════ */}
      <Modal open={!!dhaForm} onClose={() => setDhaForm(null)}
        title={dhaForm?.isEdit ? "Edit FC DHA rate" : "Add FC DHA rate"}
        subtitle="A flat amount per barcode. Not on this sheet means Rs 0 at DHA.">
        {dhaForm && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Barcode">
                <input value={dhaForm.item_code} readOnly={dhaForm.isEdit}
                  onChange={(e) => setDhaForm({ ...dhaForm, item_code: e.target.value })}
                  className={`${inputCls} ${dhaForm.isEdit ? "opacity-60" : ""}`} autoFocus={!dhaForm.isEdit} />
              </Field>
              <Field label="Commission (Rs per piece)">
                <input type="number" value={dhaForm.commission} onChange={(e) => setDhaForm({ ...dhaForm, commission: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              {dhaForm.isEdit && (
                <button onClick={() => deleteDha(dhaForm.item_code)} disabled={saving}
                  className="flex items-center justify-center gap-2 rounded-full border border-danger/30 bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger transition hover:opacity-90 disabled:opacity-50 dark:border-danger/30 dark:bg-danger/10">
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button onClick={() => setDhaForm(null)} className={btnGhost}>Cancel</button>
              <button onClick={saveDha} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ══ STALE FC DHA CLEAN-UP ═════════════════════════════════════════ */}
      <Modal open={staleOpen} onClose={() => setStaleOpen(false)} wide
        title={`Stale FC DHA rates — ${(stale ?? []).length}`}
        subtitle="On the rate sheet, but earned nothing at DHA in the last 3 months.">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink dark:text-[#e7e2d8]">
            <input type="checkbox"
              checked={(stale ?? []).length > 0 && staleSel.length === (stale ?? []).length}
              onChange={(e) => setStaleSel(e.target.checked ? (stale ?? []).map((r) => String(r.item_code)) : [])}
              className="h-4 w-4 accent-current" />
            Select all
          </label>
          <span className="text-[12.5px] text-muted dark:text-[#a89f93]">{staleSel.length} selected</span>
          <div className="ml-auto flex gap-2">
            <button disabled={staleBusy || !staleSel.length}
              onClick={() => { if (window.confirm(`Delete ${staleSel.length} barcode(s) from the FC DHA rate sheet?`)) deleteCodes(staleSel); }}
              className="flex items-center justify-center gap-2 rounded-full border border-danger/30 bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger transition hover:opacity-90 disabled:opacity-40 dark:border-danger/30 dark:bg-danger/10">
              <Trash2 size={14} /> Delete selected
            </button>
            <button disabled={staleBusy || !(stale ?? []).length}
              onClick={() => { const all = (stale ?? []).map((r) => String(r.item_code)); if (window.confirm(`Delete ALL ${all.length} stale barcodes? This cannot be undone.`)) deleteCodes(all); }}
              className="flex items-center justify-center gap-2 rounded-full border border-danger/30 bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger transition hover:opacity-90 disabled:opacity-40 dark:border-danger/30 dark:bg-danger/10">
              <Trash2 size={14} /> Delete all
            </button>
          </div>
        </div>
        <DataTable cols={staleCols} rows={stale ?? []} loading={staleBusy} minWidth={620}
          empty="Nothing stale — every barcode on the sheet has sold recently." />
        <p className="mt-3 text-[12px] leading-relaxed text-muted dark:text-[#a89f93]">
          Deleting a barcode only removes its rate; the sales history stays. Removals go 100 at a time because a
          delete that lists thousands of barcodes builds a URL the server refuses.
        </p>
        <div className="mt-4 flex justify-end"><button onClick={() => setStaleOpen(false)} className={btnGhost}>Close</button></div>
      </Modal>

      <PreviewNote />
    </Shell>
  );
}
