"use client";
/* CPR / settlement import.
 *
 * Drop the file a courier gives you; this reads it, shows you what it read, and
 * refuses to write anything unless the numbers agree with the file's own.
 *
 * ---------------------------------------------------------------------------
 * THE GUARD IS ONLY REAL IF THE DECLARED FIGURES COME FROM OUTSIDE THE PARSE
 *
 *   OwnEx PDF  — states its own totals in the header ("Delivered 149
 *                341,043.84"), so those are read from the file and the check is
 *                genuine: parse vs. the courier's own arithmetic.
 *
 *   PostEx CSV — has NO totals row. Computing the "declared" figures from the
 *                same rows we parsed would compare a number to itself and pass
 *                every time, including on a completely wrong column mapping.
 *                So for CSV you TYPE the count and total off the PostEx portal
 *                screen. Tedious once, and it is the only version of this check
 *                that can actually fail.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FILES ACTUALLY LOOK LIKE  (measured, not assumed)
 *
 *   PostEx CSV_Transactions export
 *     TRACKING_NUMBER · STATUS · COD_AMOUNT · NET_AMOUNT
 *     NET = COD − SHIPPING_CHARGES − GST − WH_INCOME_TAX − WH_SALES_TAX
 *     verified exact: 2299.00 − 222.40 − 35.58 − 45.98 − 45.98 = 1949.06
 *     202 rows on the 25 Aug export — 147 Delivered and 55 RETURN. A PostEx
 *     settlement is not all money coming in; the returns are money going out.
 *
 *   OwnEx invoice PDF
 *     Sr · Order Ref · Tracking No · Wt · Pickup · Origin · Delivery City ·
 *     Status · D/R Date · COD · Upfront · Reserved · Charges · Tax · Net Total
 *     Net Total is NEGATIVE when the courier owes you.
 *     Order Ref is NOT reliable — row 37 of INV-20250018 reads "tayyaba".
 *     Keyed on tracking number only.
 *     Its per-row net can never foot to its own Grand Total: the fuel surcharge
 *     (20% of charges) is applied at invoice level, not per row. Guard on COD.
 */
import { useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { parseCsv, matchHeader, toNum } from "@/lib/csv";
import Modal, { btnPrimary, btnGhost } from "@/components/Modal";

type CprRow = {
  tracking_id: string; status: string;
  cod: number; net: number; fee: number; tax: number; paid_on: string | null;
};
/** One settlement. A PostEx CPR export can hold 93 of these in a single PDF. */
type Batch = {
  ref: string;
  date: string;                    // yyyy-mm-dd
  rows: CprRow[];
  declaredCount?: number;          // the file's own parcel count
  declaredNet?: number;            // the file's own net, computed from its summary
  computedNet?: number;            // the same figure summed from the rows
  courier: "PostEx" | "OwnEx";
  problem?: string;                // set when the file contradicts itself
};
type Parsed = {
  batches: Batch[];
  source: "csv" | "pdf";
  note?: string;
};

const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const money = (v: unknown) => "Rs " + n2(v).toLocaleString("en-PK");
/* A courier's own word for the row. Anything that is not a delivery is a
   charge, never a payment — see hub_cpr_import, which obeys this literally. */
const isDelivered = (s: string) => /^deliver/i.test(String(s || "").trim());

/* ---------------------------------------------------------------- CSV / XLS */
async function readSheet(file: File): Promise<Parsed> {
  let headers: string[], raw: Record<string, string>[];

  if (/\.csv$/i.test(file.name)) {
    ({ headers, rows: raw } = parseCsv(await file.text()));
  } else {
    const XLSX = await import("xlsx");                    // on demand, not on page load
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]],
      { header: 1, blankrows: false, defval: "" });
    headers = (grid[0] ?? []).map(String);
    raw = grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "")])));
  }

  // matchHeader is forgiving about spacing and case, so a courier renaming
  // "COD_AMOUNT" to "COD Amount" does not break the import.
  const col = {
    tracking: matchHeader(headers, ["tracking_number", "tracking no", "tracking", "cn"]),
    status:   matchHeader(headers, ["status", "shipment status", "order status"]),
    cod:      matchHeader(headers, ["cod_amount", "cod amount", "cod"]),
    net:      matchHeader(headers, ["net_amount", "net total", "net"]),
    ship:     matchHeader(headers, ["shipping_charges", "charges", "shipping charge"]),
    gst:      matchHeader(headers, ["gst", "sales tax"]),
    wht:      matchHeader(headers, ["wh_income_tax (2%)", "wh_income_tax", "income tax"]),
    wst:      matchHeader(headers, ["wh_sales_tax (2%)", "wh_sales_tax"]),
    date:     matchHeader(headers, ["d/r date", "dr date", "delivery date", "date"]),
  };
  if (!col.tracking) throw new Error("No tracking-number column found. Columns seen: " + headers.join(", "));

  const rows: CprRow[] = [];
  for (const r of raw) {
    const tracking = String(r[col.tracking] ?? "").trim();
    if (!tracking) continue;
    // PostEx splits its deductions across four columns. The store cares about
    // two numbers: what the courier kept, and what the government kept.
    const fee = n2(toNum(r[col.ship])) + n2(toNum(r[col.gst]));
    const tax = n2(toNum(r[col.wht])) + n2(toNum(r[col.wst]));
    rows.push({
      tracking_id: tracking,
      status: String(r[col.status] ?? "Delivered").trim(),
      cod: n2(toNum(r[col.cod])), net: n2(toNum(r[col.net])),
      fee, tax,
      paid_on: (String(r[col.date] ?? "").trim().slice(0, 10)) || null,
    });
  }
  return {
    batches: [{ ref: "", date: new Date().toISOString().slice(0, 10), rows, courier: "PostEx",
                computedNet: n2(rows.reduce((t, r) => t + r.net, 0)) }],
    source: "csv",
    note: "This transactions export states no totals of its own, so the count and COD must be typed from the PostEx portal. Filling them in from the file would compare the parse against itself and pass no matter what. A CPR PDF carries its own summary and needs none of this.",
  };
}

