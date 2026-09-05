"use client";
import { useEffect, useState, useCallback } from "react";
import { exportCSV, exportExcel, exportPDF, type ExportTable } from "@/lib/export";
import Topbar from "@/components/Topbar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Loader2, Plus, ClipboardList, X, Check, AlertTriangle, Trash2, Download } from "lucide-react";

type Article = { id: string; name: string; code: string };
type Order = { id: string; order_number: string; quantity: number; status: string; target_date: string | null; created_at: string; notes: string | null; article_id: string; article: { name?: string; code?: string } | null };
type Req = { material_label: string; required: number; unit_symbol: string; available: number; enough: boolean;
             owned: number; awaiting_sorting: number;
             /* K128. "You have none" and "you have 560 kg of the wrong kind"
                need different actions from whoever is at the screen. Showing
                both as 0 sends them hunting for stock that is right there. */
             problem: "ok" | "no_item" | "wrong_kind" | "unsorted" | "short";
             fix: string | null };

type Move = { id: string; movement_number: string; type: string; moved_at: string;
              material: string; item_code: string; quantity: number; unit: string;
              reason: string | null; department: string | null };

/* K123. Two numbers, both true: what you own, and what you can actually cut.
   Unsorted fabric is yours and it is on your floor — it just cannot be cut
   until somebody opens the Bora. */
type UsableItem = { item_id: string; item_code: string; group_id: string; material: string;
                    unit: string; usable: number; in_stock: number };
type Estimate =
  | { ok: false; guard: string; meaning: string; usable?: number; you_entered?: number }
  | { ok: true; pieces: number; from_this_material: number; limited_by: string | null;
      material_given: number; meaning: string };

/* What place_production_order (K120) hands back. It either refuses the whole
   order and lists every short line, or it succeeds and reports what it took
   out of stock. It never half-does the job. */
