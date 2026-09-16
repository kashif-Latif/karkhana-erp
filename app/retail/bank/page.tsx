"use client";
/* Bank statements — owner tier.
 *
 * WHY THIS IS OWNER-ONLY
 *   The Alfalah 5840 statement carries the personal movement sitting beside the
 *   shop money. Only the Merchant Payment IBFT credits are the business's;
 *   Raast P2P, PREMIER PAYFAST and RAAST ONUS lines are personal. There is no
 *   way to show this screen to a shop accounts person without showing them
 *   that, so it is not shown.
 *
 * THE JOB THIS SCREEN DOES
 *   A statement line arrives as a narration nobody can file. Naming it once —
 *   giving it a reference, a branch, a category — is unavoidable. Naming the
 *   same narration every month is not, so a rule can be learned from the naming
 *   and applied to every future line that matches. That is what retail_ref_rules
 *   holds, and why the needs-a-name queue shrinks over time instead of staying
 *   the same size forever.
 *
 * WHY RE-UPLOADING IS SAFE
 *   (account_id, dedupe_key) is UNIQUE in the database. Not a UI check — a
 *   constraint. The file hash on retail_stmt_files stops the same statement
 *   even earlier.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Plus, Wand2, ArrowDownRight, ArrowUpRight, Tag, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import RangeBar from "@/components/RangeBar";
import { rangeDates, MONEY_PRESETS } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Tabs, Pill, Select, PreviewNote, SourceNote,
  useBranches, money, num, text, today, type Row, type Col,
} from "@/components/retail/kit";

type Tab = "needs" | "all" | "rules" | "accounts";
const TABS: { key: Tab; label: string }[] = [
  { key: "needs", label: "Needs a name" },
  { key: "all", label: "All lines" },
  { key: "rules", label: "Rules" },
  { key: "accounts", label: "Accounts" },
];

/* The narrations that are NOT shop money in the pooled account. Flagged rather
   than hidden: a line you cannot see is a line you cannot correct. */
const PERSONAL = /raast\s*p2p|premier\s*payfast|raast\s*onus/i;
const SHOP_MONEY = /merchant\s*payment|ibft/i;

