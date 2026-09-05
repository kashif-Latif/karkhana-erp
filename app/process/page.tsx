"use client";
/* PROCESS — one box, not five gates.
 *
 * Cutting, stitching and clipping happen inside here. Which one a shirt is
 * sitting at right now is not tracked, deliberately: what matters is how many
 * of the 450 are still out on the floor and what the floor has earned.
 *
 * The receipt row is the only thing that moves. Recording 14 pieces lowers the
 * pending by 14 AND creates 14 × rate of wage in the same instant, because the
 * wage is summed from receipts rather than stored. Correct a wrong entry and
 * the wage corrects itself.
 */
import { useCallback, useEffect, useState } from "react";
import { Factory, Wallet, Tag, Plus, AlertTriangle, Check } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Row = {
  id: string; assignment_no: string; order_number: string; article_code: string; article: string;
  department: string; department_id: string; supervisor: string | null;
  assigned: number; received: number; rejected: number; pending: number;
  wage_earned: number; wage_unpaid: number; status: string; age_days: number;
};
type Order = { id: string; order_number: string; quantity: number; articles: { code: string; name: string } | null };
type Dept = { id: string; name: string; process_order: number | null };
type Emp = { id: string; name: string };
type Pay = { employee_id: string; employee: string; department: string; pieces: number; earned: number; payable: number };
type Rate = { id: string; rate: number; effective_from: string; departments: { name: string } | null; articles: { code: string } | null };
type Res = Record<string, unknown>;

