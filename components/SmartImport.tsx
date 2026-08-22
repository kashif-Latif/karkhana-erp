"use client";
import { useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
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

/** read CSV or Excel into plain rows — Excel because courier portals export
 *  .xlsx far more often than .csv */
async function readAnyFile(file: File): Promise<{ headers: string[]; rows: Row[] }> {
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
    if (/\.pdf$/i.test(f.name)) {
      setRes({ ok: false, msg: "PDF can't be read reliably — a mis-read column would mean wrong money.", detail: "Open it in Excel and save as CSV, or use the portal's Excel export." });
      return;
    }
    try {
      const { headers, rows } = await readAnyFile(f);
      if (!rows.length) { setRes({ ok: false, msg: "No rows found in that file." }); return; }
      setFileName(f.name);
      setDet(detect(headers, rows));
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
        subtitle="Drop in any courier file — the courier, store and file type are worked out for you.">
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,text/csv"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="block w-full text-[13px] text-muted file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-[12.5px] file:font-semibold file:text-white dark:text-[#a89f93] dark:file:bg-white dark:file:text-[#141414]" />
        <p className="mt-2 text-[11.5px] text-hint dark:text-[#8a8175]">CSV or Excel from PostEx or OwnEx. PDF isn't supported — export Excel instead.</p>

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
            {det.couriers.unknown > 0 && (
              <p className="flex items-start gap-1.5 text-[12px] text-muted dark:text-[#a89f93]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
                {det.couriers.unknown.toLocaleString()} row(s) have a tracking number in neither courier&apos;s format — they&apos;ll import without a courier label so you can review them.
              </p>
            )}
            <button onClick={importRows} disabled={busy} className={btnPrimary}>
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