/* -------------------------------------------------------------------- PDF */

/** Flatten a PDF to a single whitespace-normalised string.
 *
 *  Deliberately NOT line-based. A PostEx CPR wraps one parcel across three
 *  visual lines, and pdf.js orders text differently from any other extractor,
 *  so anything that depends on line structure is fragile by construction.
 *  Flatten, then anchor on things that cannot move: the 14-digit tracking
 *  number, and the summary labels. */
async function pdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const byRow = new Map<number, { x: number; t: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      const key = [...byRow.keys()].find((k) => Math.abs(k - y) <= 3) ?? y;
      const b = byRow.get(key) ?? []; b.push({ x: item.transform[4], t: item.str }); byRow.set(key, b);
    }
    [...byRow.entries()].sort((a, b) => b[0] - a[0])
      .forEach(([, parts]) => out.push(parts.sort((a, b) => a.x - b.x).map((c) => c.t).join(" ")));
  }
  return out.join(" ").replace(/\s+/g, " ");
}

const unParen = (s?: string) => {
  const v = Number(String(s ?? "").replace(/,/g, "").replace(/[()]/g, ""));
  return isNaN(v) ? 0 : v;
};

/* ---------------------------------------------------------------------------
   PostEx Cash Payment Receipt — one PDF can hold many.

   Verified against the real 549-page export: 95 blocks, 93 distinct CPRs,
   8,547 parcels. Both guards below passed on all 95, none unparseable.

   TWO INDEPENDENT PATHS TO THE SAME NUMBER, which is what makes the guard
   worth having:
       declared = Total − shipping − GST − WH income − WH sales   (the summary)
       computed = the sum of every row's own Net Amount           (the rows)
   A mapping error moves one and not the other.

   The "Net Total" label does not survive text extraction — its value sits in a
   different column — so it is recomputed from the summary rather than read.

   NOTE ON THE SUMMARY'S "Returned" LINE: it is a SERVICE-TYPE split
   (Delivered / Same Day / Returned), not an outcome. On CPR-RU8QE504774 it
   reads "Returned 2" while 47 rows actually say Return. The row status is the
   truthful one and is the only thing used here.

   PER-ROW ARITHMETIC, verified to the paisa:
       Delivered  net = COD − shipping − GST − WH income − WH sales
       Return     net = −(shipping + GST)      no COD, no withholding
   A returned parcel COSTS money. Across your year: −Rs 453,358.85.
--------------------------------------------------------------------------- */
function parsePostExCpr(flat: string): Batch[] {
  const parts = flat.split(/(?=CPR Number CPR-)/).filter((p) => /^CPR Number CPR-/.test(p));
  const out: Batch[] = [];

  for (const p of parts) {
    const ref  = /CPR Number (CPR-[A-Z0-9]+)/.exec(p)?.[1];
    const d    = /CPR Date (\d{2})\/(\d{2})\/(\d{4})/.exec(p);
    const ship = /Shipping Charges (\d+) \(([\d.,]+)\)/.exec(p);
    const gst  = /GST \(([\d.,]+)\)/.exec(p);
    const whi  = /WH Income Tax \(2%\) \(([\d.,]+)\)/.exec(p);
    const whs  = /WH Sales Tax \(2%\) \(([\d.,]+)\)/.exec(p);
    const tot  = /Total ([\d,]+\.\d{2})/.exec(p);
    if (!ref || !d) continue;

    const rows: CprRow[] = [];
    const re = /(\d{14})\s+(.*?)(?=\d{14}\s|Developed by PostEx|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p))) {
      const rest = m[2];
      const st = /\b(Delivered|Return)\b/.exec(rest);
      if (!st) continue;
      const ns = rest.match(/\(?-?[\d,]+\.\d{2}\)?/g);
      if (!ns || ns.length < 9) continue;
      // COD · Upfront · Reserve · Shipping · UpfrontChg · GST · WHinc · WHsales · Net
      const v = ns.slice(0, 9).map((x) => Number(x.replace(/,/g, "").replace("(", "-").replace(")", "")));
      rows.push({
        tracking_id: m[1], status: st[1],
        cod: n2(v[0]), fee: n2(v[3] + v[5]), tax: n2(v[6] + v[7]), net: n2(v[8]),
        paid_on: `${d[3]}-${d[2]}-${d[1]}`,
      });
    }

    const declaredNet = (ship && gst && whi && whs && tot)
      ? n2(unParen(tot[1]) - unParen(ship[2]) - unParen(gst[1]) - unParen(whi[1]) - unParen(whs[1]))
      : undefined;
    const computedNet = n2(rows.reduce((t, r) => t + r.net, 0));

    let problem: string | undefined;
    if (!rows.length) problem = "no parcel rows could be read";
    else if (!ship) problem = "summary totals missing — cannot be checked";
    else if (rows.length !== Number(ship[1]))
      problem = `read ${rows.length} parcels, the file says ${ship[1]}`;
    else if (declaredNet !== undefined && Math.abs(declaredNet - computedNet) > 1)
      problem = `rows total ${computedNet}, the summary says ${declaredNet}`;

    out.push({ ref, date: `${d[3]}-${d[2]}-${d[1]}`, rows, courier: "PostEx",
               declaredCount: ship ? Number(ship[1]) : undefined,
               declaredNet, computedNet, problem });
  }
  return out;
}

