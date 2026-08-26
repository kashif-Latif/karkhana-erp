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
type Parsed = {
  rows: CprRow[];
  declared: { count?: number; total?: number; ref?: string; date?: string };
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
    rows, source: "csv", declared: {},
    note: "This export states no totals of its own, so the count and amount below must be typed from the courier's portal. Filling them in from the file would compare the parse against itself and pass no matter what.",
  };
}

/* -------------------------------------------------------------------- PDF */
async function readPdf(file: File): Promise<Parsed> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const byRow = new Map<number, { x: number; t: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      const key = [...byRow.keys()].find((k) => Math.abs(k - y) <= 3) ?? y;
      const bucket = byRow.get(key) ?? [];
      bucket.push({ x: item.transform[4], t: item.str });
      byRow.set(key, bucket);
    }
    [...byRow.entries()].sort((a, b) => b[0] - a[0]).forEach(([, parts]) =>
      lines.push(parts.sort((a, b) => a.x - b.x).map((c) => c.t).join(" ").replace(/\s+/g, " ").trim()));
  }

  const text = lines.join("\n");
  /* The invoice states its own count and payable total. This is what makes the
     guard meaningful for a PDF: "Delivered 149 341,043.84". */
  const dm = /Delivered\s+(\d+)\s+([\d,]+\.\d{2})/i.exec(text);
  const declared = {
    count: dm ? Number(dm[1]) : undefined,
    total: dm ? Number(dm[2].replace(/,/g, "")) : undefined,
    ref: /INVOICE\s+NUMBER\s*:?\s*(\S+)/i.exec(text)?.[1],
    date: /INVOICE\s+DATE\s*:?\s*([\d/]+)/i.exec(text)?.[1],
  };

  /* Anchored on the tracking number rather than on column positions, because a
     delivery city can be two words ("MANDI BAHAUDDIN") and would shift every
     field after it. The six money columns are read from the END of the line,
     which is stable regardless of how many words the city took. */
  const rows: CprRow[] = [];
  for (const ln of lines) {
    const m = /^\s*\d+\s+(\S+)\s+(\d{9,})\s+(.*)$/.exec(ln);
    if (!m) continue;
    const rest = m[3];
    const status = /\b(Delivered|Returned|Return|Cancelled|Lost)\b/i.exec(rest)?.[1] ?? "";
    if (!status) continue;
    const nums = rest.match(/-?[\d,]+\.\d{2}/g) ?? [];
    if (nums.length < 6) continue;
    // COD · Upfront · Reserved · Charges · Tax · Net Total
    const [cod, , , charges, tax, net] = nums.slice(-6).map((x) => Number(x.replace(/,/g, "")));
    const date = /(\d{1,2}\/\d{1,2}\/\d{4})/g.exec(rest);
    rows.push({
      tracking_id: m[2], status,
      cod: n2(cod), net: n2(Math.abs(net)), fee: n2(charges), tax: n2(tax),
      paid_on: date ? new Date(date[1]).toISOString().slice(0, 10) : null,
    });
  }
  return {
    rows, source: "pdf", declared,
    note: "The invoice's fuel surcharge is applied at invoice level rather than per row, so per-row net will not foot to the Grand Total. The check runs on COD, which does.",
  };
}

