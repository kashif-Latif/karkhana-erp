"use client";
/* Import — one drop zone, six Nimbus file types.
 *
 * The old app had a single Import screen that worked out what you had dropped
 * on it from the header row, and that is right: the person exporting from
 * Nimbus is not thinking about which of six importers they need, they are
 * thinking "here is today's file". Every rule below is ported from that app;
 * the reasoning lives in lib/nimbus.ts next to the code it justifies.
 *
 * The three things worth knowing before changing anything here:
 *
 *   1. The sales file cannot tell card from JazzCash. Both arrive as "Other
 *      Payment". They are resolved afterwards by the Non-cash payments file,
 *      matched on store + date + exact time — so that file has to be dropped
 *      AFTER the sales it refers to, or there is nothing to tag.
 *
 *   2. The bill-wise sale report has no item codes. It is refused here in
 *      words, and refused again by a trigger in the database.
 *
 *   3. line_hash is a plain joined string, not a digest, and its shape is
 *      load-bearing for compatibility with rows already in the old database.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, FileCheck2, AlertTriangle, CheckCircle2, X, Info } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, DataTable, Pill, Select, PreviewNote, SourceNote,
  money, type Col,
} from "@/components/retail/kit";
import {
  parseCsvRows, detectKind, KIND_LABEL, normStore, withLineHashes,
  parseSalesRows, parseExpenseRows, parsePaymentRows, parseCommRows,
  type NimbusKind, type SaleRow, type ExpenseRow, type PaymentRow, type CommRow,
} from "@/lib/nimbus";

type Branch = { id: number; name: string; chain: string | null; nimbus_name: string | null };

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [kind, setKind] = useState<NimbusKind>("unknown");
  const [needBranch, setNeedBranch] = useState(false);
  const [pickBranch, setPickBranch] = useState("");
  const [fatal, setFatal] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.from("retail_branches").select("id,name,chain,nimbus_name").order("name")
      .then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);

  const resolveBranch = useCallback((ns: string): number | null => {
    const b = branches.find((x) => x.nimbus_name && normStore(x.nimbus_name) === ns);
    return b ? b.id : null;
  }, [branches]);

  const forceBid = needBranch && pickBranch ? Number(pickBranch) : null;

  /* ── parse, per kind ─────────────────────────────────────────────────── */
  const sales = useMemo(() => {
    if (!rows.length || (kind !== "sales_multi" && kind !== "sales_single")) return null;
    if (kind === "sales_single" && forceBid == null) return null;
    return parseSalesRows(rows, kind === "sales_single" ? forceBid : null, resolveBranch);
  }, [rows, kind, forceBid, resolveBranch]);

  const expenses = useMemo(() => {
    if (!rows.length || (kind !== "expense_multi" && kind !== "expense_single")) return null;
    if (kind === "expense_single" && forceBid == null) return null;
    return parseExpenseRows(rows, kind === "expense_single" ? forceBid : null, resolveBranch);
  }, [rows, kind, forceBid, resolveBranch]);

  const payments = useMemo(() => {
    if (!rows.length || kind !== "payments") return null;
    return parsePaymentRows(rows);
  }, [rows, kind]);

  const comm = useMemo(() => {
    if (!rows.length || kind !== "comm_master") return null;
    return parseCommRows(rows);
  }, [rows, kind]);

  async function onFile(f: File) {
    setFatal(""); setWarn([]); setDone(null); setRows([]); setNeedBranch(false); setPickBranch("");
    setFileName(f.name);
    const parsed = parseCsvRows(await f.text()).filter((r) => r.length > 1);
    if (!parsed.length) { setFatal("Could not read any rows from that file."); return; }

    const hdr = parsed[0].map((h) => h.trim());
    const k = detectKind(hdr);
    setKind(k);

    if (k === "unknown") {
      setFatal("This does not look like a Nimbus export — no Store, Account, Payment Mode or Item Code column was found.");
      return;
    }

    /* The bill-wise guard. A bill-wise sale report has one row per receipt and
       therefore no item code. Commissions are per item and cannot be rebuilt
       from it, and uploading it on top of an item-wise day doubles that day's
       sales. Refused here in words, and again by a trigger in Postgres. */
    if (k === "sales_multi" || k === "sales_single") {
      const ci = hdr.indexOf("Item Code");
      const anyCode = ci >= 0 && parsed.slice(1).some((r) => (r[ci] ?? "").trim() !== "" && !/^total/i.test((r[ci] ?? "").trim()));
      if (!anyCode) {
        setFatal("This is the BILL-WISE sale report — it has no item codes. Commissions are calculated per item and cannot be built from it, and uploading it on top of an item-wise day doubles that day's sales. In Nimbus, choose the item-wise (line-item) sale export instead.");
        return;
      }
    }

    setRows(parsed);
    if (k === "sales_single" || k === "expense_single") setNeedBranch(true);
  }

  /* Whichever kind is loaded, these drive the summary strip. */
  const summary = useMemo(() => {
    if (sales) {
      const ok = sales.parsed.filter((p) => p.branch_id);
      return [
        { l: "Line items", v: sales.parsed.length.toLocaleString() },
        { l: "Matched to a shop", v: ok.length.toLocaleString() },
        { l: "Shop-days", v: String(new Set(ok.map((p) => p.branch_id + "|" + p.sale_date)).size) },
        { l: "Total sales", v: money(ok.reduce((t, p) => t + p.sales_amount, 0)) },
      ];
    }
    if (expenses) {
      const exp = expenses.parsed.filter((p) => p.txn_type === "expense").reduce((t, p) => t + p.amount, 0);
      const inc = expenses.parsed.filter((p) => p.txn_type === "income").reduce((t, p) => t + p.amount, 0);
      return [
        { l: "Transactions", v: expenses.parsed.length.toLocaleString() },
        { l: "Total expense", v: money(exp) },
        { l: "Misc income", v: money(inc) },
        { l: "Date range", v: `${expenses.minD ?? "—"} → ${expenses.maxD ?? "—"}` },
      ];
    }
    if (payments) {
      const modes = new Map<string, number>();
      payments.forEach((p) => modes.set(p.modeRaw, (modes.get(p.modeRaw) ?? 0) + 1));
      return [
        { l: "Payments in file", v: payments.length.toLocaleString() },
        { l: "Card", v: String(payments.filter((p) => p.pm === "meezan_card").length) },
        { l: "JazzCash", v: String(payments.filter((p) => p.pm === "jazzcash").length) },
        { l: "Modes seen", v: [...modes.keys()].slice(0, 2).join(", ") || "—" },
      ];
    }
    if (comm) return [
      { l: "Items", v: comm.length.toLocaleString() },
      { l: "With a rate", v: String(comm.filter((c) => c.percentage > 0 || c.commission > 0).length) },
      { l: "—", v: "" }, { l: "—", v: "" },
    ];
    return null;
  }, [sales, expenses, payments, comm]);

  /* Unknown store names, surfaced before anything is written. */
  useEffect(() => {
    const w: string[] = [];
    if (sales?.unknownStores.size) w.push(`${sales.unknownStores.size} store name(s) not recognised: ${[...sales.unknownStores].slice(0, 4).join(", ")}. Those lines will be skipped — set the shop's Nimbus name on the Branches screen first.`);
    if (expenses?.unknown.size) w.push(`${expenses.unknown.size} store name(s) not recognised: ${[...expenses.unknown].slice(0, 4).join(", ")}. Those rows will be skipped.`);
    if (payments && branches.length) {
      const un = [...new Set(payments.map((p) => p.store))].filter((s) => !resolveBranch(normStore(s)));
      if (un.length) w.push(`Store name(s) not recognised: ${un.slice(0, 4).join(", ")}.`);
    }
    setWarn(w);
  }, [sales, expenses, payments, branches, resolveBranch]);

  /* THE UPLOAD LOG IS HOW THE DASHBOARD KNOWS WHAT IS MISSING.
     It records that a given shop-day HAS been uploaded, for a given KIND of
     file. Absence is the signal — the reminder lists every shop-day with no
     stamp and names the file still owed.

     So the kind written here has to match the kind the reminder looks for, for
     all three: sales, expenses, noncash. Stamping only "sales" (which is what
     this screen used to do) leaves the other two permanently unstamped, and a
     reminder that reports every day as missing forever is a reminder people
     switch off. `unit` is the branch id as text, which is what the dashboard
     keys on too. */
  async function stampUploads(pairs: { branch_id: number | null; date: string | null }[], kind: string) {
    if (!supabase || !pairs.length) return;
    const stamps = [...new Set(
      pairs.filter((p) => p.branch_id && p.date).map((p) => `${p.branch_id}|${p.date}`)
    )].map((k) => {
      const [unit, log_date] = k.split("|");
      return { unit, log_date, kind };
    });
    if (stamps.length) {
      await supabase.from("retail_upload_log")
        .upsert(stamps, { onConflict: "unit,log_date,kind", ignoreDuplicates: true });
    }
  }

  /* ── run ─────────────────────────────────────────────────────────────── */
  async function run() {
    if (!supabase) return;
    setBusy(true); setFatal(""); setDone(null);
    try {
      if (sales) {
        const ok = sales.parsed.filter((p) => p.branch_id);
        if (!ok.length) { setFatal("No line matched a branch — nothing to import."); setBusy(false); return; }
        const total = ok.reduce((t, p) => t + p.sales_amount, 0);
        const { data: batch, error: be } = await supabase.from("retail_import_batches")
          .insert({ filename: fileName, row_count: sales.parsed.length, total_sales: total })
          .select("id").single();
        if (be) throw be;
        const batchId = (batch as { id: number }).id;

        const hashed = withLineHashes(ok);
        let inserted = 0;
        for (let i = 0; i < hashed.length; i += 400) {
          const chunk = hashed.slice(i, i + 400).map(({ _store, _ns, ...rest }: SaleRow & { line_hash: string }) => {
            void _store; void _ns;
            return { ...rest, import_batch_id: batchId };
          });
          const { data, error } = await supabase.from("retail_sale_lines")
            .upsert(chunk, { onConflict: "line_hash", ignoreDuplicates: true }).select("id");
          if (error) throw error;
          inserted += (data as unknown[] | null)?.length ?? 0;
        }
        const skipped = hashed.length - inserted;
        await supabase.from("retail_import_batches").update({ inserted_count: inserted, skipped_count: skipped }).eq("id", batchId);

        await stampUploads(ok.map((p) => ({ branch_id: p.branch_id, date: p.sale_date })), "sales");

        setDone(`${inserted.toLocaleString()} new line${inserted === 1 ? "" : "s"} added.` +
          (skipped ? ` ${skipped.toLocaleString()} were already in — that is the duplicate guard working, not an error.` : ""));
      }

      else if (expenses) {
        const ok = expenses.parsed.filter((p) => p.branch_id);
        if (!ok.length) { setFatal("No row matched a branch — nothing to import."); setBusy(false); return; }
        /* The RPC, not a client-side delete-then-insert. It scopes its own
           delete from the payload and lands on a unique dedupe_key, which is
           what makes re-importing an overlapping range safe. */
        const { data, error } = await supabase.rpc("retail_import_nimbus_expenses", {
          p_branch_ids: [...new Set(ok.map((p) => p.branch_id))],
          p_min_date: expenses.minD,
          p_max_date: expenses.maxD,
          p_rows: ok.map(({ _store, _ns, ...rest }: ExpenseRow) => { void _store; void _ns; return rest; }),
          p_adv_rows: [],
        });
        if (error) throw error;
        await stampUploads(ok.map((p) => ({ branch_id: p.branch_id, date: p.expense_date })), "expenses");
        const res = data as { inserted?: number; expenses_replaced?: number } | null;
        setDone(`${(res?.inserted ?? 0).toLocaleString()} expense rows imported. ${(res?.expenses_replaced ?? 0).toLocaleString()} previously-imported rows in the same range were replaced, so an overlapping re-import cannot double anything.`);
      }

      else if (payments) {
        const mapped = payments.map((p) => ({ ...p, bid: forceBid ?? resolveBranch(p.ns) })).filter((p) => p.bid);
        if (!mapped.length) { setFatal("No payment matched a branch."); setBusy(false); return; }
        const minD = mapped.reduce((a, p) => (a < p.date ? a : p.date), mapped[0].date);
        const maxD = mapped.reduce((a, p) => (a > p.date ? a : p.date), mapped[0].date);

        const key = new Map<string, string>();
        mapped.forEach((p) => key.set(`${p.bid}|${p.date}|${p.time}`, p.pm));

        const lines: { id: number; branch_id: number; sale_date: string; sale_time: string | null }[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from("retail_sale_lines")
            .select("id,branch_id,sale_date,sale_time").gte("sale_date", minD).lte("sale_date", maxD)
            .range(from, from + 999);
          if (error) throw error;
          const got = (data as typeof lines) ?? [];
          lines.push(...got);
          if (got.length < 1000) break;
        }

        const byMode: Record<string, number[]> = {};
        lines.forEach((l) => {
          const m = key.get(`${l.branch_id}|${l.sale_date}|${l.sale_time ?? ""}`);
          if (m) (byMode[m] = byMode[m] ?? []).push(l.id);
        });
        let updated = 0;
        for (const mode of Object.keys(byMode)) {
          const ids = byMode[mode];
          for (let i = 0; i < ids.length; i += 300) {
            const { error } = await supabase.from("retail_sale_lines")
              .update({ payment_method: mode }).in("id", ids.slice(i, i + 300));
            if (error) throw error;
            updated += Math.min(300, ids.length - i);
          }
        }
        await stampUploads(mapped.map((p) => ({ branch_id: p.bid as number, date: p.date })), "noncash");
        setDone(updated === 0
          ? "No sale line matched. This file tags sales that are already imported, matched on shop + date + exact time — import that shop's sales first, then drop this again."
          : `${updated.toLocaleString()} sale lines tagged as card or JazzCash.`);
      }

      else if (comm) {
        let n = 0;
        for (let i = 0; i < comm.length; i += 500) {
          const { error } = await supabase.from("retail_commission_master")
            .upsert(comm.slice(i, i + 500) as CommRow[], { onConflict: "item_code" });
          if (error) throw error;
          n += Math.min(500, comm.length - i);
        }
        setDone(`${n.toLocaleString()} commission rates updated.`);
      }
    } catch (e) {
      setFatal((e as { message?: string })?.message ?? String(e));
    }
    setBusy(false);
  }

  function reset() {
    setRows([]); setFileName(""); setFatal(""); setWarn([]); setDone(null); setNeedBranch(false); setPickBranch("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const saleCols: Col<SaleRow>[] = [
    { head: "Date", muted: true, cell: (p) => p.sale_date },
    { head: "Shop", bold: true, cell: (p) => p.branch_id ? (branches.find((b) => b.id === p.branch_id)?.name ?? p._store) : <Pill tone="bad">{p._store || "unmatched"}</Pill> },
    { head: "Receipt", muted: true, cell: (p) => p.receipt_txn || "—" },
    { head: "Item", cell: (p) => p.item_name || p.item_code || "—" },
    { head: "Qty", right: true, cell: (p) => p.quantity },
    { head: "Amount", right: true, bold: true, cell: (p) => money(p.sales_amount) },
    { head: "MOP", cell: (p) =>
        p.payment_method === "credit" ? <Pill tone="bad">Credit (udhaar)</Pill>
        : p.payment_method === "cash" ? <Pill tone="good">Cash</Pill>
        : p.payment_method === "online" ? <Pill tone="info">Online</Pill>
        : <Pill tone="warn">{p.mop_raw || "unclassified"}</Pill> },
  ];
  const expCols: Col<ExpenseRow>[] = [
    { head: "Date", muted: true, cell: (p) => p.expense_date },
    { head: "Shop", bold: true, cell: (p) => p.branch_id ? (branches.find((b) => b.id === p.branch_id)?.name ?? p._store) : <Pill tone="bad">{p._store}</Pill> },
    { head: "Type", cell: (p) => p.txn_type === "income" ? <Pill tone="good">Income</Pill> : <Pill tone="warn">Expense</Pill> },
    { head: "Category", cell: (p) => p.category },
    { head: "Description", muted: true, cell: (p) => p.description ?? "—" },
    { head: "Paid via", muted: true, cell: (p) => p.paid_via },
    { head: "Amount", right: true, bold: true, cell: (p) => money(p.amount) },
  ];
  const payCols: Col<PaymentRow>[] = [
    { head: "Date", muted: true, cell: (p) => p.date },
    { head: "Time", muted: true, cell: (p) => p.time },
    { head: "Store", bold: true, cell: (p) => p.store },
    { head: "Mode in file", cell: (p) => p.modeRaw || "—" },
    { head: "Becomes", cell: (p) => p.pm === "jazzcash" ? <Pill tone="warn">JazzCash</Pill> : <Pill tone="info">Card</Pill> },
  ];
  const commCols: Col<CommRow>[] = [
    { head: "Item code", bold: true, cell: (c) => c.item_code },
    { head: "Item name", muted: true, cell: (c) => c.item_name ?? "—" },
    { head: "Retail", right: true, cell: (c) => money(c.retail_price) },
    { head: "Commission", right: true, cell: (c) => money(c.commission) },
    { head: "%", right: true, bold: true, cell: (c) => c.percentage },
  ];

  const readyCount = sales ? sales.parsed.filter((p) => p.branch_id).length
    : expenses ? expenses.parsed.filter((p) => p.branch_id).length
    : payments ? payments.length : comm ? comm.length : 0;

  const fcBranches = branches.filter((b) => (b.chain ?? "") !== "Topshop");

  return (
    <Shell>
      <PageHeader title="Import" subtitle="Drop any NimbusRMS export — the file says what it is.">
        {rows.length > 0 && <button onClick={reset} className={btnGhost}><X size={15} /> Clear</button>}
      </PageHeader>

      <div className="mt-5 rounded-card border border-dashed border-line bg-surface p-6 text-center dark:border-white/[0.12] dark:bg-[#201c17]">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-panel text-ink dark:bg-white/[0.08] dark:text-white"><Upload size={22} /></span>
        <p className="mt-3 text-[14px] font-semibold text-ink dark:text-[#f4f1ea]">Drop a Nimbus CSV here</p>
        <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">Sales, account transactions, non-cash payments or the commission master.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        <button onClick={() => fileRef.current?.click()} className={`${btnPrimary} mx-auto mt-4`}>Choose file</button>
        {fileName && (
          <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">
            <FileCheck2 size={14} /> {fileName}
            {kind !== "unknown" && <Pill tone="info">{KIND_LABEL[kind]}</Pill>}
          </p>
        )}
      </div>

      {fatal && (
        <div className="mt-4 flex gap-3 rounded-card border border-danger/30 bg-danger-soft p-4 dark:border-danger/30 dark:bg-danger/10">
          <AlertTriangle size={18} className="mt-0.5 flex-none text-danger" />
          <p className="text-[13px] font-medium leading-relaxed text-danger">{fatal}</p>
        </div>
      )}

      {needBranch && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-line bg-periwinkle-soft p-4 dark:border-white/[0.06] dark:bg-white/[0.04]">
          <Info size={18} className="flex-none text-ink dark:text-white" />
          <p className="flex-1 text-[12.5px] font-medium text-ink dark:text-[#e7e2d8]">
            This is a <strong>single-store</strong> file — it has no Store column, which is how a
            Fashion Collection shop exports. Which branch is it? (Top Shop comes as the combined
            all-stores export.)
          </p>
          <Select value={pickBranch} onChange={setPickBranch}>
            <option value="">Pick a branch…</option>
            {fcBranches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </Select>
        </div>
      )}

      {warn.map((w, i) => (
        <div key={i} className="mt-3 flex gap-3 rounded-card border border-line bg-amber-soft p-4 dark:border-white/[0.06] dark:bg-amber/10">
          <AlertTriangle size={18} className="mt-0.5 flex-none text-amber-strong dark:text-amber" />
          <p className="text-[12.5px] font-medium leading-relaxed text-ink dark:text-[#e7e2d8]">{w}</p>
        </div>
      ))}

      {done && (
        <div className="mt-4 flex gap-3 rounded-card border border-success/30 bg-success-soft p-4 dark:border-success/30 dark:bg-success/10">
          <CheckCircle2 size={18} className="mt-0.5 flex-none text-success" />
          <p className="text-[13px] font-medium leading-relaxed text-ink dark:text-[#e7e2d8]">{done}</p>
        </div>
      )}

      {kind === "payments" && rows.length > 0 && (
        <SourceNote>
          A Nimbus sales export cannot tell card from JazzCash — both come through as &ldquo;Other
          Payment&rdquo;. This file is what resolves them, matched on <strong>shop + date + exact
          time</strong>. So the sales for these days have to be imported first; if nothing matches,
          that is the reason.
        </SourceNote>
      )}

      {summary && !fatal && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summary.map(({ l, v }, i) => (
              <div key={i} className={`rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17] ${l === "—" ? "opacity-0" : ""}`}>
                <div className="text-[19px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{v}</div>
                <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{l}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted dark:text-[#a89f93]">Showing the first 50 rows for checking.</p>
            <button onClick={run} disabled={busy || readyCount === 0} className={btnPrimary}>
              {busy ? "Working…"
                : kind === "payments" ? `Classify ${readyCount.toLocaleString()} payments`
                : kind === "comm_master" ? `Update ${readyCount.toLocaleString()} rates`
                : `Import ${readyCount.toLocaleString()} rows`}
            </button>
          </div>

          {sales && <DataTable cols={saleCols} rows={sales.parsed.slice(0, 50)} minWidth={900} empty="Nothing to show." />}
          {expenses && <DataTable cols={expCols} rows={expenses.parsed.slice(0, 50)} minWidth={900} empty="Nothing to show." />}
          {payments && <DataTable cols={payCols} rows={payments.slice(0, 50)} minWidth={720} empty="Nothing to show." />}
          {comm && <DataTable cols={commCols} rows={comm.slice(0, 50)} minWidth={720} empty="Nothing to show." />}
        </>
      )}

      {(kind === "sales_multi" || kind === "sales_single") && rows.length > 0 && (
        <SourceNote>
          Every line carries a <strong>line_hash</strong> — shop, day, receipt, item, quantity,
          amount and time, joined. The column is unique, so dropping the same file in twice changes
          nothing; the second run reports the lines as skipped. Two identical items on one receipt
          are two real sales and get <code>|#2</code> appended rather than being collapsed.
        </SourceNote>
      )}
      {(kind === "expense_multi" || kind === "expense_single") && rows.length > 0 && (
        <SourceNote>
          Importing <strong>replaces</strong> previously-imported Nimbus expenses for these branches
          within the file&apos;s own date range, so an overlapping re-import is safe. The sign in the
          Amount column decides direction: negative is an expense, positive is misc income.
        </SourceNote>
      )}

      <PreviewNote />
    </Shell>
  );
}