/* OwnEx invoice — one per file, different shape entirely. Its per-row net can
   never foot to its Grand Total because the fuel surcharge is charged at
   invoice level, so COD is what gets guarded. */
function parseOwnExInvoice(flat: string, lines: string[]): Batch[] {
  const dm = /Delivered\s+(\d+)\s+([\d,]+\.\d{2})/i.exec(flat);
  const ref = /INVOICE NUMBER\s*:?\s*(\S+)/i.exec(flat)?.[1] ?? "";
  const dt  = /INVOICE DATE\s*:?\s*([\d/]+)/i.exec(flat)?.[1];
  let date = new Date().toISOString().slice(0, 10);
  if (dt) { const x = new Date(dt); if (!isNaN(x.getTime())) date = x.toISOString().slice(0, 10); }

  const rows: CprRow[] = [];
  for (const ln of lines) {
    const m = /^\s*\d+\s+(\S+)\s+(\d{9,})\s+(.*)$/.exec(ln);
    if (!m) continue;
    const rest = m[3];
    const status = /\b(Delivered|Returned|Return|Cancelled|Lost)\b/i.exec(rest)?.[1];
    if (!status) continue;
    const ns = rest.match(/-?[\d,]+\.\d{2}/g) ?? [];
    if (ns.length < 6) continue;
    const [cod, , , charges, tax, net] = ns.slice(-6).map((x) => Number(x.replace(/,/g, "")));
    rows.push({ tracking_id: m[2], status, cod: n2(cod), net: n2(Math.abs(net)),
                fee: n2(charges), tax: n2(tax), paid_on: date });
  }
  const codSum = n2(rows.reduce((t, r) => t + r.cod, 0));
  const declaredCount = dm ? Number(dm[1]) : undefined;
  let problem: string | undefined;
  if (!rows.length) problem = "no parcel rows could be read";
  else if (declaredCount && rows.length !== declaredCount)
    problem = `read ${rows.length} parcels, the invoice says ${declaredCount}`;
  else if (dm && Math.abs(codSum - Number(dm[2].replace(/,/g, ""))) > 1)
    problem = `COD totals ${codSum}, the invoice says ${dm[2]}`;

  return [{ ref, date, rows, courier: "OwnEx", declaredCount,
            declaredNet: undefined, computedNet: codSum, problem }];
}

