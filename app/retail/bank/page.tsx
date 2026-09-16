"use client";
/* Bank statements — owner tier.
 *
 * WHY THIS IS OWNER-ONLY
 *   The Alfalah 5840 statement carries the personal movement sitting beside the
 *   shop money. Only the Merchant Payment / IBFT credits are the business's;
 *   Raast P2P, PREMIER PAYFAST and RAAST ONUS lines are personal. There is no
 *   way to show this screen to a shop accounts person without showing them
 *   that, so it is not shown.
 *
 * THE JOB THIS SCREEN DOES, IN FOUR PARTS
 *
 *   IMPORT. A statement CSV is hashed before it is read, and the hash is
 *   checked against retail_stmt_files, so the same file cannot be loaded twice
 *   by somebody who does not remember loading it. Every line then gets a
 *   dedupe_key — see lib/bankStatement.ts — and the upsert lands on the unique
 *   (account_id, dedupe_key). That column is NOT NULL, which is why nothing
 *   could be inserted at all until something computed it.
 *
 *   NAMING. A line arrives as a narration nobody can file. Naming it once is
 *   unavoidable; naming the same narration every month is not, so a rule is
 *   learned from the naming. Forty unnamed lines are usually six parties, so
 *   the queue groups by counterparty and one decision names the whole group.
 *
 *   BALANCES. Opening is the last balance the BANK printed before the day —
 *   not a number we computed — and the bank's own balance column overrides our
 *   arithmetic on every line that has one.
 *
 *   THE DAY BOOK. One card per account for a chosen day, with opening, in, out
 *   and closing, because that is the shape the day gets signed off in.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   The old app's statement-image reader deleted a whole date span of card
 *   credits before reinserting them. One bad read and a month of reconciled
 *   money is gone with no record that it ever existed. It is not ported.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Landmark, Plus, Wand2, ArrowDownRight, ArrowUpRight, Tag, AlertTriangle,
  Upload, Printer, ChevronLeft, ChevronRight, CheckCircle2,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import RangeBar from "@/components/RangeBar";
import { rangeDates, MONEY_PRESETS } from "@/lib/dateRange";
import { printTable } from "@/lib/export";
import {
  Shell, PageHeader, StatCards, DataTable, Tabs, Pill, Select, PreviewNote, SourceNote,
  useBranches, money, num, text, today, type Row, type Col,
} from "@/components/retail/kit";
import {
  bsClean, bsDedupe, bsRuleHit, bsPattern, bsGroupPat, bsRun, bsOpening, bsSortDay,
  bsGroupParties, bsAllParties, bsGuessAcct, bsAcctLabel, sha256File, parseStatementCSV,
  addDays, PERSONAL, SHOP_MONEY,
  type BankAccount, type RefRule, type ParsedTxn,
} from "@/lib/bankStatement";

type Tab = "day" | "needs" | "all" | "rules" | "accounts";
const TABS: { key: Tab; label: string }[] = [
  { key: "day", label: "Day book" },
  { key: "needs", label: "Needs a name" },
  { key: "all", label: "All lines" },
  { key: "rules", label: "Rules" },
  { key: "accounts", label: "Accounts" },
];

/** A statement line as it comes back out of the database. */
type BankTxn = {
  id: number; account_id: number; txn_date: string; txn_time: string | null;
  direction: string; amount: number; balance: number | null;
  descr: string | null; ref_no: string | null; ref: string | null;
  branch_id: number | null; category: string | null; counterparty: string | null;
  suggest: string | null; needs_ref: boolean | null; auto: boolean | null;
  source: string | null;
  /** Not a column — filled in from the account before a rule is tested, because
   *  a rule scoped to a bank can never match a row that does not know its own. */
  bank?: string | null;
};

/** A line read out of a dropped file, before anything is written. */
type PreviewRow = ParsedTxn & {
  keep: boolean; account_id: number | null; bank: string;
  dedupe_key: string; ref: string; branch_id: number | null; category: string | null;
  auto: boolean; hash: string; file: string;
};

type DayPack = {
  acct: BankAccount;
  lines: { row: BankTxn; run: number }[];
  opening: number; closing: number; inAmt: number; outAmt: number; needN: number;
};

