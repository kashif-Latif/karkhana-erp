"use client";
/* SORTING — turning a bulk lot into the colours it actually contains.
 *
 * A lot is a receipt line of material that arrived without an attribute its
 * own material requires: 500 kg of fabric in sealed cartons, colour unknown,
 * paid for at the gate. Days later a supervisor opens the cartons, weighs each
 * colour, and this screen records what came out.
 *
 * NOTHING IS WRITTEN UNTIL THE NUMBERS AGREE. Check runs the same function in
 * dry-run mode and shows exactly what would happen — sorted, lost, value, what
 * the lot would have left. Record then commits it. Same two-step the courier
 * settlement import uses, for the same reason: a wrong weight here silently
 * turns into wrong stock and a wrong cost per garment months later.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Scale, AlertTriangle, Plus, Trash2, Check, Lock, Undo2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Lot = {
  id: string; lot_number: string; grn_number: string; supplier: string | null;
  item_label: string; unit: string; received_qty: number; rate: number;
  sorted_qty: number; variance_qty: number; remaining_qty: number;
  labour_cost: number; job_count: number; status: string; age_days: number;
};
type Opt = { id: string; name: string };
type OutLine = { category_id: string; color_id: string; size_id: string; quantity: string };
type Job = {
  id: string; job_number: string; sorted_at: string; worker_count: number | null;
  labour_cost: number; variance_qty: number; variance_reason: string | null;
  voided_at: string | null; void_reason: string | null;
  employees: { name: string } | null;
};
type Check = Record<string, unknown>;

const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString();
const kg = (n: number, u: string) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${u}`;

export default function SortingPage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [cats, setCats] = useState<Opt[]>([]);
  const [colors, setColors] = useState<Opt[]>([]);
  const [sizes, setSizes] = useState<Opt[]>([]);
  const [staff, setStaff] = useState<Opt[]>([]);
  const [group, setGroup] = useState<{ has_category: boolean; has_color: boolean; has_size: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const [open, setOpen] = useState<Lot | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [lines, setLines] = useState<OutLine[]>([{ category_id: "", color_id: "", size_id: "", quantity: "" }]);
  const [supervisor, setSupervisor] = useState("");
  const [workers, setWorkers] = useState("");
  const [labour, setLabour] = useState("");
  const [variance, setVariance] = useState("");
  const [varReason, setVarReason] = useState("");
  const [note, setNote] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [l, c, co, sz, e] = await Promise.all([
      supabase.from("v_stock_lots").select("*").eq("needs_sorting", true).order("received_at", { ascending: true }),
      supabase.from("material_categories").select("id,name").order("name"),
      supabase.from("colors").select("id,name").order("name"),
      supabase.from("sizes").select("id,name").order("name"),
      /* Only factory floors. `employees` is shared — the Hub's seven people live
         in the same table (0093), and a sorting supervisor is never one of them. */
      supabase.from("employees").select("id,name,departments!inner(kind)")
        .eq("is_active", true).eq("departments.kind", "section").order("name"),
    ]);
    if (l.error) setErr(l.error.message);
    setLots((l.data as Lot[]) ?? []);
    setCats((c.data as Opt[]) ?? []); setColors((co.data as Opt[]) ?? []);
    setSizes((sz.data as Opt[]) ?? []); setStaff((e.data as Opt[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => lots.filter((l) => (showClosed ? true : l.status !== "closed")),
    [lots, showClosed]
  );
  const awaiting = lots.filter((l) => l.status !== "closed");
  const tiedUp = awaiting.reduce((t, l) => t + Number(l.remaining_qty) * Number(l.rate), 0);

  async function openLot(lot: Lot) {
    setOpen(lot); setCheck(null); setFormErr("");
    setLines([{ category_id: "", color_id: "", size_id: "", quantity: "" }]);
    setSupervisor(""); setWorkers(""); setLabour(""); setVariance(""); setVarReason(""); setNote("");
    if (!supabase) return;
    const [g, j] = await Promise.all([
      supabase.from("material_groups").select("has_category,has_color,has_size").eq("id", (lot as unknown as { group_id: string }).group_id).maybeSingle(),
      supabase.from("sort_jobs").select("id,job_number,sorted_at,worker_count,labour_cost,variance_qty,variance_reason,voided_at,void_reason,employees(name)")
        .eq("lot_id", lot.id).order("sorted_at"),
    ]);
    setGroup((g.data as typeof group) ?? null);
    setJobs(((j.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      ...r, employees: Array.isArray(r.employees) ? r.employees[0] ?? null : r.employees,
    })) as Job[]);
  }

  const payload = useCallback((dry: boolean) => ({
    p_lot_id: open?.id,
    p_sorted_at: new Date().toISOString(),
    p_supervisor_employee_id: supervisor || null,
    p_worker_count: workers ? parseInt(workers) : null,
    p_labour_cost: parseFloat(labour) || 0,
    p_variance_qty: parseFloat(variance) || 0,
    p_variance_reason: varReason || null,
    p_note: note || null,
    p_lines: lines
      .filter((l) => parseFloat(l.quantity) > 0)
      .map((l) => ({
        category_id: l.category_id || null, color_id: l.color_id || null,
        size_id: l.size_id || null, quantity: parseFloat(l.quantity),
      })),
    p_dry_run: dry,
  }), [open, supervisor, workers, labour, variance, varReason, note, lines]);

  async function run(dry: boolean) {
    if (!supabase || !open) return;
    setBusy(true); setFormErr("");
    const { data, error } = await supabase.rpc("post_sort_job", payload(dry));
    setBusy(false);
    if (error) { setFormErr(error.message); return; }
    const res = data as Check;
    setCheck(res);
    if (!dry && res.ok) { await load(); await openLot(open); setCheck(res); }
  }

  /* A session can be undone while its output is still on the shelf. The
     database refuses once any of it has been issued, and says which
     material and how much is left — so the message is shown as-is rather
     than replaced with something vaguer. */
  async function undo(job: Job) {
    if (!supabase || !open) return;
    const why = window.prompt(`Undo ${job.job_number}? The material goes back into the lot.\n\nWhy?`);
    if (!why || !why.trim()) return;
    setBusy(true); setFormErr(""); setCheck(null);
    const { data, error } = await supabase.rpc("void_sort_job", { p_job_id: job.id, p_reason: why.trim() });
    setBusy(false);
    if (error) { setFormErr(error.message); return; }
    const r = data as Record<string, unknown>;
    await load();
    const fresh = (await supabase.from("v_stock_lots").select("*").eq("id", open.id).maybeSingle()).data as Lot | null;
    if (fresh) await openLot(fresh);
    setFormErr(`${String(r.job)} undone — ${String(r.returned_to_lot)} ${open.unit} back in the lot.`);
  }

  const entered = lines.reduce((t, l) => t + (parseFloat(l.quantity) || 0), 0) + (parseFloat(variance) || 0);
  const overBy = open ? entered - Number(open.remaining_qty) : 0;
  const passed = !!check && check.ok === true && check.dry_run === true;

  return (
    <>
      <Topbar title="Sorting" subtitle="Bulk material waiting to be split into what it actually is" />
      <div className="space-y-5 px-6 pb-10">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to see lots.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-card bg-amber-soft p-4 shadow-soft">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/60">Lots open</p>
                <p className="mt-1 text-[22px] font-extrabold text-ink">{awaiting.length}</p>
              </div>
              <div className="rounded-card bg-periwinkle-soft p-4 shadow-soft">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/60">Value not yet identified</p>
                <p className="mt-1 text-[22px] font-extrabold text-ink">{rs(tiedUp)}</p>
              </div>
              <div className="rounded-card bg-salmon-soft p-4 shadow-soft">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/60">Oldest waiting</p>
                <p className="mt-1 text-[22px] font-extrabold text-ink">
                  {awaiting.length ? `${Math.max(...awaiting.map((l) => l.age_days))} days` : "—"}
                </p>
              </div>
            </div>

            {err && <div className="rounded-xl2 bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{err}</div>}

            <div className="rounded-card bg-surface shadow-card">
              <div className="flex items-center justify-between px-5 py-4">
                <h3 className="text-[14px] font-extrabold text-ink">Lots</h3>
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
                  <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="h-3.5 w-3.5 accent-[#141414]" />
                  Show closed
                </label>
              </div>
              {loading ? (
                <p className="px-5 pb-5 text-[13px] text-muted">Loading…</p>
              ) : visible.length === 0 ? (
                <p className="px-5 pb-5 text-[13px] text-muted">
                  Nothing waiting. Every receipt gets a batch number, but only batches received without a colour, category or size appear here — the rest arrive already identified.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[13px]">
                    <thead className="border-y border-line bg-panel text-[11.5px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-5 py-2.5 text-left">Lot</th>
                        <th className="px-3 py-2.5 text-left">Material</th>
                        <th className="px-3 py-2.5 text-right">Received</th>
                        <th className="px-3 py-2.5 text-right">Sorted</th>
                        <th className="px-3 py-2.5 text-right">Lost</th>
                        <th className="px-3 py-2.5 text-right">Left</th>
                        <th className="px-3 py-2.5 text-left">Status</th>
                        <th className="px-5 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((l) => (
                        <tr key={l.id} className="border-b border-line/60 last:border-0">
                          <td className="px-5 py-3">
                            <span className="font-semibold text-ink">{l.lot_number}</span>
                            <span className="mt-0.5 block text-[11.5px] text-muted">{l.grn_number} · {l.supplier ?? "—"} · {l.age_days}d</span>
                          </td>
                          <td className="px-3 py-3 text-ink/80">{l.item_label}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{kg(l.received_qty, l.unit)}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-ink/70">{kg(l.sorted_qty, l.unit)}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-ink/70">{Number(l.variance_qty) > 0 ? kg(l.variance_qty, l.unit) : "—"}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{kg(l.remaining_qty, l.unit)}</td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                              l.status === "closed" ? "bg-panel text-muted"
                              : l.status === "part sorted" ? "bg-periwinkle-soft text-ink"
                              : "bg-amber-soft text-ink"}`}>{l.status}</span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {l.status !== "closed" && (
                              <button onClick={() => openLot(l)} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white">Sort</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} wide
        title={open ? `Sort ${open.lot_number}` : ""}
        subtitle={open ? `${open.item_label} · ${kg(open.remaining_qty, open.unit)} left of ${kg(open.received_qty, open.unit)} at ${rs(open.rate)}/${open.unit}` : ""}>
        {open && (
          <div className="space-y-4">
            {jobs.length > 0 && (
              <div className="rounded-xl2 bg-canvas p-3.5">
                <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Earlier sessions</p>
                {jobs.map((j) => (
                  <div key={j.id} className="flex items-start justify-between gap-3 py-0.5">
                    <p className={`text-[12.5px] ${j.voided_at ? "text-muted line-through" : "text-ink/75"}`}>
                      {j.job_number} · {new Date(j.sorted_at).toLocaleDateString()} · {j.employees?.name ?? "no supervisor"}
                      {Number(j.variance_qty) > 0 && ` · lost ${j.variance_qty} (${j.variance_reason ?? "no reason given"})`}
                    </p>
                    {j.voided_at ? (
                      <span className="shrink-0 text-[11.5px] font-semibold text-muted">undone — {j.void_reason}</span>
                    ) : (
                      <button onClick={() => undo(j)} disabled={busy}
                        className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink/70 hover:bg-panel disabled:opacity-40">
                        <Undo2 size={12} /> Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Supervisor">
                <select value={supervisor} onChange={(e) => { setSupervisor(e.target.value); setCheck(null); }} className={inp}>
                  <option value="">Nobody named…</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Workers"><input value={workers} onChange={(e) => { setWorkers(e.target.value); setCheck(null); }} inputMode="numeric" className={inp} /></Field>
              <Field label="Labour paid"><input value={labour} onChange={(e) => { setLabour(e.target.value); setCheck(null); }} inputMode="decimal" className={inp} /></Field>
              <Field label={`Lost (${open.unit})`}><input value={variance} onChange={(e) => { setVariance(e.target.value); setCheck(null); }} inputMode="decimal" className={inp} /></Field>
            </div>
            {parseFloat(variance) > 0 && (
              <Field label="Why was it lost?">
                <input value={varReason} onChange={(e) => { setVarReason(e.target.value); setCheck(null); }} placeholder="dust, offcuts, torn edges…" className={inp} />
              </Field>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-extrabold text-ink">What came out</p>
                <button onClick={() => { setLines((l) => [...l, { category_id: "", color_id: "", size_id: "", quantity: "" }]); setCheck(null); }}
                  className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel">
                  <Plus size={14} /> Add
                </button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-end gap-2 rounded-xl2 border border-line bg-canvas/60 p-2.5">
                    {group?.has_category && (
                      <select value={l.category_id} onChange={(e) => { setLines((ls) => ls.map((x, j) => j === i ? { ...x, category_id: e.target.value } : x)); setCheck(null); }} className={inp}>
                        <option value="">Category…</option>
                        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    {group?.has_color && (
                      <select value={l.color_id} onChange={(e) => { setLines((ls) => ls.map((x, j) => j === i ? { ...x, color_id: e.target.value } : x)); setCheck(null); }} className={inp}>
                        <option value="">Colour…</option>
                        {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    {group?.has_size && (
                      <select value={l.size_id} onChange={(e) => { setLines((ls) => ls.map((x, j) => j === i ? { ...x, size_id: e.target.value } : x)); setCheck(null); }} className={inp}>
                        <option value="">Size…</option>
                        {sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                    <input value={l.quantity} onChange={(e) => { setLines((ls) => ls.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x)); setCheck(null); }}
                      inputMode="decimal" placeholder={open.unit} className={`${inp} max-w-[110px]`} />
                    <button onClick={() => { setLines((ls) => ls.length === 1 ? ls : ls.filter((_, j) => j !== i)); setCheck(null); }}
                      disabled={lines.length === 1} className="rounded-full p-2 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30"><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className={`flex items-center justify-between rounded-xl2 px-3.5 py-2.5 text-[13px] ${
              overBy > 0.0005 ? "bg-danger-soft text-danger" : "bg-canvas text-ink/75"}`}>
              <span className="flex items-center gap-2">
                <Scale size={15} />
                Entered {kg(entered, open.unit)} against {kg(open.remaining_qty, open.unit)} left
              </span>
              {overBy > 0.0005 && <span className="font-semibold">over by {kg(overBy, open.unit)}</span>}
            </div>

            {formErr && (
              <div className="flex items-start gap-2 rounded-xl2 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />{formErr}
              </div>
            )}

            {check && (
              <div className={`rounded-xl2 px-3.5 py-3 text-[13px] ${check.ok ? "bg-success-soft text-ink" : "bg-danger-soft text-danger"}`}>
                {check.ok ? (
                  check.dry_run ? (
                    <>
                      <p className="font-semibold">Checks out — nothing written yet.</p>
                      <p className="mt-1 text-ink/75">
                        {String(check.sorted)} {open.unit} sorted worth {rs(Number(check.sorted_value))}
                        {Number(check.variance) > 0 && `, ${String(check.variance)} ${open.unit} lost costing ${rs(Number(check.variance_cost))} (${String(check.variance_pct)}%)`}
                        . {String(check.remaining_after)} {open.unit} would remain{check.closes_lot ? ", closing the lot" : ""}.
                      </p>
                    </>
                  ) : (
                    <p className="font-semibold">Recorded as {String(check.job)}. {String(check.remaining_after)} {open.unit} left{check.lot_closed ? " — lot closed." : "."}</p>
                  )
                ) : (
                  <>
                    <p className="font-semibold">{String(check.guard)} — nothing was written.</p>
                    <p className="mt-1">{String(check.meaning)}</p>
                  </>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button onClick={() => setOpen(null)} className="rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Close</button>
              <button onClick={() => run(true)} disabled={busy}
                className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold text-ink hover:bg-panel disabled:opacity-40">
                <Layers size={15} /> {busy ? "Checking…" : "Check"}
              </button>
              <button onClick={() => run(false)} disabled={busy || !passed}
                title={passed ? "" : "Run Check first"}
                className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
                {passed ? <Check size={15} /> : <Lock size={15} />} Record
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