type ShortLine = { material?: string; item?: string; need: number; have: number; short: number; unit?: string };
type IssuedLine = { material?: string; item?: string; quantity: number };
type PlaceResult =
  | { ok: false; guard: string; wrote: number; short: ShortLine[]; meaning: string }
  | { ok: true; wrote: number; order: string; quantity: number; issued: IssuedLine[];
      material_cost: number; pending: number; floor: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-panel text-muted" },
  in_production: { label: "In production", cls: "bg-[#EEF2FF] text-[#4338CA]" },
  completed: { label: "Completed", cls: "bg-success-soft text-[#166534]" },
  cancelled: { label: "Cancelled", cls: "bg-danger-soft text-danger" },
};
function todayInput() { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
const fmtDate = (s: string | null) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const when = (s: string) => new Date(s).toLocaleString("en-PK", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const n = (v: number) => Number(v).toLocaleString("en-PK");

function Requirements({ reqs, loading }: { reqs: Req[] | null; loading: boolean }) {
  if (loading) return <div className="flex items-center gap-2 py-4 text-[13px] text-muted"><Loader2 size={15} className="animate-spin" /> Calculating…</div>;
  if (reqs === null) return null;
  if (reqs.length === 0) return <div className="rounded-xl2 bg-panel px-3.5 py-3 text-[12.5px] text-muted">No recipe set for this article yet — add one on the <b>Articles</b> screen, and material will calculate here automatically.</div>;
  return (
    <div className="overflow-hidden rounded-xl2 border border-line">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[12.5px]">
        <thead><tr className="bg-panel/60 text-[10.5px] uppercase tracking-wide text-muted"><th className="px-3 py-2 font-semibold">Material</th><th className="px-3 py-2 text-right font-semibold">Needed</th><th className="px-3 py-2 text-right font-semibold">Can cut</th><th className="px-3 py-2 text-right font-semibold">OK?</th></tr></thead>
        <tbody>
          {reqs.map((r, i) => (
            <tr key={i} className="border-t border-line/60">
              <td className="px-3 py-2 font-medium text-ink">
                {r.material_label}
                {/* Each shortage names its own remedy. Without this, "0"
                    against 560 kg of stickers reads as the system lying. */}
                {r.fix && <span className="mt-0.5 block text-[11px] font-normal leading-snug text-hint">{r.fix}</span>}
              </td>
              <td className="px-3 py-2 align-top text-right tnum font-semibold text-ink">{n(r.required)} {r.unit_symbol}</td>
              <td className="px-3 py-2 align-top text-right tnum text-muted">
                {n(r.available)} {r.unit_symbol}
                {Number(r.awaiting_sorting) > 0 && (
                  <span className="block text-[11px] text-hint">
                    {n(r.owned)} owned · {n(r.awaiting_sorting)} not sorted yet
                  </span>
                )}
              </td>
              <td className="px-3 py-2 align-top text-right">
                {r.enough ? <Check size={15} className="ml-auto text-[#166534]" /> : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
                    <AlertTriangle size={11} />
                    {r.problem === "no_item" ? "No item" :
                     r.problem === "wrong_kind" ? "Wrong kind" :
                     r.problem === "unsorted" ? "Unsorted" : "Short"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(false);
  const [articleId, setArticleId] = useState("");
  const [qty, setQty] = useState("");
  const [targetDate, setTargetDate] = useState(todayInput());
  const [notes, setNotes] = useState("");
  const [reqs, setReqs] = useState<Req[] | null>(null);

  /* K123 — the order works both ways. "I want 100 shirts, what material?"
     and "I am giving 100 kg, how many shirts?" are the same question asked
     from opposite ends, and the second one is how the floor actually thinks. */
  const [mode, setMode] = useState<"pieces" | "material">("pieces");
  const [usableItems, setUsableItems] = useState<UsableItem[]>([]);
  const [srcItem, setSrcItem] = useState("");
  const [srcQty, setSrcQty] = useState("");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estLoading, setEstLoading] = useState(false);
  const [reqLoading, setReqLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<PlaceResult | null>(null);

  const [detail, setDetail] = useState<Order | null>(null);

  /* K125 — issue, return and wastage live on the order now, not on a
     separate screen. Giving material out and getting it back are two halves
     of the same sentence: "we gave 25 kg, we got 2 back". Split across two
     screens with no order attached, that sentence cannot be written down. */
  const [moves, setMoves] = useState<Move[]>([]);
  const [mvType, setMvType] = useState<"return" | "wastage">("return");
  const [mvItem, setMvItem] = useState("");
  const [mvQty, setMvQty] = useState("");
  const [mvReason, setMvReason] = useState("");
  const [mvBusy, setMvBusy] = useState(false);
  const [mvErr, setMvErr] = useState("");
  /* A return has to name the floor it came back from, and only one
     department receives work — the unit K118 created. Read it rather than
     hardcoding a code that could be renamed. */
  const [unitId, setUnitId] = useState<string | null>(null);

  /* K132 — the order has TWO sections, because they are two different
     moments. A RAW material order (fabric + thread) starts production and
     goes to the floor. OTHER materials (sticker, shopper, zip) are added
     onto the order later, when the pieces are back and being finished. One
     dropdown offering everything mixes the two moments and invites fabric
     mistakes at packing time. */
  const [section, setSection] = useState<"raw" | "other">("raw");
  const [groupCodes, setGroupCodes] = useState<Record<string, string>>({}); // group_id -> code
  const [otherItem, setOtherItem] = useState("");
  const [otherQty, setOtherQty] = useState("");
  const [otherPrice, setOtherPrice] = useState("");
  const [otherPriceTouched, setOtherPriceTouched] = useState(false);
  const [otherBusy, setOtherBusy] = useState(false);
  const [otherErr, setOtherErr] = useState("");
  const [orderCosts, setOrderCosts] = useState<{ material: string; issued: number | null; unit: string; material_cost: number }[]>([]);

  type OtherOrder = { id: string; movement_number: string; moved_at: string;
                      order_number: string | null; material: string; quantity: number;
                      unit: string; unit_price: number | null; line_value: number };
  const [otherOrders, setOtherOrders] = useState<OtherOrder[]>([]);
  const loadOther = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("v_order_movements")
      .select("id,movement_number,moved_at,order_number,material,quantity,unit,unit_price,line_value,order_section,type")
      .eq("type", "issue").eq("order_section", "other")
      .order("moved_at", { ascending: false });
    setOtherOrders((data as unknown as OtherOrder[]) ?? []);
  }, []);
  useEffect(() => { if (section === "other") loadOther(); }, [section, loadOther]);

  const rawTable = (): ExportTable => ({
    title: "raw-material-orders",
    headers: ["Order", "Article", "Pieces", "Target", "Placed", "Status"],
    rows: orders.map((o) => [o.order_number, o.article?.name ?? "", o.quantity,
      fmtDate(o.target_date), when(o.created_at), o.status]),
  });
  const otherTable = (): ExportTable => ({
    title: "other-material-orders",
    headers: ["Number", "Date", "Production order", "Material", "Qty", "Unit", "Price", "Value Rs"],
    rows: otherOrders.map((m) => [m.movement_number, when(m.moved_at), m.order_number ?? "",
      m.material, m.quantity, m.unit, m.unit_price ?? "batch rate", m.line_value]),
  });

  const RAW = ["FAB", "THR"];
  const OTHER = ["STK", "PKG", "ZIP"];
  const rawItems = usableItems.filter((u) => RAW.includes(groupCodes[u.group_id] ?? ""));
  const otherItems = usableItems.filter((u) => OTHER.includes(groupCodes[u.group_id] ?? ""));
  const [detailReqs, setDetailReqs] = useState<Req[] | null>(null);
  const [detailStatus, setDetailStatus] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false); const [deleting, setDeleting] = useState(false); const [delErr, setDelErr] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [o, a, pm1, pm2] = await Promise.all([
      supabase.from("production_orders").select("id,order_number,quantity,status,target_date,created_at,notes,article_id, articles(name,code)").order("created_at", { ascending: false }),
      supabase.from("articles").select("id,name,code").eq("is_active", true).order("name"),
      supabase.rpc("has_permission", { p_permission_code: "production.entry" }),
      supabase.rpc("has_permission", { p_permission_code: "production.manage" }),
    ]);
    setOrders(((o.data as unknown as Record<string, unknown>[]) ?? []).map((r) => ({
      id: r.id as string, order_number: r.order_number as string, quantity: Number(r.quantity), status: r.status as string,
      target_date: (r.target_date as string) || null, created_at: r.created_at as string, notes: (r.notes as string) || null, article_id: r.article_id as string,
      article: (r.articles as { name?: string; code?: string }) || null,
    })));
    setArticles((a.data as Article[]) ?? []);
    setCanManage(!!pm1.data || !!pm2.data);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // live material requirement in the create modal
  useEffect(() => {
    if (!supabase || !articleId || !(parseInt(qty) > 0)) { setReqs(null); return; }
    let off = false; setReqLoading(true);
    supabase.rpc("get_order_requirements", { p_article_id: articleId, p_quantity: parseInt(qty) }).then(({ data }) => {
      if (!off) { setReqs((data as Req[]) ?? []); setReqLoading(false); }
    });
    return () => { off = true; };
  }, [articleId, qty]);

  function openCreate() { setModal(true); setArticleId(""); setQty(""); setTargetDate(todayInput()); setNotes(""); setReqs(null); setErr(""); setResult(null); setMode("pieces"); setSrcItem(""); setSrcQty(""); setEstimate(null); }

  /* Only material you can actually cut is offered. Listing unsorted fabric
     here would invite somebody to plan an order against it and be refused
     at the last step, which teaches people the system is unreliable when it
     is in fact being careful. */
  useEffect(() => {
    if (!supabase || !modal) return;
    supabase.from("v_usable_stock").select("item_id,item_code,group_id,material,unit,usable,in_stock")
      .gt("usable", 0).order("material")
      .then(({ data }) => setUsableItems((data as UsableItem[]) ?? []));
  }, [modal]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("v_usable_stock").select("item_id,item_code,group_id,material,unit,usable,in_stock")
      .gt("usable", 0).order("material")
      .then(({ data }) => setUsableItems((prev) => prev.length ? prev : ((data as UsableItem[]) ?? [])));
    supabase.from("departments").select("id").eq("kind", "section").eq("in_process", true)
      .limit(1).maybeSingle()
      .then(({ data }) => setUnitId((data as { id: string } | null)?.id ?? null));
    supabase.from("material_groups").select("id,code")
      .then(({ data }) => setGroupCodes(Object.fromEntries(
        ((data as { id: string; code: string }[]) ?? []).map((g) => [g.id, g.code]))));
  }, []);

  useEffect(() => {
    if (!supabase || mode !== "material" || !articleId || !srcItem || !(parseFloat(srcQty) > 0)) {
      setEstimate(null); return;
    }
    let off = false; setEstLoading(true);
    supabase.rpc("estimate_pieces_from_material", {
      p_article_id: articleId, p_item_id: srcItem, p_quantity: parseFloat(srcQty),
    }).then(({ data, error }) => {
      if (off) return;
      setEstLoading(false);
      setEstimate(error ? { ok: false, guard: "could not calculate", meaning: error.message } : (data as Estimate));
    });
    return () => { off = true; };
  }, [mode, articleId, srcItem, srcQty]);

  /* PLACING AN ORDER IS FOUR THINGS AT ONCE (K120): the recipe multiplies out,
     the material leaves stock, the order is created, and the floor is handed
     the pending count. They happen in one transaction so they can never drift
     apart.

     The old call, create_production_order, only wrote the order row. Material
     stayed on the shelf and nobody told the floor — so the screen said an
     order existed while the factory disagreed. */
  async function create() {
    setErr(""); setResult(null);
    if (!supabase) return;
    if (!articleId) { setErr("Choose an article."); return; }
    if (!(parseInt(qty) > 0)) { setErr("Enter a quantity."); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("place_production_order", {
      p_article_id: articleId,
      p_quantity: parseInt(qty),
      p_target_date: targetDate || null,
      p_notes: notes,
      p_lines: null,
      p_dry_run: false,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }

    const r = data as PlaceResult;
    /* A refusal is not an error. The database looked, found the order could
       not be made, and deliberately wrote nothing. Showing it as a red crash
       would teach people to ignore it. */
    if (!r?.ok) { setResult(r); return; }
    setResult(r);
    load();
  }

  async function openDetail(o: Order) {
    setDetail(o); setDetailReqs(null); setDetailStatus(o.status);
    setMoves([]); setMvItem(""); setMvQty(""); setMvReason(""); setMvErr(""); setMvType("return");
    setOtherItem(""); setOtherQty(""); setOtherPrice(""); setOtherPriceTouched(false); setOtherErr(""); setOrderCosts([]);
    if (!supabase) return;
    loadMoves(o.id);
    loadCosts(o.id);
    setConfirmDel(false); setDelErr("");
    if (!supabase) return;
    const { data } = await supabase.rpc("get_order_requirements", { p_article_id: o.article_id, p_quantity: o.quantity });
    setDetailReqs((data as Req[]) ?? []);
  }
  async function loadMoves(orderId: string) {
    if (!supabase) return;
    const { data } = await supabase.from("v_order_movements")
      .select("id,movement_number,type,moved_at,material,item_code,quantity,unit,reason,department")
      .eq("production_order_id", orderId).order("moved_at", { ascending: false });
    setMoves((data as Move[]) ?? []);
  }

  async function loadCosts(orderId: string) {
    if (!supabase) return;
    const { data } = await supabase.from("v_order_material")
      .select("material,issued,unit,material_cost")
      .eq("order_id", orderId);
    setOrderCosts((data as typeof orderCosts) ?? []);
  }

  /* The sticker's price "comes up automatically" — the latest batch rate for
     that item — and stays editable, because what you agreed for THIS job can
     differ from what the supplier last charged. Whatever ends up in the box
     is frozen onto the line by K132, so next month's purchase cannot reprice
     this order. */
  useEffect(() => {
    if (!supabase || !otherItem || otherPriceTouched) return;
    let off = false;
    supabase.from("stock_lots").select("rate").eq("item_id", otherItem)
      .order("received_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (!off) setOtherPrice(String((data as { rate: number } | null)?.rate ?? "")); });
    return () => { off = true; };
  }, [otherItem, otherPriceTouched]);

  async function addOther() {
    if (!supabase || !detail) return;
    setOtherErr("");
    if (!otherItem) { setOtherErr("Choose the material."); return; }
    if (!(parseFloat(otherQty) > 0)) { setOtherErr("Enter a quantity."); return; }
    if (!(parseFloat(otherPrice) >= 0)) { setOtherErr("Enter the price."); return; }
    setOtherBusy(true);
    const { error } = await supabase.rpc("post_stock_movement", {
      p_type: "issue",
      p_department_id: null,     // stickers go on at packing — no floor
      p_employee_id: null,
      p_reason: "other material added to order",
      p_moved_at: new Date().toISOString(),
      p_direction: null,
      p_lines: [{ item_id: otherItem, quantity: parseFloat(otherQty), unit_price: parseFloat(otherPrice) }],
      p_production_order_id: detail.id,
    });
    setOtherBusy(false);
    if (error) { setOtherErr(error.message); return; }
    setOtherItem(""); setOtherQty(""); setOtherPrice(""); setOtherPriceTouched(false);
    loadMoves(detail.id); loadCosts(detail.id); loadOther();
  }

  /* A return puts material back on the shelf; wastage writes it off. Both
     name this order, so v_order_material can work out what a shirt actually
     cost instead of what the recipe hoped it would cost. */
  async function recordMove() {
    if (!supabase || !detail) return;
    setMvErr("");
    if (!mvItem) { setMvErr("Choose the material."); return; }
    if (!(parseFloat(mvQty) > 0)) { setMvErr("Enter a quantity."); return; }
    if (mvType === "wastage" && !mvReason.trim()) { setMvErr("Say what happened to it."); return; }
    setMvBusy(true);
    const { error } = await supabase.rpc("post_stock_movement", {
      p_type: mvType,
      p_department_id: mvType === "return" ? unitId : null,
      p_employee_id: null,
      p_reason: mvReason || null,
      p_moved_at: new Date().toISOString(),
      p_direction: null,
      p_lines: [{ item_id: mvItem, quantity: parseFloat(mvQty) }],
      p_production_order_id: detail.id,
    });
    setMvBusy(false);
    if (error) { setMvErr(error.message); return; }
    setMvItem(""); setMvQty(""); setMvReason("");
    loadMoves(detail.id);
  }

  async function saveStatus() {
    if (!supabase || !detail) return;
    setSavingStatus(true);
    const { error } = await supabase.rpc("update_production_order", { p_id: detail.id, p_quantity: detail.quantity, p_target_date: detail.target_date, p_notes: detail.notes, p_status: detailStatus });
    setSavingStatus(false);
    if (!error) { setDetail(null); load(); }
  }

  async function doDelete() {
    if (!supabase || !detail) return;
    setDelErr(""); setDeleting(true);
    const { error } = await supabase.rpc("delete_production_order", { p_id: detail.id });
    setDeleting(false);
    if (error) { setDelErr(error.message); return; }
    setDetail(null); load();
  }

  return (
    <>
      <Topbar title="Production Orders" subtitle="Make N pieces of an article — material is deducted and the floor is told" />
      <div className="px-6 pb-12">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to manage production orders.</div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <>
            {/* THE TWO SECTIONS. Raw starts production; Other finishes it.
                Same orders underneath — the tab changes what you DO to one. */}
            <div className="mb-4 flex rounded-xl2 bg-panel p-1">
              <button onClick={() => setSection("raw")}
                className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${section === "raw" ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
                Raw material order
                <span className="ml-1.5 hidden text-[11px] font-normal text-hint sm:inline">fabric + thread → floor</span>
              </button>
              <button onClick={() => setSection("other")}
                className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${section === "other" ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
                Other material order
                <span className="ml-1.5 hidden text-[11px] font-normal text-hint sm:inline">sticker · shopper · zip</span>
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[12.5px] text-muted">
                {section === "raw"
                  ? <>Create an order and the system multiplies the article&apos;s recipe to show exactly what material you need.{!canManage && " (View only.)"}</>
                  : <>Open an order and add sticker, shopper or zip onto it — the price comes up on its own and adds to the order&apos;s cost.</>}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                {(() => { const t = section === "raw" ? rawTable : otherTable; return (
                  <>
                    <button onClick={() => exportCSV(t())} className="flex items-center gap-1 rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel"><Download size={13} /> CSV</button>
                    <button onClick={() => exportExcel(t())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">Excel</button>
                    <button onClick={() => exportPDF(t())} className="rounded-full border border-line px-3 py-2 text-[12px] font-semibold text-ink/70 hover:bg-panel">PDF</button>
                  </>
                ); })()}
                {canManage && section === "raw" && <button onClick={openCreate} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white"><Plus size={15} /> New order</button>}
              </div>
            </div>

            {section === "other" ? (
              otherOrders.length === 0 ? (
                <div className="rounded-card bg-surface p-10 text-center shadow-card">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><ClipboardList size={26} /></span>
                  <p className="mt-3 text-[15px] font-semibold text-ink">No other-material orders yet</p>
                  <p className="mt-1 text-[13px] text-muted">Open a production order and add a sticker, shopper or zip — each addition becomes its own order here.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-card bg-surface shadow-card">
                  <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13.5px]">
                    <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-semibold">Number</th><th className="px-5 py-3 font-semibold">For order</th>
                      <th className="px-5 py-3 font-semibold">Material</th><th className="px-5 py-3 text-right font-semibold">Qty</th>
                      <th className="px-5 py-3 text-right font-semibold">Price</th><th className="px-5 py-3 text-right font-semibold">Value</th>
                      <th className="px-5 py-3 font-semibold">Date</th>
                    </tr></thead>
                    <tbody>
                      {otherOrders.map((m) => (
                        <tr key={m.id} className="border-b border-line/60 last:border-0">
                          <td className="px-5 py-3 font-mono text-[12px] text-ink">{m.movement_number}</td>
                          <td className="px-5 py-3 text-ink/80">{m.order_number ?? "—"}</td>
                          <td className="px-5 py-3 font-semibold text-ink">{m.material}</td>
                          <td className="px-5 py-3 text-right tnum text-ink/80">{n(m.quantity)} {m.unit}</td>
                          <td className="px-5 py-3 text-right tnum text-muted">{m.unit_price == null ? "batch rate" : `Rs ${n(m.unit_price)}`}</td>
                          <td className="px-5 py-3 text-right tnum font-semibold text-ink">Rs {n(m.line_value)}</td>
                          <td className="px-5 py-3 text-[12.5px] text-muted">{when(m.moved_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>
              )
            ) : orders.length === 0 ? (
              <div className="rounded-card bg-surface p-10 text-center shadow-card">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel text-ink"><ClipboardList size={26} /></span>
                <p className="mt-3 text-[15px] font-semibold text-ink">No orders yet</p>
                <p className="mt-1 text-[13px] text-muted">Create your first production order to see material auto-calculated.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-card bg-surface shadow-card">
                <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><table className="w-full text-left text-[13.5px]">
                  <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-5 py-3 font-semibold">Order</th><th className="px-5 py-3 font-semibold">Article</th>
                    <th className="px-5 py-3 text-right font-semibold">Pieces</th><th className="px-5 py-3 font-semibold">Target</th>
                    <th className="px-5 py-3 font-semibold">Placed</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {orders.map((o) => {
                      const st = STATUS[o.status] || STATUS.open;
                      return (
                        <tr key={o.id} className="border-b border-line/60 last:border-0">
                          <td className="px-5 py-3"><button onClick={() => openDetail(o)} className="font-mono text-[12px] text-ink underline decoration-dotted underline-offset-2 hover:text-salmon-strong">{o.order_number}</button></td>
                          <td className="px-5 py-3 font-semibold text-ink">{o.article?.name || "—"}</td>
                          <td className="px-5 py-3 text-right tnum text-ink/80">{n(o.quantity)}</td>
                          <td className="px-5 py-3 text-ink/70">{fmtDate(o.target_date)}</td>
                          <td className="px-5 py-3 text-[12.5px] text-muted">{when(o.created_at)}</td>
                          <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${st.cls}`}>{st.label}</span></td>
                          <td className="px-5 py-3 text-right"><button onClick={() => openDetail(o)} className="rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:bg-panel">View</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              </div>
            )}
          </>
        )}
      </div>

      {/* create modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !saving && setModal(false)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-[16px] font-extrabold">New production order</h2><button onClick={() => setModal(false)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button></div>
            <label className="block text-[12px] font-medium text-muted">Article *</label>
            <select value={articleId} onChange={(e) => setArticleId(e.target.value)} className={inp}>
              <option value="">Choose article…</option>
              {articles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div className="mt-3 flex rounded-xl2 bg-panel p-1">
              <button onClick={() => { setMode("pieces"); setEstimate(null); }}
                className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${mode === "pieces" ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
                I want N pieces
              </button>
              <button onClick={() => { setMode("material"); setQty(""); }}
                className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${mode === "material" ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
                I&apos;m giving material
              </button>
            </div>

            {mode === "material" && (
              <div className="mt-3 rounded-xl2 border border-line p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] font-medium text-muted">Material you are giving</label>
                    <select value={srcItem} onChange={(e) => setSrcItem(e.target.value)} className={inp}>
                      <option value="">Choose…</option>
                      {/* A raw order is fabric and thread. Stickers, shoppers
                          and zips are added later, on the Other tab, when the
                          pieces are back — offering them here mixes the two
                          moments. */}
                      {rawItems.map((u) => (
                        <option key={u.item_id} value={u.item_id}>
                          {u.material} · {u.item_code} — {n(u.usable)} {u.unit} ready
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-muted">How much</label>
                    <input type="number" value={srcQty} onChange={(e) => setSrcQty(e.target.value)} placeholder="e.g. 100" className={inp} />
                  </div>
                </div>

                {rawItems.length === 0 && (
                  <p className="mt-2 text-[12px] text-muted">
                    No fabric or thread in stock yet. Receive some and it appears here.
                  </p>
                )}

                {estLoading && <p className="mt-2 flex items-center gap-2 text-[12.5px] text-muted"><Loader2 size={14} className="animate-spin" /> Working it out…</p>}

                {estimate && !estimate.ok && (
                  <p className="mt-2 text-[12.5px] text-danger">{estimate.meaning}</p>
                )}

                {estimate && estimate.ok && (
                  <div className="mt-3 rounded-xl2 bg-panel px-3.5 py-3">
                    <p className="text-[13px] font-bold text-ink">
                      {n(estimate.material_given)} makes {n(estimate.pieces)} pieces
                    </p>
                    {/* The fabric alone is never the answer. If thread runs out
                        at 250 the honest number is 250, and it says which
                        material held it back. */}
                    {estimate.limited_by && (
                      <p className="mt-1 text-[12px] text-ink/75">
                        The fabric alone is worth {n(estimate.from_this_material)}, but {estimate.limited_by} only supports {n(estimate.pieces)}.
                      </p>
                    )}
                    <button
                      onClick={() => { setQty(String(estimate.pieces)); setMode("pieces"); }}
                      disabled={estimate.pieces <= 0}
                      className="mt-2.5 rounded-xl2 bg-ink px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">
                      Use {n(estimate.pieces)} pieces
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><label className="block text-[12px] font-medium text-muted">Pieces to make *</label><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 100" className={inp} /></div>
              <div><label className="block text-[12px] font-medium text-muted">Target date</label><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inp} /></div>
            </div>
            <label className="mt-3 block text-[12px] font-medium text-muted">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" className={inp} />

            {(articleId && parseInt(qty) > 0) && (
              <div className="mt-4"><p className="mb-2 text-[12px] font-semibold text-ink">Material needed for this order</p><Requirements reqs={reqs} loading={reqLoading} /></div>
            )}

            {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}

            {/* REFUSED — nothing was written. Every short line is listed, not
                just the first, so one trip to the store fixes all of them. */}
            {result && !result.ok && (
              <div className="mt-4 rounded-xl2 border border-danger/30 bg-danger-soft p-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-danger">
                  <AlertTriangle size={15} /> Order not placed — {result.guard}
                </p>
                <ul className="mt-2 space-y-1">
                  {result.short?.map((s, i) => (
                    <li key={i} className="flex justify-between gap-3 text-[12.5px] text-ink/80">
                      <span className="font-medium">{s.material || s.item}</span>
                      <span className="tnum">
                        short {n(s.short)} {s.unit || ""} · need {n(s.need)}, have {n(s.have)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[12px] leading-relaxed text-ink/70">{result.meaning}</p>
              </div>
            )}

            {/* PLACED — say exactly what moved, so it can be checked against
                the shelf rather than taken on trust. */}
            {result && result.ok && (
              <div className="mt-4 rounded-xl2 border border-[#166534]/25 bg-success-soft p-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#166534]">
                  <Check size={15} /> {result.order} placed
                </p>
                <p className="mt-1 text-[12.5px] text-ink/80">
                  {n(result.pending)} pieces pending with <b>{result.floor}</b>. Material below has left stock.
                </p>
                <ul className="mt-2 space-y-1">
                  {result.issued?.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 text-[12.5px] text-ink/80">
                      <span className="font-medium">{l.material || l.item}</span>
                      <span className="tnum">−{n(l.quantity)}</span>
                    </li>
                  ))}
                </ul>
                {result.material_cost > 0 && (
                  <p className="mt-2 text-[12px] text-ink/70">
                    Material cost at batch rates: <b className="tnum">Rs {n(result.material_cost)}</b>
                  </p>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              {result?.ok ? (
                <button onClick={() => setModal(false)} className="rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white">Done</button>
              ) : (
                <>
                  <button onClick={() => setModal(false)} disabled={saving} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
                  <button onClick={create} disabled={saving} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />}Place order &amp; issue material</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !savingStatus && setDetail(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between"><h2 className="text-[16px] font-extrabold">{detail.order_number}</h2><button onClick={() => setDetail(null)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button></div>
            <p className="text-[13px] text-muted">{detail.article?.name} · <b className="text-ink">{n(detail.quantity)}</b> pieces · target {fmtDate(detail.target_date)}</p>
            <p className="text-[12px] text-muted">Placed {when(detail.created_at)}</p>
            {detail.notes && <p className="mt-1 text-[12.5px] text-muted">Note: {detail.notes}</p>}

            <p className="mb-2 mt-4 text-[12px] font-semibold text-ink">Material needed</p>
            <Requirements reqs={detailReqs} loading={detailReqs === null} />

            {/* ---- K125: what actually moved on this order ---- */}
            <p className="mb-2 mt-5 text-[12px] font-semibold text-ink">Material movements</p>
            {moves.length === 0 ? (
              <p className="rounded-xl2 bg-panel px-3.5 py-3 text-[12.5px] text-muted">
                Nothing recorded yet beyond what the order issued.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl2 border border-line">
                <table className="w-full text-left text-[12.5px]">
                  <tbody>
                    {moves.map((m) => (
                      <tr key={m.id} className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            m.type === "issue" ? "bg-panel text-ink"
                            : m.type === "return" ? "bg-success-soft text-[#166534]"
                            : "bg-danger-soft text-danger"}`}>{m.type}</span>
                        </td>
                        <td className="px-3 py-2 text-ink">{m.material}</td>
                        <td className="px-3 py-2 text-right tnum font-semibold text-ink">
                          {m.type === "return" ? "+" : "−"}{n(m.quantity)} {m.unit}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-hint">{m.reason ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canManage && (
              <div className="mt-3 rounded-xl2 border border-line p-3">
                <p className="text-[12.5px] font-bold text-ink">Add other material — sticker · shopper · zip</p>
                <p className="mt-0.5 text-[11.5px] text-hint">Goes onto this order at the price below. No floor needed — this happens at packing.</p>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  <select value={otherItem}
                    onChange={(e) => { setOtherItem(e.target.value); setOtherPriceTouched(false); setOtherErr(""); }}
                    className={inp}>
                    <option value="">Which one…</option>
                    {otherItems.map((u) => (
                      <option key={u.item_id} value={u.item_id}>{u.material} · {u.item_code} — {n(u.usable)} {u.unit}</option>
                    ))}
                  </select>
                  <input type="number" value={otherQty} onChange={(e) => setOtherQty(e.target.value)} placeholder="Quantity" className={inp} />
                  <input type="number" value={otherPrice}
                    onChange={(e) => { setOtherPrice(e.target.value); setOtherPriceTouched(true); }}
                    placeholder="Price / unit" className={inp} />
                </div>
                {otherItem && otherQty && otherPrice && parseFloat(otherQty) > 0 && (
                  <p className="mt-2 text-[12px] text-ink/75">
                    Adds <b className="tnum">Rs {n(parseFloat(otherQty) * parseFloat(otherPrice))}</b> to this order.
                  </p>
                )}
                {otherErr && <p className="mt-2 text-[12px] font-medium text-danger">{otherErr}</p>}
                <button onClick={addOther} disabled={otherBusy}
                  className="mt-2.5 flex items-center gap-1.5 rounded-xl2 bg-ink px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">
                  {otherBusy && <Loader2 size={14} className="animate-spin" />} Add to order
                </button>
              </div>
            )}

            {orderCosts.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-xl2 border border-line">
                <table className="w-full text-left text-[12.5px]">
                  <thead><tr className="bg-panel/60 text-[10.5px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-semibold">Material on this order</th>
                    <th className="px-3 py-2 text-right font-semibold">Used</th>
                    <th className="px-3 py-2 text-right font-semibold">Cost</th>
                  </tr></thead>
                  <tbody>
                    {orderCosts.map((c, i) => (
                      <tr key={i} className="border-t border-line/60">
                        <td className="px-3 py-2 text-ink">{c.material}</td>
                        <td className="px-3 py-2 text-right tnum text-muted">{c.issued == null ? "—" : n(c.issued)} {c.unit}</td>
                        <td className="px-3 py-2 text-right tnum font-semibold text-ink">Rs {n(c.material_cost)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line bg-panel/40">
                      <td className="px-3 py-2 font-bold text-ink" colSpan={2}>Material cost so far</td>
                      <td className="px-3 py-2 text-right tnum font-extrabold text-ink">
                        Rs {n(orderCosts.reduce((a, c) => a + Number(c.material_cost || 0), 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {canManage && (
              <div className="mt-3 rounded-xl2 border border-line p-3">
                <div className="flex gap-2">
                  <button onClick={() => { setMvType("return"); setMvErr(""); }}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${mvType === "return" ? "bg-ink text-white" : "bg-panel text-muted"}`}>
                    Material came back
                  </button>
                  <button onClick={() => { setMvType("wastage"); setMvErr(""); }}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${mvType === "wastage" ? "bg-ink text-white" : "bg-panel text-muted"}`}>
                    Spoiled on the floor
                  </button>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <select value={mvItem} onChange={(e) => setMvItem(e.target.value)} className={inp}>
                    <option value="">Which material…</option>
                    {usableItems.map((u) => (
                      <option key={u.item_id} value={u.item_id}>{u.material} · {u.item_code}</option>
                    ))}
                  </select>
                  <input type="number" value={mvQty} onChange={(e) => setMvQty(e.target.value)} placeholder="Quantity" className={inp} />
                </div>
                <input value={mvReason} onChange={(e) => setMvReason(e.target.value)} className={inp}
                  placeholder={mvType === "wastage" ? "what happened to it — required" : "note (optional)"} />
                {mvErr && <p className="mt-2 text-[12px] font-medium text-danger">{mvErr}</p>}
                <button onClick={recordMove} disabled={mvBusy}
                  className="mt-2.5 flex items-center gap-1.5 rounded-xl2 bg-ink px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">
                  {mvBusy && <Loader2 size={14} className="animate-spin" />}
                  Record {mvType === "return" ? "return" : "wastage"}
                </button>
              </div>
            )}

            {canManage && (
              <div className="mt-5 border-t border-line pt-4">
                <label className="block text-[12px] font-medium text-muted">Status</label>
                <div className="mt-1.5 flex gap-2">
                  <select value={detailStatus} onChange={(e) => setDetailStatus(e.target.value)} className={inp}>
                    <option value="open">Open</option><option value="in_production">In production</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                  </select>
                  <button onClick={saveStatus} disabled={savingStatus || detailStatus === detail.status} className="flex shrink-0 items-center gap-1.5 rounded-xl2 bg-ink px-5 text-[13px] font-semibold text-white disabled:opacity-40">{savingStatus && <Loader2 size={15} className="animate-spin" />}Save</button>
                </div>
                {!confirmDel ? (
                  <button onClick={() => setConfirmDel(true)} className="mt-4 flex items-center gap-1.5 text-[12.5px] font-semibold text-danger hover:underline"><Trash2 size={14} /> Delete this order</button>
                ) : (
                  <div className="mt-4 rounded-xl2 bg-danger-soft p-3">
                    <p className="text-[12.5px] font-medium text-danger">Delete {detail.order_number}? This can&apos;t be undone.</p>
                    {delErr && <p className="mt-1 text-[12px] text-danger">{delErr}</p>}
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => setConfirmDel(false)} disabled={deleting} className="rounded-xl2 border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink/70">Cancel</button>
                      <button onClick={doDelete} disabled={deleting} className="flex items-center gap-1.5 rounded-xl2 bg-danger px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">{deleting && <Loader2 size={14} className="animate-spin" />}Yes, delete</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const inp = "mt-1.5 w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
