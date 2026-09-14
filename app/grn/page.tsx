"use client";
/* GRN — one screen, three divisions that never mix.
 *
 *   Fabric     cloth only, with its own categories
 *   Other      sticker · shopper · zip · thread
 *   Finished   goods made and fully ready
 *
 * The division lives on the material (K150), so a fabric GRN cannot offer a
 * sticker and an other-materials GRN cannot offer cloth. That separation is
 * the whole point: two kinds of stock that look alike on a shelf but are
 * bought, priced and consumed completely differently.
 */
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Boxes, Layers, PackageCheck, Download, Plus } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Grn = { id: string; grn_number: string; kind: string; received_at: string;
             total: number | null; note: string | null; status: string | null;
             supplier: string | null; lines: number; quantity: number;
             categories: string | null };
type Line = { id: string; item_id: string; item_code: string; material: string; category: string | null;
              colour: string | null; size: string | null; unit: string;
              quantity: number; rate: number | null; line_total: number };
type Kind = "fabric" | "other" | "finished";

const DIVISIONS: { k: Kind; label: string; sub: string; Icon: typeof Boxes; tone: string }[] = [
  { k: "fabric",   label: "Fabric",          sub: "cloth, by category",            Icon: Layers,       tone: "bg-periwinkle-soft" },
  { k: "other",    label: "Other materials", sub: "sticker · shopper · zip · thread", Icon: Boxes,     tone: "bg-amber-soft" },
  { k: "finished", label: "Market goods",  sub: "made and fully ready",          Icon: PackageCheck, tone: "bg-success-soft" },
];

const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const rs = (v: number) => "Rs " + Math.round(Number(v) || 0).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString();