export default function BankPage() {
  const { branches, branchName } = useBranches();
  const [tab, setTab] = useState<Tab>("needs");
  const [account, setAccount] = useState("");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [txns, setTxns] = useState<Row[]>([]);
  const [rules, setRules] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [naming, setNaming] = useState<Row | null>(null);
  const [nameForm, setNameForm] = useState({ ref: "", branch_id: "", category: "", learn: true });
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctForm, setAcctForm] = useState({ bank: "Bank Alfalah", label: "", account_no: "", opening_balance: "", opening_date: today() });
  const [saving, setSaving] = useState(false);

  const loadAccounts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("retail_bank_accounts").select("id,bank,label,account_no,opening_balance,opening_date,active,branch_id").order("sort");
    setAccounts((data as Row[]) ?? []);
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);

    let t = supabase.from("retail_bank_txns")
      .select("id,account_id,txn_date,txn_time,direction,amount,balance,descr,ref_no,ref,branch_id,category,needs_ref,counterparty,source")
      .order("txn_date", { ascending: false, nullsFirst: false }).limit(2000);
    if (from) t = t.gte("txn_date", from);
    if (to) t = t.lte("txn_date", to);
    if (account) t = t.eq("account_id", Number(account));

    const [tr, rr] = await Promise.all([
      t,
      supabase.from("retail_ref_rules").select("id,bank,direction,match_type,pattern,ref,branch_id,category,priority,hits,active").order("priority"),
    ]);
    if (tr.error) setErr(tr.error.message);
    setTxns((tr.data as Row[]) ?? []);
    setRules((rr.data as Row[]) ?? []);
    setLoading(false);
  }, [preset, cf, ct, account]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { load(); }, [load]);

  const needs = useMemo(() => txns.filter((r) => r.needs_ref === true), [txns]);
  const tot = useMemo(() => {
    const cr = txns.filter((r) => String(r.direction) === "credit").reduce((t, r) => t + num(r.amount), 0);
    const db = txns.filter((r) => String(r.direction) === "debit").reduce((t, r) => t + num(r.amount), 0);
    const personal = txns.filter((r) => PERSONAL.test(String(r.descr ?? ""))).reduce((t, r) => t + num(r.amount), 0);
    return { cr, db, personal };
  }, [txns]);

  const stats = [
    { label: "Credits", value: money(tot.cr), Icon: ArrowDownRight },
    { label: "Debits", value: money(tot.db), Icon: ArrowUpRight },
    { label: "Flagged personal", value: money(tot.personal), Icon: AlertTriangle },
    { label: "Needs a name", value: String(needs.length), Icon: Tag },
  ];

  function startName(r: Row) {
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
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("retail_bank_txns").update(patch).eq("id", Number(naming.id));
    if (error) { setErr(error.message); setSaving(false); return; }

    /* Learn the rule from the narration, so the same line next month names
       itself. The pattern is the narration trimmed to something that will
       still match when the amount and date change. */
    if (nameForm.learn) {
      const descr = String(naming.descr ?? "").trim();
      const pattern = descr.split(/\s{2,}|\s\d{4,}/)[0].slice(0, 60).trim();
      if (pattern.length >= 4) {
        await supabase.from("retail_ref_rules").insert({
          bank: null, direction: String(naming.direction), match_type: "contains",
          pattern, ref: patch.ref, branch_id: patch.branch_id, category: patch.category,
          account_id: naming.account_id ? Number(naming.account_id) : null,
        });
      }
    }

    setTxns((rs) => rs.map((r) => (r.id === naming.id ? { ...r, ...patch } : r)));
    setNaming(null); setSaving(false);
    if (nameForm.learn) load();
  }

  /* Apply every active rule to every line still waiting for a name. Done in the
     browser and written back per row, because the set is small and doing it in
     a function would hide which rule fired. */
  async function applyRules() {
    if (!supabase) return;
    setSaving(true);
    let hit = 0;
    for (const t of needs) {
      const d = String(t.descr ?? "").toLowerCase();
      const rule = rules.find((r) => r.active !== false && d.includes(String(r.pattern).toLowerCase()));
      if (!rule) continue;
      const patch = { ref: String(rule.ref), branch_id: rule.branch_id ?? null, category: rule.category ?? null, needs_ref: false, auto: true };
      const { error } = await supabase.from("retail_bank_txns").update(patch).eq("id", Number(t.id));
      if (!error) {
        hit++;
        await supabase.from("retail_ref_rules").update({ hits: num(rule.hits) + 1 }).eq("id", Number(rule.id));
      }
    }
    setSaving(false);
    if (hit) load(); else setErr("No waiting line matched an existing rule.");
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
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setAcctOpen(false); setAcctForm((f) => ({ ...f, label: "", account_no: "", opening_balance: "" }));
    loadAccounts();
  }

  const txnCols: Col<Row>[] = [
    { head: "Date", muted: true, cell: (r) => text(r.txn_date) },
    { head: "Narration", cell: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="line-clamp-1 max-w-[280px]">{text(r.descr)}</span>
          {PERSONAL.test(String(r.descr ?? "")) && <Pill tone="bad">personal</Pill>}
          {SHOP_MONEY.test(String(r.descr ?? "")) && <Pill tone="good">shop</Pill>}
        </span>
      ) },
    { head: "Dir", cell: (r) => (String(r.direction) === "credit" ? <Pill tone="good">In</Pill> : <Pill tone="warn">Out</Pill>) },
    { head: "Amount", right: true, bold: true, cell: (r) => money(r.amount) },
    { head: "Reference", cell: (r) => (r.needs_ref ? <Pill tone="warn">unnamed</Pill> : text(r.ref)) },
    { head: "Branch", muted: true, cell: (r) => (r.branch_id ? branchName(r.branch_id) : "—") },
    { head: "", right: true, cell: (r) => (
        <button onClick={() => startName(r)} className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:text-white dark:hover:bg-white/[0.08]">
          {r.needs_ref ? "Name it" : "Edit"}
        </button>
      ) },
  ];

  const ruleCols: Col<Row>[] = [
    { head: "When narration contains", bold: true, cell: (r) => text(r.pattern) },
    { head: "Call it", cell: (r) => text(r.ref) },
    { head: "Branch", muted: true, cell: (r) => (r.branch_id ? branchName(r.branch_id) : "—") },
    { head: "Category", muted: true, cell: (r) => text(r.category) },
    { head: "Used", right: true, cell: (r) => num(r.hits).toLocaleString() },
    { head: "", right: true, cell: (r) => (r.active === false ? <Pill>off</Pill> : <Pill tone="good">on</Pill>) },
  ];

  const acctCols: Col<Row>[] = [
    { head: "Bank", bold: true, cell: (r) => text(r.bank) },
    { head: "Label", cell: (r) => text(r.label) },
    { head: "Account no", muted: true, cell: (r) => text(r.account_no) },
    { head: "Opening", right: true, cell: (r) => money(r.opening_balance) },
    { head: "From", muted: true, cell: (r) => text(r.opening_date) },
    { head: "", right: true, cell: (r) => (r.active === false ? <Pill>closed</Pill> : <Pill tone="good">active</Pill>) },
  ];

  return (
    <Shell>
      <PageHeader title="Bank Statements" subtitle="Alfalah, Meezan and JazzCash lines — named once, then named automatically."
        onRefresh={load} loading={loading}>
        <Select value={account} onChange={setAccount}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={String(a.id)} value={String(a.id)}>{String(a.bank)} · {String(a.label)}</option>)}
        </Select>
        {tab === "needs" && needs.length > 0 && (
          <button onClick={applyRules} disabled={saving} className={btnGhost}><Wand2 size={15} /> Apply rules</button>
        )}
        {tab === "accounts" && <button onClick={() => { setErr(""); setAcctOpen(true); }} className={btnPrimary}><Plus size={15} /> Add account</button>}
      </PageHeader>

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} presets={MONEY_PRESETS} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab !== "accounts" && tab !== "rules" && <StatCards stats={stats} loading={loading} />}

      {err && <p className="mt-4 text-[12.5px] font-semibold text-danger">{err}</p>}

      {tab === "needs" && <DataTable cols={txnCols} rows={needs} loading={loading} minWidth={1020} empty="Nothing waiting — every line in this range has a name." />}
      {tab === "all" && <DataTable cols={txnCols} rows={txns} loading={loading} minWidth={1020} empty="No statement lines in this range. Add an account and import a statement first." />}
      {tab === "rules" && <DataTable cols={ruleCols} rows={rules} loading={loading} minWidth={760} empty="No rules yet — name a line and tick “remember this” to make the first one." />}
      {tab === "accounts" && <DataTable cols={acctCols} rows={accounts} loading={loading} minWidth={720} empty="No accounts yet — add the Alfalah pooled account first." />}

      <SourceNote>
        In the pooled Alfalah account, <strong>only the Merchant Payment / IBFT credits are shop
        money</strong>. Raast P2P, PREMIER PAYFAST and RAAST ONUS lines are personal and are
        flagged rather than hidden, because a line you cannot see is a line you cannot correct.
        Re-uploading a statement cannot duplicate a payment: <code>(account, dedupe_key)</code> is
        unique in the database.
      </SourceNote>

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
            <span><strong>Remember this narration.</strong> The next statement will name the same line by itself, and the queue gets shorter every month instead of staying the same size.</span>
          </label>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setNaming(null)} className={btnGhost}>Cancel</button>
            <button onClick={saveName} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save name"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={acctOpen} onClose={() => setAcctOpen(false)} title="Add a bank account"
        subtitle="The opening balance is the figure on the statement the day before the first line you will import.">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank"><input value={acctForm.bank} onChange={(e) => setAcctForm({ ...acctForm, bank: e.target.value })} className={inputCls} /></Field>
            <Field label="Label"><input value={acctForm.label} onChange={(e) => setAcctForm({ ...acctForm, label: e.target.value })} className={inputCls} placeholder="e.g. Pooled 5840" autoFocus /></Field>
          </div>
          <Field label="Account number"><input value={acctForm.account_no} onChange={(e) => setAcctForm({ ...acctForm, account_no: e.target.value })} className={inputCls} /></Field>
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
        <Landmark size={13} /> Statement reading from a PDF or screenshot needs the read-statement function deployed on this project.
      </div>
      <PreviewNote />
    </Shell>
  );
}
