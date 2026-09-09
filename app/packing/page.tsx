"use client";
/* STAMPING · PRESS · PACKING — where a stitched piece becomes a sellable one.
 *
 * The queue is not a list somebody maintains; it is stitched minus packed.
 * Two ledgers, each a plain sum, so the gap between them cannot lie about
 * what is waiting.
 *
 * Packing writes three things at once (K147): pieces leave stitched, the
 * stickers and shoppers leave stock, and the packer's wage is recorded.
 * Nothing here can be typed into a number — the costing comes back from
 * the database so the screen and the ledger can never disagree.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, Loader2, Download, Undo2, Plus, Check } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Queue = { article_id: string; code: string; name: string;
               audience: string | null; garment_type: string | null;
               stitched: number; packed: number; last_off_floor: string | null };
type Job = { id: string; job_no: string; packed_at: string; quantity: number;
             rate: number | null; labour_cost: number; material_cost: number;
             total_cost: number; note: string | null; voided_at: string | null;
             void_reason: string | null; article_code: string; article: string;
             worker: string | null; on_payroll: boolean };
type Stock = { item_id: string; material: string; unit: string; usable: number };
type Staff = { id: string; name: string };
type MatLine = { item_id: string; quantity: string };
type Preview = Record<string, unknown> | null;

const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString();

export default function PackingPage() {
  const { can } = usePermissions();
  const canDo = can(["process.manage"]);

  const [queue, setQueue] = useState<Queue[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [showVoided, setShowVoided] = useState(false);

  const [open, setOpen] = useState(false);
  const [articleId, setArticleId] = useState("");
  const [qty, setQty] = useState("");
  const [empId, setEmpId] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [rate, setRate] = useState("");
  const [mats, setMats] = useState<MatLine[]>([]);
  const [note, setNote] = useState("");
  const [check, setCheck] = useState<Preview>(null);
  const [busy, setBusy] = useState(false);

  const [voidRow, setVoidRow] = useState<string | null>(null);
  const [voidWhy, setVoidWhy] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [qd, jd, sd, ed] = await Promise.all([
      supabase.from("v_packing_queue").select("*"),
      supabase.from("v_packing_jobs").select("*").order("packed_at", { ascending: false }).limit(300),
      supabase.from("v_usable_stock").select("item_id,material,unit,usable").gt("usable", 0).order("material"),
      supabase.from("v_factory_employees").select("id,name").order("name"),
    ]);
    if (qd.error) setErr(qd.error.message);
    setQueue((qd.data as Queue[]) ?? []);
    setJobs((jd.data as Job[]) ?? []);
    setStock((sd.data as unknown as Stock[]) ?? []);
    setStaff((ed.data as Staff[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const inRange = (iso: string) => {
    if (days === null) return true;
    const edge = new Date(); edge.setHours(0, 0, 0, 0);
    edge.setDate(edge.getDate() - (days - 1));
    return new Date(String(iso).slice(0, 10)) >= edge;
  };
  const hit = (...v: (string | null)[]) =>
    !q.trim() || v.some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase()));

  /* Waiting = stitched minus packed. Sorted by whatever is waiting most,
     because that is the question this screen is opened to answer. */
  const waiting = useMemo(() => queue
    .map((r) => ({ ...r, waiting: Number(r.stitched) - Number(r.packed) }))
    .filter((r) => hit(r.code, r.name) && (r.waiting > 0 || Number(r.packed) > 0))
    .sort((a, b) => b.waiting - a.waiting), [queue, q]);

  const jobsView = useMemo(() => jobs.filter((j) =>
    (showVoided || !j.voided_at) && hit(j.job_no, j.article, j.article_code, j.worker) && inRange(j.packed_at)),
    [jobs, q, days, showVoided]);

  const totalWaiting = waiting.reduce((a, r) => a + r.waiting, 0);
  const totalPacked = waiting.reduce((a, r) => a + Number(r.packed), 0);
  const spent = jobsView.filter((j) => !j.voided_at).reduce((a, j) => a + Number(j.total_cost || 0), 0);

  const picked = queue.find((r) => r.article_id === articleId);
  const available = picked ? Number(picked.stitched) - Number(picked.packed) : 0;

  function openForm(a?: Queue) {
    setOpen(true); setArticleId(a?.article_id ?? ""); setQty(""); setEmpId("");
    setWorkerName(""); setRate(""); setMats([]); setNote(""); setCheck(null); setErr("");
  }

  const payload = () => ({
    p_article_id: articleId || null,
    p_quantity: parseFloat(qty) || 0,
    p_worker_employee_id: empId || null,
    p_worker_name: empId ? null : (workerName.trim() || null),
    p_rate: rate ? parseFloat(rate) : 0,
    p_materials: mats.filter((m) => m.item_id && parseFloat(m.quantity) > 0)
      .map((m) => ({ item_id: m.item_id, quantity: parseFloat(m.quantity) })),
    p_note: note.trim() || null,
  });

  async function run(dry: boolean) {
    if (!supabase) return;
    setErr("");
    if (!articleId) { setErr("Which article was packed?"); return; }
    if (!(parseFloat(qty) > 0)) { setErr("How many pieces?"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("post_packing_job", { ...payload(), p_dry_run: dry });
    setBusy(false);
    if (error) { setErr(error.message); setCheck(null); return; }
    if (dry) { setCheck(data as Preview); return; }
    setOpen(false); load();
  }

  async function voidJob(id: string) {
    if (!supabase || !voidWhy.trim()) return;
    const { error } = await supabase.rpc("void_packing_job", { p_id: id, p_reason: voidWhy.trim() });
    if (error) { setErr(error.message); return; }
    setVoidRow(null); setVoidWhy(""); load();
  }

  const table = (): ExportTable => ({
    title: "packing-jobs",
    headers: ["Job", "Date", "Article", "Pieces", "Worker", "Rate", "Labour", "Material", "Total", "Voided"],
    rows: jobsView.map((j) => [j.job_no, when(j.packed_at), `${j.article_code} ${j.article}`,
      j.quantity, j.worker ?? "", j.rate ?? "", j.labour_cost, j.material_cost,
      j.total_cost, j.voided_at ? "yes" : ""]),
  });

  return (
    <>
      <Topbar title="Stamping · Press · Packing" subtitle="Stitched pieces become sellable ones — and what that costs" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Waiting to pack</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{n(totalWaiting)}</p>
            <p className="mt-1 text-[12px] text-ink/60">{waiting.filter((r) => r.waiting > 0).length} articles</p>
          </div>
          <div className="rounded-card bg-success-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Packed and ready</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{n(totalPacked)}</p>
          </div>
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Packing cost</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{rs(spent)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search article or job…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          {[{ l: "All time", d: null }, { l: "Today", d: 1 }, { l: "5 days", d: 5 }, { l: "30 days", d: 30 }].map((r) => (
            <button key={r.l} onClick={() => setDays(r.d)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${days === r.d ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {r.l}
            </button>
          ))}
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          {canDo && (
            <button onClick={() => openForm()} className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
              <Plus size={15} /> Record packing
            </button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {/* ---- the queue ---- */}
        {!loading && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="border-b border-line px-4 py-2.5">
              <p className="text-[13px] font-bold text-ink">Queue — stitched, waiting to be packed</p>
            </div>
            {waiting.length === 0 ? (
              <div className="p-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-panel text-ink"><PackageCheck size={22} /></span>
                <p className="mt-2.5 text-[14px] font-semibold text-ink">Nothing waiting</p>
                <p className="mt-1 text-[12.5px] text-muted">Pieces appear here once they come back from the stitching unit.</p>
              </div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                  <th className="px-4 py-2.5 font-bold">Article</th>
                  <th className="px-4 py-2.5 text-right font-bold">Stitched</th>
                  <th className="px-4 py-2.5 text-right font-bold">Packed</th>
                  <th className="px-4 py-2.5 text-right font-bold">Waiting</th>
                  <th className="px-4 py-2.5"></th>
                </tr></thead>
                <tbody>
                  {waiting.map((r, ix) => (
                    <tr key={r.article_id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-ink">{r.name}</span>
                        <span className="block text-[11px] text-hint">{r.code}{r.audience ? ` · ${r.audience}` : ""}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tnum text-muted">{n(r.stitched)}</td>
                      <td className="px-4 py-2.5 text-right tnum text-muted">{n(r.packed)}</td>
                      <td className={`px-4 py-2.5 text-right tnum text-[16px] font-extrabold ${r.waiting > 0 ? "text-ink" : "text-hint/60"}`}>{n(r.waiting)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {canDo && r.waiting > 0 && (
                          <button onClick={() => openForm(r)}
                            className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white">Pack</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        )}

        {/* ---- history ---- */}
        {!loading && jobs.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-[13px] font-bold text-ink">Packing history</p>
              {jobs.some((j) => j.voided_at) && (
                <button onClick={() => setShowVoided((v) => !v)}
                  className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink/65">
                  {showVoided ? "Hide" : "Show"} voided
                </button>
              )}
            </div>
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-2.5 font-bold">Job</th>
                <th className="px-4 py-2.5 font-bold">Article</th>
                <th className="px-4 py-2.5 font-bold">Worker</th>
                <th className="px-4 py-2.5 text-right font-bold">Pieces</th>
                <th className="px-4 py-2.5 text-right font-bold">Labour</th>
                <th className="px-4 py-2.5 text-right font-bold">Material</th>
                <th className="px-4 py-2.5 text-right font-bold">Total</th>
                <th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody>
                {jobsView.map((j) => (
                  <tr key={j.id} className={`border-b border-line/60 last:border-0 ${j.voided_at ? "opacity-45" : ""}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-ink">{j.job_no}</span>
                      <span className="block text-[11px] text-hint">{when(j.packed_at)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{j.article}
                      <span className="block text-[11px] text-hint">{j.article_code}</span></td>
                    <td className="px-4 py-2.5 text-ink/80">{j.worker ?? "—"}
                      {j.worker && !j.on_payroll && <span className="ml-1 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-semibold text-muted">casual</span>}</td>
                    <td className="px-4 py-2.5 text-right tnum font-bold text-ink">{n(j.quantity)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-muted">{rs(j.labour_cost)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-muted">{rs(j.material_cost)}</td>
                    <td className="px-4 py-2.5 text-right tnum font-bold text-ink">{rs(j.total_cost)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {canDo && !j.voided_at && (voidRow === j.id ? (
                        <span className="flex items-center justify-end gap-1.5">
                          <input value={voidWhy} autoFocus onChange={(e) => setVoidWhy(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") voidJob(j.id); if (e.key === "Escape") setVoidRow(null); }}
                            placeholder="reason" className="w-32 rounded-lg border border-ink/30 px-2 py-1 text-[12px] outline-none" />
                          <button onClick={() => voidJob(j.id)} disabled={!voidWhy.trim()}
                            className="text-[11px] font-bold text-danger disabled:opacity-40">void</button>
                          <button onClick={() => setVoidRow(null)} className="text-[11px] text-ink/50">cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => { setVoidRow(j.id); setVoidWhy(""); }} title="Void — pieces and material go back"
                          className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-danger"><Undo2 size={14} /></button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Record packing" wide>
        <Field label="Article *">
          <select value={articleId} onChange={(e) => { setArticleId(e.target.value); setCheck(null); }} className={inp}>
            <option value="">Choose…</option>
            {queue.filter((r) => Number(r.stitched) - Number(r.packed) > 0).map((r) => (
              <option key={r.article_id} value={r.article_id}>
                {r.code} — {r.name} ({n(Number(r.stitched) - Number(r.packed))} waiting)
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Pieces packed *">
            <input type="number" value={qty} onChange={(e) => { setQty(e.target.value); setCheck(null); }}
              className={`${inp} ${picked && parseFloat(qty) > available ? "border-danger" : ""}`} />
          </Field>
          <Field label="Packed by">
            <select value={empId} onChange={(e) => { setEmpId(e.target.value); setCheck(null); }} className={inp}>
              <option value="">Nobody on payroll…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {!empId && (
            <Field label="His name *">
              <input value={workerName} onChange={(e) => { setWorkerName(e.target.value); setCheck(null); }}
                placeholder="casual is fine" className={inp} />
            </Field>
          )}
          <Field label="Rate per piece">
            <input type="number" value={rate} onChange={(e) => { setRate(e.target.value); setCheck(null); }} className={inp} />
          </Field>
        </div>

        {picked && (
          <p className={`mt-2 text-[12.5px] ${parseFloat(qty) > available ? "text-danger" : "text-ink/70"}`}>
            {n(available)} waiting to be packed{parseFloat(qty) > available ? " — that is more than exists" : ""}.
          </p>
        )}

        {/* Stickers, shoppers and anything else the packing bench uses. The
            database refuses more than is in stock, so the shelf and this
            screen cannot drift apart. */}
        <div className="mt-4 rounded-xl2 border border-line p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-semibold text-ink">Material used <span className="font-normal text-hint">stickers, shoppers, tape</span></p>
            <button onClick={() => setMats((m) => [...m, { item_id: "", quantity: "" }])}
              className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink/70">+ Material</button>
          </div>
          {mats.map((m, i) => {
            const it = stock.find((s) => s.item_id === m.item_id);
            const over = it && parseFloat(m.quantity) > Number(it.usable);
            return (
              <div key={i} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <select value={m.item_id} className={inp}
                  onChange={(e) => { setMats((x) => x.map((y, j) => j === i ? { ...y, item_id: e.target.value } : y)); setCheck(null); }}>
                  <option value="">Material…</option>
                  {stock.map((s) => <option key={s.item_id} value={s.item_id}>{s.material} — {n(s.usable)} {s.unit}</option>)}
                </select>
                <input type="number" value={m.quantity} placeholder="Quantity" className={`${inp} ${over ? "border-danger" : ""}`}
                  onChange={(e) => { setMats((x) => x.map((y, j) => j === i ? { ...y, quantity: e.target.value } : y)); setCheck(null); }} />
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-hint">{over ? `only ${n(Number(it!.usable))} in stock` : ""}</span>
                  <button onClick={() => setMats((x) => x.filter((_, j) => j !== i))}
                    className="ml-auto text-[11px] font-semibold text-danger/70">remove</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3"><Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} />
        </Field></div>

        {check && (
          <div className="mt-4 rounded-xl2 border border-line bg-panel px-3.5 py-3 text-[12.5px]">
            <p className="flex items-center gap-1.5 font-semibold text-ink"><Check size={14} /> Checks out — nothing written yet.</p>
            <p className="mt-1 text-ink/75">
              {String(check.worker)} packing {n(Number(check.pieces))} pieces ·
              labour {rs(Number(check.labour_cost))} · material {rs(Number(check.material_cost))}
            </p>
            <p className="mt-1 text-[14px] font-extrabold text-ink">
              {rs(Number(check.total_cost))} total · {rs(Number(check.cost_per_piece))} per piece
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} disabled={busy}
            className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          {!check ? (
            <button onClick={() => run(true)} disabled={busy}
              className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" />} Check
            </button>
          ) : (
            <button onClick={() => run(false)} disabled={busy}
              className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" />} Save packing
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