function GrnInner() {
  /* Coming back from a receipt, land on the division just received rather
     than snapping back to fabric. */
  const urlKind = useSearchParams().get("kind");
  const [kind, setKind] = useState<Kind>(
    urlKind === "other" || urlKind === "finished" ? urlKind : "fabric");
  const [rows, setRows] = useState<Grn[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  /* Opening a GRN shows what is in it — the question the list cannot answer. */
  const [openGrn, setOpenGrn] = useState<Grn | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [linesBusy, setLinesBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [voidWhy, setVoidWhy] = useState("");
  const [killOpen, setKillOpen] = useState(false);
  /* edit_grn replaces the whole receipt in one call — supplier, date, freight,
     discount and every line — so a half-edited GRN cannot exist. */
  const [editing, setEditing] = useState(false);
  const [eLines, setELines] = useState<Line[]>([]);
  const [eNote, setENote] = useState("");
  const [eBusy, setEBusy] = useState(false);
  /* edit_grn REPLACES the receipt, so anything not sent is wiped. The header
     fields must be read back and passed through unchanged, or editing a
     quantity would silently erase the supplier, the freight and the discount. */
  const [hdr, setHdr] = useState<{ supplier_id: string | null; freight: number | null;
                                   discount: number | null } | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("v_grn_in").select("*")
      .order("received_at", { ascending: false });
    if (error) setErr(error.message);
    setRows((data as Grn[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* Arriving from a report with ?open=<id> lands straight on that receipt. */
  const openId = useSearchParams().get("open");
  useEffect(() => {
    if (!openId || rows.length === 0) return;
    const g = rows.find((r) => r.id === openId);
    if (g) openDetail(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, rows]);

  async function openDetail(g: Grn) {
    if ((window.getSelection()?.toString() ?? "").length > 0) return;
    setOpenGrn(g); setLines([]); setLinesBusy(true); setDelOpen(false); setVoidWhy(""); setErr(""); setEditing(false); setHdr(null); setKillOpen(false);
    const [ln, hd] = await Promise.all([
      supabase!.from("v_grn_lines").select("*").eq("grn_id", g.id),
      supabase!.from("grns").select("supplier_id,freight,discount").eq("id", g.id).single(),
    ]);
    setLines((ln.data as unknown as Line[]) ?? []);
    const h = hd.data as Record<string, unknown> | null;
    setHdr(h ? {
      supplier_id: (h.supplier_id as string) ?? null,
      freight: h.freight == null ? null : Number(h.freight),
      discount: h.discount == null ? null : Number(h.discount),
    } : null);
    setLinesBusy(false);
  }

  function startEdit() {
    if (!openGrn) return;
    setEditing(true); setELines(lines.map((l) => ({ ...l })));
    setENote(openGrn.note ?? ""); setErr("");
  }

  async function saveEdit() {
    if (!supabase || !openGrn) return;
    if (!hdr) { setErr("Still loading this receipt — try again in a moment."); return; }
    setEBusy(true); setErr("");
    const { error } = await supabase.rpc("edit_grn", {
      p_grn_id: openGrn.id,
      p_supplier_id: hdr?.supplier_id ?? null,
      p_received_at: openGrn.received_at,
      p_freight: hdr?.freight ?? null,
      p_discount: hdr?.discount ?? null,
      p_note: eNote.trim() || null,
      p_lines: eLines.filter((l) => Number(l.quantity) > 0).map((l) => ({
        item_id: l.item_id, quantity: Number(l.quantity), rate: l.rate == null ? null : Number(l.rate),
      })),
    });
    setEBusy(false);
    if (error) { setErr(error.message); return; }
    setEditing(false); setOpenGrn(null); load();
  }

  async function deleteGrn() {
    if (!supabase || !openGrn) return;
    const { error } = await supabase.rpc("delete_grn", { p_grn_id: openGrn.id });
    if (error) {
      /* Show what the database actually said. Replacing it with a guess about
         stock sent Kashif hunting a problem that did not exist — the real
         refusal was a permission one. */
      setErr(error.message);
      return;
    }
    setOpenGrn(null); load();
  }

  async function voidGrn() {
    if (!supabase || !openGrn) return;
    if (!voidWhy.trim()) { setErr("Give a reason for voiding."); return; }
    const { error } = await supabase.rpc("void_grn", {
      p_grn_id: openGrn.id, p_reason: voidWhy.trim(),
    });
    if (error) { setErr(error.message); return; }
    setOpenGrn(null); load();
  }

  const counts = useMemo(() => ({
    fabric: rows.filter((r) => r.kind === "fabric").length,
    other: rows.filter((r) => r.kind === "other").length,
    finished: rows.filter((r) => r.kind === "finished").length,
  }), [rows]);

  const cats = useMemo(() => {
    const set = new Set<string>();
    rows.filter((r) => r.kind === kind).forEach((r) =>
      String(r.categories ?? "").split(" · ").filter(Boolean).forEach((c) => set.add(c)));
    return [...set].sort();
  }, [rows, kind]);

  const view = useMemo(() => rows.filter((r) => {
    if (r.kind !== kind) return false;
    if (cat !== "all" && !String(r.categories ?? "").split(" · ").includes(cat)) return false;
    const day = String(r.received_at).slice(0, 10);
    if (days !== null) {
      const edge = new Date(); edge.setHours(0, 0, 0, 0);
      edge.setDate(edge.getDate() - (days - 1));
      if (new Date(day) < edge) return false;
    }
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      return [r.grn_number, r.supplier, r.note].some((x) => String(x ?? "").toLowerCase().includes(t));
    }
    return true;
  }), [rows, kind, q, days, from, to, cat]);

  const value = view.reduce((a, r) => a + Number(r.total || 0), 0);
  const qty = view.reduce((a, r) => a + Number(r.quantity || 0), 0);
  const current = DIVISIONS.find((d) => d.k === kind)!;

  const table = (): ExportTable => ({
    title: `grn-in-${kind}`,
    headers: ["GRN", "Date", "Supplier", "Lines", "Quantity", "Value", "Note"],
    rows: view.map((r) => [r.grn_number, when(r.received_at), r.supplier ?? "",
      r.lines, r.quantity, r.total ?? "", r.note ?? ""]),
  });

  return (
    <>
      <Topbar title="GRN" subtitle="Goods received — fabric, other materials and finished goods, kept apart" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        {/* The three divisions, always visible, so which one you are in is
            never a guess. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {DIVISIONS.map((d) => {
            const on = d.k === kind;
            return (
              <button key={d.k} onClick={() => { setKind(d.k); setQ(""); }}
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
          {cats.length > 0 && (
            <select value={cat} onChange={(e) => setCat(e.target.value)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none">
              <option value="all">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GRN or supplier…"
            className="w-full max-w-sm rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30" />
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          <Link href={`/inventory/receive?kind=${kind}`}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">
            <Plus size={15} /> New {current.label} GRN
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-muted">
          <span>{view.length} receipts</span>
          <span>{n(qty)} units</span>
          <span className="font-semibold text-ink">{rs(value)}</span>
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {!loading && view.length === 0 && (
          <div className="rounded-card border border-line bg-surface p-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><current.Icon size={24} /></span>
            <p className="mt-3 text-[15px] font-semibold text-ink">No {current.label.toLowerCase()} GRNs</p>
            <p className="mt-1 text-[13px] text-muted">{current.sub} — received here, and nowhere else.</p>
          </div>
        )}

        {!loading && view.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                <th className="px-4 py-3 font-bold">GRN</th>
                <th className="px-4 py-3 font-bold">Category</th>
                <th className="px-4 py-3 font-bold">Supplier</th>
                <th className="px-4 py-3 text-right font-bold">Lines</th>
                <th className="px-4 py-3 text-right font-bold">Quantity</th>
                <th className="px-4 py-3 text-right font-bold">Value</th>
                <th className="px-4 py-3 font-bold">Note</th>
              </tr></thead>
              <tbody>
                {view.map((r, ix) => (
                  <tr key={r.id} onClick={() => openDetail(r)}
                    className={`cursor-pointer border-b border-line/60 last:border-0 hover:bg-panel/40 ${ix % 2 ? "bg-panel/25" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12.5px] font-bold text-ink">{r.grn_number}</span>
                      <span className="block text-[11px] text-hint">{when(r.received_at)}</span>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-ink/85">{r.categories ?? "—"}</td>
                    <td className="px-4 py-3 text-ink">{r.supplier ?? "—"}</td>
                    <td className="px-4 py-3 text-right tnum text-muted">{r.lines}</td>
                    <td className="px-4 py-3 text-right tnum font-semibold text-ink">{n(r.quantity)}</td>
                    <td className="px-4 py-3 text-right tnum font-bold text-ink">{r.total == null ? "—" : rs(r.total)}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-[12px] text-hint">{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      {openGrn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setOpenGrn(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-card bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[17px] font-extrabold text-ink">{openGrn.grn_number}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {openGrn.supplier ?? "no supplier"} · {when(openGrn.received_at)}
                </p>
              </div>
              <span className="rounded-full bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-ink">{openGrn.kind}</span>
            </div>

            {linesBusy && <p className="mt-4 text-[13px] text-hint">Loading lines…</p>}

            {!linesBusy && lines.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-xl2 border border-line">
                <table className="w-full text-left text-[12.5px]">
                  <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                    <th className="px-3 py-2 font-bold">Material</th>
                    <th className="px-3 py-2 text-right font-bold">Quantity</th>
                    <th className="px-3 py-2 text-right font-bold">Rate</th>
                    <th className="px-3 py-2 text-right font-bold">Total</th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-2">
                          <span className="font-semibold text-ink">
                            {[l.material, l.category].filter(Boolean).join(" · ")}
                          </span>
                          <span className="block text-[11px] text-hint">
                            {[l.colour, l.size, l.item_code].filter(Boolean).join(" · ")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {editing ? (
                            <input type="number" defaultValue={String(l.quantity)}
                              onChange={(e) => setELines((x) => x.map((y) => y.id === l.id ? { ...y, quantity: parseFloat(e.target.value) || 0 } : y))}
                              className="w-24 rounded-lg border border-ink/30 px-2 py-1 text-right text-[12.5px] outline-none" />
                          ) : (
                            <span className="tnum font-semibold text-ink">{n(l.quantity)} <span className="text-[11px] font-normal text-muted">{l.unit}</span></span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {editing ? (
                            <input type="number" defaultValue={l.rate == null ? "" : String(l.rate)}
                              onChange={(e) => setELines((x) => x.map((y) => y.id === l.id ? { ...y, rate: e.target.value === "" ? null : parseFloat(e.target.value) } : y))}
                              className="w-24 rounded-lg border border-ink/30 px-2 py-1 text-right text-[12.5px] outline-none" />
                          ) : (
                            <span className="tnum text-muted">{l.rate == null ? "—" : rs(l.rate)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tnum font-bold text-ink">{rs(l.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between text-[13px]">
              <span className="text-muted">{openGrn.lines} line(s) · {n(openGrn.quantity)} units</span>
              <span className="text-[16px] font-extrabold text-ink">{rs(openGrn.total ?? 0)}</span>
            </div>
            {editing ? (
              <input value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="Note"
                className="mt-2 w-full rounded-xl2 border border-line px-3 py-2 text-[12.5px] outline-none focus:border-ink/30" />
            ) : openGrn.note ? <p className="mt-2 text-[12.5px] text-muted">{openGrn.note}</p> : null}
            {err && <p className="mt-2 text-[12.5px] font-medium text-danger">{err}</p>}

            <div className="mt-5 flex items-center gap-2">
              {/* Edit changes it · Void reverses it and keeps the record ·
                  Delete removes a receipt that should never have existed. */}
              {editing ? (
                <>
                  <button onClick={saveEdit} disabled={eBusy}
                    className="rounded-xl2 bg-ink px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">
                    {eBusy ? "Saving…" : "Save changes"}
                  </button>
                  <button onClick={() => setEditing(false)} className="text-[12px] text-ink/60">cancel</button>
                  <span className="text-[11.5px] text-muted">Stock adjusts to match the new quantities.</span>
                </>
              ) : delOpen ? (
                <span className="flex flex-1 items-center gap-2">
                  <input value={voidWhy} autoFocus onChange={(e) => setVoidWhy(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") voidGrn(); if (e.key === "Escape") setDelOpen(false); }}
                    placeholder="Reason — required"
                    className="w-48 rounded-lg border border-ink/30 px-2.5 py-1.5 text-[12.5px] outline-none" />
                  <button onClick={voidGrn} disabled={!voidWhy.trim()}
                    className="rounded-xl2 bg-danger px-3.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40">
                    Void it — stock goes back
                  </button>
                  <button onClick={() => setDelOpen(false)} className="text-[12px] text-ink/60">cancel</button>
                </span>
              ) : killOpen ? (
                <span className="flex items-center gap-2">
                  <button onClick={deleteGrn} className="rounded-xl2 bg-danger px-3.5 py-2 text-[12.5px] font-semibold text-white">
                    Delete permanently
                  </button>
                  <button onClick={() => setKillOpen(false)} className="text-[12px] text-ink/60">cancel</button>
                </span>
                ) : (
                <>
                  <button onClick={startEdit}
                    className="rounded-xl2 border border-line px-3.5 py-2 text-[12.5px] font-semibold text-ink/75 hover:bg-panel">
                    Edit
                  </button>
                  <button onClick={() => setDelOpen(true)}
                    className="rounded-xl2 border border-line px-3.5 py-2 text-[12.5px] font-semibold text-danger/80 hover:bg-danger-soft">
                    Void
                  </button>
                  {/* Delete for a receipt typed in error; void for one that
                      happened and was undone. */}
                  <button onClick={() => setKillOpen(true)}
                    className="rounded-xl2 border border-line px-3.5 py-2 text-[12.5px] font-semibold text-danger/80 hover:bg-danger-soft">
                    Delete
                  </button>
                </>
              )}
              {!editing && <button onClick={() => setOpenGrn(null)} className="ml-auto rounded-xl2 border border-line px-5 py-2.5 text-[13px] font-semibold text-ink/70">Close</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function GrnPage() {
  return <Suspense fallback={null}><GrnInner /></Suspense>;
}
