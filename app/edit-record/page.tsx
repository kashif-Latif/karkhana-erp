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
type Kind = "article" | "material" | "product";
type Rec = { kind: Kind; id: string; code: string; name: string; sub: string;
             barcode: string | null; active: boolean; owner: string | null;
             min_quantity: number | null; bom: number };

type Opt = { id: string; name: string };
type Bom = { group_id: string; category_id: string | null; size_id: string | null;
             unit_id: string; quantity: string };

const SECTIONS = [["40","Baby/Newborn"],["41","Kids"],["42","Child"],["43","Ladies"],
                  ["44","Men"],["60","Shoes"],["61","Accessories"]];
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

  /* Everything an article has, edited here. Sending someone to another screen
     for the recipe was the bug: you lose your place and the record you opened. */
  const [manual, setManual] = useState("");
  const [section, setSection] = useState("");
  const [cost, setCost] = useState("");
  const [retail, setRetail] = useState("");
  const [gst, setGst] = useState("");
  const [bom, setBom] = useState<Bom[]>([]);
  const [groups, setGroups] = useState<Opt[]>([]);
  const [cats, setCats] = useState<(Opt & { group_id: string })[]>([]);
  const [units, setUnits] = useState<Opt[]>([]);

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
      /* The warehouse holds TWO kinds of record, and only reading one was the
         bug: products it stocks (khana_final_items, with their own barcodes)
         and articles marked as warehouse-owned. Both belong here. */
      const [prod, arts] = await Promise.all([
        supabase.from("khana_final_items")
          .select("id,barcode,name,category,raw_material_reference,is_active").order("name"),
        supabase.from("articles")
          .select("id,code,name,system_barcode,is_active,owner,audience,size")
          .eq("owner", "warehouse").order("code"),
      ]);
      if (prod.error) setErr(prod.error.message);
      const ps: Rec[] = ((prod.data as unknown as Record<string, unknown>[]) ?? []).map((r) => ({
        kind: "product", id: String(r.id), code: String(r.barcode), name: String(r.name),
        sub: String(r.category ?? ""), barcode: (r.barcode as string) ?? null,
        active: r.is_active == null ? true : !!r.is_active,
        owner: "warehouse", min_quantity: null, bom: 0,
      }));
      const as: Rec[] = ((arts.data as unknown as Record<string, unknown>[]) ?? []).map((r) => ({
        kind: "article", id: String(r.id), code: String(r.code), name: String(r.name),
        sub: [r.audience, r.size].filter(Boolean).join(" · "),
        barcode: (r.system_barcode as string) ?? null, active: !!r.is_active,
        owner: "warehouse", min_quantity: null, bom: 0,
      }));
      setRows([...ps, ...as]);
    }
    setLoading(false);
  }, [side]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [g, c, u] = await Promise.all([
        supabase!.from("material_groups").select("id,name").eq("is_active", true).order("name"),
        supabase!.from("material_categories").select("id,name,group_id").order("name"),
        supabase!.from("units").select("id,symbol").order("symbol"),
      ]);
      setGroups((g.data as Opt[]) ?? []);
      setCats((c.data as unknown as (Opt & { group_id: string })[]) ?? []);
      setUnits(((u.data as unknown as { id: string; symbol: string }[]) ?? [])
        .map((x) => ({ id: x.id, name: x.symbol })));
    })();
  }, []);

  const view = useMemo(() => rows.filter((r) => {
    if (show === "active" && !r.active) return false;
    if (show === "blocked" && r.active) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [r.code, r.name, r.sub, r.barcode].some((x) => String(x ?? "").toLowerCase().includes(t));
  }), [rows, q, show]);

  async function openRec(r: Rec) {
    setOpen(r); setName(r.name); setActive(r.active);
    setMinQ(r.min_quantity == null ? "" : String(r.min_quantity));
    setConfirmDel(false); setErr(""); setBom([]);
    setManual(r.kind === "product" ? (r.barcode ?? "") : "");
    setSection(""); setCost(""); setRetail(""); setGst("");
    if (r.kind === "article" && supabase) {
      const [a, b] = await Promise.all([
        supabase.from("articles")
          .select("manual_barcode,section,cost_price,retail_price,gst_rate").eq("id", r.id).single(),
        supabase.from("article_bom")
          .select("group_id,category_id,size_id,quantity,unit_id").eq("article_id", r.id),
      ]);
      const d = a.data as Record<string, unknown> | null;
      if (d) {
        setManual((d.manual_barcode as string) ?? "");
        setSection((d.section as string) ?? "");
        setCost(d.cost_price == null ? "" : String(d.cost_price));
        setRetail(d.retail_price == null ? "" : String(d.retail_price));
        setGst(d.gst_rate == null ? "" : String(d.gst_rate));
      }
      setBom(((b.data as unknown as Record<string, unknown>[]) ?? []).map((x) => ({
        group_id: String(x.group_id), category_id: (x.category_id as string) ?? null,
        size_id: (x.size_id as string) ?? null, unit_id: String(x.unit_id),
        quantity: String(x.quantity),
      })));
    }
  }

  async function save() {
    if (!supabase || !open) return;
    setBusy(true); setErr("");
    let error = null as { message: string } | null;
    if (open.kind === "product") {
      const r = await supabase.from("khana_final_items")
        .update({ is_active: active }).eq("id", open.id);
      error = r.error;
    } else {
      const r = await supabase.rpc("set_item_active", {
        p_kind: open.kind, p_id: open.id, p_active: active,
      });
      error = r.error;
    }
    if (!error && open.kind === "article") {
      await supabase.from("articles").update({
        name: name.trim() || open.name,
        manual_barcode: manual.trim() || null,
        section: section || null,
        cost_price: cost === "" ? null : parseFloat(cost),
        retail_price: retail === "" ? null : parseFloat(retail),
        gst_rate: gst === "" ? null : parseFloat(gst),
      }).eq("id", open.id);
      /* The recipe is replaced whole — one call, so a half-saved recipe
         cannot exist. */
      const lines = bom.filter((l) => l.group_id && l.unit_id && parseFloat(l.quantity) > 0)
        .map((l) => ({ group_id: l.group_id, category_id: l.category_id,
                       size_id: l.size_id, unit_id: l.unit_id, quantity: parseFloat(l.quantity) }));
      const r = await supabase.rpc("set_article_bom", { p_article_id: open.id, p_lines: lines });
      if (r.error) { setBusy(false); setErr(r.error.message); return; }
    }
    if (!error && open.kind === "product") {
      await supabase.from("khana_final_items").update({
        name: name.trim() || open.name,
        barcode: manual.trim() || open.barcode,
      }).eq("id", open.id);
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
    const table = open.kind === "article" ? "articles"
                : open.kind === "product" ? "khana_final_items" : "material_items";
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
                      <tr key={r.kind + r.id}
                        onClick={() => {
                          /* Selecting text is a click too. Opening a modal
                             mid-copy loses the selection and the place. */
                          if (!canEdit) return;
                          if ((window.getSelection()?.toString() ?? "").length > 0) return;
                          openRec(r);
                        }}
                        className={`border-b border-line/60 last:border-0 ${r.active ? "" : "opacity-55"} ${canEdit ? "cursor-pointer hover:bg-panel/40" : ""}`}>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-ink">{r.name}</span>
                          <span className="block text-[11px] text-hint">{r.code}{r.sub ? ` · ${r.sub}` : ""}</span>
                        </td>
                        <td className="px-4 py-3 text-[12.5px] text-muted">
                          {r.kind === "article" ? "Article" : r.kind === "product" ? "Product" : "Material"}
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
              <>
                <div className="mt-3"><Field label="Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inp} />
                </Field></div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Section">
                    <select value={section} onChange={(e) => setSection(e.target.value)} className={inp}>
                      <option value="">—</option>
                      {SECTIONS.map(([v, l]) => <option key={v} value={v}>{v} · {l}</option>)}
                    </select>
                  </Field>
                  <Field label="Manual barcode">
                    <input value={manual} onChange={(e) => setManual(e.target.value)} className={inp} />
                  </Field>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Field label="Cost"><input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} /></Field>
                  <Field label="Retail"><input type="number" value={retail} onChange={(e) => setRetail(e.target.value)} className={inp} /></Field>
                  <Field label="GST %"><input type="number" value={gst} onChange={(e) => setGst(e.target.value)} className={inp} /></Field>
                </div>

                {/* The recipe, right here. */}
                <div className="mt-4 rounded-xl2 border border-line p-3">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                      <BookOpen size={14} /> Recipe <span className="font-normal text-hint">per piece</span>
                    </p>
                    <button onClick={() => setBom((b) => [...b, { group_id: "", category_id: null, size_id: null, unit_id: units[0]?.id ?? "", quantity: "" }])}
                      className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink/70">+ Material</button>
                  </div>
                  {bom.length === 0 && <p className="mt-2 text-[12px] text-hint">No recipe — an order cannot calculate its material.</p>}
                  {bom.map((l, i) => (
                    <div key={i} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <select value={l.group_id ? `${l.group_id}|${l.category_id ?? ""}` : ""} className={inp}
                        onChange={(e) => {
                          const [g, c] = e.target.value.split("|");
                          setBom((b) => b.map((y, j) => j === i ? { ...y, group_id: g, category_id: c || null } : y));
                        }}>
                        <option value="">Material…</option>
                        {/* Group AND category together: "Fabric · Fleece" is what
                            people actually mean, and picking a group then a
                            category in two boxes is two chances to mismatch. */}
                        {groups.flatMap((g) => {
                          const kids = cats.filter((c) => c.group_id === g.id);
                          return [
                            <option key={g.id} value={`${g.id}|`}>{g.name} · any</option>,
                            ...kids.map((c) => (
                              <option key={g.id + c.id} value={`${g.id}|${c.id}`}>{g.name} · {c.name}</option>
                            )),
                          ];
                        })}
                      </select>
                      <input type="number" value={l.quantity} placeholder="Qty" className={inp}
                        onChange={(e) => setBom((b) => b.map((y, j) => j === i ? { ...y, quantity: e.target.value } : y))} />
                      <div className="flex items-center gap-2">
                        <select value={l.unit_id} className={inp}
                          onChange={(e) => setBom((b) => b.map((y, j) => j === i ? { ...y, unit_id: e.target.value } : y))}>
                          {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                        <button onClick={() => setBom((b) => b.filter((_, j) => j !== i))}
                          className="text-[11px] font-semibold text-danger/70">remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {open.kind === "product" && (
              <>
                <div className="mt-3"><Field label="Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inp} />
                </Field></div>
                <div className="mt-3"><Field label="Barcode">
                  <input value={manual} onChange={(e) => setManual(e.target.value)} className={inp} />
                </Field></div>
              </>
            )}

            {open.kind === "material" && (
              <div className="mt-3"><Field label="Warn when stock falls to">
                <input type="number" value={minQ} onChange={(e) => setMinQ(e.target.value)}
                  placeholder="blank = no warning" className={inp} />
              </Field></div>
            )}

            {/* The important control. Blocking hides it from every dropdown
                while leaving every GRN that mentions it untouched. */}

            {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}

            <div className="mt-5 flex items-center gap-2">
              {/* Block sits with Delete, bottom left: both are "stop using this",
                  and one of them is the safe version of the other. */}
              <button onClick={() => setActive((v) => !v)}
                className={`flex items-center gap-1.5 rounded-xl2 px-3.5 py-2 text-[12.5px] font-semibold transition ${active ? "border border-line text-ink/75 hover:bg-panel" : "bg-ink text-white"}`}>
                {active ? <><Ban size={13} /> Block</> : <><Check size={13} /> Unblock</>}
              </button>
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
              {active !== open.active && (
                <span className="text-[11.5px] font-semibold text-ink/60">
                  {active ? "will be unblocked" : "will be blocked"} on save
                </span>
              )}
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