export default function BankPage() {
  const { branches, branchName } = useBranches();
  const [tab, setTab] = useState<Tab>("day");
  const [acct, setAcct] = useState("");
  const [day, setDay] = useState(today());
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [rules, setRules] = useState<RefRule[]>([]);
  const [txns, setTxns] = useState<BankTxn[]>([]);
  const [packs, setPacks] = useState<DayPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [naming, setNaming] = useState<BankTxn | null>(null);
  const [nameForm, setNameForm] = useState({ ref: "", branch_id: "", category: "", learn: true });
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctForm, setAcctForm] = useState({ bank: "alfalah", label: "", account_no: "", opening_balance: "", opening_date: today(), branch_id: "" });

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [previewFiles, setPreviewFiles] = useState<{ name: string; hash: string }[]>([]);
  const [previewSkipped, setPreviewSkipped] = useState<string[]>([]);
  const [previewFailed, setPreviewFailed] = useState<string[]>([]);
  const [groupRef, setGroupRef] = useState<Record<string, string>>({});
  /* What is typed into the day book's Reference column, before it is saved.
     Controlled rather than uncontrolled: stepping to another day reuses the
     same table rows, and an uncontrolled input would keep yesterday's text
     sitting in today's row looking like it had been saved. */
  const [refDraft, setRefDraft] = useState<Record<number, string>>({});

  const acctById = useCallback((id: unknown) => accounts.find((a) => a.id === Number(id)) ?? null, [accounts]);

  /* ── loading ──────────────────────────────────────────────────────────── */

  const loadRefs = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const [ra, rr] = await Promise.all([
      supabase.from("retail_bank_accounts").select("id,bank,label,account_no,opening_balance,opening_date,active,sort,branch_id").order("sort").order("id"),
      supabase.from("retail_ref_rules").select("id,bank,direction,match_type,pattern,ref,branch_id,account_id,category,priority,hits,active").order("priority").order("id"),
    ]);
    setAccounts((ra.data as BankAccount[]) ?? []);
    setRules((rr.data as RefRule[]) ?? []);
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);
    let t = supabase.from("retail_bank_txns")
      .select("id,account_id,txn_date,txn_time,direction,amount,balance,descr,ref_no,ref,branch_id,category,counterparty,suggest,needs_ref,auto,source")
      .order("txn_date", { ascending: false, nullsFirst: false }).order("id").limit(3000);
    if (from) t = t.gte("txn_date", from);
    if (to) t = t.lte("txn_date", to);
    if (acct) t = t.eq("account_id", Number(acct));
    const { data, error } = await t;
    if (error) setErr(error.message);
    setTxns((data as BankTxn[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, acct]);

  /* The day book reads its own day, per account, because the running balance
     needs the last balance BEFORE the day and that is not in the range above. */
  const loadDay = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !accounts.length) { setPacks([]); return; }
    const db = supabase;
    setDayLoading(true);
    const wanted = accounts.filter((a) => a.active !== false && (!acct || Number(acct) === a.id));
    const out: DayPack[] = [];
    for (const a of wanted) {
      const { data } = await db.from("retail_bank_txns")
        .select("id,account_id,txn_date,txn_time,direction,amount,balance,descr,ref_no,ref,branch_id,category,counterparty,suggest,needs_ref,auto,source")
        .eq("account_id", a.id).eq("txn_date", day).order("id");
      const rows = bsSortDay((data as BankTxn[]) ?? []);
      const opening = await bsOpening(db, a.id, day, a.opening_balance);
      const { lines, closing } = bsRun(rows, opening);
      out.push({
        acct: a, lines, opening, closing,
        inAmt: rows.filter((r) => r.direction === "credit").reduce((s, r) => s + num(r.amount), 0),
        outAmt: rows.filter((r) => r.direction === "debit").reduce((s, r) => s + num(r.amount), 0),
        needN: rows.filter((r) => r.needs_ref).length,
      });
    }
    setPacks(out);
    setRefDraft({});
    setDayLoading(false);
  }, [accounts, acct, day]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "day") loadDay(); }, [tab, loadDay]);

  /* ── derived ──────────────────────────────────────────────────────────── */

  /* A stored row does not carry its bank; the account does. Attach it before a
     rule is tested, or every bank-scoped rule silently never fires. */
  const withBank = useCallback(
    (t: BankTxn): BankTxn => ({ ...t, bank: acctById(t.account_id)?.bank ?? null }),
    [acctById]
  );

  const needs = useMemo(() => txns.filter((r) => r.needs_ref === true), [txns]);
  const { groups, singles } = useMemo(() => bsGroupParties(needs), [needs]);
  const allParties = useMemo(() => bsAllParties(needs), [needs]);

  const tot = useMemo(() => ({
    cr: txns.filter((r) => r.direction === "credit").reduce((t, r) => t + num(r.amount), 0),
    db: txns.filter((r) => r.direction === "debit").reduce((t, r) => t + num(r.amount), 0),
    personal: txns.filter((r) => PERSONAL.test(String(r.descr ?? ""))).reduce((t, r) => t + num(r.amount), 0),
  }), [txns]);

  const stats = [
    { label: "Credits", value: money(tot.cr), Icon: ArrowDownRight },
    { label: "Debits", value: money(tot.db), Icon: ArrowUpRight },
    { label: "Flagged personal", value: money(tot.personal), Icon: AlertTriangle },
    { label: "Needs a name", value: `${needs.length} · ${groups.length} repeat part${groups.length === 1 ? "y" : "ies"}`, Icon: Tag },
  ];

  /* ── import ───────────────────────────────────────────────────────────── */

  async function onFiles(list: FileList | null) {
    if (!list || !list.length) return;
    if (!supabase) { setErr("Not connected."); return; }
    if (!accounts.length) { setErr("Add a bank account first — the Accounts tab."); return; }
    const db = supabase;
    setImporting(true); setErr(""); setNote("");

    const files = Array.from(list).slice(0, 12);
    const out: PreviewRow[] = [];
    const meta: { name: string; hash: string }[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    /* One seen-map across the whole batch, so the "#2" suffix is consistent
       whether two identical payments arrive in one file or in two. */
    const seen: Record<string, number> = {};

    for (const f of files) {
      const hash = await sha256File(f);
      const { data: ex } = await db.from("retail_stmt_files").select("id").eq("file_hash", hash).limit(1);
      if (((ex as Row[] | null) ?? []).length || meta.some((m) => m.hash === hash)) { skipped.push(f.name); continue; }
      let parsed;
      try { parsed = parseStatementCSV(await f.text(), f.name); }
      catch (e) { failed.push(`${f.name} — ${(e as Error).message}`); continue; }
      if (!parsed.rows.length) { failed.push(`${f.name} — no transaction rows found in it`); continue; }

      const aid = bsGuessAcct({ account: parsed.account, bank: parsed.bank, name: f.name }, accounts, acct ? Number(acct) : null);
      const bank = acctById(aid)?.bank ?? parsed.bank;
      meta.push({ name: f.name, hash });
      parsed.rows.forEach((x) => {
        const r: PreviewRow = {
          ...x, keep: true, account_id: aid, bank, hash, file: f.name,
          dedupe_key: "", ref: "", branch_id: null, category: null, auto: false,
        };
        r.dedupe_key = bsDedupe(r, seen);
        const hit = bsRuleHit(r, rules);
        if (hit) { r.ref = hit.ref; r.branch_id = hit.branch_id ?? null; r.category = hit.category ?? null; r.auto = true; }
        out.push(r);
      });
    }

    out.sort((a, b) => a.txn_date.localeCompare(b.txn_date) || String(a.txn_time).localeCompare(String(b.txn_time)));
    setPreview(out); setPreviewFiles(meta); setPreviewSkipped(skipped); setPreviewFailed(failed);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!out.length) {
      setErr(failed.length ? failed[0]
        : skipped.length ? "Already loaded before — nothing new in those files."
        : "No transactions found in those files.");
    }
  }

  /** Changing the account changes which rules are even allowed to fire, so the
   *  suggestion is recomputed rather than left showing another account's rule. */
  function setRowAccount(i: number, id: string) {
    setPreview((rs) => rs.map((r, j) => {
      if (j !== i) return r;
      const aid = Number(id) || null;
      const next: PreviewRow = { ...r, account_id: aid, bank: acctById(aid)?.bank ?? r.bank };
      if (r.auto || !r.ref) {
        const hit = bsRuleHit(next, rules);
        next.ref = hit ? hit.ref : "";
        next.branch_id = hit?.branch_id ?? null;
        next.category = hit?.category ?? null;
        next.auto = !!hit;
      }
      return next;
    }));
  }

  async function saveImport() {
    if (!supabase) return;
    const db = supabase;
    const keep = preview.filter((r) => r.keep && r.account_id);
    if (!keep.length) { setErr("Nothing ticked to save."); return; }
    setSaving(true); setErr("");

    /* The file row first. It is what makes the next upload of the same file a
       no-op — and 23505 on it just means somebody else got there first. */
    const fileIds: Record<string, number> = {};
    for (const f of previewFiles) {
      const mine = keep.filter((r) => r.hash === f.hash);
      if (!mine.length) continue;
      const ds = mine.map((r) => r.txn_date).sort();
      const { data, error } = await db.from("retail_stmt_files")
        .insert({ file_hash: f.hash, file_name: f.name, account_id: mine[0].account_id, n_rows: mine.length, from_date: ds[0], to_date: ds[ds.length - 1] })
        .select("id").single();
      if (error && error.code !== "23505") { setErr(error.message); setSaving(false); return; }
      if (data) fileIds[f.hash] = Number((data as Row).id);
    }

    const payload = keep.map((r) => ({
      account_id: r.account_id, txn_date: r.txn_date, txn_time: r.txn_time || null,
      direction: r.direction, amount: r.amount, balance: r.balance,
      descr: r.descr || null, ref_no: r.ref_no || null, ref: r.ref || null,
      branch_id: r.branch_id, category: r.category, counterparty: r.counterparty || null,
      suggest: r.suggest || null, auto: r.auto, needs_ref: !r.ref,
      file_id: fileIds[r.hash] ?? null, dedupe_key: r.dedupe_key, source: "statement",
    }));

    /* ignoreDuplicates, not "check first". The unique index decides, so a race
       or a re-read can never double a payment up. */
    const { error } = await db.from("retail_bank_txns").upsert(payload, { onConflict: "account_id,dedupe_key", ignoreDuplicates: true });
    setSaving(false);
    if (error) { setErr(error.message); return; }

    const needN = payload.filter((p) => p.needs_ref).length;
    setNote(`${keep.length} transaction(s) saved${needN ? ` · ${needN} still need a name` : ""}.`);
    setDay(payload.map((p) => p.txn_date).sort().pop() ?? day);
    setPreview([]); setPreviewFiles([]); setPreviewSkipped([]); setPreviewFailed([]);
    setTab(needN ? "needs" : "day");
    load(); loadDay();
  }

  /* ── naming ───────────────────────────────────────────────────────────── */

  function startName(r: BankTxn) {
    setNaming(r);
    setNameForm({ ref: String(r.suggest ?? r.ref ?? ""), branch_id: r.branch_id ? String(r.branch_id) : "", category: String(r.category ?? ""), learn: true });
    setErr("");
  }

  async function saveName() {
    if (!naming || !supabase) return;
    if (!nameForm.ref.trim()) { setErr("Give it a reference."); return; }
    setSaving(true); setErr("");
    const patch = {
      ref: nameForm.ref.trim(),
      branch_id: nameForm.branch_id ? Number(nameForm.branch_id) : null,
      category: nameForm.category.trim() || null,
      needs_ref: false,
      auto: false,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("retail_bank_txns").update(patch).eq("id", naming.id);
    if (error) { setErr(error.message); setSaving(false); return; }

    /* LEARN THE RULE — from the most durable thing on the line, not from an
       arbitrary slice of narration. bsPattern prefers a masked account token,
       then the counterparty, then the longest real word. bsGroupPat then
       refuses to write anything at all when the candidate is a substring of
       another party's name: a contains-rule on "AHMED" would swallow "AHMED
       TEXTILES" forever, and a confidently wrong name is worse than an
       unnamed line.

       Scoped to this account and this direction, because a pattern taken off
       one line is weaker evidence than a party name shared by a whole group,
       and a debit rule firing on a credit is a wrong attribution of money. */
    if (nameForm.learn) {
      const pat = bsGroupPat(bsPattern(naming), [naming], allParties);
      if (pat && pat.length >= 4) {
        await supabase.from("retail_ref_rules").insert({
          bank: null, direction: naming.direction, match_type: "contains",
          pattern: pat, ref: patch.ref, branch_id: patch.branch_id, category: patch.category,
          account_id: naming.account_id, priority: 60,
        });
      } else {
        setNote("Named, but no rule was saved — the only pattern available would also have matched another party's lines.");
      }
    }

    setTxns((rs) => rs.map((r) => (r.id === naming.id ? { ...r, ...patch } : r)));
    setNaming(null); setSaving(false);
    if (nameForm.learn) loadRefs();
    if (tab === "day") loadDay();
  }

  /** Name a whole repeat party in one action, and learn one rule from it.
   *  Naming forty rows one at a time is the reason the queue never shrinks. */
  async function applyGroup(g: { name: string; rows: BankTxn[] }) {
    if (!supabase) return;
    /* Same fallback the input shows, so pressing Apply without editing the
       suggestion does what it looks like it will do. */
    const ref = bsClean(groupRef[g.name.toLowerCase()] ?? g.rows[0].suggest ?? "");
    if (!ref) { setErr(`Type a reference for ${g.name} first.`); return; }
    setSaving(true); setErr("");
    const br = branches.find((x) => ref.toLowerCase().indexOf(String(x.name).toLowerCase()) >= 0);
    const ids = g.rows.map((r) => r.id);
    const { error } = await supabase.from("retail_bank_txns")
      .update({ ref, branch_id: br ? br.id : null, needs_ref: false, auto: false, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) { setErr(error.message); setSaving(false); return; }

    /* One rule for the whole group, and only when it is safe to write one. The
       group rule is left unscoped by bank and direction: the pattern is a party
       name or an account token, which identifies the same party whichever way
       the money is moving. */
    const pat = bsGroupPat(g.name, g.rows, allParties);
    if (pat) {
      await supabase.from("retail_ref_rules").insert({
        bank: null, direction: null, match_type: "contains",
        pattern: pat, ref, branch_id: br ? br.id : null, priority: 50,
      });
    }
    setTxns((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, ref, branch_id: br ? br.id : null, needs_ref: false } : r)));
    setNote(`${ids.length} transaction(s) named “${ref}”${pat ? "" : " — no rule saved, that name is contained in another party's name"}.`);
    setSaving(false);
    loadRefs();
  }

  /** Run every active rule over every line still waiting for a name. */
  async function applyRules() {
    if (!supabase) return;
    setSaving(true); setErr(""); setNote("");
    let hit = 0;
    for (const t of needs) {
      const rule = bsRuleHit(withBank(t), rules);
      if (!rule) continue;
      const patch = { ref: rule.ref, branch_id: rule.branch_id ?? null, category: rule.category ?? null, needs_ref: false, auto: true };
      const { error } = await supabase.from("retail_bank_txns").update(patch).eq("id", t.id);
      if (!error) {
        hit++;
        if (rule.id) await supabase.from("retail_ref_rules").update({ hits: num(rule.hits) + 1 }).eq("id", rule.id);
      }
    }
    setSaving(false);
    if (hit) { setNote(`${hit} line(s) named from saved rules.`); load(); }
    else setErr("No waiting line matched an existing rule.");
  }

  /** Type straight into the Reference column in the day book. */
  async function saveRef(id: number, value: string) {
    if (!supabase) return;
    const ref = bsClean(value);
    const br = branches.find((x) => ref.toLowerCase().indexOf(String(x.name).toLowerCase()) >= 0);
    const { error } = await supabase.from("retail_bank_txns")
      .update({ ref: ref || null, branch_id: br ? br.id : null, needs_ref: !ref, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { setErr(error.message); return; }
    setPacks((ps) => ps.map((p) => ({
      ...p,
      lines: p.lines.map((l) => (l.row.id === id ? { ...l, row: { ...l.row, ref: ref || null, needs_ref: !ref } } : l)),
      needN: p.lines.filter((l) => (l.row.id === id ? !ref : l.row.needs_ref)).length,
    })));
  }

  async function saveAccount() {
    if (!supabase) return;
    if (!acctForm.label.trim()) { setErr("Give the account a label."); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("retail_bank_accounts").insert({
      bank: acctForm.bank.trim(), label: acctForm.label.trim(),
      account_no: acctForm.account_no.trim() || null,
      opening_balance: Number(acctForm.opening_balance) || 0,
      opening_date: acctForm.opening_date || null,
      branch_id: acctForm.branch_id ? Number(acctForm.branch_id) : null,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setAcctOpen(false);
    setAcctForm((f) => ({ ...f, label: "", account_no: "", opening_balance: "", branch_id: "" }));
    loadRefs();
  }

  async function deleteRule(id: unknown) {
    if (!supabase) return;
    const { error } = await supabase.from("retail_ref_rules").delete().eq("id", Number(id));
    if (error) { setErr(error.message); return; }
    setRules((rs) => rs.filter((r) => r.id !== Number(id)));
  }

  function printDay() {
    printTable({
      title: `Bank day book · ${day}`,
      headers: ["Account", "Time", "Reference", "Bank details", "In", "Out", "Balance"],
      rows: packs.flatMap((p) => [
        [bsAcctLabel(p.acct), "", "Opening balance", "", "", "", Math.round(p.opening)],
        ...p.lines.map((l) => [
          bsAcctLabel(p.acct), String(l.row.txn_time ?? "").slice(0, 5), l.row.ref ?? "",
          l.row.descr ?? "",
          l.row.direction === "credit" ? Math.round(num(l.row.amount)) : "",
          l.row.direction === "debit" ? Math.round(num(l.row.amount)) : "",
          Math.round(l.run),
        ]),
        [bsAcctLabel(p.acct), "", "Closing balance", "", Math.round(p.inAmt), Math.round(p.outAmt), Math.round(p.closing)],
      ]),
    });
  }

  /* ── columns ──────────────────────────────────────────────────────────── */

  const txnCols: Col<BankTxn>[] = [
    { head: "Date", muted: true, cell: (r) => text(r.txn_date) },
    { head: "Account", muted: true, cell: (r) => bsAcctLabel(acctById(r.account_id)) },
    { head: "Narration", cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="line-clamp-1 max-w-[260px]">{text(r.descr)}</span>
          {PERSONAL.test(String(r.descr ?? "")) && <Pill tone="bad">personal</Pill>}
          {SHOP_MONEY.test(String(r.descr ?? "")) && <Pill tone="good">shop</Pill>}
        </span>
      ) },
    { head: "Dir", cell: (r) => (r.direction === "credit" ? <Pill tone="good">In</Pill> : <Pill tone="warn">Out</Pill>) },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.amount) },
    { head: "Balance", right: true, muted: true, cell: (r) => (r.balance == null ? "—" : money(r.balance)) },
    { head: "Reference", cell: (r) => (r.needs_ref ? <Pill tone="warn">unnamed</Pill> : <span className="flex items-center gap-1.5">{text(r.ref)}{r.auto && <Pill tone="info">rule</Pill>}</span>) },
    { head: "Branch", muted: true, cell: (r) => (r.branch_id ? branchName(r.branch_id) : "—") },
    { head: "", right: true, cell: (r) => (
        <button onClick={() => startName(r)} className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:text-white dark:hover:bg-white/[0.08]">
          {r.needs_ref ? "Name it" : "Edit"}
        </button>
      ) },
  ];

  const groupCols: Col<{ name: string; rows: BankTxn[]; inA: number; outA: number }>[] = [
    { head: "Party", bold: true, cell: (g) => <span className="line-clamp-1 max-w-[260px]">{g.name}</span> },
    { head: "Times", right: true, cell: (g) => g.rows.length },
    { head: "Received", right: true, cell: (g) => (g.inA ? <span className="text-success">{money(g.inA)}</span> : "—") },
    { head: "Paid out", right: true, cell: (g) => (g.outA ? <span className="text-danger">{money(g.outA)}</span> : "—") },
    { head: "Your reference", cell: (g) => (
        <input value={groupRef[g.name.toLowerCase()] ?? String(g.rows[0].suggest ?? "")}
          onChange={(e) => setGroupRef((m) => ({ ...m, [g.name.toLowerCase()]: e.target.value }))}
          placeholder="e.g. Rent DHA, Card settlement" className={inputCls} />
      ) },
    { head: "", right: true, cell: (g) => (
        <button onClick={() => applyGroup(g)} disabled={saving} className={btnGhost}>Apply to {g.rows.length}</button>
      ) },
  ];

  const ruleCols: Col<RefRule>[] = [
    { head: "When the details contain", bold: true, cell: (r) => <code className="text-[12px]">{text(r.pattern)}</code> },
    { head: "How", muted: true, cell: (r) => text(r.match_type ?? "contains") },
    { head: "Call it", cell: (r) => text(r.ref) },
    { head: "Account", muted: true, cell: (r) => (r.account_id ? bsAcctLabel(acctById(r.account_id)) : "any") },
    { head: "Direction", muted: true, cell: (r) => (r.direction === "credit" ? "money in" : r.direction === "debit" ? "money out" : "any") },
    { head: "Branch", muted: true, cell: (r) => (r.branch_id ? branchName(r.branch_id) : "—") },
    { head: "Priority", right: true, muted: true, cell: (r) => num(r.priority ?? 100) },
    { head: "Used", right: true, cell: (r) => num(r.hits).toLocaleString() },
    { head: "", right: true, cell: (r) => (
        <button onClick={() => deleteRule(r.id)} className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:text-white dark:hover:bg-white/[0.08]">Delete</button>
      ) },
  ];

  const acctCols: Col<BankAccount>[] = [
    { head: "Bank", bold: true, cell: (r) => text(r.bank) },
    { head: "Label", cell: (r) => text(r.label) },
    { head: "Account no", muted: true, cell: (r) => text(r.account_no) },
    { head: "Shop it belongs to", muted: true, cell: (r) => (r.branch_id ? branchName(r.branch_id) : "mixed / not set") },
    { head: "Opening", right: true, cell: (r) => money(r.opening_balance) },
    { head: "From", muted: true, cell: (r) => text(r.opening_date) },
    { head: "", right: true, cell: (r) => (r.active === false ? <Pill>closed</Pill> : <Pill tone="good">active</Pill>) },
  ];

  const dayCols: Col<{ row: BankTxn; run: number }>[] = [
    { head: "Time", muted: true, cell: (l) => String(l.row.txn_time ?? "").slice(0, 5) || "—" },
    { head: "Reference", cell: (l) => (
        <input value={refDraft[l.row.id] ?? (l.row.ref ?? "")} placeholder={String(l.row.suggest ?? "name this")}
          onChange={(e) => setRefDraft((m) => ({ ...m, [l.row.id]: e.target.value }))}
          onBlur={(e) => { if (bsClean(e.target.value) !== bsClean(l.row.ref)) saveRef(l.row.id, e.target.value); }}
          className={inputCls} />
      ) },
    { head: "Bank details", muted: true, cell: (l) => <span className="line-clamp-1 max-w-[300px]">{text(l.row.descr)}</span> },
    { head: "In", right: true, cell: (l) => (l.row.direction === "credit" ? <span className="text-success">{money(l.row.amount)}</span> : "") },
    { head: "Out", right: true, cell: (l) => (l.row.direction === "debit" ? <span className="text-danger">{money(l.row.amount)}</span> : "") },
    { head: "Balance", right: true, bold: true, cell: (l) => money(l.run) },
  ];

  const previewCols: Col<PreviewRow>[] = [
    { head: "", cell: (_r, i) => (
        <input type="checkbox" checked={preview[i].keep}
          onChange={(e) => setPreview((rs) => rs.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
          className="h-4 w-4 accent-[#141414] dark:accent-white" />
      ) },
    { head: "Date", muted: true, cell: (r) => `${r.txn_date}${r.txn_time ? " " + r.txn_time : ""}` },
    { head: "Account", cell: (_r, i) => (
        <select value={String(preview[i].account_id ?? "")} onChange={(e) => setRowAccount(i, e.target.value)} className={inputCls}>
          {accounts.map((a) => <option key={a.id} value={String(a.id)}>{bsAcctLabel(a)}</option>)}
        </select>
      ) },
    { head: "Details", muted: true, cell: (r) => (
        <span className="block max-w-[280px]">
          <span className="line-clamp-1">{r.descr}</span>
          {r.ref_no && <span className="block text-[10.5px] text-hint dark:text-[#8a8175]">{r.ref_no}</span>}
        </span>
      ) },
    { head: "In", right: true, cell: (r) => (r.direction === "credit" ? <span className="text-success">{money(r.amount)}</span> : "") },
    { head: "Out", right: true, cell: (r) => (r.direction === "debit" ? <span className="text-danger">{money(r.amount)}</span> : "") },
    { head: "Balance", right: true, muted: true, cell: (r) => (r.balance == null ? "—" : money(r.balance)) },
    { head: "Reference", cell: (_r, i) => (
        <input value={preview[i].ref} placeholder={preview[i].suggest || "name it later"}
          onChange={(e) => setPreview((rs) => rs.map((x, j) => (j === i ? { ...x, ref: e.target.value, auto: false } : x)))}
          className={inputCls} />
      ) },
  ];

  const nAuto = preview.filter((r) => r.auto).length;
  const pIn = preview.filter((r) => r.direction === "credit").reduce((a, r) => a + r.amount, 0);
  const pOut = preview.filter((r) => r.direction === "debit").reduce((a, r) => a + r.amount, 0);

  return (
    <Shell>
      <PageHeader title="Bank Statements"
        subtitle="Alfalah, Meezan and JazzCash lines — named once, then named automatically."
        onRefresh={() => { load(); loadDay(); }} loading={loading}>
        <Select value={acct} onChange={setAcct}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={String(a.id)}>{a.bank} · {bsAcctLabel(a)}</option>)}
        </Select>
        <input ref={fileRef} type="file" accept=".csv,text/csv" multiple className="hidden"
          onChange={(e) => onFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={importing} className={btnGhost}>
          <Upload size={15} /> {importing ? "Reading…" : "Import statement"}
        </button>
        {tab === "needs" && needs.length > 0 && (
          <button onClick={applyRules} disabled={saving} className={btnGhost}><Wand2 size={15} /> Apply rules</button>
        )}
        {tab === "accounts" && <button onClick={() => { setErr(""); setAcctOpen(true); }} className={btnPrimary}><Plus size={15} /> Add account</button>}
      </PageHeader>

      {tab === "day" ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button onClick={() => setDay(addDays(day, -1))} className={btnGhost} aria-label="Previous day"><ChevronLeft size={15} /></button>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink outline-none dark:border-white/10 dark:bg-white/[0.06] dark:text-white" />
          <button onClick={() => setDay(addDays(day, 1))} className={btnGhost} aria-label="Next day"><ChevronRight size={15} /></button>
          <button onClick={printDay} disabled={!packs.length} className={`${btnGhost} ml-auto`}><Printer size={15} /> Print for signing</button>
        </div>
      ) : (
        <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} presets={MONEY_PRESETS} />
      )}

      <Tabs tabs={TABS} value={tab} onChange={(t) => { setErr(""); setNote(""); setTab(t); }} />
      {(tab === "needs" || tab === "all") && <StatCards stats={stats} loading={loading} />}

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}
      {note && (
        <div className="mt-4 flex gap-3 rounded-card border border-success/30 bg-success-soft p-4 dark:border-success/30 dark:bg-success/10">
          <CheckCircle2 size={18} className="mt-0.5 flex-none text-success" />
          <p className="text-[13px] font-medium leading-relaxed text-ink dark:text-[#e7e2d8]">{note}</p>
        </div>
      )}

      {/* ── DAY BOOK ───────────────────────────────────────────────────── */}
      {tab === "day" && (
        packs.length === 0 && !dayLoading ? (
          <DataTable cols={dayCols} rows={[]} loading={false} minWidth={900}
            empty="No accounts yet — add one in the Accounts tab, then import a statement." />
        ) : (
          packs.map((p) => (
            <div key={p.acct.id} className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">{bsAcctLabel(p.acct)}</h2>
                  <p className="mt-0.5 text-[12px] text-muted dark:text-[#a89f93]">
                    {p.lines.length} transaction{p.lines.length === 1 ? "" : "s"}
                    {p.needN ? ` · ${p.needN} to name` : p.lines.length ? " · all named" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {[
                    { l: "Opening", v: money(p.opening), c: "" },
                    { l: "In", v: money(p.inAmt), c: "text-success" },
                    { l: "Out", v: money(p.outAmt), c: "text-danger" },
                    { l: "Closing", v: money(p.closing), c: "" },
                  ].map((x) => (
                    <div key={x.l} className="text-right">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-hint dark:text-[#8a8175]">{x.l}</div>
                      <div className={`text-[14px] font-extrabold tabular-nums ${x.c || "text-ink dark:text-[#f4f1ea]"}`}>{x.v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <DataTable cols={dayCols} rows={p.lines} loading={dayLoading} minWidth={900}
                empty={`Nothing on ${day} in this account.`}
                footer={
                  <tr className="font-semibold text-ink dark:text-[#f4f1ea]">
                    <td className="px-4 py-3" colSpan={3}>Total for the day</td>
                    <td className="px-4 py-3 text-right tabular-nums text-success">{money(p.inAmt)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-danger">{money(p.outAmt)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(p.closing)}</td>
                  </tr>
                } />
            </div>
          ))
        )
      )}

      {/* ── NEEDS A NAME ───────────────────────────────────────────────── */}
      {tab === "needs" && (
        <>
          {groups.length > 0 && (
            <>
              <h2 className="mt-6 text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Repeat parties</h2>
              <p className="mt-0.5 text-[12.5px] text-muted dark:text-[#a89f93]">
                Name one and it applies to every line from that party — and to every future statement,
                unless the name would also have matched somebody else&apos;s.
              </p>
              <DataTable cols={groupCols} rows={groups} loading={loading} minWidth={980}
                empty="No party appears more than once." />
            </>
          )}
          <h2 className="mt-6 text-[15px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">One-off lines</h2>
          <p className="mt-0.5 text-[12.5px] text-muted dark:text-[#a89f93]">{singles.length} that appear only once in this range.</p>
          <DataTable cols={txnCols} rows={singles} loading={loading} minWidth={1140}
            empty="Nothing waiting — every line in this range has a name." />
        </>
      )}

      {tab === "all" && <DataTable cols={txnCols} rows={txns} loading={loading} minWidth={1140} empty="No statement lines in this range. Add an account and import a statement first." />}
      {tab === "rules" && <DataTable cols={ruleCols} rows={rules} loading={loading} minWidth={1060} empty="No rules yet — name a line and tick “remember this” to make the first one." />}
      {tab === "accounts" && <DataTable cols={acctCols} rows={accounts} loading={loading} minWidth={900} empty="No accounts yet — add the Alfalah pooled account first." />}

      <SourceNote>
        In the pooled Alfalah account, <strong>only the Merchant Payment / IBFT credits are shop
        money</strong>. Raast P2P, PREMIER PAYFAST and RAAST ONUS lines are personal and are flagged
        rather than hidden, because a line you cannot see is a line you cannot correct.
        Re-uploading a statement cannot duplicate a payment: the file is hashed against{" "}
        <code>retail_stmt_files</code> before it is even read, and every line carries a{" "}
        <code>dedupe_key</code> built from the bank&apos;s own transaction id where there is one, then
        a real reference, then date + amount + balance, then date + amount + narration — with a{" "}
        <code>#2</code> suffix so that two genuinely identical payments on one day both survive.{" "}
        <code>(account, dedupe_key)</code> is unique in the database.
      </SourceNote>

      {/* ── IMPORT PREVIEW ─────────────────────────────────────────────── */}
      <Modal open={preview.length > 0} onClose={() => setPreview([])} wide
        title="Transactions read from your statements"
        subtitle={`${nAuto} of ${preview.length} already have a name from your saved rules — the rest go into Needs a name.`}>
        <div className="space-y-3">
          {previewSkipped.length > 0 && (
            <p className="rounded-xl2 border border-line bg-panel/60 px-3.5 py-2.5 text-[12px] text-muted dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-[#a89f93]">
              Skipped {previewSkipped.length} file(s) loaded before: {previewSkipped.join(", ")}
            </p>
          )}
          {previewFailed.length > 0 && (
            <p className="rounded-xl2 border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[12px] font-medium text-danger dark:bg-danger/10">
              Couldn&apos;t read: {previewFailed.join(" · ")}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { l: "Transactions", v: String(preview.length) },
              { l: "Money in", v: money(pIn) },
              { l: "Money out", v: money(pOut) },
              { l: "Named by a rule", v: String(nAuto) },
            ].map((x) => (
              <div key={x.l} className="rounded-xl2 border border-line bg-panel/50 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="text-[16px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{x.v}</div>
                <div className="text-[11.5px] font-medium text-muted dark:text-[#a89f93]">{x.l}</div>
              </div>
            ))}
          </div>
          <div className="max-h-[46vh] overflow-y-auto">
            <DataTable cols={previewCols} rows={preview} minWidth={1100} empty="Nothing readable in those files." />
          </div>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setPreview([])} className={btnGhost}>Cancel</button>
            <button onClick={saveImport} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : `Save ${preview.filter((r) => r.keep).length} transaction(s)`}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── NAME ONE LINE ──────────────────────────────────────────────── */}
      <Modal open={!!naming} onClose={() => setNaming(null)} title="Name this line"
        subtitle={naming ? `${text(naming.txn_date)} · ${money(naming.amount)} · ${text(naming.descr)}` : undefined}>
        <div className="space-y-3.5">
          <Field label="Reference — what to call it"><input value={nameForm.ref} onChange={(e) => setNameForm({ ...nameForm, ref: e.target.value })} className={inputCls} autoFocus placeholder="e.g. Card settlement, Rent DHA" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch">
              <select value={nameForm.branch_id} onChange={(e) => setNameForm({ ...nameForm, branch_id: e.target.value })} className={inputCls}>
                <option value="">Not a branch line</option>
                {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Category"><input value={nameForm.category} onChange={(e) => setNameForm({ ...nameForm, category: e.target.value })} className={inputCls} placeholder="Optional" /></Field>
          </div>
          <label className="flex items-start gap-2.5 rounded-xl2 border border-line bg-panel/50 px-3.5 py-3 text-[12.5px] text-ink dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-[#e7e2d8]">
            <input type="checkbox" checked={nameForm.learn} onChange={(e) => setNameForm({ ...nameForm, learn: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[#141414] dark:accent-white" />
            <span>
              <strong>Remember this line.</strong> The rule is written from{" "}
              <code>{naming ? bsPattern(naming) : ""}</code> — a masked account token if there is one,
              otherwise the counterparty, otherwise the longest real word. If that would also have
              matched another party&apos;s lines, no rule is saved at all.
            </span>
          </label>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setNaming(null)} className={btnGhost}>Cancel</button>
            <button onClick={saveName} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save name"}</button>
          </div>
        </div>
      </Modal>

      {/* ── ADD AN ACCOUNT ─────────────────────────────────────────────── */}
      <Modal open={acctOpen} onClose={() => setAcctOpen(false)} title="Add a bank account"
        subtitle="The opening balance is the figure on the statement the day before the first line you will import.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank">
              <select value={acctForm.bank} onChange={(e) => setAcctForm({ ...acctForm, bank: e.target.value })} className={inputCls}>
                <option value="alfalah">Bank Alfalah</option>
                <option value="meezan">Meezan Bank</option>
                <option value="jazzcash">JazzCash</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Label"><input value={acctForm.label} onChange={(e) => setAcctForm({ ...acctForm, label: e.target.value })} className={inputCls} placeholder="e.g. Pooled 5840" autoFocus /></Field>
          </div>
          <Field label="Account number"><input value={acctForm.account_no} onChange={(e) => setAcctForm({ ...acctForm, account_no: e.target.value })} className={inputCls} /></Field>
          <Field label="Shop it belongs to">
            <select value={acctForm.branch_id} onChange={(e) => setAcctForm({ ...acctForm, branch_id: e.target.value })} className={inputCls}>
              <option value="">Mixed — not one shop&apos;s</option>
              {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening balance"><input type="number" value={acctForm.opening_balance} onChange={(e) => setAcctForm({ ...acctForm, opening_balance: e.target.value })} className={inputCls} /></Field>
            <Field label="Opening date"><input type="date" value={acctForm.opening_date} onChange={(e) => setAcctForm({ ...acctForm, opening_date: e.target.value })} className={inputCls} /></Field>
          </div>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setAcctOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={saveAccount} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Add account"}</button>
          </div>
        </div>
      </Modal>

      <div className="mt-3 flex items-center justify-center gap-1.5 text-center text-[12px] text-hint dark:text-[#8a8175]">
        <Landmark size={13} /> CSV statements import here. A PDF or a photograph needs the
        read-statement function deployed on this project.
      </div>
      <PreviewNote />
    </Shell>
  );
}
