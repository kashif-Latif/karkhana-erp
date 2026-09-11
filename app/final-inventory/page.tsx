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
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Boxes, Plus, Loader2, Download, Undo2, Pencil, Trash2, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
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
              delivery_no: number | null; branch_id: string | null; party_id: string | null;
              invoice_gap_reason: string | null;
              original_quantity: number | null; edited_at: string | null;
              barcode: string; name: string };
type Party = { id: string; name: string };
type Branch = { id: string; party_id: string; party: string; branch: string; deliveries: number };
type Tab = "materials" | "stock" | "in" | "out";

const inp = "w-full rounded-xl2 border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/30";
const n = (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const when = (v: string) => new Date(v).toLocaleString();

function WarehouseInner() {
  const { can } = usePermissions();
  const canManage = can(["khana.manage"]);

  const urlTab = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(
    urlTab === "in" || urlTab === "out" || urlTab === "materials" ? urlTab : "stock");
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
  const [gapWhy, setGapWhy] = useState("");
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
  /* Voided rows stay out of the way by default — they are corrections, not
     work. The toggle keeps them one click away rather than gone. */
  const [showVoided, setShowVoided] = useState(false);
  const [delRow, setDelRow] = useState<string | null>(null);
  /* Quick ranges for the common questions — what moved today, this week —
     and two date boxes for anything else. Same day in both means that one
     day. Stock filters on when an item last moved, which is the only date
     a holding has. */
  const [days, setDays] = useState<number | null>(null);
  const [dFrom, setDFrom] = useState("");
  const [dTo, setDTo] = useState("");
  /* Out is read by WHO it went to; In is read by WHAT came in. Different
     questions, so different dropdowns rather than one generic filter that
     answers neither well. */
  const [fParty, setFParty] = useState("");
  const [fBranch, setFBranch] = useState("");
  const [fItem, setFItem] = useState("");
  const [fCat, setFCat] = useState("");
  /* Editing an item is a plain update; correcting stock is not — it writes a
     movement (K146), so the total never stops matching its own history. */
  const [editItem, setEditItem] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eBar, setEBar] = useState("");
  const [eItemCat, setEItemCat] = useState("");
  const [stockRow, setStockRow] = useState<string | null>(null);
  const [sQty, setSQty] = useState("");
  const [sWhy, setSWhy] = useState("");

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

  const inRange = (iso: string | null) => {
    if (!iso) return !days && !dFrom && !dTo;   // never moved: only in "All time"
    const day = String(iso).slice(0, 10);
    if (days !== null) {
      const edge = new Date();
      edge.setHours(0, 0, 0, 0);
      edge.setDate(edge.getDate() - (days - 1));
      if (new Date(day) < edge) return false;
    }
    if (dFrom && day < dFrom) return false;
    if (dTo && day > dTo) return false;
    return true;
  };
  const hit = (...v: (string | null)[]) =>
    !q.trim() || v.some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase()));
  const fItems = useMemo(() => {
    const list = items.filter((i) => (!cat || i.category === cat)
      && hit(i.barcode, i.name, i.category, i.raw_material_reference)
      && (tab === "materials" || inRange(i.last_updated)));
    /* Stock is read to answer "what do we have" — so what we have most of
       goes first. The product list stays alphabetical, because that is
       read to find one specific thing. */
    return tab === "stock"
      ? [...list].sort((a, b) => Number(b.quantity) - Number(a.quantity) || a.name.localeCompare(b.name))
      : list;
  }, [items, q, cat, tab, days, dFrom, dTo]);
  /* The last invoice this branch was given, and what should follow it.
     Purely numeric numbers get a suggestion; anything else is left alone
     rather than guessed at. */
  const lastInvoice = useMemo(() => {
    const rows = moves.filter((m) => m.movement_type === "OUT" && !m.voided_at
      && m.invoice_no && m.party_id === partyId
      && (branchId ? m.branch_id === branchId : !m.branch_id));
    return rows.length ? rows[0].invoice_no : null;   // already newest-first
  }, [moves, partyId, branchId]);
  const expectedInvoice = useMemo(() => {
    if (!lastInvoice || !/^\d+$/.test(lastInvoice)) return null;
    return String(BigInt(lastInvoice) + BigInt(1)).padStart(lastInvoice.length, "0");
  }, [lastInvoice]);
  const invoiceGap = !!(expectedInvoice && invNo.trim() && invNo.trim() !== expectedInvoice);

  const catOf = (bc: string) => items.find((i) => i.barcode === bc)?.category ?? null;
  const fMoves = useMemo(() => moves.filter((m) =>
    hit(m.barcode, m.name, m.movement_no) && inRange(m.created_at)
    && (!fParty  || m.party === fParty)
    && (!fBranch || m.branch === fBranch)
    && (!fItem   || m.barcode === fItem)
    && (!fCat    || catOf(m.barcode) === fCat)
  ), [moves, items, q, days, dFrom, dTo, fParty, fBranch, fItem, fCat]);
  const visible = fMoves.filter((m) => showVoided || !m.voided_at);
  const inMoves = visible.filter((m) => m.movement_type === "IN");
  const outMoves = visible.filter((m) => m.movement_type === "OUT")
    .sort((a, b) => (a.party ?? "").localeCompare(b.party ?? "")
                 || (a.branch ?? "").localeCompare(b.branch ?? "")
                 || (b.delivery_no ?? 0) - (a.delivery_no ?? 0));
  const voidedCount = fMoves.filter((m) => m.voided_at).length;

  /* The scanner types the code and presses Enter. Resolving on Enter — not
     on every keystroke — means a half-typed code never matches the wrong
     item and starts a movement against it. */
  useEffect(() => {
    if (expectedInvoice && !invNo) setInvNo(expectedInvoice);
  }, [expectedInvoice]);

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
      invoice_gap_reason: type === "OUT" && invoiceGap ? (gapWhy.trim() || null) : null,
    });
    setBusy(false);
    /* The database refuses an OUT larger than stock (K138). Showing its own
       words is better than inventing a friendlier lie — it names both
       numbers. */
    if (error) { setMErr(error.message); return; }
    setScan(""); setFound(null); setQty(""); setNote(""); setInvNo(""); setGapWhy(""); load();
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

  async function deleteMove(id: string) {
    if (!supabase) return;
    const { error } = await supabase.rpc("khana_delete_movement", { p_id: id });
    if (error) { setErr(error.message); return; }
    setDelRow(null); load();
  }

  async function saveItem(i: Item) {
    if (!supabase) return;
    if (!eName.trim() || !eBar.trim()) { setErr("Name and barcode are both needed."); return; }
    const { error } = await supabase.from("khana_final_items")
      .update({ name: eName.trim(), barcode: eBar.trim(), category: eItemCat || null })
      .eq("id", i.item_id);
    if (error) { setErr(error.message.includes("duplicate") ? "That barcode belongs to another item." : error.message); return; }
    setEditItem(null); load();
  }

  async function saveStock(i: Item) {
    if (!supabase) return;
    if (!sWhy.trim()) { setErr("Say why the figure is changing."); return; }
    const { error } = await supabase.rpc("khana_set_stock", {
      p_item_id: i.item_id, p_new_quantity: parseFloat(sQty), p_reason: sWhy.trim(),
    });
    if (error) { setErr(error.message); return; }
    setStockRow(null); setSQty(""); setSWhy(""); load();
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

  /* In and Out ARE the warehouse's GRNs — goods arriving and goods leaving.
     Naming them so makes the whole system speak one language. */
  const TABS: { k: Tab; label: string }[] = [
    { k: "in", label: "New GRN" }, { k: "out", label: "Out GRN" },
    { k: "stock", label: "Stock" }, { k: "materials", label: "Products" },
  ];

  return (
    <>
      <Topbar title="Warehouse" subtitle="Ready stock by barcode — its own GRNs in and out" />

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
            <button key={t.k} onClick={() => { setTab(t.k); setCat(""); setQ(""); setDays(null); setDFrom(""); setDTo(""); setFParty(""); setFBranch(""); setFItem(""); setFCat(""); }}
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

        {tab !== "materials" && (
          <div className="flex flex-wrap items-center gap-1.5">
            {[{ l: "All time", d: null }, { l: "Today", d: 1 }, { l: "2 days", d: 2 },
              { l: "5 days", d: 5 }, { l: "This week", d: 7 }, { l: "30 days", d: 30 }].map((r) => (
              <button key={r.l}
                onClick={() => { setDays(r.d); setDFrom(""); setDTo(""); }}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${days === r.d && !dFrom && !dTo ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
                {r.l}
              </button>
            ))}
            <input type="date" value={dFrom} onChange={(e) => { setDFrom(e.target.value); setDays(null); }}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
            <span className="text-[12px] text-hint">to</span>
            <input type="date" value={dTo} onChange={(e) => { setDTo(e.target.value); setDays(null); }}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] outline-none" />
          </div>
        )}

        {(tab === "in" || tab === "out") && (
          <div className="flex flex-wrap items-center gap-2">
            {tab === "out" && (
              <>
                <select value={fParty} onChange={(e) => { setFParty(e.target.value); setFBranch(""); }}
                  className="rounded-xl2 border border-line bg-surface px-3 py-2 text-[12.5px] outline-none focus:border-ink/30">
                  <option value="">All parties</option>
                  {parties.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
                {/* Only the chosen party's branches — offering DHA under
                    Carrefour would return nothing and look broken. */}
                <select value={fBranch} onChange={(e) => setFBranch(e.target.value)} disabled={!fParty}
                  className="rounded-xl2 border border-line bg-surface px-3 py-2 text-[12.5px] outline-none disabled:opacity-45">
                  <option value="">{fParty ? "All branches" : "Pick a party first"}</option>
                  {branches.filter((b) => b.party === fParty).map((b) => <option key={b.id} value={b.branch}>{b.branch}</option>)}
                </select>
              </>
            )}
            <select value={fCat} onChange={(e) => { setFCat(e.target.value); setFItem(""); }}
              className="rounded-xl2 border border-line bg-surface px-3 py-2 text-[12.5px] outline-none focus:border-ink/30">
              <option value="">All categories</option>
              {["Kids", "Child", "Ladies", "Men"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={fItem} onChange={(e) => setFItem(e.target.value)}
              className="max-w-[15rem] rounded-xl2 border border-line bg-surface px-3 py-2 text-[12.5px] outline-none focus:border-ink/30">
              <option value="">All products</option>
              {items.filter((i) => !fCat || i.category === fCat)
                    .map((i) => <option key={i.item_id} value={i.barcode}>{i.name}</option>)}
            </select>
            {(fParty || fBranch || fItem || fCat) && (
              <button onClick={() => { setFParty(""); setFBranch(""); setFItem(""); setFCat(""); }}
                className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink/60 hover:bg-panel">Clear</button>
            )}
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
          {(tab === "in" || tab === "out") && voidedCount > 0 && (
            <button onClick={() => setShowVoided((v) => !v)}
              className={`rounded-full px-3 py-2 text-[12px] font-semibold transition ${showVoided ? "bg-ink text-white" : "border border-line text-ink/65 hover:bg-panel"}`}>
              {showVoided ? "Hide" : "Show"} voided ({voidedCount})
            </button>
          )}
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
                      <td className="px-4 py-2.5 font-mono text-[12px] text-ink">
                        {editItem === i.item_id
                          ? <input value={eBar} onChange={(e) => setEBar(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveItem(i); if (e.key === "Escape") setEditItem(null); }}
                              className="w-36 rounded-lg border border-ink/30 px-2 py-1 font-mono text-[12px] outline-none" />
                          : i.barcode}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-ink">
                        {editItem === i.item_id ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <input value={eName} autoFocus onChange={(e) => setEName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveItem(i); if (e.key === "Escape") setEditItem(null); }}
                              className="w-48 rounded-lg border border-ink/30 px-2 py-1 text-[12px] font-normal outline-none" />
                            <select value={eItemCat} onChange={(e) => setEItemCat(e.target.value)}
                              className="rounded-lg border border-ink/30 px-1.5 py-1 text-[12px] font-normal outline-none">
                              <option value="">no category</option>
                              {["Kids", "Child", "Ladies", "Men"].map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button onClick={() => saveItem(i)} className="text-[11px] font-bold text-ink">save</button>
                            <button onClick={() => setEditItem(null)} className="text-[11px] font-normal text-ink/50">cancel</button>
                          </span>
                        ) : (<>{i.name}
                          {i.description && <span className="block text-[11px] font-normal text-hint">{i.description}</span>}</>)}
                      </td>
                      <td className="px-4 py-2.5">
                        {i.category
                          ? <span className="rounded-full bg-panel px-2 py-0.5 text-[11.5px] font-semibold text-ink/75">{i.category}</span>
                          : <span className="text-muted">—</span>}
                        {i.raw_material_reference && <span className="ml-1.5 text-[11px] text-hint">{i.raw_material_reference}</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right tnum font-bold ${i.quantity > 0 ? "text-ink" : "text-hint/60"}`}>
                        {stockRow === i.item_id ? (
                          <span className="flex items-center justify-end gap-1.5">
                            <input type="number" value={sQty} autoFocus onChange={(e) => setSQty(e.target.value)}
                              className="w-20 rounded-lg border border-ink/30 px-2 py-1 text-right text-[12px] outline-none" />
                            <input value={sWhy} onChange={(e) => setSWhy(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveStock(i); if (e.key === "Escape") setStockRow(null); }}
                              placeholder="why" className="w-28 rounded-lg border border-ink/30 px-2 py-1 text-left text-[12px] outline-none" />
                            <button onClick={() => saveStock(i)} className="text-[11px] font-bold text-ink">save</button>
                            <button onClick={() => setStockRow(null)} className="text-[11px] text-ink/50">✕</button>
                          </span>
                        ) : n(i.quantity)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted">
                        {i.last_updated ? when(i.last_updated) : "—"}
                        {canManage && (
                          <span className="ml-2 inline-flex gap-2">
                            {tab === "stock" ? (
                              <button onClick={() => { setStockRow(i.item_id); setSQty(String(i.quantity)); setSWhy(""); }}
                                className="text-[11px] font-semibold text-ink/50 hover:text-ink">set stock</button>
                            ) : (
                              <>
                                <button onClick={() => { setEditItem(i.item_id); setEName(i.name); setEBar(i.barcode); setEItemCat(i.category ?? ""); }}
                                  className="text-[11px] font-semibold text-ink/50 hover:text-ink">edit</button>
                                {killRow === i.item_id ? (
                                  <>
                                    <span className="text-[11px] text-ink/60">remove?</span>
                                    <button onClick={() => delItem(i)} className="text-[11px] font-bold text-danger">yes</button>
                                    <button onClick={() => setKillRow(null)} className="text-[11px] text-ink/50">no</button>
                                  </>
                                ) : (
                                  <button onClick={() => setKillRow(i.item_id)}
                                    className="text-[11px] font-semibold text-danger/70 hover:text-danger">remove</button>
                                )}
                              </>
                            )}
                          </span>
                        )}
                      </td>
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
                {tab === "out" && lastInvoice && (
                  <p className="mt-2 text-[12px] text-ink/70">
                    Last invoice for {branches.find((b) => b.id === branchId)?.branch ?? parties.find((p) => p.id === partyId)?.name}: <b className="tnum">{lastInvoice}</b>
                    {expectedInvoice && <> · next expected <b className="tnum">{expectedInvoice}</b></>}
                  </p>
                )}
                {tab === "out" && invoiceGap && (
                  <div className="mt-2 rounded-xl2 border border-amber-soft bg-amber-soft/50 p-2.5">
                    <p className="text-[12.5px] font-semibold text-ink">
                      Expected {expectedInvoice}, you entered {invNo.trim()}.
                    </p>
                    <input value={gapWhy} onChange={(e) => setGapWhy(e.target.value)}
                      placeholder="why the gap? (optional — e.g. bulk book, cancelled pad)"
                      className={`${inp} mt-2`} />
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
                  {(tab === "in" ? inMoves : outMoves).map((m, mi, arr) => (
                    <>
                    {tab === "out" && (mi === 0 || `${arr[mi-1].party}|${arr[mi-1].branch}` !== `${m.party}|${m.branch}`) && (
                      <tr key={`h-${m.id}`} className="bg-panel/60">
                        <td colSpan={7} className="px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-ink/70">
                          {m.party ?? "—"}{m.branch ? ` · ${m.branch}` : ""}
                        </td>
                      </tr>
                    )}
                    <tr key={m.id} className={`border-b border-line/60 last:border-0 ${m.voided_at ? "opacity-45" : ""}`}>
                      {/* The delivery number is what the party quotes back at
                          you on the phone, so it reads first and reads big —
                          not buried in a sentence at the far right. */}
                      {tab === "out" && (
                        <td className="px-4 py-2.5">
                          {m.delivery_no
                            ? <span className="tnum text-[12.5px] font-bold text-ink/70">#{m.delivery_no}</span>
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
                        {canManage && m.voided_at ? (
                          delRow === m.id ? (
                            <span className="flex items-center justify-end gap-1.5">
                              <span className="text-[11px] text-ink/60">delete for good?</span>
                              <button onClick={() => deleteMove(m.id)} className="text-[11px] font-bold text-danger">yes</button>
                              <button onClick={() => setDelRow(null)} className="text-[11px] text-ink/50">no</button>
                            </span>
                          ) : (
                            <button onClick={() => setDelRow(m.id)} title="Delete this voided movement"
                              className="rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-danger"><Trash2 size={14} /></button>
                          )
                        ) : canManage && !m.voided_at && editMv === m.id ? (
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
                    </>
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

export default function FinalInventoryPage() {
  return <Suspense fallback={null}><WarehouseInner /></Suspense>;
}
