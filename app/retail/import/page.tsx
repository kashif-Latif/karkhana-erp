"use client";
/* Nimbus import — the screen the retail day actually starts on.
 *
 * THE ONE RULE THAT MATTERS
 *   Upload the ITEM-WISE sale report. The bill-wise report has one row per
 *   receipt and therefore no item code, so commissions — which are per item —
 *   cannot be built from it, and uploading bill-wise on top of an item-wise day
 *   doubles that day's sales. This screen refuses the file before a single row
 *   is sent, and the database refuses it again on insert. Two guards, because
 *   this has happened.
 *
 * THE SECOND RULE
 *   Nimbus MOP "Credit" is udhaar — goods on account — NOT a credit card.
 *   Reading it as card is what made FC DHA's 1 Sep card figure read 36,100
 *   instead of 33,400. The mapping below is the only place that decision is
 *   made, so it is the only place it can go wrong.
 *
 * WHY RE-UPLOADING IS SAFE
 *   Every line carries a line_hash built from the fields that identify it, and
 *   the column is UNIQUE. An upsert that ignores duplicates means the same file
 *   can be dropped in twice, or a file can be extended and re-dropped, and the
 *   totals do not move. Nothing here relies on the operator remembering.
 */
import { useMemo, useRef, useState } from "react";
import { Upload, FileCheck2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { parseCsv, matchHeader, toNum, toDate } from "@/lib/csv";
import { btnPrimary, btnGhost } from "@/components/Modal";
import {
  Shell, PageHeader, DataTable, Pill, PreviewNote, SourceNote,
  useBranches, money, num, type Col, type Branch,
} from "@/components/retail/kit";

type Parsed = {
  branch_id: number | null; branchLabel: string;
  sale_date: string | null; sale_time: string; receipt_no: string; receipt_txn: string;
  salesperson: string; customer: string; item_code: string; item_name: string;
  department: string; size: string; color: string;
  retail_price: number; quantity: number; sales: number; discount: number;
  net_sales: number; tax: number; sales_amount: number; cost_price: number;
  mop_raw: string; payment_method: string; serial_no: string; line_hash: string;
};

/* MOP -> payment_method. Order matters: 'credit card' must be read as card
   before the bare word 'credit' is read as udhaar, or every card sale in a
   shop that writes "Credit Card" becomes a receivable. */
function mapMop(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (!s) return "unclassified";
  if (/(credit|debit)\s*card|visa|master|meezan|pos\b/.test(s)) return "meezan_card";
  if (/jazz|mobile\s*wallet|easypaisa/.test(s)) return "jazzcash";
  if (/online|shopify|web/.test(s)) return "online";
  if (/^credit$|udhaar|udhar|account/.test(s)) return "credit";   // goods on account
  if (/cash/.test(s)) return "cash";
  return "other";
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const H = {
  branch: ["branch", "shop", "store", "location", "outlet"],
  date: ["date", "sale date", "bill date", "invoice date"],
  time: ["time", "sale time"],
  receipt: ["receipt no", "bill no", "invoice no", "receipt"],
  txn: ["receipt txn", "txn no", "transaction", "txn"],
  sp: ["salesperson", "sales person", "sales man", "salesman", "staff"],
  cust: ["customer", "customer name", "party"],
  code: ["item code", "itemcode", "sku", "barcode", "product code"],
  name: ["item name", "itemname", "product", "description"],
  dept: ["department", "category", "dept"],
  size: ["size"],
  color: ["color", "colour"],
  price: ["retail price", "rate", "mrp", "price"],
  qty: ["quantity", "qty"],
  sales: ["sales", "gross", "amount"],
  disc: ["discount", "disc"],
  net: ["net sales", "net", "net amount"],
  tax: ["tax", "gst"],
  total: ["sales amount", "total", "net payable", "grand total"],
  cost: ["cost price", "cost"],
  mop: ["mop", "payment", "payment mode", "mode of payment", "payment method"],
  serial: ["serial no", "serial", "sr no", "sr"],
};

export default function ImportPage() {
  const { branches } = useBranches();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Parsed[]>([]);
  const [fatal, setFatal] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; total: number } | null>(null);

  /* A shop is matched by its nimbus_name first, because that is the name the
     POS writes and the reason the column exists. Falling back to name and code
     costs nothing and saves the branch that was set up before anyone thought
     to fill nimbus_name in. */
  const matchBranch = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const idx = new Map<string, Branch>();
    branches.forEach((b) => {
      const rec = b as Branch & { nimbus_name?: string };
      [rec.nimbus_name, b.name, b.code].forEach((v) => { if (v) idx.set(norm(String(v)), b); });
    });
    return (raw: string) => idx.get(norm(raw)) ?? null;
  }, [branches]);

  async function onFile(f: File) {
    setFatal(""); setWarn([]); setResult(null); setParsed([]);
    setFileName(f.name);
    const { headers, rows } = parseCsv(await f.text());
    if (rows.length === 0) { setFatal("That file has no rows."); return; }

    const col = Object.fromEntries(
      Object.entries(H).map(([k, cands]) => [k, matchHeader(headers, cands)])
    ) as Record<keyof typeof H, string>;

    /* GUARD 1. No item-code column at all, or a column that is empty on every
       row, means this is the bill-wise export. Refuse it here so the operator
       is told in words rather than by a constraint error thirty seconds later. */
    const codesPresent = col.code && rows.some((r) => (r[col.code] ?? "").trim() !== "");
    if (!codesPresent) {
      setFatal(
        "This is the BILL-WISE sale report — it has no item codes. Commissions are calculated per item and cannot be built from it, and uploading it on top of an item-wise day doubles that day's sales. In Nimbus, choose the item-wise (line-item) sale export instead."
      );
      return;
    }

    const unknownBranches = new Set<string>();
    const unknownMop = new Set<string>();

    const out: Parsed[] = await Promise.all(rows.map(async (r) => {
      const branchRaw = (r[col.branch] ?? "").trim();
      const b = matchBranch(branchRaw);
      if (branchRaw && !b) unknownBranches.add(branchRaw);

      const mopRaw = (r[col.mop] ?? "").trim();
      const pm = mapMop(mopRaw);
      if (mopRaw && pm === "other") unknownMop.add(mopRaw);

      const date = toDate(r[col.date]);
      const txn = (r[col.txn] ?? r[col.receipt] ?? "").trim();
      const code = (r[col.code] ?? "").trim();
      const qty = toNum(r[col.qty]) ?? 0;
      const amount = toNum(r[col.total]) ?? toNum(r[col.net]) ?? toNum(r[col.sales]) ?? 0;
      const serial = (r[col.serial] ?? "").trim();

      /* The identity of a line: which shop, which day, which receipt, which
         item, how many, for how much, and its position on the receipt. Serial
         is in there because two identical items on one receipt are two lines,
         not a duplicate. */
      const line_hash = await sha256([b?.id ?? branchRaw, date, txn, code, qty, amount, serial].join("|"));

      return {
        branch_id: b?.id ?? null, branchLabel: b?.name ?? (branchRaw || "—"),
        sale_date: date, sale_time: (r[col.time] ?? "").trim(),
        receipt_no: (r[col.receipt] ?? "").trim(), receipt_txn: txn,
        salesperson: (r[col.sp] ?? "").trim(), customer: (r[col.cust] ?? "").trim(),
        item_code: code, item_name: (r[col.name] ?? "").trim(),
        department: (r[col.dept] ?? "").trim(), size: (r[col.size] ?? "").trim(), color: (r[col.color] ?? "").trim(),
        retail_price: toNum(r[col.price]) ?? 0, quantity: qty,
        sales: toNum(r[col.sales]) ?? 0, discount: toNum(r[col.disc]) ?? 0,
        net_sales: toNum(r[col.net]) ?? 0, tax: toNum(r[col.tax]) ?? 0,
        sales_amount: amount, cost_price: toNum(r[col.cost]) ?? 0,
        mop_raw: mopRaw, payment_method: pm, serial_no: serial, line_hash,
      };
    }));

    const w: string[] = [];
    if (unknownBranches.size) w.push(`${unknownBranches.size} branch name(s) not recognised: ${[...unknownBranches].slice(0, 4).join(", ")}${unknownBranches.size > 4 ? "…" : ""}. Those rows will be skipped — set the shop's Nimbus name on the Branches screen first.`);
    if (unknownMop.size) w.push(`Payment mode(s) landing in "Other": ${[...unknownMop].slice(0, 4).join(", ")}. Check these before trusting the non-cash figures.`);
    if (out.some((p) => !p.sale_date)) w.push(`${out.filter((p) => !p.sale_date).length} row(s) have no readable date and will be skipped.`);
    setWarn(w);
    setParsed(out);
  }

  const ready = useMemo(() => parsed.filter((p) => p.branch_id && p.sale_date && p.item_code), [parsed]);
  const totals = useMemo(() => ({
    rows: parsed.length,
    ok: ready.length,
    value: ready.reduce((t, p) => t + p.sales_amount, 0),
    days: new Set(ready.map((p) => p.sale_date)).size,
    shops: new Set(ready.map((p) => p.branch_id)).size,
  }), [parsed, ready]);

  async function run() {
    if (!supabase || ready.length === 0) return;
    setBusy(true); setFatal(""); setResult(null);

    const { data: batch, error: bErr } = await supabase.from("retail_import_batches")
      .insert({ filename: fileName, row_count: parsed.length, total_sales: totals.value })
      .select("id").single();
    if (bErr) { setFatal(bErr.message); setBusy(false); return; }
    const batchId = (batch as { id: number }).id;

    let inserted = 0;
    /* Chunked because a month of item-wise lines for nine shops is tens of
       thousands of rows and one request that large times out at the edge. */
    const CHUNK = 500;
    for (let i = 0; i < ready.length; i += CHUNK) {
      const slice = ready.slice(i, i + CHUNK).map(({ branchLabel, ...row }) => {
        void branchLabel;
        return { ...row, source: "nimbus", import_batch_id: batchId };
      });
      const { data, error } = await supabase.from("retail_sale_lines")
        .upsert(slice, { onConflict: "line_hash", ignoreDuplicates: true })
        .select("id");
      if (error) { setFatal(`Stopped at row ${i}: ${error.message}`); setBusy(false); return; }
      inserted += (data as unknown[] | null)?.length ?? 0;
    }

    await supabase.from("retail_import_batches")
      .update({ inserted_count: inserted, skipped_count: ready.length - inserted })
      .eq("id", batchId);

    /* One upload_log row per shop-day, so the dashboard can say which days are
       still missing. Absence is the signal, which is why this is written even
       when every line was a duplicate. */
    const stamps = [...new Set(ready.map((p) => `${p.branch_id}|${p.sale_date}`))].map((k) => {
      const [unit, log_date] = k.split("|");
      return { unit, log_date, kind: "sales" };
    });
    if (stamps.length) await supabase.from("retail_upload_log").upsert(stamps, { onConflict: "unit,log_date,kind", ignoreDuplicates: true });

    setResult({ inserted, skipped: ready.length - inserted, total: ready.length });
    setBusy(false);
  }

  function reset() {
    setParsed([]); setFileName(""); setFatal(""); setWarn([]); setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const cols: Col<Parsed>[] = [
    { head: "Date", muted: true, cell: (p) => p.sale_date ?? <Pill tone="bad">no date</Pill> },
    { head: "Branch", bold: true, cell: (p) => (p.branch_id ? p.branchLabel : <Pill tone="bad">{p.branchLabel}</Pill>) },
    { head: "Receipt", muted: true, cell: (p) => p.receipt_txn || p.receipt_no || "—" },
    { head: "Item", cell: (p) => p.item_name || p.item_code || "—" },
    { head: "Qty", right: true, cell: (p) => p.quantity },
    { head: "Amount", right: true, bold: true, cell: (p) => money(p.sales_amount) },
    { head: "MOP", cell: (p) => (
        p.payment_method === "credit"
          ? <Pill tone="bad">Credit (udhaar)</Pill>
          : p.payment_method === "meezan_card" ? <Pill tone="info">Card</Pill>
          : p.payment_method === "unclassified" || p.payment_method === "other" ? <Pill tone="warn">{p.mop_raw || "—"}</Pill>
          : <Pill>{p.payment_method}</Pill>
      ) },
  ];

  return (
    <Shell>
      <PageHeader title="Import" subtitle="NimbusRMS item-wise sale export. Re-uploading the same file is safe.">
        {parsed.length > 0 && <button onClick={reset} className={btnGhost}><X size={15} /> Clear</button>}
      </PageHeader>

      <div className="mt-5 rounded-card border border-dashed border-line bg-surface p-6 text-center dark:border-white/[0.12] dark:bg-[#201c17]">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-panel text-ink dark:bg-white/[0.08] dark:text-white"><Upload size={22} /></span>
        <p className="mt-3 text-[14px] font-semibold text-ink dark:text-[#f4f1ea]">Drop the Nimbus CSV here</p>
        <p className="mt-1 text-[12.5px] text-muted dark:text-[#a89f93]">Item-wise sale report only — the bill-wise one is refused.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        <button onClick={() => fileRef.current?.click()} className={`${btnPrimary} mx-auto mt-4`}>Choose file</button>
        {fileName && <p className="mt-3 flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-muted dark:text-[#a89f93]"><FileCheck2 size={14} /> {fileName}</p>}
      </div>

      {fatal && (
        <div className="mt-4 flex gap-3 rounded-card border border-danger/30 bg-danger-soft p-4 dark:border-danger/30 dark:bg-danger/10">
          <AlertTriangle size={18} className="mt-0.5 flex-none text-danger" />
          <p className="text-[13px] font-medium leading-relaxed text-danger">{fatal}</p>
        </div>
      )}

      {warn.map((w, i) => (
        <div key={i} className="mt-3 flex gap-3 rounded-card border border-line bg-amber-soft p-4 dark:border-white/[0.06] dark:bg-amber/10">
          <AlertTriangle size={18} className="mt-0.5 flex-none text-amber-strong dark:text-amber" />
          <p className="text-[12.5px] font-medium leading-relaxed text-ink dark:text-[#e7e2d8]">{w}</p>
        </div>
      ))}

      {result && (
        <div className="mt-4 flex gap-3 rounded-card border border-success/30 bg-success-soft p-4 dark:border-success/30 dark:bg-success/10">
          <CheckCircle2 size={18} className="mt-0.5 flex-none text-success" />
          <p className="text-[13px] font-medium leading-relaxed text-ink dark:text-[#e7e2d8]">
            <strong>{result.inserted.toLocaleString()}</strong> new line{result.inserted === 1 ? "" : "s"} added.{" "}
            {result.skipped > 0 && <><strong>{result.skipped.toLocaleString()}</strong> were already in — that is the duplicate guard working, not an error.</>}
          </p>
        </div>
      )}

      {parsed.length > 0 && !fatal && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { l: "Rows in file", v: totals.rows.toLocaleString() },
              { l: "Ready to import", v: totals.ok.toLocaleString() },
              { l: "Shop-days", v: `${totals.shops} × ${totals.days}` },
              { l: "Value", v: money(totals.value) },
            ].map(({ l, v }, i) => (
              <div key={i} className="rounded-card border border-line bg-surface p-4 dark:border-white/[0.06] dark:bg-[#201c17]">
                <div className="text-[20px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{v}</div>
                <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{l}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted dark:text-[#a89f93]">Showing the first 50 rows for checking.</p>
            <button onClick={run} disabled={busy || totals.ok === 0} className={btnPrimary}>
              {busy ? "Importing…" : `Import ${totals.ok.toLocaleString()} lines`}
            </button>
          </div>

          <DataTable cols={cols} rows={parsed.slice(0, 50)} minWidth={900} empty="Nothing to show." />
        </>
      )}

      <SourceNote>
        Every line carries a <strong>line_hash</strong> built from shop, day, receipt, item,
        quantity, amount and position. The column is unique, so dropping the same file in twice
        changes nothing — the second run reports the lines as skipped rather than adding them.
        Rows whose shop or date could not be read are left out and counted, never guessed.
      </SourceNote>

      <PreviewNote />
      {!isSupabaseConfigured && null}
    </Shell>
  );
}