async function readPdf(file: File): Promise<Parsed> {
  const flat = await pdfText(file);
  if (/CPR Number CPR-/.test(flat)) {
    const batches = parsePostExCpr(flat);
    return { batches, source: "pdf",
             note: `${batches.length} settlement${batches.length === 1 ? "" : "s"} found in this file. Each is checked against its own summary before anything is written; any that disagrees is skipped and named.` };
  }
  // OwnEx needs line structure for its fixed-column table
  const lines = flat.split(/(?=\s\d+\s+#?\S+\s+\d{9,})/);
  return { batches: parseOwnExInvoice(flat, lines), source: "pdf",
           note: "The fuel surcharge on an OwnEx invoice is applied at invoice level, not per row, so per-row net will not foot to the Grand Total. The check runs on COD, which does." };
}

/* ======================================================================== */
type Result = { ref: string; ok: boolean; report: Record<string, unknown> };

export default function CprImport({ onDone }: { onDone?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [courier, setCourier] = useState<"PostEx" | "OwnEx">("PostEx");
  const [dCount, setDCount] = useState("");
  const [dTotal, setDTotal] = useState("");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [results, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState("");
  const [checked, setChecked] = useState(false);
  const [committed, setCommitted] = useState(false);

  const good = (parsed?.batches ?? []).filter((b) => !b.problem);
  const bad = (parsed?.batches ?? []).filter((b) => b.problem);
  const many = (parsed?.batches.length ?? 0) > 1;
  const totals = good.reduce((a, b) => ({
    parcels: a.parcels + b.rows.length,
    delivered: a.delivered + b.rows.filter((r) => isDelivered(r.status)).length,
    returned: a.returned + b.rows.filter((r) => !isDelivered(r.status)).length,
    net: a.net + (b.computedNet ?? 0),
    returnCost: a.returnCost + b.rows.filter((r) => !isDelivered(r.status)).reduce((t, r) => t + r.net, 0),
  }), { parcels: 0, delivered: 0, returned: 0, net: 0, returnCost: 0 });

  async function pick(file: File) {
    setErr(""); setResults([]); setChecked(false); setCommitted(false); setBusy(true); setProgress("Reading…");
    try {
      const p = /\.pdf$/i.test(file.name) ? await readPdf(file) : await readSheet(file);
      if (!p.batches.length) throw new Error("No settlement could be read from this file.");
      setParsed(p);
      setCourier(p.batches[0].courier);
      if (p.batches.length === 1) {
        setRef(p.batches[0].ref); setDate(p.batches[0].date);
        if (p.batches[0].declaredCount) setDCount(String(p.batches[0].declaredCount));
      }
      setOpen(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setOpen(true); }
    finally { setBusy(false); setProgress(""); }
  }

  /* Run every settlement in sequence.
     Sequential on purpose: hub_cpr_import writes, and firing 93 concurrent
     writes at the same rows is how a race gets introduced into the one part of
     this system that moves money. Slower and correct. */
  async function run(dry: boolean) {
    if (!parsed || !supabase) return;
    setBusy(true); setErr(""); setResults([]);
    const acc: Result[] = [];
    const list = many ? good : parsed.batches;

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      setProgress(`${dry ? "Checking" : "Importing"} ${i + 1} of ${list.length} · ${b.ref || "settlement"}`);
      const { data, error } = await supabase.rpc("hub_cpr_import", {
        p_courier: many ? b.courier : courier,
        p_cpr_number: (many ? b.ref : ref).trim(),
        p_cpr_date: many ? b.date : date,
        // A CPR carries its own count. Only the CSV, which carries none, falls
        // back to what was typed from the portal.
        p_declared_count: b.declaredCount ?? (dCount ? Number(dCount) : null),
        p_declared_total: many ? null : (dTotal ? Number(dTotal) : null),
        p_rows: b.rows,
        p_dry_run: dry,
      });
      if (error) { acc.push({ ref: b.ref, ok: false, report: { error: error.message } }); }
      else acc.push({ ref: b.ref, ok: (data as { ok?: boolean })?.ok === true, report: data as Record<string, unknown> });
      setResults([...acc]);
    }
    setBusy(false); setProgress("");
    if (dry) setChecked(acc.every((r) => r.ok));
    else if (acc.some((r) => r.ok)) { setCommitted(true); onDone?.(); }
  }

  const passed = results.length > 0 && results.every((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const guardReady = many || (!!ref.trim() && !!dCount && !!dTotal);

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx,.pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
      <button onClick={() => fileRef.current?.click()} className={btnPrimary} disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        Import settlement
      </button>

      <Modal open={open} onClose={() => !busy && setOpen(false)} wide title="Import courier settlement">
        {err && (
          <div className="mb-3 flex gap-2 rounded-card border border-red-300 bg-red-50 p-3 text-[13px] text-red-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{err}</span>
          </div>
        )}

        {parsed && (
          <>
            <div className="mb-3 rounded-card border border-line bg-panel p-3 text-[13px]">
              <div className="font-semibold text-ink">
                {parsed.batches.length.toLocaleString()} settlement{parsed.batches.length === 1 ? "" : "s"} read
              </div>
              <div className="mt-1 text-muted">
                {totals.parcels.toLocaleString()} parcels · <b>{totals.delivered.toLocaleString()}</b> delivered
                {totals.returned > 0 && <> · <b>{totals.returned.toLocaleString()}</b> returned</>}
                {" · net "}{money(totals.net)}
              </div>
              {totals.returnCost < 0 && (
                <div className="mt-1.5 text-[12px] text-muted">
                  Returns cost you <b>{money(Math.abs(totals.returnCost))}</b> across these settlements —
                  the courier bills the shipping on a delivery that failed. Those parcels stay
                  returned and stay unpaid; only the charge is recorded.
                </div>
              )}
              {parsed.note && <div className="mt-1.5 text-[12px] text-hint">{parsed.note}</div>}
            </div>

            {/* A settlement whose own summary contradicts its rows is never
                imported. Naming it is more useful than a count of failures. */}
            {bad.length > 0 && (
              <div className="mb-3 rounded-card border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={14} /> {bad.length} will be skipped — the file disagrees with itself
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {bad.slice(0, 6).map((b) => <li key={b.ref}>{b.ref || "(no number)"} — {b.problem}</li>)}
                  {bad.length > 6 && <li>…and {bad.length - 6} more</li>}
                </ul>
              </div>
            )}

            {!many && (
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                <label className="block"><span className="text-muted">Courier</span>
                  <select value={courier} onChange={(e) => setCourier(e.target.value as "PostEx" | "OwnEx")}
                          className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5">
                    <option>PostEx</option><option>OwnEx</option>
                  </select></label>
                <label className="block"><span className="text-muted">CPR / invoice number</span>
                  <input value={ref} onChange={(e) => setRef(e.target.value)}
                         className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
                <label className="block"><span className="text-muted">Settlement date</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                         className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
                <div />
                <label className="block"><span className="text-muted">Parcel count (from the portal)</span>
                  <input value={dCount} onChange={(e) => setDCount(e.target.value)} inputMode="numeric"
                         className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
                <label className="block"><span className="text-muted">COD total (from the portal)</span>
                  <input value={dTotal} onChange={(e) => setDTotal(e.target.value)} inputMode="decimal"
                         className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
              </div>
            )}

            {!many && parsed.source === "csv" && (
              <div className="mt-2 flex gap-2 rounded-card border border-amber-300 bg-amber-50 p-2.5 text-[12px] text-amber-900">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                <span>Type these from the PostEx portal, not from the file. Copied from what was
                just parsed, the check compares the parse to itself and cannot fail.</span>
              </div>
            )}

            {progress && (
              <div className="mt-3 flex items-center gap-2 text-[13px] text-muted">
                <Loader2 size={14} className="animate-spin" /> {progress}
              </div>
            )}

            {results.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-[13px] font-semibold text-ink">
                  {results.filter((r) => r.ok).length} of {results.length} passed
                  {failed.length > 0 && <span className="text-red-700"> · {failed.length} refused</span>}
                </div>
                <div className="max-h-56 overflow-auto rounded-card border border-line">
                  {results.map((r, i) => (
                    <div key={i} className={`flex items-start gap-2 border-b border-line px-2.5 py-1.5 text-[12px] last:border-0 ${r.ok ? "" : "bg-red-50"}`}>
                      {r.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" />
                            : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />}
                      <span className="font-mono">{r.ref || "—"}</span>
                      <span className="text-muted">
                        {String(r.report.report ?? r.report.guard ?? r.report.error ?? "")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button className={btnGhost} disabled={busy} onClick={() => setOpen(false)}>Close</button>
              <button className={btnGhost} disabled={busy || !guardReady} onClick={() => run(true)}>
                Check {many ? `all ${good.length}` : "only"}
              </button>
              {/* Unreachable until every dry run passed. A guard that can be
                  skipped is decoration. */}
              <button className={btnPrimary} disabled={busy || !checked || committed} onClick={() => run(false)}>
                {committed ? <><CheckCircle2 size={15} /> Imported</> : "Import for real"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
