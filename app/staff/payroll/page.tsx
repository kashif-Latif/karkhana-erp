"use client";
/* STAFF PAYROLL — earned, paid, and what is still owed, per person.
 *
 * Induction is about who someone is. This is about what they are owed. Two
 * screens because they are opened for different reasons: one when a man
 * starts, the other when he asks for his money.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, Download, Printer, Loader2 } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, printTable, type ExportTable } from "@/lib/export";

type Row = { id: string; code: string; name: string; phone: string | null;
             is_active: boolean; join_date: string | null; dept_code: string | null;
             department: string | null; side: string; entries: number; pieces: number;
             earned: number; paid: number; pending: number; last_worked: string | null };

const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();

export default function PayrollPage() {
  const { can } = usePermissions();
  const canPay = can(["process.manage", "production.entry"]);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [side, setSide] = useState("all");
  const [only, setOnly] = useState<"all" | "owed">("owed");
  const [payFor, setPayFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("v_staff_payroll").select("*").order("name");
    if (error) setErr(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    if (side !== "all" && r.side !== side) return false;
    if (only === "owed" && Number(r.pending || 0) <= 0) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [r.name, r.code, r.department].some((x) => String(x ?? "").toLowerCase().includes(t));
  }).sort((a, b) => Number(b.pending) - Number(a.pending)), [rows, q, side, only]);

  const owed = view.reduce((a, r) => a + Number(r.pending || 0), 0);
  const earned = view.reduce((a, r) => a + Number(r.earned || 0), 0);

  async function settle(name: string) {
    if (!supabase) return;
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("pay_machine_process", {
      p_worker_name: name, p_process: null, p_from: null, p_to: null, p_note: null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPayFor(null); load();
  }

  const table = (): ExportTable => ({
    title: "Staff Payroll",
    headers: ["Employee ID", "Name", "Side", "Department", "Entries", "Pieces",
              "Earned", "Paid", "Pending", "Last worked"],
    rows: view.map((r) => [r.code, r.name, r.side, r.department ?? "",
      r.entries || "", r.pieces || "", r.earned || "", r.paid || "",
      r.pending || "", r.last_worked ?? ""]),
  });

  return (
    <>
      <Topbar title="Staff Payroll" subtitle="Earned, paid, and what is still owed" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-amber-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Owed right now</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{rs(owed)}</p>
            <p className="mt-1 text-[12px] text-ink/60">{view.filter((r) => Number(r.pending) > 0).length} people</p>
          </div>
          <div className="rounded-card bg-success-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">Earned in total</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{rs(earned)}</p>
          </div>
          <div className="rounded-card bg-periwinkle-soft p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink/55">People</p>
            <p className="mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">{view.length}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or employee ID…"
            className="w-full max-w-xs rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <select value={side} onChange={(e) => setSide(e.target.value)}
            className="rounded-full border border-line bg-surface px-3 py-2 text-[12px] outline-none">
            <option value="all">Both sides</option>
            <option value="factory">Factory · FT</option>
            <option value="warehouse">Warehouse · WR</option>
          </select>
          <button onClick={() => setOnly(only === "owed" ? "all" : "owed")}
            className={`rounded-full px-3 py-2 text-[12px] font-semibold transition ${only === "owed" ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
            {only === "owed" ? "Only who is owed" : "Everyone"}
          </button>
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <button onClick={() => printTable(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Printer size={13} /> Print</button>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Wallet size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">
              {only === "owed" ? "Nobody is owed anything" : "No staff yet"}
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {only === "owed"
                ? "Every recorded job has been settled. Switch to Everyone to see the full list."
                : "Add people under New staff induction."}
            </p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">Employee</th>
                <th className="px-4 py-3 font-bold">Department</th>
                <th className="px-4 py-3 text-right font-bold">Pieces</th>
                <th className="px-4 py-3 text-right font-bold">Earned</th>
                <th className="px-4 py-3 text-right font-bold">Paid</th>
                <th className="px-4 py-3 text-right font-bold">Pending</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} className={`border-b border-line/60 last:border-0 ${r.is_active ? "" : "opacity-55"} ${ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{r.name}</span>
                      <span className="block font-mono text-[11px] text-hint">
                        {r.code}{r.last_worked ? ` · last worked ${r.last_worked}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink/80">{r.department ?? "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{r.pieces ? n(r.pieces) : "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{r.earned ? rs(r.earned) : "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{r.paid ? rs(r.paid) : "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-[16px] font-extrabold text-ink">
                      {r.pending ? rs(r.pending) : <span className="text-[12.5px] font-semibold text-[#166534]">settled</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canPay && Number(r.pending) > 0 && (payFor === r.name ? (
                        <span className="flex items-center justify-end gap-1.5">
                          <button onClick={() => settle(r.name)} disabled={busy}
                            className="flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50">
                            {busy && <Loader2 size={12} className="animate-spin" />} pay {rs(r.pending)}
                          </button>
                          <button onClick={() => setPayFor(null)} className="text-[11px] text-ink/50">no</button>
                        </span>
                      ) : (
                        <button onClick={() => setPayFor(r.name)}
                          className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink/75 hover:bg-panel">Settle</button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>
    </>
  );
}
