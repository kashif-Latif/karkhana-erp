"use client";
/* BRANCHES — the admin screen for the shops, with their numbers beside them.
 *
 * WHY THIS SCREEN HAS TO BE EDITABLE  (it was a read-only report, and that was
 * a hole with money falling through it)
 *   `nimbus_name` is how the importer resolves a shop: the sales file carries a
 *   store name as free text, the importer normalises it and looks for a branch
 *   whose nimbus_name matches. No match, no branch, and every line for that
 *   store is SKIPPED. The Import screen says so in as many words — "set the
 *   shop's Nimbus name on the Branches screen first" — and until this screen
 *   could write that field there was nowhere to do it. A new shop, or a shop
 *   Nimbus renamed, silently dropped its sales and the only symptom was a
 *   branch that looked quiet.
 *
 * THE NIMBUS NAME IS NORMALISED ON SAVE
 *   Upper-cased, inner whitespace collapsed, trimmed — exactly what normStore
 *   does to the store name coming out of the file, because the importer
 *   compares normStore(file) against normStore(branch) and a value stored as
 *   "Top Shop  Fortress" would never match "TOP SHOP FORTRESS". Blank is
 *   stored as NULL, not as "": the importer tests for a truthy nimbus_name, and
 *   an empty string is a value that looks set and matches nothing.
 *
 * WHY SAVING CLEARS needs_review
 *   The importer auto-creates a branch when it meets a store it cannot resolve,
 *   and flags it needs_review=true. That row is a placeholder: a name guessed
 *   from a spreadsheet, no colour, and a nimbus_name nobody has confirmed. The
 *   flag means "a human has not looked at this yet", so a human looking at it
 *   and saving IS the review — there is no separate approve button, because a
 *   second step people have to remember is a step that stays undone and leaves
 *   the banner up forever. Opening the dialog and cancelling changes nothing.
 *
 * THE PERFORMANCE COLUMNS STAY
 *   Sales, margin, expenses, net and receipts for the chosen period. They are
 *   the per-branch table the Dashboard sends people here for, and taking them
 *   away to make room for admin fields would move a used report to nowhere.
 *   The sale lines are PAGED: PostgREST caps a response at 1000 rows and
 *   `.limit(5000)` does not raise it — it just returns what it returns, and a
 *   branch's sales total that is quietly a lower bound is worse than one that
 *   errors, because nobody re-checks a number that looks plausible.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, AlertTriangle, TrendingUp, Plus, Pencil } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import RangeBar from "@/components/RangeBar";
import { rangeDates } from "@/lib/dateRange";
import {
  Shell, PageHeader, StatCards, DataTable, Pill, PreviewNote, SourceNote,
  money, num, fetchAll, type Row, type Col, type Branch,
} from "@/components/retail/kit";

/** Ported verbatim from normStore in the original, and the same as the copy in
 *  lib/nimbus that the importer uses on the file side. Both sides of the
 *  comparison have to be normalised the same way or nothing ever matches. */
const normStore = (s: unknown) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();

const BLANK = { name: "", code: "", chain: "", nimbus_name: "", color: "#EBA98F", business: "", active: true };

