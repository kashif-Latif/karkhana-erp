"use client";
import { useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { btnPrimary, btnGhost } from "@/components/Modal";
import { matchHeader, toNum, toDate } from "@/lib/csv";

type Result = { ok: boolean; msg: string; detail?: string } | null;
type Row = Record<string, string>;
type Detected = {
  kind: "settlement" | "status" | "load_sheet";
  rows: Row[];
  headers: string[];
  cols: Record<string, string>;
  couriers: Record<string, number>;
  stores: Record<string, number>;
  withTracking: number;
  /** for PDFs: what the sheet says vs what we read. The import is blocked
   *  unless they agree, so a mis-read column can never become wrong money. */
  proof?: { declaredCount?: number; parsedCount: number; declaredTotal?: number; parsedTotal: number; sheet?: string };
};

/* the courier is written into the tracking number itself — no need to ask */
function courierFromTracking(t: string) {
  const v = (t ?? "").trim();
  if (/^3120100/.test(v)) return "OwnEx";
  if (/^\d{14}$/.test(v)) return "PostEx";
  return null;
}
function storeFromRef(ref: string) {
  const u = (ref ?? "").trim().toUpperCase();
  if (/^#?TRZ/.test(u)) return "TRZ";
  if (/^#?TS/.test(u)) return "TS";
  if (/^#?LM/.test(u)) return "LM";
  return null;
}

/** Read a courier load-sheet PDF.
 *  These are machine-generated with a fixed layout, so the text can be grouped
 *  back into rows by vertical position and read column by column. That is only
 *  safe because the format is consistent — a scan or a hand-made PDF would not
 *  be, which is why the summary below always shows what was read before
 *  anything is written. */
type PdfRead = { headers: string[]; rows: Row[]; declared: { count?: number; total?: number; sheet?: string } };
async function readPdf(file: File): Promise<PdfRead> {
  // loaded only when a PDF is actually chosen. Kept out of the page bundle
  // because it is ~200 kB and its modern syntax breaks older mobile browsers.
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    // group text fragments that sit on the same line
    const byRow = new Map<number, { x: number; t: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      const key = [...byRow.keys()].find((k) => Math.abs(k - y) <= 3) ?? y;
      const bucket = byRow.get(key) ?? [];
      bucket.push({ x: item.transform[4], t: item.str });
      byRow.set(key, bucket);
    }
    [...byRow.entries()]
      .sort((a, b) => b[0] - a[0])                    // top of the page downwards
      .forEach(([, parts]) =>
        lines.push(parts.sort((a, b) => a.x - b.x).map((c) => c.t).join(" ").replace(/\s+/g, " ").trim()));
  }

  // A load sheet states its own totals. Capturing them lets us PROVE the parse
  // is complete instead of trusting it — the whole reason PDF is safe here.
  const text = lines.join("\n");
  const declared = {
    count: Number(/Total\s+Shipment\(?s?\)?\s*:?\s*(\d+)/i.exec(text)?.[1] ?? "") || undefined,
    total: Number((/Total\s+Amount\s*:?\s*Rs\.?\s*([\d,]+(?:\.\d+)?)/i.exec(text)?.[1] ?? "").replace(/,/g, "")) || undefined,
    sheet: /Loadsheet\s+Number\s*:?\s*(\S+)/i.exec(text)?.[1],
  };

  // a shipment line always carries both a tracking number and an order reference
  const rows: Row[] = [];
  for (const line of lines) {
    const track = line.match(/\b(\d{11,14})\b/);
    const ref = line.match(/#\s?([A-Za-z]{0,4}\d+)/);
    if (!track || !ref) continue;
    const amount = line.match(/Rs\.?\s*([\d,]+(?:\.\d+)?)/i);
    const date = line.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
    const city = line.match(/\b(LHE|KHI|ISB|RWP|FSD|MUL|PEW|QTA|GUJ|SIA|SKT)\b/);
    rows.push({
      "Tracking No": track[1],
      "Order Ref": "#" + ref[1],
      "Booking Date": date?.[1] ?? "",
      "Delivery City": city?.[1] ?? "",
      "Amount": amount ? amount[1].replace(/,/g, "") : "",
    });
  }
  return { headers: ["Tracking No", "Order Ref", "Booking Date", "Delivery City", "Amount"], rows, declared };
}

/** read CSV or Excel into plain rows — Excel because courier portals export
 *  .xlsx far more often than .csv */
async function readAnyFile(file: File): Promise<{ headers: string[]; rows: Row[] }> {
  const XLSX = await import("xlsx");           // on demand, not on page load
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "" });
  if (!grid.length) return { headers: [], rows: [] };

  // portals often put a title or logo above the real header row — find the row
  // that actually looks like column names
  let headerIdx = 0;
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const filled = (grid[i] ?? []).filter((c) => String(c ?? "").trim()).length;
    if (filled >= 3) { headerIdx = i; break; }
  }
  const headers = (grid[headerIdx] ?? []).map((h) => String(h ?? "").trim());
  const rows: Row[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r: Row = {};
    let any = false;
    headers.forEach((h, c) => {
      const v = String(grid[i]?.[c] ?? "").trim();
      if (h) r[h] = v;
      if (v) any = true;
    });
    if (any) rows.push(r);
  }
  return { headers, rows };
}

function detect(headers: string[], rows: Row[]): Detected {
  const cols = {
    order: matchHeader(headers, ["order number", "orderref", "order ref", "reference", "order id", "order", "customer reference"]),
    track: matchHeader(headers, ["tracking number", "tracking id", "cn", "cn number", "consignment", "airway", "awb", "tracking"]),
    status: matchHeader(headers, ["status", "delivery status", "transaction status", "shipment status", "current status"]),
    cod: matchHeader(headers, ["cod amount", "cod", "amount", "invoice payment", "collected amount"]),
    date: matchHeader(headers, ["delivery date", "dispatch date", "booking date", "transaction date", "date", "created at"]),
    invoice: matchHeader(headers, ["invoice", "invoice number", "invoice #", "cpr", "cpr number", "batch", "payment ref"]),
    net: matchHeader(headers, ["net amount", "net", "payable", "payable amount"]),
    fee: matchHeader(headers, ["service charges", "charges", "courier fee", "delivery charges", "fee"]),
    paid: matchHeader(headers, ["paid", "payment status", "settlement status"]),
  };

  // an invoice/net-amount column means this file is about money being settled;
  // a status column means it is about where the parcel is; otherwise it is a
  // fresh load sheet
  const kind: Detected["kind"] = cols.invoice || cols.net ? "settlement" : cols.status ? "status" : "load_sheet";

  const couriers: Record<string, number> = {};
  const stores: Record<string, number> = {};
  let withTracking = 0;
  for (const r of rows) {
    const t = cols.track ? r[cols.track] : "";
    if (t) withTracking++;
    const c = courierFromTracking(t) ?? "unknown";
    couriers[c] = (couriers[c] ?? 0) + 1;
    const s = storeFromRef(cols.order ? r[cols.order] : "") ?? "unknown";
    stores[s] = (stores[s] ?? 0) + 1;
  }
  return { kind, rows, headers, cols, couriers, stores, withTracking };
}

const KIND_LABEL: Record<Detected["kind"], string> = {
  settlement: "COD settlement — marks parcels paid",
  status: "Status update — updates where parcels are",
  load_sheet: "Load sheet — adds newly booked parcels",
};

export default function SmartImport({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const [det, setDet] = useState<Detected | null>(null);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(f: File | null) {
    setRes(null); setDet(null); setFileName("");
    if (!f) return;
    try {
      const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
      const parsed = isPdf ? await readPdf(f) : await readAnyFile(f);
      const { headers, rows } = parsed;
      if (isPdf && !rows.length) {
        setRes({ ok: false, msg: "No shipment rows found in that PDF.", detail: "If it is a scan rather than a downloaded load sheet, use the portal's Excel or CSV export instead." });
        return;
      }
      if (!rows.length) { setRes({ ok: false, msg: "No rows found in that file." }); return; }
      setFileName(f.name);
      const d = detect(headers, rows);
      if (isPdf) {
        const declared = (parsed as PdfRead).declared;
        d.proof = {
          declaredCount: declared.count, parsedCount: rows.length,
          declaredTotal: declared.total,
          parsedTotal: rows.reduce((sum, r) => sum + (toNum(r["Amount"]) ?? 0), 0),
          sheet: declared.sheet,
        };
      }
      setDet(d);
    } catch (e) {
      setRes({ ok: false, msg: String((e as Error)?.message ?? e) });
    }
  }

  async function importRows() {
    if (!supabase || !det) return;
    const { cols, rows, kind } = det;
    if (!cols.track) { setRes({ ok: false, msg: "No tracking-number column — that's how parcels are matched." }); return; }
    setBusy(true); setRes(null);

    const seen = new Set<string>();
    const payload: Record<string, unknown>[] = [];
    let noTracking = 0, dupes = 0;

    for (const r of rows) {
      const track = String(r[cols.track] ?? "").trim();
      if (!track) { noTracking++; continue; }
      if (seen.has(track)) { dupes++; continue; }
      seen.add(track);

      const ref = cols.order ? String(r[cols.order] ?? "").trim() : "";
      const row: Record<string, unknown> = { tracking_id: track };
      const courier = courierFromTracking(track);
      if (courier) row.courier = courier;
      const store = storeFromRef(ref);
      if (store) row.store_code = store;
      if (ref) row.order_number = ref;

      if (kind === "settlement") {
        // this file is a payment record: the parcel was delivered and paid for
        row.payment_status = "Paid";
        if (cols.date) row.payment_date = toDate(r[cols.date]);
        if (cols.invoice) row.cpr_number = String(r[cols.invoice] ?? "") || null;
        if (cols.net) row.cpr_net_amount = toNum(r[cols.net]);
        if (cols.fee) row.courier_fee = toNum(r[cols.fee]);
        if (cols.cod) row.cod_amount = toNum(r[cols.cod]);
        row.delivery_status = "Delivered";
      } else if (kind === "status") {
        const raw = String(r[cols.status] ?? "");
        const s = raw.toLowerCase();
        row.raw_status = raw || null;
        row.delivery_status = /deliver/.test(s) ? "Delivered"
          : /return|rts/.test(s) ? "Returned"
          : /cancel/.test(s) ? "Cancelled" : "In Transit";
        if (cols.date) row.delivery_date = toDate(r[cols.date]);
        if (cols.cod) row.cod_amount = toNum(r[cols.cod]);
      } else {
        row.delivery_status = "In Transit";
        if (cols.date) row.dispatch_date = toDate(r[cols.date]);
        if (cols.cod) row.cod_amount = toNum(r[cols.cod]);
      }
      payload.push(row);
    }

    if (!payload.length) { setBusy(false); setRes({ ok: false, msg: "No rows with a tracking number." }); return; }

    let saved = 0;
    for (let i = 0; i < payload.length; i += 300) {
      const { data, error } = await supabase.from("online_logistics")
        // a load sheet only adds; status and settlement files correct what is there
        .upsert(payload.slice(i, i + 300), { onConflict: "tracking_id", ignoreDuplicates: kind === "load_sheet" })
        .select("id");
      if (error) { setBusy(false); setRes({ ok: false, msg: error.message }); return; }
      saved += (data ?? []).length;
    }

    setBusy(false);
    const notes = [noTracking ? `${noTracking} row(s) had no tracking number` : "",
                   dupes ? `${dupes} duplicate row(s) in the file` : ""].filter(Boolean).join(" · ");
    setRes({ ok: true, msg: `${saved.toLocaleString()} parcel(s) updated from ${fileName}.`, detail: notes || undefined });
    setDet(null); setFileName("");
    if (inputRef.current) inputRef.current.value = "";
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); setDet(null); }} className={btnGhost}>
        <Upload size={15} /> Smart import
      </button>

      <Modal open={open} onClose={() => setOpen(false)} wide title="Smart import"
        subtitle="Drop in any courier file — CSV, Excel or load-sheet PDF. Courier, store and type are worked out for you.">
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="block w-full text-[13px] text-muted file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-[12.5px] file:font-semibold file:text-white dark:text-[#a89f93] dark:file:bg-white dark:file:text-[#141414]" />
        <p className="mt-2 text-[11.5px] text-hint dark:text-[#8a8175]">CSV, Excel, or a courier load-sheet PDF. PDF totals are verified against the sheet before anything is written.</p>

        {det && (
          <div className="mt-4 space-y-3">
            <div className="rounded-card border border-line p-3.5 dark:border-white/[0.06]">
              <div className="flex items-center gap-2 text-[13.5px] font-bold text-ink dark:text-[#f4f1ea]">
                <FileSpreadsheet size={16} /> {KIND_LABEL[det.kind]}
              </div>
              <div className="mt-2 grid gap-1.5 text-[12.5px] text-muted dark:text-[#a89f93]">
                <span>{det.rows.length.toLocaleString()} rows · {det.withTracking.toLocaleString()} with a tracking number</span>
                <span>Courier: {Object.entries(det.couriers).map(([k, v]) => `${k} ${v}`).join(" · ")}</span>
                <span>Store: {Object.entries(det.stores).map(([k, v]) => `${k} ${v}`).join(" · ")}</span>
                <span className="text-[11.5px]">Matched columns: {Object.entries(det.cols).filter(([, v]) => v).map(([k, v]) => `${k}→${v}`).join(", ") || "none"}</span>
              </div>
            </div>
            {det.proof && (() => {
              const p = det.proof;
              const countOk = p.declaredCount === undefined || p.declaredCount === p.parsedCount;
              const totalOk = p.declaredTotal === undefined || Math.abs(p.declaredTotal - p.parsedTotal) < 1;
              const good = countOk && totalOk;
              return (
                <div className={`rounded-card border p-3.5 text-[12.5px] ${good ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft"} dark:border-white/[0.06] dark:bg-white/[0.05]`}>
                  <div className="flex items-center gap-1.5 text-[13px] font-bold text-ink dark:text-[#f4f1ea]">
                    {good ? <CheckCircle2 size={15} className="text-success" /> : <AlertTriangle size={15} className="text-danger" />}
                    {good ? "Checked against the sheet's own totals" : "Does not match the sheet's totals"}
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-muted dark:text-[#a89f93]">
                    {p.sheet && <div>Load sheet {p.sheet}</div>}
                    <div>Shipments — read {p.parsedCount}{p.declaredCount !== undefined && ` · sheet says ${p.declaredCount}`}</div>
                    <div>Amount — read Rs {p.parsedTotal.toLocaleString()}{p.declaredTotal !== undefined && ` · sheet says Rs ${p.declaredTotal.toLocaleString()}`}</div>
                  </div>
                  {!good && <p className="mt-1.5 font-semibold text-danger">Import blocked — the numbers must agree first.</p>}
                </div>
              );
            })()}
            {det.couriers.unknown > 0 && (
              <p className="flex items-start gap-1.5 text-[12px] text-muted dark:text-[#a89f93]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
                {det.couriers.unknown.toLocaleString()} row(s) have a tracking number in neither courier&apos;s format — they&apos;ll import without a courier label so you can review them.
              </p>
            )}
            <button onClick={importRows}
              disabled={busy || (!!det.proof && !(
                (det.proof.declaredCount === undefined || det.proof.declaredCount === det.proof.parsedCount) &&
                (det.proof.declaredTotal === undefined || Math.abs(det.proof.declaredTotal - det.proof.parsedTotal) < 1)))}
              className={btnPrimary}>
              {busy && <Loader2 size={14} className="animate-spin" />} Import {det.rows.length.toLocaleString()} rows
            </button>
          </div>
        )}

        {res && (
          <div className={`mt-4 text-[13px] font-semibold ${res.ok ? "text-success" : "text-danger"}`}>
            <span className="flex items-start gap-1.5">{res.ok ? <CheckCircle2 size={15} className="mt-0.5" /> : <AlertTriangle size={15} className="mt-0.5" />}{res.msg}</span>
            {res.detail && <span className="mt-1 block text-[12px] font-medium text-muted dark:text-[#a89f93]">{res.detail}</span>}
          </div>
        )}

        <div className="mt-5"><button onClick={() => setOpen(false)} className={btnGhost}>Close</button></div>
      </Modal>
    </>
  );
}
