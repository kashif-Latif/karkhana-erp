"use client";
import { useEffect, useState } from "react";
import { Plus, Loader2, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmDialog";

type Res = { ok: boolean; msg: string } | null;
type Row = Record<string, unknown>;
const STORES = ["LM", "TS", "TRZ"];
const COURIERS = ["PostEx", "OwnEx"];
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- Add CPR batch / Add return ---------------- */
export function AddFinanceRow({ tab, onDone }: { tab: "payments" | "cpr" | "returns"; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res>(null);
  const [f, setF] = useState<Record<string, string>>({ store_code: "LM", courier: "PostEx" });

  if (tab === "payments") return null; // payments are marked on existing shipments

  async function save() {
    if (!supabase) return;
    setBusy(true); setRes(null);
    if (tab === "cpr") {
      if (!f.cpr_number?.trim()) { setBusy(false); setRes({ ok: false, msg: "CPR number is required." }); return; }
      const { error } = await supabase.from("online_cpr").upsert({
        store_code: f.store_code, courier: f.courier, cpr_number: f.cpr_number.trim(),
        cpr_date: f.cpr_date || null, amount: f.amount ? Number(f.amount) : 0,
        orders_count: f.orders_count ? Number(f.orders_count) : 0, status: f.status || "Pending",
      }, { onConflict: "store_code,cpr_number" });
      setBusy(false);
      if (error) { setRes({ ok: false, msg: error.message }); return; }
    } else {
      if (!f.order_number?.trim()) { setBusy(false); setRes({ ok: false, msg: "Order number is required." }); return; }
      const { error } = await supabase.from("online_returns").upsert({
        store_code: f.store_code, courier: f.courier, order_number: f.order_number.trim(),
        tracking_id: f.tracking_id || null, return_date: f.return_date || null,
        reason: f.reason || null, received: f.received === "yes",
        received_date: f.received === "yes" ? (f.received_date || today()) : null,
      }, { onConflict: "store_code,order_number" });
      setBusy(false);
      if (error) { setRes({ ok: false, msg: error.message }); return; }
    }
    setRes({ ok: true, msg: tab === "cpr" ? "CPR batch saved." : "Return saved." });
    setF({ store_code: f.store_code, courier: f.courier });
    onDone();
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setRes(null); }} className={btnPrimary}>
        <Plus size={15} /> {tab === "cpr" ? "Add CPR" : "Add return"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)}
        title={tab === "cpr" ? "Add CPR batch" : "Add return"}
        subtitle="Saved by natural key — re-adding the same record updates it instead of duplicating.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Store"><select className={inputCls} value={f.store_code} onChange={(e) => setF({ ...f, store_code: e.target.value })}>{STORES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Courier"><select className={inputCls} value={f.courier} onChange={(e) => setF({ ...f, courier: e.target.value })}>{COURIERS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          {tab === "cpr" ? (
            <>
              <Field label="CPR number *"><input className={inputCls} value={f.cpr_number ?? ""} onChange={(e) => setF({ ...f, cpr_number: e.target.value })} /></Field>
              <Field label="CPR date"><input type="date" className={inputCls} value={f.cpr_date ?? ""} onChange={(e) => setF({ ...f, cpr_date: e.target.value })} /></Field>
              <Field label="Amount (Rs)"><input type="number" className={inputCls} value={f.amount ?? ""} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
              <Field label="Orders covered"><input type="number" className={inputCls} value={f.orders_count ?? ""} onChange={(e) => setF({ ...f, orders_count: e.target.value })} /></Field>
              <Field label="Status"><select className={inputCls} value={f.status ?? "Pending"} onChange={(e) => setF({ ...f, status: e.target.value })}><option>Pending</option><option>Paid</option><option>Cleared</option></select></Field>
            </>
          ) : (
            <>
              <Field label="Order number *"><input className={inputCls} value={f.order_number ?? ""} onChange={(e) => setF({ ...f, order_number: e.target.value })} /></Field>
              <Field label="Tracking"><input className={inputCls} value={f.tracking_id ?? ""} onChange={(e) => setF({ ...f, tracking_id: e.target.value })} /></Field>
              <Field label="Return date"><input type="date" className={inputCls} value={f.return_date ?? ""} onChange={(e) => setF({ ...f, return_date: e.target.value })} /></Field>
              <Field label="Received back?"><select className={inputCls} value={f.received ?? "no"} onChange={(e) => setF({ ...f, received: e.target.value })}><option value="no">Not yet</option><option value="yes">Received</option></select></Field>
              <Field label="Reason"><input className={inputCls} value={f.reason ?? ""} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            </>
          )}
        </div>
        {res && <p className={`mt-3 flex items-center gap-1.5 text-[13px] font-semibold ${res.ok ? "text-success" : "text-danger"}`}>{res.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{res.msg}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button>
          <button onClick={() => setOpen(false)} className={btnGhost}>Close</button>
        </div>
      </Modal>
    </>
  );
}

