"use client";
/* ADD NEW ARTICLE — a form, not a list.
 *
 * Deliberately separate from the Articles list in Karkhana. This page has
 * one job: define a new garment and get its barcode. The saved articles,
 * their history and their recipes live in Karkhana → Articles, which is
 * where you go to look something up.
 *
 * One screen doing both would mean scrolling past two hundred rows to reach
 * the button you came for.
 */
import { useState } from "react";
import Link from "next/link";
import { Shirt, Loader2, ArrowRight } from "lucide-react";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";

const inp = "mt-1 w-full rounded-xl2 border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-ink/30";
const SECTIONS = [
    { v: "40", l: "40 · Baby blanket" }, { v: "41", l: "41 · Kids" },
  { v: "42", l: "42 · Child" }, { v: "43", l: "43 · Ladies" },
  { v: "44", l: "44 · Men" }, { v: "60", l: "60 · Shoes" },
  { v: "61", l: "61 · Accessories" },
];

type Made = { code?: string; system_barcode?: string; manual_barcode?: string; section?: string };

export default function AddArticlePage() {
  const { can } = usePermissions();
  const allowed = can(["articles.manage", "production.entry"]);

  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [manual, setManual] = useState("");
  /* Factory articles are made; warehouse articles are bought and resold.
     Kept apart so a recipe never lands on something that was never cut. */
  const [owner, setOwner] = useState("factory");
  const [gtype, setGtype] = useState("");
  const [size, setSize] = useState("");
  const [cost, setCost] = useState("");
  const [retail, setRetail] = useState("");
  const [gst, setGst] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [made, setMade] = useState<Made | null>(null);

  function reset() {
    setName(""); setSection(""); setManual(""); setOwner("factory"); setGtype(""); setSize("");
    setCost(""); setRetail(""); setGst(""); setErr(""); setMade(null);
  }

  async function save() {
    if (!isSupabaseConfigured || !supabase) return;
    setErr("");
    if (!name.trim()) { setErr("Give the article a name."); return; }
    if (!section) { setErr("Which section does it belong to?"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("add_article", {
      p_name: name.trim(), p_section: section,
      p_manual_barcode: manual.trim() || null,
      p_garment_type: gtype.trim() || null, p_size: size.trim() || null,
      p_cost_price: cost ? parseFloat(cost) : null,
      p_retail_price: retail ? parseFloat(retail) : null,
      p_gst_rate: gst ? parseFloat(gst) : null, p_code: null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const row = data as Made & { id?: string };
    if (owner !== "factory" && row?.id) {
      await supabase.from("articles").update({ owner }).eq("id", row.id);
    }
    setMade(row);
  }

  const margin = cost && retail ? parseFloat(retail) - parseFloat(cost) : null;

  return (
    <>
      <Topbar title="Add New Article" subtitle="Define a garment and give it a barcode" />

      <div className="px-6 pb-12">
        <div className="mx-auto max-w-2xl">
          {made ? (
            <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-ink"><Shirt size={24} /></span>
              <p className="mt-3 text-[15px] font-semibold text-ink">{name || "Article"} created</p>

              <div className="mx-auto mt-4 max-w-xs rounded-xl2 border border-[#166534]/25 bg-success-soft p-4">
                <p className="text-[11.5px] font-bold uppercase tracking-wide text-ink/55">System barcode</p>
                <p className="mt-1 font-mono text-[32px] font-extrabold leading-none tracking-tight text-ink">{made.system_barcode ?? "—"}</p>
                {/* Shown here too, because if you typed one you want to see it
                    took — not go hunting for it in a list afterwards. */}
                {made.manual_barcode && (
                  <p className="mt-2 font-mono text-[13px] text-ink/70">also {made.manual_barcode}</p>
                )}
                <p className="mt-1.5 text-[11.5px] text-ink/55">{made.code}</p>
              </div>

              <p className="mx-auto mt-4 max-w-sm text-[12.5px] leading-relaxed text-muted">
                It has no recipe yet, so an order cannot calculate its material.
                Set that in Karkhana → Articles.
              </p>

              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button onClick={reset} className="rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white">Add another</button>
                <Link href="/articles" className="flex items-center gap-1.5 rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/75 hover:bg-panel">
                  Go to Articles <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-card border border-line bg-surface p-6 shadow-card">
              <p className="text-[13px] text-muted">
                The barcode is generated when you save — {section || "??"}_000001 upward, counting inside its own section. It cannot be typed.
              </p>

              <div className="mt-4">
                <label className="block text-[12px] font-medium text-muted">Article name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                  placeholder="e.g. Men Cotton Tracksuit" className={inp} />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-medium text-muted">Belongs to *</label>
                  <select value={owner} onChange={(e) => setOwner(e.target.value)} className={inp}>
                    <option value="factory">Factory — we make it</option>
                    <option value="warehouse">Warehouse — we store and supply</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted">Section *</label>
                  <select value={section} onChange={(e) => setSection(e.target.value)} className={inp}>
                    <option value="">Choose…</option>
                    {SECTIONS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted">Manual barcode</label>
                  <input value={manual} onChange={(e) => setManual(e.target.value)}
                    placeholder="if one is already printed" className={inp} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted">Type</label>
                  <input value={gtype} onChange={(e) => setGtype(e.target.value)} placeholder="Shirt / Trouser" className={inp} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted">Size</label>
                  <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="M, 2-6Y…" className={inp} />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-muted">Cost price</label>
                  <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted">Retail price</label>
                  <input type="number" value={retail} onChange={(e) => setRetail(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted">GST %</label>
                  <input type="number" value={gst} onChange={(e) => setGst(e.target.value)} placeholder="18" className={inp} />
                </div>
              </div>

              {margin !== null && (
                <p className="mt-2.5 text-[12.5px] text-ink/70">
                  Margin <b className="text-ink">Rs {margin.toLocaleString()}</b>
                  {gst && retail ? ` · GST Rs ${(parseFloat(retail) * parseFloat(gst) / 100).toFixed(0)} · sells at Rs ${(parseFloat(retail) * (1 + parseFloat(gst) / 100)).toFixed(0)} inc` : ""}
                </p>
              )}

              {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}

              <div className="mt-5 flex justify-end gap-2">
                <button onClick={reset} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Clear</button>
                <button onClick={save} disabled={busy || !allowed}
                  className="flex items-center gap-1.5 rounded-xl2 bg-ink px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                  {busy && <Loader2 size={15} className="animate-spin" />} Create article
                </button>
              </div>
              {!allowed && <p className="mt-2 text-right text-[12px] text-hint">You do not have permission to add articles.</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
