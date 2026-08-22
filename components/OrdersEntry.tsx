"use client";
import { useRef, useState } from "react";
import { Plus, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import { parseCsv, matchHeader, toNum, toDate } from "@/lib/csv";

type Result = { ok: boolean; msg: string; detail?: string } | null;
const STORES = ["LM", "TS", "TRZ"];
const STATUSES = ["Pending", "Dispatched", "Delivered", "Cancelled", "Returned"];

/** Store is derived from the order prefix (#LM / #TS / #TRZ) — the same rule the
 *  courier sync uses, because one courier account serves all three stores. */
function storeFromRef(ref: string, fallback = "LM") {
  const u = (ref || "").trim().toUpperCase();
  if (/^#?TRZ/.test(u)) return "TRZ";
  if (/^#?TS/.test(u)) return "TS";
  if (/^#?LM/.test(u)) return "LM";
  return fallback;
}

/* ------------------------------------------------------------------ */
/*  Add / update a single order                                        */
/* ------------------------------------------------------------------ */
export function AddOrder({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const [f, setF] = useState({
    order_number: "", store_code: "LM", order_date: "", customer_name: "", phone: "",
    city: "", amount: "", product: "", address: "", notes: "", status: "Pending",
  });
  const [autoStore, setAutoStore] = useState(true);

  function setRef(v: string) {
    setF((p) => ({ ...p, order_number: v, store_code: autoStore ? storeFromRef(v, p.store_code) : p.store_code }));
  }

  async function save() {
    if (!supabase) return;
    // these four are NOT NULL in the database — check here so the user gets a
    // clear message instead of a raw Postgres error
    if (!f.order_number.trim()) { setRes({ ok: false, msg: "Order number is required." }); return; }
    if (!f.customer_name.trim()) { setRes({ ok: false, msg: "Customer name is required." }); return; }
    if (!f.phone.trim()) { setRes({ ok: false, msg: "Phone is required." }); return; }
    if (!f.city.trim()) { setRes({ ok: false, msg: "City is required." }); return; }

    setBusy(true); setRes(null);
    const payload = {
      order_number: f.order_number.trim(),
      store_code: f.store_code,
      order_date: f.order_date || null,
      customer_name: f.customer_name.trim(),
      phone: f.phone.trim(),
      city: f.city.trim(),
      amount: f.amount ? Number(f.amount) : 0,
      product: f.product.trim() || null,
      address: f.address.trim() || null,
      notes: f.notes.trim() || null,
      status: f.status,
    };
    // (store_code, order_number) is the natural key — re-saving updates, never duplicates
    const { error } = await supabase.from("online_orders")
      .upsert(payload, { onConflict: "store_code,order_number" });
    setBusy(false);
    if (error) { setRes({ ok: false, msg: error.message }); return; }
    setRes({ ok: true, msg: `Order ${payload.order_number} saved to ${payload.store_code}.` });
    setF({ ...f, order_number: "", customer_name: "", phone: "", city: "", amount: "", product: "", address: "", notes: "" });
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnPrimary}>
        <Plus size={15} /> Add order
      </button>
      <Modal open={open} onClose={() => setOpen(false)} wide title="Add / update order"
        subtitle="Saved against store + order number — re-adding the same order updates it instead of creating a duplicate.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Order number *">
            <input className={inputCls} value={f.order_number} onChange={(e) => setRef(e.target.value)} placeholder="#LM1001" />
          </Field>
          <Field label="Store">
            <select className={inputCls} value={f.store_code}
              onChange={(e) => { setAutoStore(false); setF({ ...f, store_code: e.target.value }); }}>
              {STORES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Customer name *">
            <input className={inputCls} value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} />
          </Field>
          <Field label="Phone *">
            <input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="03XXXXXXXXX" />
          </Field>
          <Field label="City *">
            <input className={inputCls} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </Field>
          <Field label="Order date">
            <input type="date" className={inputCls} value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} />
          </Field>
          <Field label="Amount (Rs)">
            <input type="number" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Product"><input className={inputCls} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></Field>
          <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Notes"><input className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>

        {f.order_number && autoStore && (
          <p className="mt-3 text-[12px] text-hint dark:text-[#8a8175]">
            Store read from the order prefix — change the dropdown to override.
          </p>
        )}
        {res && (
          <p className={`mt-3 flex items-center gap-1.5 text-[13px] font-semibold ${res.ok ? "text-success" : "text-danger"}`}>
            {res.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{res.msg}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy && <Loader2 size={14} className="animate-spin" />} Save order
          </button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Bulk import from a Shopify / spreadsheet export                    */
/* ------------------------------------------------------------------ */
export function ImportOrders({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const [store, setStore] = useState("AUTO");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!supabase) return;
    setBusy(true); setRes(null);
    try {
      const { headers, rows } = parseCsv(await file.text());
      const H = {
        ref: matchHeader(headers, ["order number", "order", "name", "order_number", "order id", "order #"]),
        date: matchHeader(headers, ["order date", "created at", "date", "order_date", "created"]),
        cust: matchHeader(headers, ["customer name", "customer", "name", "billing name", "shipping name"]),
        phone: matchHeader(headers, ["phone", "mobile", "contact", "shipping phone", "billing phone"]),
        city: matchHeader(headers, ["city", "shipping city", "billing city"]),
        amount: matchHeader(headers, ["amount", "total", "cod", "cod amount", "total price", "order total"]),
        product: matchHeader(headers, ["product", "item", "items", "lineitem name", "product name"]),
        address: matchHeader(headers, ["address", "shipping address", "address1", "street"]),
        status: matchHeader(headers, ["status", "order status", "fulfillment status"]),
      };
      if (!H.ref) { setBusy(false); setRes({ ok: false, msg: "Couldn't find an order-number column in that file." }); return; }

      const seen = new Set<string>();
      const payload: Record<string, unknown>[] = [];
      let skippedNoRef = 0, skippedDupe = 0;

      for (const r of rows) {
        const ref = String(r[H.ref] ?? "").trim();
        if (!ref) { skippedNoRef++; continue; }
        const sc = store === "AUTO" ? storeFromRef(ref) : store;
        const key = `${sc}::${ref}`;
        // the database rejects duplicates anyway; de-duping here keeps the
        // batch clean and the reported count honest
        if (seen.has(key)) { skippedDupe++; continue; }
        seen.add(key);
        payload.push({
          order_number: ref,
          store_code: sc,
          order_date: H.date ? toDate(r[H.date]) : null,
          customer_name: (H.cust ? String(r[H.cust] ?? "").trim() : "") || "Unknown",
          phone: (H.phone ? String(r[H.phone] ?? "").trim() : "") || "0000000000",
          city: (H.city ? String(r[H.city] ?? "").trim() : "") || "Unknown",
          amount: H.amount ? (toNum(r[H.amount]) ?? 0) : 0,
          product: H.product ? String(r[H.product] ?? "").trim() || null : null,
          address: H.address ? String(r[H.address] ?? "").trim() || null : null,
          status: H.status ? String(r[H.status] ?? "").trim() || "Pending" : "Pending",
        });
      }

      if (!payload.length) { setBusy(false); setRes({ ok: false, msg: "No usable rows found in that file." }); return; }

      let saved = 0;
      for (let i = 0; i < payload.length; i += 300) {
        const { data, error } = await supabase.from("online_orders")
          .upsert(payload.slice(i, i + 300), { onConflict: "store_code,order_number" })
          .select("id");
        if (error) throw error;
        saved += (data ?? []).length;
      }

      const notes = [
        skippedNoRef ? `${skippedNoRef} row(s) had no order number` : "",
        skippedDupe ? `${skippedDupe} duplicate row(s) in the file` : "",
      ].filter(Boolean).join(" · ");
      setRes({ ok: true, msg: `${saved.toLocaleString()} orders imported or updated.`, detail: notes || undefined });
      onDone();
    } catch (e) {
      setRes({ ok: false, msg: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnGhost}>
        <Upload size={15} /> Import orders
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import orders from a file"
        subtitle="CSV export from Shopify or a spreadsheet. Column names are matched automatically.">
        <div className="space-y-3">
          <Field label="Store">
            <select className={inputCls} value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="AUTO">Detect from order number (#LM / #TS / #TRZ)</option>
              {STORES.map((s) => <option key={s} value={s}>{s} — force all rows</option>)}
            </select>
          </Field>
          <input ref={fileRef} type="file" accept=".csv,text/csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            className="block w-full text-[13px] text-muted file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-[12.5px] file:font-semibold file:text-white dark:text-[#a89f93] dark:file:bg-white dark:file:text-[#141414]" />
          <p className="text-[12px] leading-snug text-hint dark:text-[#8a8175]">
            Re-importing the same file is safe — orders are matched on store + order number, so rows update rather than duplicate.
          </p>
        </div>

        {busy && <p className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-muted dark:text-[#a89f93]"><Loader2 size={15} className="animate-spin" /> Importing…</p>}
        {res && (
          <div className={`mt-3 text-[13px] font-semibold ${res.ok ? "text-success" : "text-danger"}`}>
            <span className="flex items-center gap-1.5">{res.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{res.msg}</span>
            {res.detail && <span className="mt-1 block text-[12px] font-medium text-muted dark:text-[#a89f93]">{res.detail}</span>}
          </div>
        )}
        <div className="mt-5"><button onClick={() => setOpen(false)} className={btnGhost}>Close</button></div>
      </Modal>
    </>
  );
}