/* ---------------- Edit an existing row (mark paid / received) ---------------- */
export function EditFinanceRow({ tab, row, onClose, onDone }:
  { tab: "payments" | "cpr" | "returns"; row: Row | null; onClose: () => void; onDone: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res>(null);
  const [f, setF] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!row) return;
    setRes(null);
    if (tab === "payments") setF({
      payment_status: String(row.payment_status ?? "Pending"),
      payment_date: String(row.payment_date ?? "") || today(),
      cpr_net_amount: row.cpr_net_amount == null ? "" : String(row.cpr_net_amount),
      cpr_number: String(row.cpr_number ?? ""),
    });
    else if (tab === "cpr") setF({
      status: String(row.status ?? "Pending"),
      amount: String(row.amount ?? ""),
      cpr_date: String(row.cpr_date ?? ""),
      orders_count: String(row.orders_count ?? ""),
    });
    else setF({
      received: row.received ? "yes" : "no",
      received_date: String(row.received_date ?? "") || today(),
      reason: String(row.reason ?? ""),
    });
  }, [row, tab]);

  if (!row) return null;
  const id = row.id;

  async function save() {
    if (!supabase) return;
    setBusy(true); setRes(null);
    let error = null;
    if (tab === "payments") {
      const paid = f.payment_status === "Paid" || f.payment_status === "Received";
      ({ error } = await supabase.from("online_logistics").update({
        payment_status: f.payment_status,
        payment_date: paid ? (f.payment_date || today()) : null,
        cpr_net_amount: f.cpr_net_amount === "" ? null : Number(f.cpr_net_amount),
        cpr_number: f.cpr_number || null,
      }).eq("id", id));
    } else if (tab === "cpr") {
      ({ error } = await supabase.from("online_cpr").update({
        status: f.status, amount: f.amount === "" ? 0 : Number(f.amount),
        cpr_date: f.cpr_date || null, orders_count: f.orders_count === "" ? 0 : Number(f.orders_count),
      }).eq("id", id));
    } else {
      const got = f.received === "yes";
      ({ error } = await supabase.from("online_returns").update({
        received: got, received_date: got ? (f.received_date || today()) : null, reason: f.reason || null,
      }).eq("id", id));
    }
    setBusy(false);
    if (error) { setRes({ ok: false, msg: error.message }); return; }
    onDone(); onClose();
  }

  async function remove() {
    if (!supabase || tab === "payments") return;
    if (!(await confirm({ title: "Delete this record?",
                          body: "This cannot be undone.", confirmLabel: "Delete" }))) return;
    setBusy(true);
    const table = tab === "cpr" ? "online_cpr" : "online_returns";
    const { error } = await supabase.from(table).delete().eq("id", id);
    setBusy(false);
    if (error) { setRes({ ok: false, msg: error.message }); return; }
    onDone(); onClose();
  }

  const title = tab === "payments" ? "Mark payment" : tab === "cpr" ? "Update CPR batch" : "Update return";
  const ref = String(row.order_number ?? row.cpr_number ?? "");

  return (
    <Modal open={!!row} onClose={onClose} title={title} subtitle={ref ? `Record: ${ref}` : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        {tab === "payments" && (
          <>
            <Field label="Payment status"><select className={inputCls} value={f.payment_status ?? ""} onChange={(e) => setF({ ...f, payment_status: e.target.value })}><option>Pending</option><option>Paid</option><option>Received</option></select></Field>
            <Field label="Payment date"><input type="date" className={inputCls} value={f.payment_date ?? ""} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></Field>
            <Field label="Net received (Rs)"><input type="number" className={inputCls} value={f.cpr_net_amount ?? ""} onChange={(e) => setF({ ...f, cpr_net_amount: e.target.value })} /></Field>
            <Field label="CPR number"><input className={inputCls} value={f.cpr_number ?? ""} onChange={(e) => setF({ ...f, cpr_number: e.target.value })} /></Field>
          </>
        )}
        {tab === "cpr" && (
          <>
            <Field label="Status"><select className={inputCls} value={f.status ?? ""} onChange={(e) => setF({ ...f, status: e.target.value })}><option>Pending</option><option>Paid</option><option>Cleared</option></select></Field>
            <Field label="CPR date"><input type="date" className={inputCls} value={f.cpr_date ?? ""} onChange={(e) => setF({ ...f, cpr_date: e.target.value })} /></Field>
            <Field label="Amount (Rs)"><input type="number" className={inputCls} value={f.amount ?? ""} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Orders covered"><input type="number" className={inputCls} value={f.orders_count ?? ""} onChange={(e) => setF({ ...f, orders_count: e.target.value })} /></Field>
          </>
        )}
        {tab === "returns" && (
          <>
            <Field label="Received back?"><select className={inputCls} value={f.received ?? "no"} onChange={(e) => setF({ ...f, received: e.target.value })}><option value="no">Not yet</option><option value="yes">Received</option></select></Field>
            <Field label="Received date"><input type="date" className={inputCls} value={f.received_date ?? ""} onChange={(e) => setF({ ...f, received_date: e.target.value })} /></Field>
            <Field label="Reason"><input className={inputCls} value={f.reason ?? ""} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          </>
        )}
      </div>
      {res && <p className={`mt-3 flex items-center gap-1.5 text-[13px] font-semibold ${res.ok ? "text-success" : "text-danger"}`}>{res.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{res.msg}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Save</button>
        <button onClick={onClose} className={btnGhost}>Cancel</button>
        {tab !== "payments" && <button onClick={remove} disabled={busy} className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-2.5 text-[13px] font-semibold text-danger transition hover:bg-danger-soft"><Trash2 size={14} /> Delete</button>}
      </div>
    </Modal>
  );
}
