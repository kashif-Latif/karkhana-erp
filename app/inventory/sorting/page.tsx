"use client";
/* SORTING — paying the man who opens the Bora.
 *
 * K130 changed what sorting IS. It used to split a lot into new items and
 * move stock between them; it does neither any more. Stock is unchanged by
 * sorting — 2,500 kg before, 2,500 kg after. What happens physically is that
 * a man opens bales and stacks them into piles so the floor can work faster,
 * and what this screen records is that work and what it cost:
 *
 *   who · how many Bora · how much came out · what he was paid · a note
 *
 * The per-Bora rate (set below, admins only) fills the amount in — 25 Bora at
 * Rs 68 suggests Rs 1,700 — and the amount stays editable, because the agreed
 * rate and what was actually paid on the day are allowed to differ.
 *
 * Nothing on this page can change a stock number. That is not a missing
 * feature; it is the point.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageOpen, Check, Undo2, Download, Pencil, Loader2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";

type Lot = { id: string; lot_number: string; item_label: string; unit: string;
             received_qty: number };
type Opt = { id: string; name: string };
type Job = { id: string; job_number: string; sorted_at: string; lot_number: string;
             material: string; worker: string | null; on_payroll: boolean;
             worker_count: number | null; packages_sorted: number | null; package_unit: string;
             sorted_qty: number; variance_qty: number; labour_cost: number;
             per_package: number | null; per_unit: number | null;
             note: string | null; voided_at: string | null };
type CheckResult = Record<string, unknown> | null;

const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const num = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function SortingPage() {
  const { can } = usePermissions();
  const canSort = can(["inventory.sort"]);
  const canSettings = can(["settings.manage"]);

  const [lots, setLots] = useState<Lot[]>([]);
  const [staff, setStaff] = useState<Opt[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [rate, setRate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  /* the form */
  const [modal, setModal] = useState(false);
  const [lotId, setLotId] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [bora, setBora] = useState("");
  const [workers, setWorkers] = useState("");
  const [labour, setLabour] = useState("");
  const [labourTouched, setLabourTouched] = useState(false);
  const [sortedKg, setSortedKg] = useState("");
  const [wasteKg, setWasteKg] = useState("");
  const [note, setNote] = useState("");
  const [check, setCheck] = useState<CheckResult>(null);
  const [busy, setBusy] = useState(false);

  /* the rate editor */
  const [rateModal, setRateModal] = useState(false);
  const [rateDraft, setRateDraft] = useState("");
  const [rateBusy, setRateBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [l, s, j, r] = await Promise.all([
      supabase.from("v_stock_lots")
        .select("id,lot_number,item_label,unit,received_qty")
        .order("received_at", { ascending: false }),
      supabase.from("employees").select("id,name").eq("is_active", true).order("name"),
      supabase.from("v_sort_history").select("*").order("sorted_at", { ascending: false }),
      supabase.from("factory_settings").select("value").eq("key", "sort_rate_per_bora").maybeSingle(),
    ]);
    if (l.error || s.error || j.error) setErr((l.error || s.error || j.error)!.message);
    setLots((l.data as Lot[]) ?? []);
    setStaff((s.data as Opt[]) ?? []);
    setJobs((j.data as Job[]) ?? []);
    setRate(Number((r.data as { value: unknown } | null)?.value ?? 0));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* Bora × rate suggests the amount; typing your own number wins and stays
     won. The suggestion must never fight the person at the keyboard. */
  useEffect(() => {
    if (labourTouched) return;
    const b = parseInt(bora);
    if (rate > 0 && b > 0) setLabour(String(b * rate));
  }, [bora, rate, labourTouched]);

  function openForm() {
    setModal(true); setLotId(""); setSupervisor(""); setWorkerName("");
    setBora(""); setWorkers(""); setLabour(""); setLabourTouched(false);
    setSortedKg(""); setWasteKg(""); setNote(""); setCheck(null); setErr("");
  }

  const payload = useMemo(() => ({
    p_lot_id: lotId || null,
    p_sorted_at: new Date().toISOString(),
    p_supervisor_employee_id: supervisor || null,
    p_worker_count: workers ? parseInt(workers) : null,
    p_labour_cost: labour ? parseFloat(labour) : 0,
    p_variance_qty: wasteKg ? parseFloat(wasteKg) : 0,
    p_variance_reason: null,
    p_note: note || null,
    /* The kg he separated, recorded ONLY so the per-kg rate can be shown.
       K130's function sums it and moves nothing. */
    p_lines: sortedKg && parseFloat(sortedKg) > 0
      ? [{ quantity: parseFloat(sortedKg) }] : [],
    p_packages_sorted: bora ? parseInt(bora) : null,
    p_worker_name: supervisor ? null : (workerName.trim() || null),
  }), [lotId, supervisor, workerName, bora, workers, labour, sortedKg, wasteKg, note]);

  async function run(dry: boolean) {
    if (!supabase) return;
    setErr("");
    if (!lotId) { setErr("Which delivery did he open? Pick the lot."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("post_sort_job", { ...payload, p_dry_run: dry });
    setBusy(false);
    if (error) { setErr(error.message); setCheck(null); return; }
    if (dry) { setCheck(data as CheckResult); return; }
    setModal(false); load();
  }

  async function voidJob(j: Job) {
    if (!supabase) return;
    const reason = window.prompt(`Remove ${j.job_number}? Give the reason:`);
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc("void_sort_job", { p_job_id: j.id, p_reason: reason.trim() });
    if (error) { setErr(error.message); return; }
    load();
  }

  async function saveRate() {
    if (!supabase) return;
    setRateBusy(true);
    const { error } = await supabase.rpc("set_factory_setting", {
      p_key: "sort_rate_per_bora", p_value: parseFloat(rateDraft) || 0,
    });
    setRateBusy(false);
    if (error) { setErr(error.message); return; }
    setRateModal(false); load();
  }

  /* CSV is built from the rows already on screen, so what you export is
     exactly what you were looking at — no second query that could disagree.
     XLS and PDF need a library added to the project; that is a dependency
     decision, not a page decision, so they arrive as one shared exporter
     for every tab rather than a one-off here. */
  function exportCsv() {
    const head = ["Job", "Date", "Lot", "Material", "Worker", "On payroll",
                  "Bora", "Sorted", "Waste", "Labour Rs", "Per Bora", "Per unit", "Note", "Removed"];
    const rows = jobs.map((j) => [
      j.job_number, new Date(j.sorted_at).toLocaleDateString(), j.lot_number, j.material,
      j.worker ?? "", j.on_payroll ? "yes" : "no", j.packages_sorted ?? "",
      j.sorted_qty ?? "", j.variance_qty ?? "", j.labour_cost,
      j.per_package ?? "", j.per_unit ?? "", j.note ?? "", j.voided_at ? "yes" : "",
    ]);
    const esc = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
    const csv = [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `sorting-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const totalPaid = jobs.filter((j) => !j.voided_at).reduce((a, j) => a + Number(j.labour_cost || 0), 0);
  const totalBora = jobs.filter((j) => !j.voided_at).reduce((a, j) => a + Number(j.packages_sorted || 0), 0);

  return (
    <>
      <Topbar title="Sorting" subtitle="Who opened the Bora, and what it cost — stock is not touched here" />

      <div className="space-y-5 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-hint">Bora opened</p>
            <p className="mt-1.5 text-[22px] font-extrabold tracking-tight text-ink">{totalBora.toLocaleString()}</p>
          </div>
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-hint">Paid for sorting</p>
            <p className="mt-1.5 text-[22px] font-extrabold tracking-tight text-ink">{rs(totalPaid)}</p>
          </div>
          <button
            onClick={() => { if (canSettings) { setRateDraft(String(rate || "")); setRateModal(true); } }}
            disabled={!canSettings}
            className="rounded-card border border-line bg-surface p-4 text-left transition enabled:hover:border-ink/25 disabled:cursor-default"
            title={canSettings ? "Change the rate" : "Only an admin can change the rate"}
          >
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-hint">
              Rate per Bora {canSettings && <Pencil size={11} />}
            </p>
            <p className="mt-1.5 text-[22px] font-extrabold tracking-tight text-ink">
              {rate > 0 ? rs(rate) : <span className="text-[15px] font-semibold text-muted">set your rate</span>}
            </p>
          </button>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ink">Sorting history</h2>
          <div className="flex gap-2">
            <button onClick={exportCsv} disabled={jobs.length === 0}
              className="flex items-center gap-1.5 rounded-xl2 border border-line px-3.5 py-2 text-[12.5px] font-semibold text-ink/80 hover:bg-panel disabled:opacity-40">
              <Download size={14} /> CSV
            </button>
            {canSort && (
              <button onClick={openForm}
                className="flex items-center gap-1.5 rounded-xl2 bg-ink px-4 py-2 text-[12.5px] font-semibold text-white">
                <PackageOpen size={14} /> Record sorting
              </button>
            )}
          </div>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && jobs.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><PackageOpen size={24} /></span>
            <h3 className="mt-4 text-[16px] font-extrabold text-ink">Nothing recorded yet</h3>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
              When a man opens Bora and gets paid, record it here. It is a labour record — stock does not change.
            </p>
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-hint">
                    <th className="px-4 py-2.5 font-bold">Job</th>
                    <th className="px-4 py-2.5 font-bold">Worker</th>
                    <th className="px-4 py-2.5 font-bold">Lot</th>
                    <th className="px-4 py-2.5 text-right font-bold">Bora</th>
                    <th className="px-4 py-2.5 text-right font-bold">Sorted</th>
                    <th className="px-4 py-2.5 text-right font-bold">Paid</th>
                    <th className="px-4 py-2.5 text-right font-bold">Per Bora</th>
                    <th className="px-4 py-2.5 font-bold">Note</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className={`border-b border-line/60 last:border-0 ${j.voided_at ? "opacity-45" : ""}`}>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-ink">{j.job_number}</span>
                        <span className="block text-[11px] text-hint">{new Date(j.sorted_at).toLocaleDateString()}</span>
                      </td>
                      <td className="px-4 py-2.5 text-ink">
                        {j.worker ?? "—"}
                        {j.worker && !j.on_payroll && <span className="ml-1.5 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-semibold text-muted">casual</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{j.lot_number}</td>
                      <td className="px-4 py-2.5 text-right tnum text-ink">{num(j.packages_sorted)}</td>
                      <td className="px-4 py-2.5 text-right tnum text-muted">{num(j.sorted_qty)}</td>
                      <td className="px-4 py-2.5 text-right tnum font-semibold text-ink">{rs(j.labour_cost)}</td>
                      <td className="px-4 py-2.5 text-right tnum text-muted">{j.per_package == null ? "—" : rs(j.per_package)}</td>
                      <td className="max-w-[180px] truncate px-4 py-2.5 text-[12px] text-hint">{j.voided_at ? `removed — ${j.note ?? ""}` : (j.note ?? "")}</td>
                      <td className="px-4 py-2.5 text-right">
                        {canSort && !j.voided_at && (
                          <button onClick={() => voidJob(j)} title="Remove this record"
                            className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-danger">
                            <Undo2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- record a sorting job ---------------- */}
      <Modal open={modal} onClose={() => setModal(false)} title="Record sorting">
        <Field label="Which delivery did he open? *">
          <select value={lotId} onChange={(e) => { setLotId(e.target.value); setCheck(null); }} className={inp}>
            <option value="">Choose the lot…</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lot_number} — {l.item_label} · {num(l.received_qty)} {l.unit}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Supervisor">
            <select value={supervisor} onChange={(e) => { setSupervisor(e.target.value); setCheck(null); }} className={inp}>
              <option value="">Nobody on payroll…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {!supervisor && (
            <Field label="Who did it? *">
              <input value={workerName} onChange={(e) => { setWorkerName(e.target.value); setCheck(null); }}
                placeholder="his name — casual is fine" className={inp} />
            </Field>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Bora opened *">
            <input value={bora} onChange={(e) => { setBora(e.target.value); setCheck(null); }}
              inputMode="numeric" placeholder="25" className={inp} />
          </Field>
          <Field label="Workers">
            <input value={workers} onChange={(e) => { setWorkers(e.target.value); setCheck(null); }}
              inputMode="numeric" className={inp} />
          </Field>
          <Field label={rate > 0 ? `Paid (${rs(rate)}/Bora)` : "Paid"}>
            <input value={labour}
              onChange={(e) => { setLabour(e.target.value); setLabourTouched(true); setCheck(null); }}
              inputMode="decimal" className={inp} />
          </Field>
          <Field label="Kg sorted (opt)">
            <input value={sortedKg} onChange={(e) => { setSortedKg(e.target.value); setCheck(null); }}
              inputMode="decimal" className={inp} />
          </Field>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Kg waste (opt)">
            <input value={wasteKg} onChange={(e) => { setWasteKg(e.target.value); setCheck(null); }}
              inputMode="decimal" className={inp} />
          </Field>
          <Field label="Note (opt)">
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. black pile for orders, light for retail" className={inp} />
          </Field>
        </div>

        {check && (
          <div className="mt-4 rounded-xl2 border border-line bg-panel px-3.5 py-3 text-[12.5px]">
            <p className="flex items-center gap-1.5 font-semibold text-ink"><Check size={14} /> Checks out — nothing written yet.</p>
            <p className="mt-1 text-ink/75">
              {String(check.worker)} · {String(check.packages ?? "?")} Bora · {rs(Number(check.labour_cost))}
              {check.per_package != null && ` — ${rs(Number(check.per_package))} per Bora`}
              {check.per_unit != null && `, ${rs(Number(check.per_unit))} per kg`}.
            </p>
            <p className="mt-1 text-[11.5px] text-hint">Stock is not changed by this. It is a labour record.</p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModal(false)} disabled={busy}
            className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
          {!check ? (
            <button onClick={() => run(true)} disabled={busy}
              className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" />} Check
            </button>
          ) : (
            <button onClick={() => run(false)} disabled={busy}
              className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" />} Save
            </button>
          )}
        </div>
      </Modal>

      {/* ---------------- the per-Bora rate ---------------- */}
      <Modal open={rateModal} onClose={() => setRateModal(false)} title="Rate per Bora">
        <Field label="What one opened Bora pays, in rupees">
          <input value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} inputMode="decimal"
            placeholder="e.g. 68" className={inp} autoFocus />
        </Field>
        <p className="mt-2 text-[12px] leading-relaxed text-hint">
          This fills the Paid box in automatically — Bora × rate — and stays editable on each job,
          because the agreed rate and what was paid on the day are allowed to differ.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setRateModal(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
          <button onClick={saveRate} disabled={rateBusy}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {rateBusy && <Loader2 size={15} className="animate-spin" />} Save rate
          </button>
        </div>
      </Modal>
    </>
  );
}
