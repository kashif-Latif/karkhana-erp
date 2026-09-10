"use client";
/* GRN — FINAL INVENTORY. Goods received after pressing, packing, stickering.
 *
 * Its own series (GRF-…), and the one place a piece can leave Karkhana for
 * the warehouse. The transfer matches on the article's barcode, which is the
 * one thing both departments already agree on — so nothing is retyped and
 * the two sides cannot drift apart.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, Download, Loader2, Truck, Plus, Check } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Row = { id: string; grn_no: string; packed_at: string; quantity: number;
             labour_cost: number; material_cost: number; total_cost: number;
             cost_per_piece: number | null; note: string | null; voided_at: string | null;
             article_id: string; article_code: string; article: string;
             system_barcode: string | null; manual_barcode: string | null;
             retail_price: number | null; worker: string | null };
type Ready = { article_id: string; code: string; name: string;
               system_barcode: string | null; manual_barcode: string | null;
               audience: string | null; retail_price: number | null; in_hand: number };

type Queue = { article_id: string; code: string; name: string; stitched: number; packed: number };
type Stock = { item_id: string; material: string; unit: string; usable: number };
type Staff = { id: string; name: string };
type MatLine = { item_id: string; quantity: string };

const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString();

export default function GrnFinalPage() {
  const { can } = usePermissions();
  const canShip = can(["production.entry"]);

  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState<Ready[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [ship, setShip] = useState<Ready | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, unknown> | null>(null);

  /* THE PACKING FORM LIVES HERE NOW, not on its own page. Receiving finished
     goods IS this GRN — doing it in two places would mean two ledgers of the
     same event. */
  const [queue, setQueue] = useState<Queue[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [pkOpen, setPkOpen] = useState(false);
  const [pkArticle, setPkArticle] = useState("");
  const [pkQty, setPkQty] = useState("");
  const [pkEmp, setPkEmp] = useState("");
  const [pkName, setPkName] = useState("");
  const [pkRate, setPkRate] = useState("");
  const [pkMats, setPkMats] = useState<MatLine[]>([]);
  const [pkNote, setPkNote] = useState("");
  const [pkCheck, setPkCheck] = useState<Record<string, unknown> | null>(null);
  const [pkBusy, setPkBusy] = useState(false);
  const [pkErr, setPkErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [g, r, qd, sd, ed] = await Promise.all([
      supabase.from("v_grn_final").select("*").order("packed_at", { ascending: false }),
      supabase.from("v_ready_to_ship").select("*").order("name"),
      supabase.from("v_packing_queue").select("article_id,code,name,stitched,packed"),
      supabase.from("v_usable_stock").select("item_id,material,unit,usable").gt("usable", 0).order("material"),
      supabase.from("v_factory_employees").select("id,name").order("name"),
    ]);
    setQueue(((qd.data as unknown as Queue[]) ?? []).filter((x) => Number(x.stitched) - Number(x.packed) > 0));
    setStock((sd.data as unknown as Stock[]) ?? []);
    setStaff((ed.data as Staff[]) ?? []);
    if (g.error) setErr(g.error.message);
    setRows((g.data as Row[]) ?? []);
    setReady(((r.data as Ready[]) ?? []).filter((x) => Number(x.in_hand) > 0));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    const day = String(r.packed_at).slice(0, 10);
    if (days !== null) {
      const edge = new Date(); edge.setHours(0, 0, 0, 0);
      edge.setDate(edge.getDate() - (days - 1));
      if (new Date(day) < edge) return false;
    }
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return [r.grn_no, r.article, r.article_code, r.system_barcode, r.manual_barcode, r.worker]
        .some((x) => String(x ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, q, days, from, to]);

  const packed = view.filter((r) => !r.voided_at).reduce((a, r) => a + Number(r.quantity || 0), 0);
  const cost = view.filter((r) => !r.voided_at).reduce((a, r) => a + Number(r.total_cost || 0), 0);
  const inHand = ready.reduce((a, r) => a + Number(r.in_hand || 0), 0);

  async function doShip() {
    if (!supabase || !ship) return;
    setErr("");
    if (!(parseFloat(qty) > 0)) { setErr("How many pieces?"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("transfer_to_warehouse", {
      p_article_id: ship.article_id, p_quantity: parseFloat(qty), p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(data as Record<string, unknown>); load();
  }

  const pkPicked = queue.find((x) => x.article_id === pkArticle);
  const pkAvail = pkPicked ? Number(pkPicked.stitched) - Number(pkPicked.packed) : 0;

  function openPacking() {
    setPkOpen(true); setPkArticle(""); setPkQty(""); setPkEmp(""); setPkName("");
    setPkRate(""); setPkMats([]); setPkNote(""); setPkCheck(null); setPkErr("");
  }

  async function runPacking(dry: boolean) {
    if (!supabase) return;
    setPkErr("");
    if (!pkArticle) { setPkErr("Which article was packed?"); return; }
    if (!(parseFloat(pkQty) > 0)) { setPkErr("How many pieces?"); return; }
    setPkBusy(true);
    const { data, error } = await supabase.rpc("post_packing_job", {
      p_article_id: pkArticle, p_quantity: parseFloat(pkQty),
      p_worker_employee_id: pkEmp || null,
      p_worker_name: pkEmp ? null : (pkName.trim() || null),
      p_rate: pkRate ? parseFloat(pkRate) : 0,
      p_materials: pkMats.filter((m) => m.item_id && parseFloat(m.quantity) > 0)
        .map((m) => ({ item_id: m.item_id, quantity: parseFloat(m.quantity) })),
      p_note: pkNote.trim() || null, p_dry_run: dry,
    });
    setPkBusy(false);
    if (error) { setPkErr(error.message); setPkCheck(null); return; }
    if (dry) { setPkCheck(data as Record<string, unknown>); return; }
    setPkOpen(false); load();
  }

  const table = (): ExportTable => ({
    title: "grn-final-inventory",
    headers: ["GRN", "Date", "Barcode", "Article", "Pieces", "Labour", "Material", "Total", "Per piece", "Worker"],
    rows: view.map((r) => [r.grn_no, when(r.packed_at), r.system_barcode ?? "",
      r.article, r.quantity, r.labour_cost, r.material_cost, r.total_cost,
      r.cost_per_piece ?? "", r.worker ?? ""]),
  });

  return (
    <>
      <Topbar title="GRN — Final Inventory" subtitle="Packed and finished goods, ready for the warehouse" />
      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-success-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Ready to ship</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(inHand)}</p>
            <p className="mt-1 text-[12px] text-ink/60">{ready.length} articles in hand</p>
          </div>
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Packed (filtered)</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{n(packed)}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Finishing cost</p>
            <p className="mt-1.5 text-[32px] font-extrabold leading-none tracking-tight text-ink">{rs(cost)}</p>
          </div>
        </div>

        {/* Ready to ship reads first: it is the question this page is opened
            to answer, and the history is what you check afterwards. */}
        {ready.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="border-b border-line px-4 py-2.5">
              <p className="text-[13px] font-bold text-ink">In hand — packed, not yet sent to the warehouse</p>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <tbody>
                {ready.map((r) => (
                  <tr key={r.article_id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.name}</span>
                      <span className="block font-mono text-[11px] text-hint">{r.system_barcode ?? r.code}</span>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-muted">{r.audience ?? ""}</td>
                    <td className="px-4 py-3 text-right tnum text-[16px] font-extrabold text-ink">{n(r.in_hand)}</td>
                    <td className="px-4 py-3 text-right">
                      {canShip && (
                        <button onClick={() => { setShip(r); setQty(String(r.in_hand)); setNote(""); setDone(null); }}
                          className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white">
                          <Truck size={13} /> Send to warehouse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {[{ l: "All time", d: null }, { l: "Today", d: 1 }, { l: "5 days", d: 5 },
            { l: "This week", d: 7 }, { l: "30 days", d: 30 }].map((r) => (
            <button key={r.l} onClick={() => { setDays(r.d); setFrom(""); setTo(""); }}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${days === r.d && !from && !to ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {r.l}
            </button>
          ))}
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setDays(null); }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          <span className="text-[12px] text-hint">to</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setDays(null); }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GRN, barcode, article…"
            className="w-full max-w-sm rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          {canShip && (
            <button onClick={openPacking} className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
              <Plus size={15} /> New GRN
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><PackageCheck size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">Nothing packed yet</p>
            <p className="mt-1 text-[13px] text-muted">A GRF appears here each time a packing job is recorded.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">GRN</th>
                <th className="px-4 py-3 font-bold">Article</th>
                <th className="px-4 py-3 text-right font-bold">Pieces</th>
                <th className="px-4 py-3 text-right font-bold">Cost</th>
                <th className="px-4 py-3 text-right font-bold">Per piece</th>
                <th className="px-4 py-3 font-bold">Worker</th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} className={`border-b border-line/60 last:border-0 ${r.voided_at ? "opacity-45" : ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12.5px] font-bold text-ink">{r.grn_no}</span>
                      <span className="block text-[11px] text-hint">{when(r.packed_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.article}</span>
                      <span className="block font-mono text-[11px] text-hint">{r.system_barcode ?? r.article_code}</span>
                    </td>
                    <td className="px-4 py-3 text-right tnum text-[15px] font-extrabold text-ink">{n(r.quantity)}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{rs(r.total_cost)}</td>
                    <td className="px-4 py-3 text-right tnum font-semibold text-ink">{r.cost_per_piece == null ? "—" : rs(r.cost_per_piece)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-ink/80">{r.worker ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={pkOpen} onClose={() => setPkOpen(false)} title="New GRN — receive from packing" wide>
        <Field label="Article *">
          <select value={pkArticle} onChange={(e) => { setPkArticle(e.target.value); setPkCheck(null); }} className={inp}>
            <option value="">Choose…</option>
            {queue.map((x) => (
              <option key={x.article_id} value={x.article_id}>
                {x.code} — {x.name} ({n(Number(x.stitched) - Number(x.packed))} waiting)
              </option>
            ))}
          </select>
        </Field>
        {queue.length === 0 && <p className="mt-2 text-[12.5px] text-muted">Nothing is waiting to be packed.</p>}

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Pieces packed *">
            <input type="number" value={pkQty} onChange={(e) => { setPkQty(e.target.value); setPkCheck(null); }}
              className={`${inp} ${pkPicked && parseFloat(pkQty) > pkAvail ? "border-danger" : ""}`} />
          </Field>
          <Field label="Packed by">
            <select value={pkEmp} onChange={(e) => { setPkEmp(e.target.value); setPkCheck(null); }} className={inp}>
              <option value="">Nobody on payroll…</option>
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          {!pkEmp && (
            <Field label="His name *">
              <input value={pkName} onChange={(e) => { setPkName(e.target.value); setPkCheck(null); }} placeholder="casual is fine" className={inp} />
            </Field>
          )}
          <Field label="Rate per piece">
            <input type="number" value={pkRate} onChange={(e) => { setPkRate(e.target.value); setPkCheck(null); }} className={inp} />
          </Field>
        </div>
        {pkPicked && parseFloat(pkQty) > pkAvail && (
          <p className="mt-2 text-[12.5px] text-danger">Only {n(pkAvail)} are stitched and waiting.</p>
        )}

        <div className="mt-4 rounded-xl2 border border-line p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-semibold text-ink">Material used <span className="font-normal text-hint">stickers, shoppers, tape</span></p>
            <button onClick={() => setPkMats((m) => [...m, { item_id: "", quantity: "" }])}
              className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink/70">+ Material</button>
          </div>
          {pkMats.map((m, i) => {
            const it = stock.find((x) => x.item_id === m.item_id);
            const over = it && parseFloat(m.quantity) > Number(it.usable);
            return (
              <div key={i} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <select value={m.item_id} className={inp}
                  onChange={(e) => { setPkMats((x) => x.map((y, j) => j === i ? { ...y, item_id: e.target.value } : y)); setPkCheck(null); }}>
                  <option value="">Material…</option>
                  {stock.map((x) => <option key={x.item_id} value={x.item_id}>{x.material} — {n(x.usable)} {x.unit}</option>)}
                </select>
                <input type="number" value={m.quantity} placeholder="Quantity" className={`${inp} ${over ? "border-danger" : ""}`}
                  onChange={(e) => { setPkMats((x) => x.map((y, j) => j === i ? { ...y, quantity: e.target.value } : y)); setPkCheck(null); }} />
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-hint">{over ? `only ${n(Number(it!.usable))} in stock` : ""}</span>
                  <button onClick={() => setPkMats((x) => x.filter((_, j) => j !== i))} className="ml-auto text-[11px] font-semibold text-danger/70">remove</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3"><Field label="Note (optional)">
          <input value={pkNote} onChange={(e) => setPkNote(e.target.value)} className={inp} />
        </Field></div>

        {pkCheck && (
          <div className="mt-4 rounded-xl2 border border-line bg-panel px-3.5 py-3 text-[12.5px]">
            <p className="flex items-center gap-1.5 font-semibold text-ink"><Check size={14} /> Checks out — nothing written yet.</p>
            <p className="mt-1 text-ink/75">
              {String(pkCheck.worker)} packing {n(Number(pkCheck.pieces))} · labour {rs(Number(pkCheck.labour_cost))} · material {rs(Number(pkCheck.material_cost))}
            </p>
            <p className="mt-1 text-[14px] font-extrabold text-ink">
              {rs(Number(pkCheck.total_cost))} total · {rs(Number(pkCheck.cost_per_piece))} per piece
            </p>
          </div>
        )}
        {pkErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{pkErr}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setPkOpen(false)} disabled={pkBusy} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          {!pkCheck ? (
            <button onClick={() => runPacking(true)} disabled={pkBusy}
              className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {pkBusy && <Loader2 size={15} className="animate-spin" />} Check
            </button>
          ) : (
            <button onClick={() => runPacking(false)} disabled={pkBusy}
              className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {pkBusy && <Loader2 size={15} className="animate-spin" />} Save GRN
            </button>
          )}
        </div>
      </Modal>

      <Modal open={!!ship} onClose={() => { setShip(null); setDone(null); }} title={`Send ${ship?.name ?? ""} to warehouse`}>
        {done ? (
          <div className="text-center">
            <p className="text-[15px] font-semibold text-ink">{n(Number(done.pieces))} pieces sent</p>
            <p className="mt-1.5 font-mono text-[13px] text-ink/70">{String(done.barcode)}</p>
            {done.warehouse_product_created ? (
              <p className="mx-auto mt-3 max-w-xs text-[12.5px] leading-relaxed text-muted">
                This is the first time this article has been sent, so the warehouse product was created against its barcode.
              </p>
            ) : (
              <p className="mt-3 text-[12.5px] text-muted">Added to the existing warehouse stock for this barcode.</p>
            )}
            <p className="mt-2 text-[12.5px] text-ink/70">{n(Number(done.karkhana_left))} still in Karkhana.</p>
            <button onClick={() => { setShip(null); setDone(null); }}
              className="mt-4 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white">Done</button>
          </div>
        ) : (
          <>
            <p className="text-[12.5px] text-muted">
              {n(Number(ship?.in_hand ?? 0))} in hand · barcode <b className="font-mono text-ink">{ship?.system_barcode ?? "—"}</b>
            </p>
            <div className="mt-3"><Field label="How many *">
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus
                className={`${inp} ${ship && parseFloat(qty) > Number(ship.in_hand) ? "border-danger" : ""}`} />
            </Field></div>
            <div className="mt-3"><Field label="Note (optional)">
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} />
            </Field></div>
            {ship && parseFloat(qty) > Number(ship.in_hand) && (
              <p className="mt-2 text-[12.5px] text-danger">That is more than the {n(Number(ship.in_hand))} in hand.</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShip(null)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
              <button onClick={doShip} disabled={busy}
                className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {busy && <Loader2 size={15} className="animate-spin" />} Send
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
