"use client";
/* FINAL INVENTORY — a section that stands alone.
 *
 * Its own items, its own stock, its own in/out ledger (K138). It reads and
 * writes nothing else: not material_items, not stock_ledger, not Hub, not
 * FS Traders. One man can be given khana.view / khana.manage and he sees
 * this and nothing more.
 *
 * Barcode first, because that is how it will actually be used: scan into
 * the box, the item resolves, type the quantity, done. A scanner types the
 * code then presses Enter — so Enter is the trigger everywhere.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Plus, Loader2, Download, Undo2, Pencil, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import Topbar from "@/components/Topbar";
import Modal, { Field } from "@/components/Modal";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";

type Item = { item_id: string; barcode: string; name: string; description: string | null;
              raw_material_reference: string | null; category: string | null; is_active: boolean;
              quantity: number; last_updated: string | null };
type Move = { id: string; movement_no: string | null; movement_type: "IN" | "OUT";
              quantity: number; note: string | null; created_at: string;
              voided_at: string | null; void_reason: string | null;
              invoice_no: string | null; party: string | null; branch: string | null;
              delivery_no: number | null; branch_id: string | null;
              original_quantity: number | null; edited_at: string | null;
              barcode: string; name: string };
type Party = { id: string; name: string };
type Branch = { id: string; party_id: string; party: string; branch: string; deliveries: number };
type Tab = "materials" | "stock" | "in" | "out";

const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const when = (v: string) => new Date(v).toLocaleString();

export default function FinalInventoryPage() {
  const { can } = usePermissions();
  const canManage = can(["khana.manage"]);

  const [tab, setTab] = useState<Tab>("stock");
  const [items, setItems] = useState<Item[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [q, setQ] = useState("");
  /* 041 Kids · 042 Child · 043 Ladies · 044 Men — the codes on the printed
     sheets. Filtering by name is what people actually think in. */
  const [cat, setCat] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  /* add an item */
  const [itemOpen, setItemOpen] = useState(false);
  const [bc, setBc] = useState("");
  const [nm, setNm] = useState("");
  const [desc, setDesc] = useState("");
  const [rawRef, setRawRef] = useState("");
  const [busy, setBusy] = useState(false);

  /* record a movement */
  const [scan, setScan] = useState("");
  const [found, setFound] = useState<Item | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [mErr, setMErr] = useState("");
  /* OUT must say where it went — the party is required, the branch optional
     (some parties have none), and the invoice number is theirs, as given. */
  const [parties, setParties] = useState<Party[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [partyId, setPartyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [invNo, setInvNo] = useState("");
  const [pOpen, setPOpen] = useState(false);
  const [pName, setPName] = useState("");
  const [pParty, setPParty] = useState("");
  /* No window.prompt / window.confirm anywhere. A browser dialog cannot be
     styled, cannot be cancelled with Escape reliably on every platform, and
     looks like a phishing box. Renaming and confirming happen in the row. */
  const [editRow, setEditRow] = useState<{ id: string; branch: boolean } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [killRow, setKillRow] = useState<string | null>(null);
  const [voidRow, setVoidRow] = useState<string | null>(null);
  const [voidWhy, setVoidWhy] = useState("");
  /* Editing a movement moves stock by the DIFFERENCE (K143) — the database
     does that arithmetic, never the screen. */
  const [editMv, setEditMv] = useState<string | null>(null);
  const [eQty, setEQty] = useState("");
  const [eInv, setEInv] = useState("");
  const [eBranch, setEBranch] = useState("");
  const [eNote, setENote] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const [i, m, pa, br] = await Promise.all([
      supabase.from("v_khana_stock").select("*").order("name"),
      supabase.from("v_khana_movements").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("khana_parties").select("id,name").eq("is_active", true).order("name"),
      supabase.from("v_khana_branches").select("id,party_id,party,branch,deliveries").eq("is_active", true).order("branch"),
    ]);
    setParties((pa.data as Party[]) ?? []);
    setBranches((br.data as Branch[]) ?? []);
    if (i.error || m.error) setErr((i.error || m.error)!.message);
    setItems((i.data as Item[]) ?? []);
    setMoves((m.data as Move[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const hit = (...v: (string | null)[]) =>
    !q.trim() || v.some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase()));
  const fItems = useMemo(() => {
    const list = items.filter((i) => (!cat || i.category === cat)
      && hit(i.barcode, i.name, i.category, i.raw_material_reference));
    /* Stock is read to answer "what do we have" — so what we have most of
       goes first. The product list stays alphabetical, because that is
       read to find one specific thing. */
    return tab === "stock"
      ? [...list].sort((a, b) => Number(b.quantity) - Number(a.quantity) || a.name.localeCompare(b.name))
      : list;
  }, [items, q, cat, tab]);
  const fMoves = useMemo(() => moves.filter((m) => hit(m.barcode, m.name, m.movement_no)), [moves, q]);
  const inMoves = fMoves.filter((m) => m.movement_type === "IN");
  const outMoves = fMoves.filter((m) => m.movement_type === "OUT");

  /* The scanner types the code and presses Enter. Resolving on Enter — not
     on every keystroke — means a half-typed code never matches the wrong
     item and starts a movement against it. */
  function resolve() {
    const code = scan.trim();
    if (!code) return;
    const it = items.find((i) => i.barcode.toLowerCase() === code.toLowerCase());
    if (!it) { setFound(null); setMErr(`No item with barcode ${code}. Add it under Materials first.`); return; }
    setFound(it); setMErr("");
  }

  async function addItem() {
    if (!supabase) return;
    setErr("");
    if (!bc.trim() || !nm.trim()) { setErr("Barcode and name are both needed."); return; }
    setBusy(true);
    const { error } = await supabase.from("khana_final_items").insert({
      barcode: bc.trim(), name: nm.trim(),
      description: desc.trim() || null, raw_material_reference: rawRef.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message.includes("duplicate") ? "That barcode already exists." : error.message); return; }
    setItemOpen(false); setBc(""); setNm(""); setDesc(""); setRawRef(""); load();
  }

  async function record(type: "IN" | "OUT") {
    if (!supabase || !found) return;
    setMErr("");
    if (!(parseFloat(qty) > 0)) { setMErr("Enter a quantity."); return; }
    setBusy(true);
    if (type === "OUT" && !partyId) { setBusy(false); setMErr("Which party is this going to?"); return; }
    const { error } = await supabase.from("khana_stock_movements").insert({
      item_id: found.item_id, movement_type: type,
      quantity: parseFloat(qty), note: note.trim() || null,
      party_id: type === "OUT" ? partyId : null,
      branch_id: type === "OUT" && branchId ? branchId : null,
      invoice_no: type === "OUT" ? (invNo.trim() || null) : null,
    });
    setBusy(false);
    /* The database refuses an OUT larger than stock (K138). Showing its own
       words is better than inventing a friendlier lie — it names both
       numbers. */
    if (error) { setMErr(error.message); return; }
    setScan(""); setFound(null); setQty(""); setNote(""); setInvNo(""); load();
  }

  async function addParty() {
    if (!supabase || !pName.trim()) return;
    setBusy(true);
    const { error } = pParty
      ? await supabase.from("khana_party_branches").insert({ party_id: pParty, name: pName.trim() })
      : await supabase.from("khana_parties").insert({ name: pName.trim() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPOpen(false); setPName(""); setPParty(""); load();
  }

  async function saveRename() {
    if (!supabase || !editRow || !editVal.trim()) return;
    const { error } = await supabase.from(editRow.branch ? "khana_party_branches" : "khana_parties")
      .update({ name: editVal.trim() }).eq("id", editRow.id);
    if (error) { setErr(error.message); return; }
    setEditRow(null); setEditVal(""); load();
  }

  async function removeBranch(b: Branch) {
    if (!supabase) return;
    /* A branch with deliveries is hidden, not deleted — those rows point at
       it, and old paperwork still names it. Nothing with history is ever
       destroyed here. */
    const { error } = b.deliveries > 0
      ? await supabase.from("khana_party_branches").update({ is_active: false }).eq("id", b.id)
      : await supabase.from("khana_party_branches").delete().eq("id", b.id);
    if (error) { setErr(error.message); return; }
    setKillRow(null); load();
  }

  async function removeParty(pt: Party) {
    if (!supabase) return;
    const used = moves.some((m) => m.party === pt.name);
    const hasBranches = branches.some((b) => b.party_id === pt.id);
    if (used || hasBranches) {
      /* Same rule one level up: a party that has shipped anything, or still
         holds branches, is deactivated so its deliveries stay explainable. */
      const { error } = await supabase.from("khana_parties").update({ is_active: false }).eq("id", pt.id);
      if (error) { setErr(error.message); return; }
    } else {
      const { error } = await supabase.from("khana_parties").delete().eq("id", pt.id);
      if (error) { setErr(error.message); return; }
    }
    setKillRow(null); load();
  }

  async function delItem(i: Item) {
    if (!supabase) return;
    setKillRow(null);
    if (i.quantity !== 0) { setErr(`${i.name} still holds ${n(i.quantity)}. Take it out before removing the item.`); return; }
    const { error } = await supabase.from("khana_final_items").delete().eq("id", i.item_id);
    if (error) { setErr(error.message); return; }
    load();
  }

  async function voidMove(id: string) {
    if (!supabase || !voidWhy.trim()) return;
    const { error } = await supabase.rpc("khana_void_movement", { p_id: id, p_reason: voidWhy.trim() });
    if (error) { setErr(error.message); return; }
    setVoidRow(null); setVoidWhy(""); load();
  }

  function startEdit(m: Move) {
    setEditMv(m.id); setVoidRow(null);
    setEQty(String(m.quantity)); setEInv(m.invoice_no ?? "");
    setEBranch(m.branch_id ?? ""); setENote(m.note ?? "");
  }
  async function saveEdit(m: Move) {
    if (!supabase) return;
    const { error } = await supabase.rpc("khana_edit_movement", {
      p_id: m.id, p_quantity: parseFloat(eQty),
      p_note: eNote || null, p_invoice_no: eInv || null,
      p_branch_id: eBranch || null,
    });
    if (error) { setErr(error.message); return; }
    setEditMv(null); load();
  }

  const table = (): ExportTable => tab === "materials" || tab === "stock"
    ? { title: `final-inventory-${tab}`,
        headers: ["Barcode", "Name", "Category", "Code", "Quantity", "Last updated"],
        rows: fItems.map((i) => [i.barcode, i.name, i.category ?? "", i.raw_material_reference ?? "", i.quantity, i.last_updated ? when(i.last_updated) : ""]) }
    : { title: `final-inventory-${tab}`,
        headers: ["Number", "Date", "Barcode", "Item", "Type", "Quantity", "Party", "Branch", "Delivery #", "Invoice", "Note", "Voided"],
        rows: (tab === "in" ? inMoves : outMoves).map((m) => [m.movement_no ?? "", when(m.created_at),
          m.barcode, m.name, m.movement_type, m.quantity, m.party ?? "", m.branch ?? "",
          m.delivery_no ?? "", m.invoice_no ?? "", m.note ?? "", m.voided_at ? "yes" : ""]) };

  const TABS: { k: Tab; label: string }[] = [
    { k: "materials", label: "Product list" }, { k: "stock", label: "Stock" },
    { k: "in", label: "In" }, { k: "out", label: "Out" },
  ];

  return (
    <>
      <Topbar title="Final Inventory" subtitle="Ready stock by barcode — its own materials, its own in and out" />

      <div className="space-y-4 px-6 pb-12">
        {err && <div className="rounded-xl2 border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-ink">{err}</div>}

        {/* The numbers first, in colour — the same visual language as the
            other departments, so this section does not look like a bolt-on. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-card bg-periwinkle-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Items</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">{items.length}</p>
          </div>
          <div className="rounded-card bg-success-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Pieces in stock</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">{n(items.reduce((a, i) => a + Number(i.quantity || 0), 0))}</p>
          </div>
          <div className="rounded-card bg-amber-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">In today</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">
              {n(moves.filter((m) => !m.voided_at && m.movement_type === "IN" && new Date(m.created_at).toDateString() === new Date().toDateString()).reduce((a, m) => a + Number(m.quantity), 0))}
            </p>
          </div>
          <div className="rounded-card bg-salmon-soft p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/55">Out today</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-ink">
              {n(moves.filter((m) => !m.voided_at && m.movement_type === "OUT" && new Date(m.created_at).toDateString() === new Date().toDateString()).reduce((a, m) => a + Number(m.quantity), 0))}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.k} onClick={() => { setTab(t.k); setCat(""); setQ(""); }}
              className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${tab === t.k ? "bg-ink text-white" : "border border-line text-ink/70 hover:bg-panel"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {(tab === "materials" || tab === "stock") && (
          <div className="flex flex-wrap gap-1.5">
            {["", "Kids", "Child", "Ladies", "Men"].map((c) => (
              <button key={c || "all"} onClick={() => setCat(c)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${cat === c ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
                {c || "All"}
                <span className="ml-1 opacity-60">{c ? items.filter((i) => i.category === c).length : items.length}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search barcode or name…"
              className="w-full rounded-xl2 border border-line bg-surface px-3 py-2 pr-16 text-[13px] outline-none focus:border-ink/30" />
            {q && (
              <button onClick={() => setQ("")} title="Clear"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-panel px-2 py-0.5 text-[11px] font-semibold text-ink/60">
                {(tab === "materials" || tab === "stock" ? fItems.length : (tab === "in" ? inMoves : outMoves).length)} ✕
              </button>
            )}
          </div>
          <button onClick={() => exportCSV(table())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
          <button onClick={() => exportExcel(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
          <button onClick={() => exportPDF(table())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
          {tab === "materials" && canManage && (
            <button onClick={() => setItemOpen(true)} className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white"><Plus size={15} /> Add material</button>
          )}
        </div>

        {loading && <p className="text-[13px] text-hint">Loading…</p>}

        {/* ---------- MATERIALS / STOCK ---------- */}
        {!loading && (tab === "materials" || tab === "stock") && (
          fItems.length === 0 ? (
            <div className="rounded-card border border-line bg-surface p-10 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><Boxes size={24} /></span>
              <p className="mt-3 text-[15px] font-semibold text-ink">Nothing here yet</p>
              <p className="mt-1 text-[13px] text-muted">Add a material with its barcode, then bring stock in.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                  <th className="px-4 py-2.5 font-bold">Barcode</th><th className="px-4 py-2.5 font-bold">Item</th>
                  <th className="px-4 py-2.5 font-bold">Category</th>
                  <th className="px-4 py-2.5 text-right font-bold">In stock</th>
                  <th className="px-4 py-2.5 font-bold">Last moved</th>
                </tr></thead>
                <tbody>
                  {fItems.map((i, ix) => (
                    <tr key={i.item_id} className={`border-b border-line/60 last:border-0 ${ix % 2 ? "bg-panel/25" : ""}`}>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-ink">{i.barcode}</td>
                      <td className="px-4 py-2.5 font-semibold text-ink">{i.name}
                        {i.description && <span className="block text-[11px] font-normal text-hint">{i.description}</span>}</td>
                      <td className="px-4 py-2.5">
                        {i.category
                          ? <span className="rounded-full bg-panel px-2 py-0.5 text-[11.5px] font-semibold text-ink/75">{i.category}</span>
                          : <span className="text-muted">—</span>}
                        {i.raw_material_reference && <span className="ml-1.5 text-[11px] text-hint">{i.raw_material_reference}</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right tnum font-bold ${i.quantity > 0 ? "text-ink" : "text-hint/60"}`}>{n(i.quantity)}</td>
                      <td className="px-4 py-2.5 text-[12px] text-muted">{i.last_updated ? when(i.last_updated) : "—"}
                        {tab === "materials" && canManage && (
                          <button onClick={() => delItem(i)} title="Remove item"
                            className="ml-2 rounded-full p-1 text-muted hover:text-danger">✕</button>
                        )}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )
        )}

        {/* ---------- IN / OUT ---------- */}
        {!loading && (tab === "in" || tab === "out") && (
          <>
            {canManage && (
              <div className="rounded-card border border-line bg-surface p-4">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                  {tab === "in" ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}
                  {tab === "in" ? "Bring stock in" : "Send stock out"}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <input value={scan} autoFocus
                    onChange={(e) => { setScan(e.target.value); setFound(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolve(); } }}
                    onBlur={resolve}
                    placeholder="Scan or type barcode, then Enter" className={inp} />
                  <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Quantity" className={inp} />
                  {tab === "out" ? (
                    <select value={partyId} onChange={(e) => { setPartyId(e.target.value); setBranchId(""); }} className={inp}>
                      <option value="">Party…</option>
                      {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inp} />
                  )}
                  <button onClick={() => record(tab === "in" ? "IN" : "OUT")} disabled={busy || !found}
                    className="flex items-center justify-center gap-1.5 rounded-xl2 bg-ink px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                    {busy && <Loader2 size={14} className="animate-spin" />}
                    Record {tab === "in" ? "in" : "out"}
                  </button>
                </div>
                {tab === "out" && (
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={!partyId} className={inp}>
                      <option value="">Branch (optional)…</option>
                      {branches.filter((b) => b.party_id === partyId).map((b) => <option key={b.id} value={b.id}>{b.branch}</option>)}
                    </select>
                    <input value={invNo} onChange={(e) => setInvNo(e.target.value)} placeholder="Party invoice number" className={inp} />
                    <button onClick={() => setPOpen(true)} className="rounded-xl2 border border-line px-3 py-2 text-[12.5px] font-semibold text-ink/70 hover:bg-panel">+ Party / branch</button>
                  </div>
                )}
                {found && (
                  <p className="mt-2 text-[12.5px] text-ink/80">
                    <b>{found.name}</b> · holding {n(found.quantity)}
                    {tab === "out" && parseFloat(qty) > found.quantity && (
                      <span className="text-danger"> — more than is there</span>)}
                  </p>
                )}
                {mErr && <p className="mt-2 text-[12.5px] font-medium text-danger">{mErr}</p>}
              </div>
            )}

            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
                <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-hint">
                  {tab === "out" && <th className="px-4 py-2.5 font-bold">#</th>}
                  <th className="px-4 py-2.5 font-bold">Date</th><th className="px-4 py-2.5 font-bold">Barcode</th>
                  <th className="px-4 py-2.5 font-bold">Item</th>
                  <th className="px-4 py-2.5 text-right font-bold">Qty</th>
                  <th className="px-4 py-2.5 font-bold">{tab === "out" ? "Went to" : "Note"}</th><th className="px-4 py-2.5"></th>
                </tr></thead>
                <tbody>
                  {(tab === "in" ? inMoves : outMoves).map((m) => (
                    <tr key={m.id} className={`border-b border-line/60 last:border-0 ${m.voided_at ? "opacity-45" : ""}`}>
                      {/* The delivery number is what the party quotes back at
                          you on the phone, so it reads first and reads big —
                          not buried in a sentence at the far right. */}
                      {tab === "out" && (
                        <td className="px-4 py-2.5">
                          {m.delivery_no
                            ? <span className="inline-flex min-w-[2.25rem] justify-center rounded-lg bg-ink px-2 py-1 text-[13px] font-extrabold tnum text-white">#{m.delivery_no}</span>
                            : <span className="text-hint">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-[12px] text-muted">{when(m.created_at)}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-ink">{m.barcode}</td>
                      <td className="px-4 py-2.5 font-semibold text-ink">{m.name}</td>
                      <td className="px-4 py-2.5 text-right tnum font-bold text-ink">{n(m.quantity)}</td>
                      <td className="px-4 py-2.5 text-[12px] text-hint">
                        {m.edited_at && !m.voided_at ? `edited · was ${n(Number(m.original_quantity ?? 0))} · ` : ""}
                        {m.voided_at ? `voided — ${m.void_reason ?? ""}`
                          : m.movement_type === "OUT"
                            ? `${m.party ?? ""}${m.branch ? " · " + m.branch : ""}${m.invoice_no ? " · inv " + m.invoice_no : ""}`
                            : (m.note ?? "")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canManage && !m.voided_at && editMv === m.id ? (
                          <span className="flex flex-wrap items-center justify-end gap-1.5">
                            <input value={eQty} autoFocus onChange={(e) => setEQty(e.target.value)}
                              type="number" placeholder="qty"
                              className="w-20 rounded-lg border border-ink/30 px-2 py-1 text-[12px] outline-none" />
                            {m.movement_type === "OUT" && (
                              <>
                                <select value={eBranch} onChange={(e) => setEBranch(e.target.value)}
                                  className="w-28 rounded-lg border border-ink/30 px-1.5 py-1 text-[12px] outline-none">
                                  <option value="">branch…</option>
                                  {branches.filter((b) => b.party === m.party).map((b) => <option key={b.id} value={b.id}>{b.branch}</option>)}
                                </select>
                                <input value={eInv} onChange={(e) => setEInv(e.target.value)} placeholder="invoice"
                                  className="w-28 rounded-lg border border-ink/30 px-2 py-1 text-[12px] outline-none" />
                              </>
                            )}
                            <button onClick={() => saveEdit(m)} className="text-[11px] font-bold text-ink">save</button>
                            <button onClick={() => setEditMv(null)} className="text-[11px] text-ink/50">cancel</button>
                          </span>
                        ) : canManage && !m.voided_at && (voidRow === m.id ? (
                          <span className="flex items-center justify-end gap-1.5">
                            <input value={voidWhy} autoFocus placeholder="reason"
                              onChange={(e) => setVoidWhy(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") voidMove(m.id); if (e.key === "Escape") { setVoidRow(null); setVoidWhy(""); } }}
                              className="w-36 rounded-lg border border-ink/30 px-2 py-1 text-[12px] outline-none" />
                            <button onClick={() => voidMove(m.id)} disabled={!voidWhy.trim()}
                              className="text-[11px] font-bold text-danger disabled:opacity-40">void</button>
                            <button onClick={() => { setVoidRow(null); setVoidWhy(""); }} className="text-[11px] text-ink/50">cancel</button>
                          </span>
                        ) : (
                          <span className="flex items-center justify-end gap-1">
                            <button onClick={() => startEdit(m)} title="Edit"
                              className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink"><Pencil size={14} /></button>
                            <button onClick={() => { setVoidRow(m.id); setVoidWhy(""); }} title="Void this movement"
                              className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-danger"><Undo2 size={14} /></button>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {(tab === "in" ? inMoves : outMoves).length === 0 && (
                    <tr><td colSpan={tab === "out" ? 7 : 6} className="px-4 py-8 text-center text-[13px] text-muted">Nothing recorded yet.</td></tr>
                  )}
                </tbody>
              </table></div>
            </div>
          </>
        )}
      </div>

      <Modal open={pOpen} onClose={() => setPOpen(false)} title="Add party or branch">
        <Field label="Belongs to (leave empty to add a new party)">
          <select value={pParty} onChange={(e) => setPParty(e.target.value)} className={inp}>
            <option value="">— new party —</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div className="mt-3"><Field label="Name *">
          <input value={pName} onChange={(e) => setPName(e.target.value)} autoFocus
            placeholder={pParty ? "branch name" : "party name"} className={inp} />
        </Field></div>
        <div className="mt-4 max-h-64 overflow-y-auto rounded-xl2 border border-line">
          {parties.map((pt) => (
            <div key={pt.id} className="border-b border-line/60 px-3 py-2 last:border-0">
              <div className="flex items-center justify-between gap-2">
                {editRow?.id === pt.id && !editRow.branch ? (
                  <input value={editVal} autoFocus
                    onChange={(e) => setEditVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditRow(null); }}
                    className="flex-1 rounded-lg border border-ink/30 px-2 py-1 text-[12.5px] outline-none" />
                ) : (
                  <span className="text-[12.5px] font-bold text-ink">{pt.name}</span>
                )}
                <span className="flex shrink-0 gap-2">
                  {editRow?.id === pt.id && !editRow.branch ? (
                    <>
                      <button onClick={saveRename} className="text-[11px] font-bold text-ink">save</button>
                      <button onClick={() => setEditRow(null)} className="text-[11px] text-ink/50">cancel</button>
                    </>
                  ) : killRow === pt.id ? (
                    <>
                      <span className="text-[11px] text-ink/60">
                        {moves.some((m) => m.party === pt.name) || branches.some((b) => b.party_id === pt.id) ? "hide it?" : "remove?"}
                      </span>
                      <button onClick={() => removeParty(pt)} className="text-[11px] font-bold text-danger">yes</button>
                      <button onClick={() => setKillRow(null)} className="text-[11px] text-ink/50">no</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditRow({ id: pt.id, branch: false }); setEditVal(pt.name); }}
                        className="text-[11px] font-semibold text-ink/50 hover:text-ink">rename</button>
                      <button onClick={() => setKillRow(pt.id)}
                        className="text-[11px] font-semibold text-danger/70 hover:text-danger">remove</button>
                    </>
                  )}
                </span>
              </div>

              {branches.filter((b) => b.party_id === pt.id).map((b) => (
                <div key={b.id} className="mt-1 flex items-center justify-between gap-2 pl-3">
                  {editRow?.id === b.id && editRow.branch ? (
                    <input value={editVal} autoFocus
                      onChange={(e) => setEditVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditRow(null); }}
                      className="flex-1 rounded-lg border border-ink/30 px-2 py-1 text-[12px] outline-none" />
                  ) : (
                    <span className="text-[12px] text-ink/70">{b.branch}
                      {b.deliveries > 0 && <span className="ml-1 text-[10.5px] text-hint">{b.deliveries} deliveries</span>}</span>
                  )}
                  <span className="flex shrink-0 gap-2">
                    {editRow?.id === b.id && editRow.branch ? (
                      <>
                        <button onClick={saveRename} className="text-[11px] font-bold text-ink">save</button>
                        <button onClick={() => setEditRow(null)} className="text-[11px] text-ink/50">cancel</button>
                      </>
                    ) : killRow === b.id ? (
                      <>
                        <span className="text-[11px] text-ink/60">{b.deliveries > 0 ? "hide it?" : "remove?"}</span>
                        <button onClick={() => removeBranch(b)} className="text-[11px] font-bold text-danger">yes</button>
                        <button onClick={() => setKillRow(null)} className="text-[11px] text-ink/50">no</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setEditRow({ id: b.id, branch: true }); setEditVal(b.branch); }}
                          className="text-[11px] font-semibold text-ink/50 hover:text-ink">rename</button>
                        <button onClick={() => setKillRow(b.id)}
                          className="text-[11px] font-semibold text-danger/70 hover:text-danger">remove</button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setPOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70">Cancel</button>
          <button onClick={addParty} disabled={busy} className="rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">Add</button>
        </div>
      </Modal>

      <Modal open={itemOpen} onClose={() => setItemOpen(false)} title="Add material">
        <Field label="Barcode *">
          <input value={bc} onChange={(e) => setBc(e.target.value)} autoFocus
            placeholder="scan it, or type the item number" className={inp} />
        </Field>
        <div className="mt-3"><Field label="Name *">
          <input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="e.g. FS MEN HOOD ZIP W026" className={inp} />
        </Field></div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Reference (opt)">
            <input value={rawRef} onChange={(e) => setRawRef(e.target.value)} placeholder="item # / section" className={inp} />
          </Field>
          <Field label="Description (opt)">
            <input value={desc} onChange={(e) => setDesc(e.target.value)} className={inp} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setItemOpen(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
          <button onClick={addItem} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />} Add
          </button>
        </div>
      </Modal>
    </>
  );
}
