"use client";
/* EDIT RECORD — one place to open anything already saved and change it.
 *
 * Pick a department, see everything it holds, open one, edit it. Blocking an
 * item makes it vanish from every dropdown WITHOUT vanishing from history —
 * deleting would orphan every GRN that ever mentioned it, which is why
 * "inactive" exists and delete is guarded.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Loader2, Ban, Check, Trash2, BookOpen } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";

type Side = "karkhana" | "warehouse";
type Kind = "article" | "material";
type Rec = { kind: Kind; id: string; code: string; name: string; sub: string;
             barcode: string | null; active: boolean; owner: string | null;
             min_quantity: number | null; bom: number };

const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink/30";

export default function EditRecordPage() {
  const { can } = usePermissions();
  const canEdit = can(["production.entry", "grn.create"]);

  const [side, setSide] = useState<Side | null>(null);
  const [rows, setRows] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "active" | "blocked">("all");

  const [open, setOpen] = useState<Rec | null>(null);
  const [name, setName] = useState("");
  const [minQ, setMinQ] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !side) return;
    setLoading(true); setErr("");
    if (side === "karkhana") {
      const [a, m] = await Promise.all([
        supabase.from("articles")
          .select("id,code,name,system_barcode,is_active,owner,audience,size,article_bom(count)")
          .eq("owner", "factory").order("code"),
        supabase.from("material_items")
          .select("id,code,is_active,min_quantity,material_groups(name),material_categories(name),colors(name)")
          .order("code"),
      ]);
      if (a.error) setErr(a.error.message);
      const arts: Rec[] = ((a.data as unknown as Record<string, unknown>[]) ?? []).map((r) => ({
        kind: "article", id: String(r.id), code: String(r.code), name: String(r.name),
        sub: [r.audience, r.size].filter(Boolean).join(" · "),
        barcode: (r.system_barcode as string) ?? null, active: !!r.is_active,
        owner: (r.owner as string) ?? null, min_quantity: null,
        bom: Number((r.article_bom as { count: number }[] | null)?.[0]?.count ?? 0),
      }));
      const mats: Rec[] = ((m.data as unknown as Record<string, unknown>[]) ?? []).map((r) => ({
        kind: "material", id: String(r.id), code: String(r.code),
        name: String((r.material_groups as { name: string } | null)?.name ?? "Material"),
        sub: [(r.material_categories as { name: string } | null)?.name,
              (r.colors as { name: string } | null)?.name].filter(Boolean).join(" · "),
        barcode: null, active: !!r.is_active, owner: null,
        min_quantity: r.min_quantity == null ? null : Number(r.min_quantity), bom: 0,
      }));
      setRows([...arts, ...mats]);
    } else {
      const { data, error } = await supabase.from("articles")
        .select("id,code,name,system_barcode,is_active,owner,audience,size")
        .eq("owner", "warehouse").order("code");
      if (error) setErr(error.message);
      setRows(((data as unknown as Record<string, unknown>[]) ?? []).map((r) => ({
        kind: "article", id: String(r.id), code: String(r.code), name: String(r.name),
        sub: [r.audience, r.size].filter(Boolean).join(" · "),
        barcode: (r.system_barcode as string) ?? null, active: !!r.is_active,
        owner: "warehouse", min_quantity: null, bom: 0,
      })));
    }
    setLoading(false);
  }, [side]);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    if (show === "active" && !r.active) return false;
    if (show === "blocked" && r.active) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [r.code, r.name, r.sub, r.barcode].some((x) => String(x ?? "").toLowerCase().includes(t));
  }), [rows, q, show]);

  function openRec(r: Rec) {
    setOpen(r); setName(r.name); setActive(r.active);
    setMinQ(r.min_quantity == null ? "" : String(r.min_quantity));
    setConfirmDel(false); setErr("");
  }

  async function save() {
    if (!supabase || !open) return;
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("set_item_active", {
      p_kind: open.kind, p_id: open.id, p_active: active,
    });
    if (!error && open.kind === "article" && name.trim() && name.trim() !== open.name) {
      await supabase.from("articles").update({ name: name.trim() }).eq("id", open.id);
    }
    if (!error && open.kind === "material") {
      await supabase.rpc("set_min_quantity", {
        p_item_id: open.id, p_min: minQ === "" ? null : parseFloat(minQ),
      });
    }
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOpen(null); load();
  }

  async function remove() {
    if (!supabase || !open) return;
    setBusy(true); setErr("");
    const table = open.kind === "article" ? "articles" : "material_items";
    const { error } = await supabase.from(table).delete().eq("id", open.id);
    setBusy(false);
    if (error) {
      /* Almost always a foreign key: it appears in a GRN or an order. That is
         the system protecting history, so say so instead of showing raw SQL. */
      setErr("This cannot be deleted — it already appears in a GRN, an order or a recipe. Block it instead, and it will disappear from the dropdowns while its history stays intact.");
      return;
    }
    setOpen(null); load();
  }

  return (
    <>
      <Topbar title="Edit record" subtitle="Open anything already saved — change it, block it, remove it" />

      <div className="space-y-4 px-6 pb-12">
        {err && !open && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        {!side ? (
          <div className="mx-auto max-w-xl pt-6">
            <p className="text-center text-[14px] text-muted">Which department&rsquo;s records?</p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([["karkhana", "Karkhana", "Articles we make, and every material"],
                 ["warehouse", "Warehouse", "Products we store and supply"]] as [Side, string, string][])
                .map(([v, l, d]) => (
                  <button key={v} onClick={() => setSide(v)}
                    className="rounded-card border border-line bg-surface p-5 text-left transition hover:bg-panel">
                    <p className="text-[15px] font-bold text-ink">{l}</p>
                    <p className="mt-1 text-[12.5px] text-muted">{d}</p>
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => { setSide(null); setRows([]); setQ(""); }}
                className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">
                ← Department
              </button>
              <span className="rounded-full bg-ink px-3 py-2 text-[12px] font-semibold text-white">
                {side === "karkhana" ? "Karkhana" : "Warehouse"}
              </span>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
                  className="w-64 rounded-xl2 border border-line bg-surface py-2 pl-8 pr-3 text-[13px] outline-none focus:border-ink/30" />
              </div>
              {(["all", "active", "blocked"] as const).map((x) => (
                <button key={x} onClick={() => setShow(x)}
                  className={`rounded-full px-3 py-2 text-[12px] font-semibold capitalize transition ${show === x ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
                  {x}
                </button>
              ))}
              <span className="ml-auto text-[12.5px] text-muted">{view.length} records</span>
            </div>

            {loading && <p className="text-[13px] text-hint">Loading…</p>}

            {!loading && (
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
                  <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                    <th className="px-4 py-3 font-bold">Record</th>
                    <th className="px-4 py-3 font-bold">Type</th>
                    <th className="px-4 py-3 font-bold">Barcode</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {view.map((r) => (
                      <tr key={r.kind + r.id} className={`border-b border-line/60 last:border-0 ${r.active ? "" : "opacity-55"}`}>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-ink">{r.name}</span>
                          <span className="block text-[11px] text-hint">{r.code}{r.sub ? ` · ${r.sub}` : ""}</span>
                        </td>
                        <td className="px-4 py-3 text-[12.5px] text-muted">
                          {r.kind === "article" ? "Article" : "Material"}
                          {r.bom > 0 && <span className="block text-[11px] text-hint">{r.bom} in recipe</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-muted">{r.barcode ?? "—"}</td>
                        <td className="px-4 py-3">
                          {r.active
                            ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] font-semibold text-ink">Active</span>
                            : <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-semibold text-ink">Blocked</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => openRec(r)} disabled={!canEdit}
                            className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink/75 hover:bg-panel disabled:opacity-40">
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {view.length === 0 && <p className="p-8 text-center text-[13px] text-muted">Nothing matches.</p>}
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open && (
          <>
            <p className="text-[12.5px] text-muted">
              {open.kind === "article" ? "Article" : "Material"} · {open.code}
              {open.barcode ? ` · ${open.barcode}` : ""}
            </p>

            {open.kind === "article" && (
              <div className="mt-3"><Field label="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} className={inp} />
              </Field></div>
            )}

            {open.kind === "material" && (
              <div className="mt-3"><Field label="Warn when stock falls to">
                <input type="number" value={minQ} onChange={(e) => setMinQ(e.target.value)}
                  placeholder="blank = no warning" className={inp} />
              </Field></div>
            )}

            {/* The important control. Blocking hides it from every dropdown
                while leaving every GRN that mentions it untouched. */}
            <div className="mt-4 rounded-xl2 border border-line p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-ink">{active ? "Active" : "Blocked"}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {active ? "Appears in dropdowns and can be used."
                            : "Hidden from dropdowns. History is untouched."}
                  </p>
                </div>
                <button onClick={() => setActive((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition ${active ? "border border-line text-ink/75 hover:bg-panel" : "bg-ink text-white"}`}>
                  {active ? <><Ban size={13} /> Block it</> : <><Check size={13} /> Make active</>}
                </button>
              </div>
            </div>

            {open.kind === "article" && (
              <Link href="/articles"
                className="mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink/75 hover:text-ink">
                <BookOpen size={14} /> Edit its recipe on the Articles screen
                {open.bom > 0 ? ` (${open.bom} materials)` : " (none set)"}
              </Link>
            )}

            {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}

            <div className="mt-5 flex items-center gap-2">
              {confirmDel ? (
                <span className="flex items-center gap-2">
                  <button onClick={remove} disabled={busy}
                    className="rounded-xl2 bg-danger px-3.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">
                    Delete permanently
                  </button>
                  <button onClick={() => setConfirmDel(false)} className="text-[12px] text-ink/60">cancel</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDel(true)}
                  className="flex items-center gap-1.5 rounded-xl2 border border-line px-3.5 py-2 text-[12.5px] font-semibold text-danger/80 hover:bg-danger-soft">
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button onClick={() => setOpen(null)} className="ml-auto rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
              <button onClick={save} disabled={busy}
                className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {busy && <Loader2 size={15} className="animate-spin" />} Save
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