/* ======================================================================== */
export default function CprImport({ onDone }: { onDone?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [courier, setCourier] = useState("PostEx");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dCount, setDCount] = useState("");
  const [dTotal, setDTotal] = useState("");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [committed, setCommitted] = useState(false);

  async function pick(file: File) {
    setErr(""); setReport(null); setCommitted(false); setBusy(true);
    try {
      const p = /\.pdf$/i.test(file.name) ? await readPdf(file) : await readSheet(file);
      if (!p.rows.length) throw new Error("No rows could be read from this file.");
      setParsed(p);
      setCourier(/\.pdf$/i.test(file.name) ? "OwnEx" : "PostEx");
      if (p.declared.ref) setRef(p.declared.ref);
      if (p.declared.count) setDCount(String(p.declared.count));
      if (p.declared.total) setDTotal(String(p.declared.total));
      if (p.declared.date) {
        const d = new Date(p.declared.date);
        if (!isNaN(d.getTime())) setDate(d.toISOString().slice(0, 10));
      }
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setOpen(true);
    } finally { setBusy(false); }
  }

  async function run(dry: boolean) {
    if (!parsed || !supabase) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("hub_cpr_import", {
      p_courier: courier,
      p_cpr_number: ref.trim(),
      p_cpr_date: date,
      p_declared_count: dCount ? Number(dCount) : null,
      p_declared_total: dTotal ? Number(dTotal) : null,
      p_rows: parsed.rows,
      p_dry_run: dry,
    });
    if (error) setErr(error.message);
    else {
      setReport(data as Record<string, unknown>);
      if (!dry && (data as { ok?: boolean })?.ok) { setCommitted(true); onDone?.(); }
    }
    setBusy(false);
  }

  const delivered = parsed?.rows.filter((r) => isDelivered(r.status)).length ?? 0;
  const returned = (parsed?.rows.length ?? 0) - delivered;
  const codSum = n2(parsed?.rows.reduce((t, r) => t + r.cod, 0) ?? 0);
  const guardReady = !!ref.trim() && !!dCount && !!dTotal;
  const passed = !!report && (report as { ok?: boolean }).ok === true;

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx,.pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
      <button onClick={() => fileRef.current?.click()} className={btnPrimary} disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        Import settlement
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Import courier settlement">
        {err && (
          <div className="mb-3 flex gap-2 rounded-card border border-red-300 bg-red-50 p-3 text-[13px] text-red-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{err}</span>
          </div>
        )}

        {parsed && (
          <>
            <div className="mb-3 rounded-card border border-line bg-panel p-3 text-[13px]">
              <div className="font-semibold text-ink">Read from the file</div>
              <div className="mt-1 text-muted">
                {parsed.rows.length.toLocaleString()} rows · <b>{delivered}</b> delivered
                {returned > 0 && <> · <b>{returned}</b> returned</>} · COD {money(codSum)}
              </div>
              {returned > 0 && (
                <div className="mt-1.5 text-[12px] text-muted">
                  Returns stay returned. The courier billed you for those — they are a cost,
                  not a payment, so their status and payment are left untouched.
                </div>
              )}
              {parsed.note && <div className="mt-1.5 text-[12px] text-hint">{parsed.note}</div>}
            </div>

            <div className="grid grid-cols-2 gap-2 text-[13px]">
              <label className="block">
                <span className="text-muted">Courier</span>
                <select value={courier} onChange={(e) => setCourier(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5">
                  <option>PostEx</option><option>OwnEx</option>
                </select>
              </label>
              <label className="block">
                <span className="text-muted">CPR / invoice number</span>
                <input value={ref} onChange={(e) => setRef(e.target.value)}
                       className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-muted">Settlement date</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                       className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" />
              </label>
              <div />
              <label className="block">
                <span className="text-muted">Parcel count {parsed.source === "csv" && "(from the portal)"}</span>
                <input value={dCount} onChange={(e) => setDCount(e.target.value)} inputMode="numeric"
                       className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-muted">COD total {parsed.source === "csv" && "(from the portal)"}</span>
                <input value={dTotal} onChange={(e) => setDTotal(e.target.value)} inputMode="decimal"
                       className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" />
              </label>
            </div>

            {parsed.source === "csv" && (
              <div className="mt-2 flex gap-2 rounded-card border border-amber-300 bg-amber-50 p-2.5 text-[12px] text-amber-900">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                <span>
                  Type these two from the PostEx portal, not from the file. If they are copied
                  from what was just parsed, the check compares the parse to itself and cannot fail.
                </span>
              </div>
            )}

            {report && (
              <pre className={`mt-3 max-h-56 overflow-auto rounded-card border p-3 text-[12px] ${
                passed ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                       : "border-red-300 bg-red-50 text-red-900"}`}>
{JSON.stringify(report, null, 2)}
              </pre>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button className={btnGhost} onClick={() => setOpen(false)}>Close</button>
              <button className={btnGhost} disabled={busy || !guardReady} onClick={() => run(true)}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : null} Check only
              </button>
              {/* Commit is unreachable until a dry run has actually passed. A guard
                  that can be skipped is decoration. */}
              <button className={btnPrimary} disabled={busy || !passed || committed}
                      onClick={() => run(false)}>
                {committed ? <><CheckCircle2 size={15} /> Imported</> : "Import for real"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
