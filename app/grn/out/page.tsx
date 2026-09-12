"use client";
/* GR OUT — the same three divisions, going the other way.
 *
 * Fabric and other materials leave stock; finished goods leave the factory
 * for the warehouse. The database refuses more than exists and names both
 * numbers, so a GRO can never create a shortage nobody can explain.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Layers, PackageCheck, Download, Plus, Loader2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Row = { id: string; out_number: string; kind: string; moved_at: string;
             went_to: string | null; reason: string | null; note: string | null;
             voided_at: string | null; quantity: number; rate: number | null;
             what: string | null; code: string | null };
type Item = { item_id: string; code: string; division: string; material: string;
              category: string | null; unit: string; in_stock: number };
type Ready = { article_id: string; code: string; name: string; in_hand: number };
type Kind = "fabric" | "other" | "finished";

const DIV: { k: Kind; label: string; sub: string; Icon: typeof Boxes; tone: string }[] = [
  { k: "fabric",   label: "Fabric",          sub: "cloth out of stock",             Icon: Layers,       tone: "bg-periwinkle-soft" },
  { k: "other",    label: "Other materials", sub: "sticker · shopper · zip · thread", Icon: Boxes,      tone: "bg-amber-soft" },
  { k: "finished", label: "Finished goods",  sub: "out to the warehouse",           Icon: PackageCheck, tone: "bg-success-soft" },
];
const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const when = (v: string) => new Date(v).toLocaleString();

export default function GrnOutPage() {
  const { can } = usePermissions();
  const canOut = can(["inventory.issue", "grn.create"]);

  const [kind, setKind] = useState<Kind>("fabric");
  const [rows, setRows] = useState<Row[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [ready, setReady] = useState<Ready[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState<number | null>(null);

  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("");
  const [wentTo, setWentTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [fErr, setFErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [o, s, r] = await Promise.all([
      supabase.from("v_grn_out").select("*").order("moved_at", { ascending: false }),
      supabase.from("v_stock_split").select("*").gt("in_stock", 0).order("material"),
      supabase.from("v_ready_to_ship").select("article_id,code,name,in_hand"),
    ]);
    if (o.error) setErr(o.error.message);
    setRows((o.data as Row[]) ?? []);
    setItems((s.data as unknown as Item[]) ?? []);
    setReady(((r.data as Ready[]) ?? []).filter((x) => Number(x.in_hand) > 0));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    fabric: rows.filter((r) => r.kind === "fabric").length,
    other: rows.filter((r) => r.kind === "other").length,
    finished: rows.filter((r) => r.kind === "finished").length,
  }), [rows]);

  const view = useMemo(() => rows.filter((r) => {
    if (r.kind !== kind) return false;
    if (days !== null) {
      const edge = new Date(); edge.setHours(0, 0, 0, 0);
      edge.setDate(edge.getDate() - (days - 1));
      if (new Date(String(r.moved_at).slice(0, 10)) < edge) return false;
    }
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return [r.out_number, r.what, r.code, r.went_to].some((x) => String(x ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, kind, q, days]);

  /* Only what this division actually holds — offering cloth on the sticker
     tab would be refused by the database anyway, and look broken here. */
  const choices = kind === "finished"
    ? ready.map((x) => ({ id: x.article_id, label: `${x.name} — ${n(x.in_hand)} packed`, max: Number(x.in_hand) }))
    : items.filter((i) => i.division === kind)
           .map((x) => ({ id: x.item_id, label: `${[x.material, x.category].filter(Boolean).join(" · ")} — ${n(x.in_stock)} ${x.unit}`, max: Number(x.in_stock) }));
  const chosen = choices.find((c) => c.id === pick);

  async function send() {
    if (!supabase) return;
    setFErr("");
    if (!pick) { setFErr("Choose what is going out."); return; }
    if (!(parseFloat(qty) > 0)) { setFErr("How much?"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("post_grn_out", {
      p_kind: kind, p_went_to: wentTo.trim() || null, p_reason: reason.trim() || null,
      p_note: null,
      p_lines: [kind === "finished"
        ? { article_id: pick, quantity: parseFloat(qty) }
        : { item_id: pick, quantity: parseFloat(qty) }],
    });
    setBusy(false);
    if (error) { setFErr(error.message); return; }
    setOpen(false); setPick(""); setQty(""); setWentTo(""); setReason(""); load();
  }

  const current = DIV.find((d) => d.k === kind)!;
  const table = (): ExportTable => ({
    title: `grn-out-${kind}`,
    headers: ["GRO", "Date", "What", "Code", "Quantity", "Went to", "Reason"],
    rows: view.map((r) => [r.out_number, when(r.moved_at), r.what ?? "", r.code ?? "",
      r.quantity, r.went_to ?? "", r.reason ?? ""]),
  });

  return (
    <>
      <Topbar title="GR out" subtitle="Goods leaving — fabric, other materials and finished goods" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {DIV.map((d) => {
            const on = d.k === kind;
            return (
              <button key={d.k} onClick={() => { setKind(d.k); setPick(""); setQ(""); }}
                className={`rounded-card p-4 text-left transition ${on ? `${d.tone} ring-2 ring-ink/70` : "border border-line bg-surface hover:bg-panel"}`}>
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/55">
                  <d.Icon size={13} /> {d.label}
                </span>
                <p className="mt-1 text-[26px] font-extrabold leading-none tracking-tight text-ink">{counts[d.k]}</p>
                <p className="mt-1 text-[12px] text-ink/60">{d.sub}</p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[{ l: "All time", d: null }, { l: "Today", d: 1 }, { l: "5 days", d: 5 }, { l: "30 days", d: 30 }].map((r) => (
            <button key={r.l} onClick={() => setDays(r.d)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${days === r.d ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {r.l}
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GRO, material, destination…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          {canOut && (
            <button onClick={() => { setOpen(true); setPick(""); setQty(""); setFErr(""); }}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
              <Plus size={15} /> New {current.label} out
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><current.Icon size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">Nothing sent out</p>
            <p className="mt-1 text-[13px] text-muted">{current.sub}.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">GRO</th>
                <th className="px-4 py-3 font-bold">What</th>
                <th className="px-4 py-3 text-right font-bold">Quantity</th>
                <th className="px-4 py-3 font-bold">Went to</th>
                <th className="px-4 py-3 font-bold">Reason</th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id + (r.code ?? "")} className={`border-b border-line/60 last:border-0 ${r.voided_at ? "opacity-45" : ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12.5px] font-bold text-ink">{r.out_number}</span>
                      <span className="block text-[11px] text-hint">{when(r.moved_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.what}</span>
                      <span className="block font-mono text-[11px] text-hint">{r.code ?? ""}</span>
                    </td>
                    <td className="px-4 py-3 text-right tnum font-bold text-ink">{n(r.quantity)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-ink/80">{r.went_to ?? "—"}</td>
                    <td className="px-4 py-3 text-[12px] text-hint">{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`New ${current.label} out`}>
        <Field label="What is going out? *">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={inp}>
            <option value="">Choose…</option>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        {choices.length === 0 && <p className="mt-2 text-[12.5px] text-muted">Nothing in this division has stock.</p>}
        <div className="mt-3"><Field label="How much *">
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
            className={`${inp} ${chosen && parseFloat(qty) > chosen.max ? "border-danger" : ""}`} />
        </Field></div>
        {chosen && parseFloat(qty) > chosen.max && (
          <p className="mt-1.5 text-[12.5px] text-danger">Only {n(chosen.max)} available.</p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={kind === "finished" ? "To (warehouse)" : "Went to"}>
            <input value={wentTo} onChange={(e) => setWentTo(e.target.value)} className={inp} />
          </Field>
          <Field label="Reason">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inp} />
          </Field>
        </div>
        {fErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{fErr}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={send} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Send out
          </button>
        </div>
      </Modal>
    </>
  );
}
