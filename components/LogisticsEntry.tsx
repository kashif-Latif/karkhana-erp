"use client";
import { useRef, useState } from "react";
import { Plus, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import { parseCsv, matchHeader, toNum, toDate } from "@/lib/csv";

type Result = { ok: boolean; msg: string } | null;
/* DIRECT is a real answer, not a missing one.
   Some parcels never came from a Shopify store — a one-off sent to somebody the
   owner knows, a replacement, a sample. Forcing those into LM, TS or TRZ makes
   the row lie: no Shopify order will ever match it, so it gets flagged as a
   broken link forever and somebody keeps trying to fix what was never wrong.

   DIRECT says the parcel is real and has no online order behind it. It still
   ships, still settles, still counts. It simply stops pretending to belong to a
   shop it never touched. */
const STORES = ["LM", "TS", "TRZ", "DIRECT"];
const COURIERS = ["PostEx", "OwnEx"];
const DSTATUS = ["Unbooked", "In Transit", "Delivered", "Returned", "RTS", "Cancelled"];

/** A courier file usually holds every store mixed together, and the tracking
 *  number already says which courier it is — so both can be worked out per row
 *  instead of forcing one value on the whole file. */
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

export function AddShipment({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const [f, setF] = useState({ order_number: "", store_code: "LM", courier: "PostEx", tracking_id: "", dispatch_date: "", delivery_status: "In Transit", cod_amount: "" });

  async function save() {
    if (!supabase || !f.order_number.trim()) { setRes({ ok: false, msg: "Order number is required." }); return; }
    setBusy(true); setRes(null);
    const payload = {
      order_number: f.order_number.trim(), store_code: f.store_code,
      /* The tracking number knows which courier issued it — an OwnEx number
         starts 3120. When the person picked the other one, the number wins:
         a wrong courier sends the wrong sync chasing it, stops settlements
         matching, and applies the wrong return rule. */
      courier: courierFromTracking(f.tracking_id.trim()) ?? f.courier,
      tracking_id: f.tracking_id.trim() || null, dispatch_date: f.dispatch_date || null,
      delivery_status: f.delivery_status, cod_amount: f.cod_amount ? Number(f.cod_amount) : null,
    };
    // tracking number is the real-world unique key for a parcel; without one we simply insert.
    const { error } = payload.tracking_id
      ? await supabase.from("online_logistics").upsert(payload, { onConflict: "tracking_id" })
      : await supabase.from("online_logistics").insert(payload);
    setBusy(false);
    if (error) { setRes({ ok: false, msg: error.message }); return; }
    setRes({ ok: true, msg: "Shipment saved." });
    setF({ ...f, order_number: "", tracking_id: "", cod_amount: "" });
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnPrimary}><Plus size={15} /> Add shipment</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add / update shipment" subtitle="Saves by order number — re-adding the same order updates it instead of duplicating.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Order number *"><input className={inputCls} value={f.order_number} onChange={(e) => setF({ ...f, order_number: e.target.value })} placeholder="#1001" /></Field>
          <Field label="Store"><select className={inputCls} value={f.store_code} onChange={(e) => setF({ ...f, store_code: e.target.value })}>{STORES.map((s) => <option key={s}>{s}</option>)}</select>
            {f.store_code === "DIRECT" && (
              <p className="mt-1 text-[11.5px] text-hint dark:text-[#8a8175]">
                No Shopify order. Use for one-off shipments — a replacement, a sample,
                something sent to somebody directly.
              </p>
            )}</Field>
          <Field label="Courier"><select className={inputCls} value={f.courier} onChange={(e) => setF({ ...f, courier: e.target.value })}>{COURIERS.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Tracking number"><input className={inputCls} value={f.tracking_id} onChange={(e) => setF({ ...f, tracking_id: e.target.value })} /></Field>
          <Field label="Dispatch date"><input type="date" className={inputCls} value={f.dispatch_date} onChange={(e) => setF({ ...f, dispatch_date: e.target.value })} /></Field>
          <Field label="Delivery status"><select className={inputCls} value={f.delivery_status} onChange={(e) => setF({ ...f, delivery_status: e.target.value })}>{DSTATUS.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="COD amount (Rs)"><input type="number" className={inputCls} value={f.cod_amount} onChange={(e) => setF({ ...f, cod_amount: e.target.value })} /></Field>
        </div>
        {res && <p className={`mt-3 flex items-center gap-1.5 text-[13px] font-semibold ${res.ok ? "text-success" : "text-danger"}`}>{res.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{res.msg}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save shipment</button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}

type Mode = "load_sheet" | "status" | "cpr";
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "load_sheet", label: "Load sheet", hint: "New shipments booked with the courier — creates tracking rows." },
  { key: "status", label: "Status update", hint: "Delivery status for existing shipments." },
  { key: "cpr", label: "CPR / payment", hint: "Courier payment batches — updates COD settlement." },
];

export function UploadCourierFile({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("load_sheet");
  const [courier, setCourier] = useState("AUTO");
  const [store, setStore] = useState("AUTO");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(fl: File | null) {
    setFile(fl); setRes(null); setPreview(null);
    if (!fl) return;
    const text = await fl.text();
    const p = parseCsv(text);
    if (p.rows.length === 0) { setRes({ ok: false, msg: "No rows found — is this a CSV file?" }); return; }
    setPreview(p);
  }

  async function importRows() {
    if (!supabase || !preview || !file) return;
    setBusy(true); setRes(null);
    const H = preview.headers;
    const cOrder = matchHeader(H, ["order number", "orderref", "order ref", "reference", "order id", "order"]);
    const cTrack = matchHeader(H, ["tracking number", "tracking id", "cn", "consignment", "airway", "awb"]);
    const cStatus = matchHeader(H, ["status", "delivery status", "transaction status"]);
    const cAmount = matchHeader(H, ["cod amount", "amount", "invoice payment", "cod"]);
    const cDate = matchHeader(H, ["date", "dispatch date", "booking date", "transaction date", "delivery date"]);
    const cCpr = matchHeader(H, ["cpr", "cpr number", "batch", "payment ref"]);
    const cNet = matchHeader(H, ["net amount", "payable", "net"]);

    if (mode !== "cpr" && !cTrack) { setBusy(false); setRes({ ok: false, msg: "This file needs a tracking-number column — that's how shipments are matched." }); return; }
    if (mode === "cpr" && !cCpr) { setBusy(false); setRes({ ok: false, msg: "Couldn't find a CPR/batch number column in this file." }); return; }

    // record the batch first
    const { data: batch } = await supabase.from("online_import_batches").insert({
      batch_type: mode, courier: courier === "AUTO" ? "Mixed" : courier,
      store_code: store === "AUTO" ? "ALL" : store, file_name: file.name, rows_in_file: preview.rows.length,
    }).select("id").maybeSingle();
    const batchId = batch?.id ?? null;

    let newRows = 0, skipped = 0;
    if (mode === "cpr") {
      const seen = new Set<string>();
      const payload = preview.rows.map((r) => ({
        store_code: store === "AUTO" ? "LM" : store,
        courier: courier === "AUTO" ? "OwnEx" : courier,
        cpr_number: cCpr ? r[cCpr] : null,
        cpr_date: cDate ? toDate(r[cDate]) : null,
        amount: cAmount ? toNum(r[cAmount]) ?? 0 : 0,
        status: "Pending", import_batch_id: batchId,
      })).filter((r) => { const k = String(r.cpr_number ?? ""); if (!k || seen.has(k)) { skipped++; return false; } seen.add(k); return true; });
      for (let i = 0; i < payload.length; i += 300) {
        const { data } = await supabase.from("online_cpr").upsert(payload.slice(i, i + 300), { onConflict: "store_code,cpr_number", ignoreDuplicates: true }).select("id");
        newRows += (data ?? []).length;
      }
    } else {
      const seen = new Set<string>();
      const payload = preview.rows.map((r) => {
        const ord = cOrder ? r[cOrder] : "";
        const trk = cTrack ? (r[cTrack] || "") : "";
        // when the dropdown says AUTO, read it off the row itself
        const rowCourier = courier === "AUTO" ? courierFromTracking(trk) : courier;
        const rowStore = store === "AUTO" ? (storeFromRef(ord) ?? "LM") : store;
        const row: Record<string, unknown> = { store_code: rowStore, order_number: ord || null, import_batch_id: batchId };
        if (rowCourier) row.courier = rowCourier;
        if (cTrack) row.tracking_id = trk || null;
        if (cDate) row[mode === "status" ? "delivery_date" : "dispatch_date"] = toDate(r[cDate]);
        if (cAmount) row.cod_amount = toNum(r[cAmount]);
        if (cNet) row.cpr_net_amount = toNum(r[cNet]);
        if (mode === "status" && cStatus) {
          const s = (r[cStatus] || "").toLowerCase();
          row.raw_status = r[cStatus] || null;
          row.delivery_status = /deliver/.test(s) ? "Delivered" : /return|rts/.test(s) ? "Returned" : /cancel/.test(s) ? "Cancelled" : "In Transit";
        } else if (mode === "load_sheet") row.delivery_status = "In Transit";
        return row;
      }).filter((r) => {
        const k = String(r.tracking_id ?? "");
        // one tracking number = one parcel; rows without one can't be safely deduped
        if (!k || seen.has(k)) { skipped++; return false; }
        seen.add(k); return true;
      });

      for (let i = 0; i < payload.length; i += 300) {
        const chunk = payload.slice(i, i + 300);
        const { data, error } = await supabase.from("online_logistics")
          .upsert(chunk, { onConflict: "tracking_id", ignoreDuplicates: mode === "load_sheet" })
          .select("id");
        if (error) { setBusy(false); setRes({ ok: false, msg: error.message }); return; }
        newRows += (data ?? []).length;
      }
    }
    if (batchId) await supabase.from("online_import_batches").update({ rows_new: newRows, rows_skipped: skipped }).eq("id", batchId);
    setBusy(false);
    setRes({ ok: true, msg: `Imported ${newRows.toLocaleString()} row${newRows === 1 ? "" : "s"}${skipped ? ` · ${skipped.toLocaleString()} duplicate/blank skipped` : ""}.` });
    setPreview(null); setFile(null); if (inputRef.current) inputRef.current.value = "";
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnGhost}><Upload size={15} /> Upload file</button>
      <Modal open={open} onClose={() => setOpen(false)} wide title="Upload courier file" subtitle="Load sheets, status updates or CPR payments — duplicates are skipped automatically.">
        <div className="flex flex-wrap gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {MODES.map((m) => (
            <button key={m.key} onClick={() => { setMode(m.key); setRes(null); }}
              className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition ${mode === m.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93]"}`}>{m.label}</button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-hint dark:text-[#8a8175]">{MODES.find((m) => m.key === mode)?.hint}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Courier"><select className={inputCls} value={courier} onChange={(e) => setCourier(e.target.value)}><option value="AUTO">Detect from tracking number</option>
              {COURIERS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Store"><select className={inputCls} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="AUTO">All stores — detect per row</option>
            {STORES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></Field>
        </div>
        <div className="mt-3">
          <Field label="CSV file">
            <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0] ?? null)}
              className="w-full rounded-xl2 border border-dashed border-line bg-canvas px-3 py-3 text-[13px] file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-white dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:file:bg-white dark:file:text-[#141414]" />
          </Field>
        </div>

        {preview && (
          <div className="mt-4 rounded-card border border-line dark:border-white/[0.06]">
            <div className="border-b border-line px-3 py-2 text-[12.5px] font-semibold text-ink dark:border-white/[0.06] dark:text-[#f4f1ea]">
              {preview.rows.length.toLocaleString()} rows · {preview.headers.length} columns detected
            </div>
            <div className="max-h-48 overflow-auto">
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[12px]">
                <thead><tr className="text-[10.5px] uppercase tracking-wide text-hint dark:text-[#8a8175]">{preview.headers.slice(0, 6).map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line dark:divide-white/[0.05]">
                  {preview.rows.slice(0, 4).map((r, i) => (
                    <tr key={i} className="text-ink dark:text-[#e7e2d8]">{preview.headers.slice(0, 6).map((h) => <td key={h} className="max-w-[130px] truncate px-3 py-2">{r[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          </div>
        )}

        {res && <p className={`mt-3 flex items-center gap-1.5 text-[13px] font-semibold ${res.ok ? "text-success" : "text-danger"}`}>{res.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{res.msg}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={importRows} disabled={busy || !preview} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Import rows</button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}