type Perf = { sales: number; margin: number; qty: number; exp: number; receipts: Set<string> };
const EMPTY_PERF: Perf = { sales: 0, margin: 0, qty: 0, exp: 0, receipts: new Set() };

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [sales, setSales] = useState<Row[]>([]);
  const [expenses, setExpenses] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [preset, setPreset] = useState("30d");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [from, to] = rangeDates(preset, cf, ct);

    /* nimbus_name and needs_review are the point of this screen, so they are
       selected here rather than through the kit's useBranches, which reads the
       short list every screen needs to name a row. */
    const [b, s, e] = await Promise.all([
      supabase.from("retail_branches")
        .select("id,code,name,chain,business,active,color,nimbus_name,needs_review")
        .order("chain").order("name"),
      fetchAll<Row>((a, z) => {
        let q = supabase!.from("retail_sale_lines")
          .select("branch_id,sales_amount,gross_margin,quantity,receipt_txn,receipt_no,id");
        if (from) q = q.gte("sale_date", from);
        if (to) q = q.lte("sale_date", to);
        return q.order("id", { ascending: true }).range(a, z);
      }),
      fetchAll<Row>((a, z) => {
        let q = supabase!.from("retail_expenses").select("branch_id,amount,txn_type");
        if (from) q = q.gte("expense_date", from);
        if (to) q = q.lte("expense_date", to);
        return q.order("id", { ascending: true }).range(a, z);
      }),
    ]);
    if (b.error || s.error || e.error) setErr(b.error?.message || s.error || e.error);
    setBranches((b.data as Branch[]) ?? []);
    setSales(s.rows);
    setExpenses(e.rows);
    setLoading(false);
  }, [preset, cf, ct]);
  useEffect(() => { load(); }, [load]);

  const perf = useMemo(() => {
    const m: Record<string, Perf> = {};
    sales.forEach((r) => {
      const k = String(r.branch_id);
      (m[k] ||= { sales: 0, margin: 0, qty: 0, exp: 0, receipts: new Set() });
      m[k].sales += num(r.sales_amount); m[k].margin += num(r.gross_margin); m[k].qty += num(r.quantity);
      m[k].receipts.add(String(r.receipt_txn || r.receipt_no || r.id));
    });
    expenses.forEach((r) => {
      const k = String(r.branch_id);
      (m[k] ||= { sales: 0, margin: 0, qty: 0, exp: 0, receipts: new Set() });
      /* Income is the same table with txn_type flipped, so it comes off the
         expense figure rather than being counted as one. */
      m[k].exp += r.txn_type === "income" ? -num(r.amount) : num(r.amount);
    });
    return m;
  }, [sales, expenses]);

  const totalSales = useMemo(() => Object.values(perf).reduce((a, v) => a + v.sales, 0), [perf]);
  const maxSales = useMemo(() => Math.max(...Object.values(perf).map((v) => v.sales), 1), [perf]);
  const needsReview = useMemo(() => branches.filter((b) => b.needs_review), [branches]);

  /** The chains and businesses that exist, for the pickers. Taken from the data
   *  rather than hardcoded: the original's dialog offered exactly two chains,
   *  which quietly rewrites the chain of any branch that is neither — Head
   *  Office among them, and Head Office is told apart by its chain. */
  const chains = useMemo(
    () => [...new Set(branches.map((b) => b.chain).filter(Boolean))] as string[],
    [branches]
  );
  const businesses = useMemo(
    () => [...new Set(branches.map((b) => b.business).filter(Boolean))] as string[],
    [branches]
  );

  const stats = [
    { label: "Branches", value: String(branches.length), Icon: Building2 },
    { label: "Active", value: String(branches.filter((b) => b.active !== false).length), Icon: CheckCircle2 },
    { label: "Needs review", value: String(needsReview.length), Icon: AlertTriangle },
    { label: "Period sales", value: money(totalSales), Icon: TrendingUp },
  ];

  function startAdd() {
    setEditing(null);
    setForm({
      ...BLANK,
      chain: chains[0] ?? "",
      /* A new branch belongs to whatever business the existing ones do. Getting
         this wrong files a shop where nobody looking for it will see it. */
      business: businesses[0] ?? "",
    });
    setErr(""); setOpen(true);
  }

  function startEdit(b: Branch) {
    setEditing(b);
    setForm({
      name: b.name ?? "", code: b.code ?? "", chain: b.chain ?? "",
      nimbus_name: b.nimbus_name ?? "", color: b.color || "#EBA98F",
      business: b.business ?? "", active: b.active !== false,
    });
    setErr(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setErr("A branch name is required."); return; }
    if (!supabase) { setErr("Not connected."); return; }
    setSaving(true); setErr("");
    const payload = {
      name: form.name.trim(),
      chain: form.chain.trim() || null,
      color: form.color || null,
      /* Normalised on the way in, NULL when blank — see the note at the top.
         The importer matches normStore(file) against this value. */
      nimbus_name: form.nimbus_name.trim() ? normStore(form.nimbus_name) : null,
      active: form.active,
      /* Saving IS the review: somebody has now looked at this row and confirmed
         its name and its Nimbus name, which is the whole meaning of the flag. */
      needs_review: false,
    };
    const { error } = editing
      ? await supabase.from("retail_branches").update(payload).eq("id", editing.id)
      : await supabase.from("retail_branches").insert({
          ...payload,
          code: form.code.trim() || null,
          business: form.business.trim() || null,
        });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setOpen(false); load();
  }

  const cols: Col<Branch>[] = [
    { head: "Branch", cell: (b) => {
        const p = perf[String(b.id)] ?? EMPTY_PERF;
        return (
          <div>
            <span className="flex items-center gap-2 font-semibold">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: b.color || "#EBA98F" }} />
              {b.name}
            </span>
            <span className="mt-1 block h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-panel dark:bg-white/[0.06]">
              <span className="block h-full rounded-full" style={{ width: `${Math.max((p.sales / maxSales) * 100, 1)}%`, background: b.color || "#EBA98F" }} />
            </span>
          </div>
        );
      } },
    { head: "Chain", muted: true, cell: (b) => b.chain || "—" },
    { head: "Nimbus store name", cell: (b) => (
        b.nimbus_name
          ? <span className="font-medium text-muted dark:text-[#a89f93]">{b.nimbus_name}</span>
          /* Not a dash. A branch with no Nimbus name is not missing a label,
             it is a branch whose sales are being skipped on every import. */
          : <Pill tone="bad">Not set</Pill>
      ) },
    { head: "Status", cell: (b) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {b.active !== false ? <Pill tone="good">Active</Pill> : <Pill>Inactive</Pill>}
          {b.needs_review ? <Pill tone="warn">Needs review</Pill> : null}
        </span>
      ) },
    { head: "Sales", right: true, bold: true, cell: (b) => money((perf[String(b.id)] ?? EMPTY_PERF).sales) },
    { head: "Margin", right: true, cell: (b) => money((perf[String(b.id)] ?? EMPTY_PERF).margin) },
    { head: "Expenses", right: true, cell: (b) => money((perf[String(b.id)] ?? EMPTY_PERF).exp) },
    { head: "Net", right: true, cell: (b) => {
        const p = perf[String(b.id)] ?? EMPTY_PERF;
        const net = p.margin - p.exp;
        return <span className={`font-semibold ${net < 0 ? "text-danger" : "text-success"}`}>{money(net)}</span>;
      } },
    { head: "Receipts", right: true, cell: (b) => (perf[String(b.id)] ?? EMPTY_PERF).receipts.size.toLocaleString() },
    { head: "", right: true, cell: (b) => (
        <button onClick={() => startEdit(b)}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <Pencil size={13} /> Edit
        </button>
      ) },
  ];

  return (
    <Shell>
      <PageHeader
        title="Branches"
        subtitle="Rename a shop, set its Nimbus store name so imports land, and see how each performed."
        onRefresh={load} loading={loading}
      >
        <button onClick={startAdd} className={btnPrimary}><Plus size={15} /> Add branch</button>
      </PageHeader>

      {/* A branch the importer invented is useless until somebody confirms its
          Nimbus name, and nobody goes looking for a flag they cannot see. */}
      {needsReview.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-card border border-amber-strong/40 bg-amber-soft px-4 py-3 text-[13px] text-ink dark:border-white/10 dark:bg-white/[0.06] dark:text-[#f4f1ea]">
          <AlertTriangle size={16} className="shrink-0 text-amber-strong" />
          <span>
            <strong>{needsReview.length}</strong>{" "}
            {needsReview.length === 1 ? "branch was" : "branches were"} created automatically by an import and
            {" "}{needsReview.length === 1 ? "has" : "have"} not been checked:{" "}
            <strong>{needsReview.map((b) => b.name).join(", ")}</strong>. Open{" "}
            {needsReview.length === 1 ? "it" : "each"} and save to confirm the name and the Nimbus store name.
          </span>
        </div>
      )}

      <StatCards stats={stats} loading={loading} />

      <RangeBar preset={preset} setPreset={setPreset} cf={cf} setCf={setCf} ct={ct} setCt={setCt} />

      <DataTable cols={cols} rows={branches} loading={loading} err={err} minWidth={1180}
        empty="No branches yet — add the first one above, or let an import create it and confirm it here." />

      <SourceNote>
        <strong>Nimbus store name</strong> is the exact text the POS export uses for this shop. The importer
        upper-cases it and collapses its spaces before matching, and this screen stores it the same way, so
        the two can agree. A branch with no Nimbus name has every one of its lines skipped on import — the
        shop simply looks quiet. Sales, margin and expenses are for the period chosen above; net is margin
        less expenses.
      </SourceNote>

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : "Add branch"}
        subtitle={editing?.needs_review
          ? "This branch was created by an import. Saving confirms it and clears the review flag."
          : "The Nimbus store name is what makes imported sales land on this shop."}>
        <div className="space-y-3.5">
          <Field label="Branch name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Chain">
              {/* A list of what already exists, and still typeable: a new chain
                  is a real thing, and a fixed two-item dropdown would rewrite
                  the chain of anything that is neither. */}
              <input value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })} list="rt-branch-chains" className={inputCls} placeholder="e.g. Topshop" />
              <datalist id="rt-branch-chains">{chains.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Colour">
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-[38px] w-full rounded-xl2 border border-line bg-canvas px-1.5 py-1 dark:border-white/10 dark:bg-white/[0.04]" />
            </Field>
          </div>
          <Field label="Nimbus store name (exact text from the export)">
            <input value={form.nimbus_name} onChange={(e) => setForm({ ...form, nimbus_name: e.target.value })}
              className={inputCls} placeholder="e.g. TOP SHOP FORTRESS" />
          </Field>
          {form.nimbus_name.trim() && normStore(form.nimbus_name) !== form.nimbus_name && (
            <p className="text-[12px] text-muted dark:text-[#a89f93]">
              Saved as <strong>{normStore(form.nimbus_name)}</strong> — the importer matches on the
              upper-cased, single-spaced form.
            </p>
          )}
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputCls} placeholder="short code" /></Field>
              <Field label="Business">
                <input value={form.business} onChange={(e) => setForm({ ...form, business: e.target.value })} list="rt-branch-biz" className={inputCls} />
                <datalist id="rt-branch-biz">{businesses.map((x) => <option key={x} value={x} />)}</datalist>
              </Field>
            </div>
          )}
          <label className="flex items-center gap-2.5 text-[13px] font-semibold text-ink dark:text-[#e7e2d8]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-[#141414] dark:accent-white" />
            Open for business
          </label>
          {err && <p className="text-[12.5px] font-semibold text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={save} disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add branch"}
            </button>
          </div>
          {!isSupabaseConfigured && <p className="text-center text-[12px] text-hint">Preview build — nothing will be saved.</p>}
        </div>
      </Modal>

      <PreviewNote />
    </Shell>
  );
}
