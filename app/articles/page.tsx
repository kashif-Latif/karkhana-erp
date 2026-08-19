"use client";
import { useEffect, useState, useCallback } from "react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Loader2, Plus, Pencil, Shirt, X, Trash2, BookOpen } from "lucide-react";

type Cat = { id: string; name: string };
type Group = { id: string; name: string; has_category: boolean; has_size: boolean; units: { id: string; symbol: string }[]; categories: Cat[] };
type Article = { id: string; code: string; name: string; garment_type: string | null; audience: string | null; size: string | null; notes: string | null; is_active: boolean; bomCount: number };
type BomLine = { group_id: string; category_id: string; size_id: string; quantity: string; unit_id: string };

const AUDIENCES = ["Kids", "Men", "Ladies", "Unisex"];

export default function Articles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sizes, setSizes] = useState<{ id: string; name: string }[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  const [artModal, setArtModal] = useState<null | { id?: string }>(null);
  const [name, setName] = useState(""); const [gtype, setGtype] = useState(""); const [aud, setAud] = useState("");
  const [size, setSize] = useState(""); const [notes, setNotes] = useState(""); const [active, setActive] = useState(true);
  const [savingArt, setSavingArt] = useState(false); const [artErr, setArtErr] = useState("");

  const [recipeFor, setRecipeFor] = useState<Article | null>(null);
  const [lines, setLines] = useState<BomLine[]>([]);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false); const [recipeErr, setRecipeErr] = useState("");
  const [deleteFor, setDeleteFor] = useState<Article | null>(null); const [deleting, setDeleting] = useState(false); const [deleteErr, setDeleteErr] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [a, g, sz, pm] = await Promise.all([
      supabase.from("articles").select("id,code,name,garment_type,audience,size,notes,is_active, article_bom(count)").order("code", { ascending: false }),
      supabase.from("material_groups").select("id,name,has_category,has_color,has_size, group_units(units(id,symbol)), material_categories(id,name)").eq("is_active", true).order("name"),
      supabase.from("sizes").select("id,name").eq("is_active", true).order("sort_order"),
      supabase.rpc("has_permission", { p_permission_code: "production.manage" }),
    ]);
    setArticles(((a.data as unknown as Record<string, unknown>[]) ?? []).map((r) => {
      const bc = (r.article_bom as { count: number }[] | null)?.[0]?.count ?? 0;
      return { id: r.id as string, code: r.code as string, name: r.name as string, garment_type: (r.garment_type as string) || null, audience: (r.audience as string) || null, size: (r.size as string) || null, notes: (r.notes as string) || null, is_active: !!r.is_active, bomCount: Number(bc) };
    }));
    setGroups(((g.data as unknown as Record<string, unknown>[]) ?? []).map((r) => {
      const gu = (r.group_units as { units: { id: string; symbol: string } | null }[]) ?? [];
      const cats = (r.material_categories as Cat[]) ?? [];
      return { id: r.id as string, name: r.name as string, has_category: !!r.has_category, has_size: !!r.has_size, units: gu.map((x) => x.units).filter(Boolean) as { id: string; symbol: string }[], categories: cats };
    }));
    setSizes((sz.data as { id: string; name: string }[]) ?? []);
    setCanManage(!!pm.data);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openAdd() { setArtModal({}); setName(""); setGtype(""); setAud(""); setSize(""); setNotes(""); setActive(true); setArtErr(""); }
  function openEdit(a: Article) { setArtModal({ id: a.id }); setName(a.name); setGtype(a.garment_type || ""); setAud(a.audience || ""); setSize(a.size || ""); setNotes(a.notes || ""); setActive(a.is_active); setArtErr(""); }

  async function saveArticle() {
    setArtErr(""); if (!supabase) return;
    if (!name.trim()) { setArtErr("Enter an article name."); return; }
    setSavingArt(true);
    const args = { p_name: name.trim(), p_garment_type: gtype, p_audience: aud, p_size: size, p_notes: notes };
    const { error } = artModal?.id
      ? await supabase.rpc("update_article", { p_id: artModal.id, ...args, p_is_active: active })
      : await supabase.rpc("create_article", args);
    setSavingArt(false);
    if (error) { setArtErr(error.message); return; }
    setArtModal(null); load();
  }

  const groupById = (id: string) => groups.find((g) => g.id === id);
  const unitsFor = (id: string) => groupById(id)?.units ?? [];
  const catsFor = (id: string) => groupById(id)?.categories ?? [];

  async function openRecipe(a: Article) {
    setRecipeFor(a); setLines([]); setRecipeErr(""); setRecipeLoading(true);
    if (!supabase) return;
    const { data } = await supabase.from("article_bom").select("group_id,category_id,size_id,quantity,unit_id").eq("article_id", a.id);
    const existing = ((data as { group_id: string; category_id: string | null; size_id: string | null; quantity: number; unit_id: string }[]) ?? [])
      .map((r) => ({ group_id: r.group_id, category_id: r.category_id || "", size_id: r.size_id || "", quantity: String(Number(r.quantity)), unit_id: r.unit_id }));
    setLines(existing.length ? existing : [{ group_id: "", category_id: "", size_id: "", quantity: "", unit_id: "" }]);
    setRecipeLoading(false);
  }
  function setLine(i: number, patch: Partial<BomLine>) {
    setLines((ls) => ls.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, ...patch };
      if (patch.group_id !== undefined) { const us = unitsFor(patch.group_id); next.unit_id = us.length === 1 ? us[0].id : ""; next.category_id = ""; next.size_id = ""; }
      return next;
    }));
  }
  const addLine = () => setLines((ls) => [...ls, { group_id: "", category_id: "", size_id: "", quantity: "", unit_id: "" }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));

  async function saveRecipe() {
    setRecipeErr(""); if (!supabase || !recipeFor) return;
    const valid = lines.filter((l) => l.group_id && l.unit_id && parseFloat(l.quantity) > 0);
    setSavingRecipe(true);
    const p_lines = valid.map((l) => ({ group_id: l.group_id, category_id: l.category_id || null, size_id: l.size_id || null, quantity: parseFloat(l.quantity), unit_id: l.unit_id }));
    const { error } = await supabase.rpc("set_article_bom", { p_article_id: recipeFor.id, p_lines });
    setSavingRecipe(false);
    if (error) { setRecipeErr(error.message); return; }
    setRecipeFor(null); load();
  }

  async function doDelete() {
    setDeleteErr(""); if (!supabase || !deleteFor) return;
    setDeleting(true);
    const { error } = await supabase.rpc("delete_article", { p_id: deleteFor.id });
    setDeleting(false);
    if (error) { setDeleteErr(error.message); return; }
    setDeleteFor(null); load();
  }

  return (
    <>
      <Topbar title="Articles" subtitle="Your garments & their material recipe" />
      <div className="px-6 pb-12">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to manage articles.</div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[12.5px] text-muted">Each article is a garment you make. Set its <b>recipe</b> (fabric + zip per piece) so orders can auto-calculate material.{!canManage && " (View only.)"}</p>
              {canManage && <button onClick={openAdd} className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white"><Plus size={15} /> Add article</button>}
            </div>

            {articles.length === 0 ? (
              <div className="rounded-card bg-surface p-10 text-center shadow-card">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Shirt size={26} /></span>
                <p className="mt-3 text-[15px] font-semibold text-ink">No articles yet</p>
                <p className="mt-1 text-[13px] text-muted">Add your first garment to get started.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-card bg-surface shadow-card">
                <table className="w-full text-left text-[13.5px]">
                  <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-semibold">Code</th><th className="px-5 py-3 font-semibold">Article</th>
                    <th className="px-5 py-3 font-semibold">Type</th><th className="px-5 py-3 font-semibold">Audience</th>
                    <th className="px-5 py-3 font-semibold">Recipe</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {articles.map((a) => (
                      <tr key={a.id} className="border-b border-line/60 last:border-0">
                        <td className="px-5 py-3 font-mono text-[12px] text-muted">{a.code}</td>
                        <td className="px-5 py-3 font-semibold text-ink">{a.name}</td>
                        <td className="px-5 py-3 text-ink/70">{a.garment_type || "—"}</td>
                        <td className="px-5 py-3 text-ink/70">{a.audience || "—"}</td>
                        <td className="px-5 py-3">{a.bomCount > 0 ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] font-semibold text-[#166534]">{a.bomCount} material{a.bomCount > 1 ? "s" : ""}</span> : <span className="rounded-full bg-panel px-2 py-0.5 text-[11.5px] font-semibold text-muted">Not set</span>}</td>
                        <td className="px-5 py-3">{a.is_active ? <span className="text-[12.5px] font-medium text-[#166534]">Active</span> : <span className="text-[12.5px] text-muted">Inactive</span>}</td>
                        <td className="px-5 py-3"><div className="flex justify-end gap-1.5">
                          <button onClick={() => openRecipe(a)} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel"><BookOpen size={13} /> Recipe</button>
                          {canManage && <button onClick={() => openEdit(a)} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel"><Pencil size={13} /> Edit</button>}
                          {canManage && <button onClick={() => setDeleteFor(a)} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-danger hover:bg-danger-soft"><Trash2 size={13} /> Delete</button>}
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {artModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !savingArt && setArtModal(null)}>
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-[16px] font-extrabold">{artModal.id ? "Edit article" : "Add article"}</h2><button onClick={() => setArtModal(null)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button></div>
            <label className="block text-[12px] font-medium text-muted">Article name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kids Cotton Shirt" className={inp} autoFocus />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><label className="block text-[12px] font-medium text-muted">Garment type</label><input value={gtype} onChange={(e) => setGtype(e.target.value)} placeholder="Shirt / Trouser" className={inp} /></div>
              <div><label className="block text-[12px] font-medium text-muted">Audience</label><select value={aud} onChange={(e) => setAud(e.target.value)} className={inp}><option value="">—</option>{AUDIENCES.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><label className="block text-[12px] font-medium text-muted">Size (optional)</label><input value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 2-6Y" className={inp} /></div>
              {artModal.id && <div><label className="block text-[12px] font-medium text-muted">Status</label><select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")} className={inp}><option value="1">Active</option><option value="0">Inactive</option></select></div>}
            </div>
            <label className="mt-3 block text-[12px] font-medium text-muted">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" className={inp} />
            {artErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{artErr}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setArtModal(null)} disabled={savingArt} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={saveArticle} disabled={savingArt} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{savingArt && <Loader2 size={15} className="animate-spin" />}{artModal.id ? "Save changes" : "Add article"}</button>
            </div>
          </div>
        </div>
      )}

      {recipeFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !savingRecipe && setRecipeFor(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between"><h2 className="text-[16px] font-extrabold">Recipe · {recipeFor.name}</h2><button onClick={() => setRecipeFor(null)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button></div>
            <p className="mb-4 text-[12.5px] text-muted">How much of each material <b>one piece</b> needs. Pick the exact variant (e.g. Sticker → Men, Zip → 8 inch).{!canManage && " (View only.)"}</p>

            {recipeLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
            ) : (
              <>
                <div className="space-y-2.5">
                  {lines.map((l, i) => {
                    const grp = groupById(l.group_id);
                    return (
                      <div key={i} className="rounded-xl2 border border-line/70 p-2.5">
                        <div className="flex items-center gap-2">
                          <select value={l.group_id} disabled={!canManage} onChange={(e) => setLine(i, { group_id: e.target.value })} className={`${inpSm} flex-1`}>
                            <option value="">Choose material…</option>
                            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                          {canManage && <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {grp?.has_category && (
                            <select value={l.category_id} disabled={!canManage} onChange={(e) => setLine(i, { category_id: e.target.value })} className={`${inpSm} min-w-[110px] flex-1`}>
                              <option value="">Category…</option>
                              {catsFor(l.group_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                          {grp?.has_size && (
                            <select value={l.size_id} disabled={!canManage} onChange={(e) => setLine(i, { size_id: e.target.value })} className={`${inpSm} min-w-[100px] flex-1`}>
                              <option value="">Size…</option>
                              {sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          )}
                          <input type="number" step="any" value={l.quantity} disabled={!canManage} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="per piece" className={`${inpSm} w-24`} />
                          <select value={l.unit_id} disabled={!canManage || !l.group_id} onChange={(e) => setLine(i, { unit_id: e.target.value })} className={`${inpSm} w-20`}>
                            <option value="">unit</option>
                            {unitsFor(l.group_id).map((u) => <option key={u.id} value={u.id}>{u.symbol}</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {canManage && <button onClick={addLine} className="mt-3 flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel"><Plus size={14} /> Add material</button>}
                {recipeErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{recipeErr}</p>}
                {canManage && (
                  <div className="mt-5 flex justify-end gap-2">
                    <button onClick={() => setRecipeFor(null)} disabled={savingRecipe} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
                    <button onClick={saveRecipe} disabled={savingRecipe} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{savingRecipe && <Loader2 size={15} className="animate-spin" />}Save recipe</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {deleteFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !deleting && setDeleteFor(null)}>
          <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger"><Trash2 size={22} /></div>
            <h2 className="text-center text-[16px] font-extrabold">Delete this article?</h2>
            <p className="mt-1.5 text-center text-[13px] text-muted"><b className="text-ink">{deleteFor.name}</b> and its recipe will be permanently removed. This can&apos;t be undone.</p>
            {deleteErr && <p className="mt-3 rounded-xl2 bg-danger-soft px-3 py-2 text-center text-[12.5px] font-medium text-danger">{deleteErr}</p>}
            <div className="mt-5 flex justify-center gap-2">
              <button onClick={() => setDeleteFor(null)} disabled={deleting} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="flex items-center gap-1.5 rounded-xl2 bg-danger px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{deleting && <Loader2 size={15} className="animate-spin" />}Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inp = "mt-1.5 w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
const inpSm = "rounded-xl2 border border-line bg-canvas px-2.5 py-2 text-[13px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