const TABS = ["Work", "Wages", "Piece rates"] as const;
type Tab = (typeof TABS)[number];
const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";
const rs = (n: number) => "Rs " + Math.round(Number(n) || 0).toLocaleString();
const num = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function ProcessPage() {
  const [tab, setTab] = useState<Tab>("Work");
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [staff, setStaff] = useState<Emp[]>([]);
  const [pay, setPay] = useState<Pay[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [assign, setAssign] = useState(false);
  const [aOrder, setAOrder] = useState(""); const [aDept, setADept] = useState("");
  const [aQty, setAQty] = useState(""); const [aSup, setASup] = useState("");

  const [recv, setRecv] = useState<Row | null>(null);
  const [rQty, setRQty] = useState(""); const [rRej, setRRej] = useState("");
  const [rEmp, setREmp] = useState(""); const [rRate, setRRate] = useState("");

  const [rateOpen, setRateOpen] = useState(false);
  const [pDept, setPDept] = useState(""); const [pRate, setPRate] = useState(""); const [pArticle, setPArticle] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Res | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [w, o, d, e, p, r] = await Promise.all([
      supabase.from("v_process_pending").select("*").order("assigned_at", { ascending: true }),
      supabase.from("production_orders").select("id,order_number,quantity,articles(code,name)").neq("status", "cancelled").order("created_at", { ascending: false }),
      supabase.from("departments").select("id,name,process_order").eq("kind", "section").eq("in_process", true).order("process_order"),
      supabase.from("v_factory_employees").select("id,name,departments!inner(kind)").eq("departments.kind", "section").order("name"),
      supabase.from("v_process_payable").select("*").order("payable", { ascending: false }),
      supabase.from("piece_rates").select("id,rate,effective_from,departments(name),articles(code)").order("effective_from", { ascending: false }),
    ]);
    if (w.error) setErr(w.error.message);
    setRows((w.data as Row[]) ?? []);
    setOrders(((o.data ?? []) as unknown as Record<string, unknown>[]).map((x) => ({
      ...x, articles: Array.isArray(x.articles) ? x.articles[0] ?? null : x.articles,
    })) as Order[]);
    setDepts((d.data as Dept[]) ?? []);
    setStaff((e.data as unknown as Emp[]) ?? []);
    setPay((p.data as Pay[]) ?? []);
    setRates(((r.data ?? []) as unknown as Record<string, unknown>[]).map((x) => ({
      ...x,
      departments: Array.isArray(x.departments) ? x.departments[0] ?? null : x.departments,
      articles: Array.isArray(x.articles) ? x.articles[0] ?? null : x.articles,
    })) as Rate[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(fn: string, args: Record<string, unknown>, after?: () => void) {
    if (!supabase) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setMsg({ ok: false, meaning: error.message }); return; }
    setMsg(data as Res);
    if ((data as Res)?.ok) { await load(); after?.(); }
  }

  const totalOut = rows.reduce((t, r) => t + Number(r.pending || 0), 0);
  const totalOwed = pay.reduce((t, p) => t + Number(p.payable || 0), 0);

  return (
    <>
      <Topbar title="Main Factory Stitching Unit" subtitle="One unit, four floors — what is out and what is owed" />
      <div className="space-y-5 px-6 pb-10">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to see process work.</div>
        ) : (
          <>
            {/* THE UNIT, THEN ITS FLOORS. Pending lives on the unit — the four
                floors are stages inside it, not separate queues, so they carry
                the same pending count rather than inventing four numbers that
                would drift apart. Kashif: "they are all bound to a single
                processing. I should see the pending section as well there." */}
            <div className="rounded-card bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/60">Processing — pieces pending</p>
                  <p className="mt-1 text-[30px] font-extrabold leading-none text-ink">{num(totalOut)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/60">Wages payable</p>
                  <p className="mt-1 text-[18px] font-extrabold text-ink">{rs(totalOwed)}</p>
                  <p className="text-[11px] text-hint">{rows.filter((r) => r.status !== "closed" && r.status !== "complete").length} open assignments</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {["Cutting", "Overlock", "Flatlock", "Singlelock"].map((f) => (
                  <div key={f} className="rounded-xl2 border border-line bg-panel/50 px-3.5 py-3">
                    <p className="text-[13px] font-bold text-ink">{f}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-hint">{num(totalOut)} pending in unit</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {TABS.map((t) => (
                  <button key={t} onClick={() => { setTab(t); setMsg(null); }}
                    className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${tab === t ? "bg-ink text-white" : "bg-surface text-muted hover:bg-panel"}`}>{t}</button>
                ))}
              </div>
              {tab === "Work" && (
                <button onClick={() => { setAssign(true); setMsg(null); }} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
                  <Plus size={15} /> Assign an order
                </button>
              )}
              {tab === "Piece rates" && (
                <button onClick={() => { setRateOpen(true); setMsg(null); }} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
                  <Tag size={15} /> Set a rate
                </button>
              )}
            </div>

            {err && <div className="rounded-xl2 bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{err}</div>}

            {tab === "Work" && (
              <div className="rounded-card bg-surface shadow-card">
                {loading ? <p className="p-5 text-[13px] text-muted">Loading…</p>
                : rows.length === 0 ? <p className="p-5 text-[13px] text-muted">Nothing on the floor. Assign an order to a department to begin.</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-[13px]">
                      <thead className="border-b border-line bg-panel text-[11.5px] uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-5 py-2.5 text-left">Order</th>
                          <th className="px-3 py-2.5 text-left">Floor</th>
                          <th className="px-3 py-2.5 text-right">Given</th>
                          <th className="px-3 py-2.5 text-right">Back</th>
                          <th className="px-3 py-2.5 text-right">Pending</th>
                          <th className="px-3 py-2.5 text-right">Wage</th>
                          <th className="px-3 py-2.5 text-left">Status</th>
                          <th className="px-5 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id} className="border-b border-line/60 last:border-0">
                            <td className="px-5 py-3">
                              <span className="font-semibold text-ink">{r.order_number}</span>
                              <span className="mt-0.5 block text-[11.5px] text-muted">{r.article_code} · {r.article} · {r.age_days}d</span>
                            </td>
                            <td className="px-3 py-3 text-ink/80">{r.department}<span className="block text-[11.5px] text-muted">{r.supervisor ?? "no supervisor"}</span></td>
                            <td className="px-3 py-3 text-right tabular-nums">{num(r.assigned)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-ink/70">{num(r.received)}</td>
                            <td className="px-3 py-3 text-right font-bold tabular-nums text-ink">{num(r.pending)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {rs(r.wage_earned)}
                              {Number(r.wage_unpaid) > 0 && <span className="block text-[11.5px] text-danger">{rs(r.wage_unpaid)} unpaid</span>}
                            </td>
                            <td className="px-3 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                                r.status === "closed" || r.status === "complete" ? "bg-panel text-muted"
                                : r.status === "part done" ? "bg-periwinkle-soft text-ink" : "bg-amber-soft text-ink"}`}>{r.status}</span>
                            </td>
                            <td className="px-5 py-3 text-right">
                              {Number(r.pending) > 0 && (
                                <button onClick={() => { setRecv(r); setRQty(""); setRRej(""); setREmp(""); setRRate(""); setMsg(null); }}
                                  className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white">Receive</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === "Wages" && (
              <div className="rounded-card bg-surface shadow-card">
                {pay.length === 0 ? <p className="p-5 text-[13px] text-muted">Nobody has delivered work yet.</p> : (
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-line bg-panel text-[11.5px] uppercase tracking-wide text-muted">
                      <tr><th className="px-5 py-2.5 text-left">Person</th><th className="px-3 py-2.5 text-left">Floor</th>
                        <th className="px-3 py-2.5 text-right">Pieces</th><th className="px-3 py-2.5 text-right">Earned</th>
                        <th className="px-5 py-2.5 text-right">Payable now</th></tr>
                    </thead>
                    <tbody>
                      {pay.map((p) => (
                        <tr key={p.employee_id + p.department} className="border-b border-line/60 last:border-0">
                          <td className="px-5 py-3 font-semibold text-ink">{p.employee}</td>
                          <td className="px-3 py-3 text-ink/70">{p.department}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{num(p.pieces)}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-muted">{rs(p.earned)}</td>
                          <td className="px-5 py-3 text-right font-bold tabular-nums text-ink">{rs(p.payable)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="px-5 py-3 text-[12px] text-hint">Earned is everything they have ever produced. Payable is what has not been paid yet — both summed from the pieces received, never stored.</p>
              </div>
            )}

            {tab === "Piece rates" && (
              <div className="rounded-card bg-surface shadow-card">
                {rates.length === 0 ? <p className="p-5 text-[13px] text-muted">No rates set. Without one, work is recorded at zero and no wage accrues.</p> : (
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-line bg-panel text-[11.5px] uppercase tracking-wide text-muted">
                      <tr><th className="px-5 py-2.5 text-left">Floor</th><th className="px-3 py-2.5 text-left">Article</th>
                        <th className="px-3 py-2.5 text-right">Per piece</th><th className="px-5 py-2.5 text-left">From</th></tr>
                    </thead>
                    <tbody>
                      {rates.map((r) => (
                        <tr key={r.id} className="border-b border-line/60 last:border-0">
                          <td className="px-5 py-3 font-semibold text-ink">{r.departments?.name ?? "—"}</td>
                          <td className="px-3 py-3 text-ink/70">{r.articles?.code ?? "any article"}</td>
                          <td className="px-3 py-3 text-right font-bold tabular-nums">{rs(r.rate)}</td>
                          <td className="px-5 py-3 text-muted">{r.effective_from}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="px-5 py-3 text-[12px] text-hint">A rate is captured onto each receipt as it is recorded, so raising a rate never restates work already done.</p>
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={assign} onClose={() => setAssign(false)} title="Assign an order to a floor"
        subtitle="The floor owes these pieces back. Nothing else is tracked until they arrive.">
        <div className="space-y-3">
          <Field label="Order">
            <select value={aOrder} onChange={(e) => setAOrder(e.target.value)} className={inp}>
              <option value="">Choose…</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number} — {o.articles?.code} × {o.quantity}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Floor">
              <select value={aDept} onChange={(e) => setADept(e.target.value)} className={inp}>
                <option value="">Choose…</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Pieces"><input value={aQty} onChange={(e) => setAQty(e.target.value)} inputMode="decimal" className={inp} /></Field>
          </div>
          <Field label="Supervisor (optional)">
            <select value={aSup} onChange={(e) => setASup(e.target.value)} className={inp}>
              <option value="">Nobody named…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {msg && <Note msg={msg} />}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setAssign(false)} className="rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
            <button disabled={busy || !aOrder || !aDept || !aQty}
              onClick={() => call("assign_to_process", { p_order_id: aOrder, p_department_id: aDept, p_quantity: parseFloat(aQty), p_supervisor_employee_id: aSup || null }, () => setAssign(false))}
              className="rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">Assign</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!recv} onClose={() => setRecv(null)}
        title={recv ? `Receive from ${recv.department}` : ""}
        subtitle={recv ? `${recv.order_number} · ${num(recv.pending)} still out` : ""}>
        {recv && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pieces good"><input value={rQty} onChange={(e) => setRQty(e.target.value)} inputMode="decimal" className={inp} autoFocus /></Field>
              <Field label="Rejected"><input value={rRej} onChange={(e) => setRRej(e.target.value)} inputMode="decimal" className={inp} /></Field>
            </div>
            <Field label="Who did the work">
              <select value={rEmp} onChange={(e) => setREmp(e.target.value)} className={inp}>
                <option value="">Nobody named…</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Rate override (optional)">
              <input value={rRate} onChange={(e) => setRRate(e.target.value)} inputMode="decimal" placeholder="uses the piece rate" className={inp} />
            </Field>
            {msg && <Note msg={msg} />}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setRecv(null)} className="rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Close</button>
              <button disabled={busy || !rQty}
                onClick={() => call("receive_from_process", {
                  p_assignment_id: recv.id, p_quantity: parseFloat(rQty),
                  p_employee_id: rEmp || null, p_rejected: parseFloat(rRej) || 0,
                  p_rate: rRate ? parseFloat(rRate) : null })}
                className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
                <Factory size={15} /> Record
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={rateOpen} onClose={() => setRateOpen(false)} title="Set a piece rate"
        subtitle="What one piece pays on this floor. Leave the article blank for a rate that covers everything.">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Floor">
              <select value={pDept} onChange={(e) => setPDept(e.target.value)} className={inp}>
                <option value="">Choose…</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Rs per piece"><input value={pRate} onChange={(e) => setPRate(e.target.value)} inputMode="decimal" className={inp} /></Field>
          </div>
          <Field label="Article (optional)">
            <select value={pArticle} onChange={(e) => setPArticle(e.target.value)} className={inp}>
              <option value="">Any article</option>
              {[...new Map(orders.map((o) => [o.articles?.code, o])).values()].filter((o) => o.articles).map((o) => (
                <option key={o.id} value={""}>{o.articles?.code} — {o.articles?.name}</option>
              ))}
            </select>
          </Field>
          {msg && <Note msg={msg} />}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setRateOpen(false)} className="rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
            <button disabled={busy || !pDept || !pRate}
              onClick={() => call("set_piece_rate", { p_department_id: pDept, p_rate: parseFloat(pRate), p_article_id: null }, () => setRateOpen(false))}
              className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
              <Wallet size={15} /> Save rate
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Note({ msg }: { msg: Res }) {
  const ok = msg.ok === true;
  return (
    <div className={`flex items-start gap-2 rounded-xl2 px-3.5 py-2.5 text-[13px] ${ok ? "bg-success-soft text-ink" : "bg-danger-soft text-danger"}`}>
      {ok ? <Check size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
      <span>
        {ok
          ? msg.receipt
            ? `${String(msg.receipt)} — ${String(msg.received)} pieces at ${rs(Number(msg.rate))}, wage ${rs(Number(msg.wage))}. ${String(msg.pending_now)} still out.`
            : msg.assignment ? `${String(msg.assignment)} created — ${String(msg.pending)} pieces pending.` : "Saved."
          : `${msg.guard ? String(msg.guard) + " — " : ""}${String(msg.meaning ?? "Something went wrong.")}`}
      </span>
    </div>
  );
}
