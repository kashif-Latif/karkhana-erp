"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Undo2, PackageCheck, Wallet, RefreshCw, Loader2, ArrowLeft, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Modal, { Field, inputCls, btnPrimary, btnGhost } from "@/components/Modal";
import { PRESETS, rangeDates, rs } from "@/lib/dateRange";
import { useLiveTables } from "@/lib/useLiveTables";

/* Returns live under Logistics, not Finance — a return is a parcel problem
   first and a money problem second, and the people chasing them are the
   logistics team.

   Three sections, because three different questions get asked:

     Pending returns    nobody here has confirmed the box  OLDEST first
     Pending delivered  delivered, money not in           newest first

   Pending returns is deliberately oldest-first: couriers stop honouring claims
   after a while, so the row most likely to cost money is the one at the top. */

type Section = "pending_returns" | "closed_returns" | "delivered_unpaid";

const TABS: { key: Section; label: string; hint: string }[] = [
  { key: "pending_returns",  label: "Pending returns",   hint: "Still needs chasing — not confirmed received, and not yet cancelled in Shopify. Newest first; the AGE column flags the ones going stale." },
  /* A CLOSED RETURN HAD NOWHERE TO LIVE.
     Pending filters needs_chasing, and a return closed by the nightly job or by
     a settlement no longer needs chasing. The other tab is delivered parcels.
     So a real parcel — #4715, returned in May 2025, closed correctly — could not
     be seen anywhere in this screen, and searching for it said "Nothing here."
     which reads as "this does not exist". */
  { key: "closed_returns",   label: "Closed returns",   hint: "Came back and no longer being chased — received, settled by a CPR, or closed automatically after nine days. The reason is on each row." },
  { key: "delivered_unpaid", label: "Returns Delivered", hint: "Delivered to the customer, but the COD has not reached you. This is the receivable." },
];

type ReturnRow = {
  tracking_id: string; order_number: string | null; store_code: string | null;
  courier: string | null; cod_amount: number | null; stage: string | null; cpr_number: string | null;
  courier_reason: string | null; courier_reason_text: string | null;
  shopify_reason: string | null; shopify_note: string | null;
  agent_note: string | null; order_tags: string[] | null;
  order_cancelled_at: string | null; needs_chasing: boolean;
  customer_name: string | null; city: string | null;
  return_date: string | null; return_received_at: string | null; received: boolean;
  return_claim_status: string | null; age_days: number | null;
};

type UnpaidRow = {
  tracking_id: string; order_number: string | null; store_code: string | null;
  courier: string | null; cod_amount: number | null; delivery_date: string | null;
  payment_status: string | null; cpr_number: string | null;
  customer_name: string | null; city: string | null; age_days: number | null;
};

type SectionCount = { section: string; n: number; value: number; oldest_days: number };

const PAGE = 500;

export default function ReturnsPage() {
  const [tab, setTab] = useState<Section>("pending_returns");
  // Which tab a search moved us to, so the jump is explained rather than silent.
  const [jumped, setJumped] = useState("");
  /* HOW OFTEN EACH COURIER BRINGS PARCELS BACK.
     The list said which parcels came back; nothing said whether that was
     normal. OwnEx ran at 14.5% in June, 25.2% in July and 14.9% in August —
     a swing worth Rs 190,000 that nobody could see. */
  type Rate = { month_label: string; courier: string;
                delivered: number; returned: number;
                return_pct: number | null; change_pts: number | null;
                cod_returned: number | null; is_part_month: boolean };
  const [rates, setRates] = useState<Rate[]>([]);
  /* Closed by default. The parcel list is what this page is opened for, and a
     twelve-row table above it pushed the work below the fold. The rate belongs
     one click away, not in the way. */
  const [showRates, setShowRates] = useState(false);
  const [rows, setRows] = useState<(ReturnRow | UnpaidRow)[]>([]);
  const [counts, setCounts] = useState<SectionCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [preset, setPreset] = useState("all");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [store, setStore] = useState("ALL");
  const [courier, setCourier] = useState("All couriers");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

  /* Same request-token guard as Logistics: switching tab or range can leave two
     queries in the air, and without this the slower, older one wins and paints
     figures that belong to a range the user already moved off. */
  const reqId = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean; figuresOnly?: boolean }) => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const my = ++reqId.current;
    if (!opts?.silent) setLoading(true);
    setErr("");
    const [from, to] = rangeDates(preset, cf, ct);

    const view = tab === "delivered_unpaid" ? "v_delivered_unpaid" : "v_returns_all";  // closed returns come from the same view, filtered below
    const dateCol = tab === "delivered_unpaid" ? "delivery_date" : "return_date";
    /* OLDEST FIRST, on both tabs.
       A chase list is worked from the top, and the oldest parcel is the one
       closest to being written off — so it should be the first thing seen, not
       something found by scrolling. Newest-first put the parcel that came back
       an hour ago above the one that has been missing for three months.

       This was newest-first briefly at Zeeshan's request and has been changed
       back deliberately. */
    // Oldest first on the chase list, because the top row is the one closest to
    // being written off. Closed returns are history — newest first there.
    const ascending = tab !== "closed_returns";

    /* Same fix as Orders: a search asks the database, not the 1,000 rows the
       page happens to hold. #4715 is a real parcel that has been in this table
       since May 2025, and searching for it returned "Nothing here." */
    const term = q.trim();
    let rq = supabase.from(view).select("*")
      .order(dateCol, { ascending, nullsFirst: false })
      .limit(PAGE);
    /* A SEARCH ASKS POSTGRES, NOT THE PAGE.
       Even with .or() the query is still capped at 1,000 rows and still bound
       to one tab. hub_find_return searches the whole table — tracking number,
       order number, customer, phone — across every store, any date, any state,
       and says which state each result is in.

       The tracking number is matched exactly first, because it is the only
       identifier a courier issues rather than a person types. */
    if (term) {
      const { data: found, error: fe } = await supabase.rpc("hub_find_return", { p_q: term });
      setLoading(false);
      if (fe) { setErr(fe.message); return; }
      setRows((found as unknown as (ReturnRow | UnpaidRow)[]) ?? []);
      setJumped("");
      return;
    }
    // the same flag hub_returns_sections() counts, so the card and the list can
    // never disagree — a return acknowledged by cancelling in Shopify drops out
    /* A SEARCH LOOKS EVERYWHERE, NOT JUST IN THIS TAB.
       Typing an order number is asking for that parcel. Filtering the answer by
       whichever tab happened to be open is how #4715 — a real, correctly closed
       return — produced "Nothing here." on both tabs in turn. With a term, the
       chase filter comes off and the row is shown with its own status. */
    if (!term) {
      if (tab === "pending_returns") rq = rq.eq("needs_chasing", true);
      if (tab === "closed_returns")  rq = rq.eq("needs_chasing", false);
    }
    // A search ignores the date window, for the same reason as Orders.
    if (!term) {
      if (from) rq = rq.gte(dateCol, from);
      if (to) rq = rq.lte(dateCol, to);
    }
    if (store !== "ALL") rq = rq.eq("store_code", store);
    if (courier !== "All couriers") rq = rq.eq("courier", courier);

    const [r, rt, c] = await Promise.all([
      opts?.figuresOnly ? Promise.resolve({ data: null, error: null }) : rq,
      supabase.rpc("hub_return_rates", { p_months: 12 }),
      supabase.rpc("hub_returns_sections", {
        p_store: store === "ALL" ? null : store,
        p_courier: courier === "All couriers" ? null : courier,
        p_from: from, p_to: to,
      }),
    ]);

    if (my !== reqId.current) return;      // superseded — discard
    setRates((rt.data as Rate[]) ?? []);
    if (r.error) setErr(r.error.message);
    // figuresOnly refreshes the counts and leaves the list alone
    if (!opts?.figuresOnly) setRows((r.data as (ReturnRow | UnpaidRow)[]) ?? []);

    /* A SEARCH GOES TO THE TAB THE PARCEL IS ACTUALLY IN.
       Searching across tabs stopped "Nothing here." for a parcel that exists,
       but it then displayed a received return underneath a heading that says
       "still needs chasing" — which is its own kind of wrong answer. If every
       match belongs somewhere else, move there rather than describing it. */
    if (!term) setJumped("");
    if (term && !opts?.figuresOnly && tab !== "delivered_unpaid") {
      const found = (r.data as ReturnRow[]) ?? [];
      if (found.length) {
        const allClosed  = found.every((x) => x.needs_chasing === false);
        const allChasing = found.every((x) => x.needs_chasing === true);
        if (tab === "pending_returns" && allClosed)  { setJumped("Closed returns");  setTab("closed_returns"); }
        if (tab === "closed_returns"  && allChasing) { setJumped("Pending returns"); setTab("pending_returns"); }
      }
    }
    setCounts((c.data as SectionCount[]) ?? []);
    setLoading(false);
  }, [tab, preset, cf, ct, store, courier, q]);

  useEffect(() => { load(); }, [load]);
  /* Figures only on a live tick — the same reason as Orders and Logistics.
     A courier status change should update the counts, not re-pull the list. */
  useLiveTables(["online_logistics"], useCallback(() => load({ silent: true, figuresOnly: true }), [load]));

  const find = (k: string) => counts.find((c) => c.section === k);
  /* Closed = every return, minus the ones still being chased. Counted from the
     same RPC rather than a second query, so the three cards can never disagree
     about how many returns exist. */
  const closedCount = Math.max(0, (find("all_returns")?.n ?? 0) - (find("pending_returns")?.n ?? 0));
  const closedValue = Math.max(0, (find("all_returns")?.value ?? 0) - (find("pending_returns")?.value ?? 0));

  const cards = [
    { key: "pending_returns" as Section, label: "Pending returns", Icon: Undo2, bg: "bg-amber-soft",
      n: find("pending_returns")?.n ?? 0, v: find("pending_returns")?.value ?? 0,
      sub: find("pending_returns")?.oldest_days ? `oldest ${find("pending_returns")?.oldest_days}d` : undefined },
    /* THE CLOSED TAB HAD NO CARD.
       I added a third tab and left the card row at two, so switching to Closed
       returns highlighted nothing and the Pending card — still showing 26 —
       read as the selected one. A parcel correctly moved to Closed looked like
       it was still stuck in Pending, which is the exact confusion the tab was
       added to remove.

       The count comes from the same figures the RPC already returns: everything
       that came back, less what is still chased. */
    { key: "closed_returns" as Section, label: "Closed returns", Icon: PackageCheck, bg: "bg-periwinkle-soft",
      n: closedCount, v: closedValue, sub: "no longer chased" },
    { key: "delivered_unpaid" as Section, label: "Returns Delivered", Icon: Wallet, bg: "bg-success-soft",
      n: find("delivered_unpaid")?.n ?? 0, v: find("delivered_unpaid")?.value ?? 0,
      sub: find("delivered_unpaid")?.oldest_days ? `oldest ${find("delivered_unpaid")?.oldest_days}d` : undefined },
  ];

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) =>
      String(r.order_number ?? "").toLowerCase().includes(n) ||
      String(r.tracking_id ?? "").toLowerCase().includes(n) ||
      String(r.customer_name ?? "").toLowerCase().includes(n));
  }, [rows, q]);

  const isReturns = tab !== "delivered_unpaid";

  /* A courier saying "returned" is not the same as the parcel being on your
     shelf, so nothing marks itself received — a person has to confirm they are
     holding the box, and record who and when. That is what closes any open
     claim, so it cannot be a silent one-click action.

     The signature matters: mark_return_received takes an ARRAY of tracking ids
     plus date, receiver, condition and notes. Calling it with a single id and
     three arguments is why this returned 404 — PostgREST could not find a
     function with that shape. */
  async function receive(f: { date: string; by: string; condition: string; notes: string }) {
    if (!supabase || !picked.length) return;
    /* Send today when the field is blank, rather than null. The function now
       defends against this too, but a page that sends null to a date column
       deciding whether a parcel is still chased should not rely on the other
       side catching it. */
    setBusy(true);
    const { error } = await supabase.rpc("mark_return_received", {
      p_tracking_ids: picked,
      p_received_at: f.date || new Date().toISOString().slice(0, 10),
      p_received_by: f.by || null,
      p_condition: f.condition,
      p_notes: f.notes || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setShowReceive(false); setPicked([]); load();
  }

  return (
    <div className="px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <Link href="/online/logistics" className="mb-1 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted transition hover:text-ink dark:text-[#a89f93] dark:hover:text-white">
        <ArrowLeft size={14} /> Logistics
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px] dark:text-[#f4f1ea]">Returns</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">{TABS.find((t) => t.key === tab)?.hint}</p>
        </div>
        <button onClick={() => load()} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* range */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${preset === p.key ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <>
            <input type="date" value={cf} onChange={(e) => setCf(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
            <input type="date" value={ct} onChange={(e) => setCt(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
          </>
        )}
        <select value={store} onChange={(e) => setStore(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
          {["ALL", "LM", "TS", "TRZ"].map((s) => <option key={s} value={s}>{s === "ALL" ? "All stores" : s}</option>)}
        </select>
        <select value={courier} onChange={(e) => setCourier(e.target.value)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
          {["All couriers", "PostEx", "OwnEx"].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order or tracking — looks everywhere"
          className="min-w-[200px] flex-1 rounded-full border border-line bg-surface px-4 py-2 text-[13px] text-ink outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white" />
      </div>

      {/* the three sections as cards — click to switch */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <button key={c.key} onClick={() => setTab(c.key)}
            className={`rounded-card p-4 text-left transition ${c.bg} ${tab === c.key ? "ring-2 ring-ink dark:ring-white/40" : "opacity-80 hover:opacity-100"} dark:bg-white/[0.05]`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><c.Icon size={15} /></span>
            <div className="mt-3 text-[22px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : c.n.toLocaleString()}</div>
            <div className="text-[12.5px] font-semibold text-ink dark:text-[#f4f1ea]">{c.label}</div>
            <div className="text-[11.5px] text-muted dark:text-[#a89f93]">{rs(c.v)}{c.sub ? ` · ${c.sub}` : ""}</div>
          </button>
        ))}
      </div>

      {err && <p className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-danger"><AlertTriangle size={15} /> {err}</p>}

      {isReturns && picked.length > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 dark:border-white/10 dark:bg-white/[0.05]">
          <span className="text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">{picked.length} selected</span>
          <button onClick={() => setShowReceive(true)} disabled={busy}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-semibold text-white dark:bg-white dark:text-[#141414]">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <PackageCheck size={13} />} Mark received
          </button>
          <button onClick={() => setPicked([])} className="text-[12.5px] font-semibold text-muted dark:text-[#a89f93]">Clear</button>
        </div>
      )}

      {/* HOW OFTEN EACH COURIER BRINGS PARCELS BACK.
          The list says which parcels came back; this says whether that is
          normal. PostEx has sat near 21% since March — a rate, not a bad month.
          OwnEx swung 14.5% to 25.2% and back — an incident. Two different
          problems, and neither was visible before.

          Always shown in full, and deliberately not affected by the filters
          above: picking "30 days" would empty a table whose whole purpose is
          the comparison across months. */}
      {rates.length > 0 && (
        <div className="mt-4 rounded-card border border-line bg-surface dark:border-white/10 dark:bg-[#201c17]">
          {/* The headline sits in the button itself, so the current rate is
              readable without opening anything — only the history costs a click. */}
          <button onClick={() => setShowRates((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-panel dark:hover:bg-white/[0.04]">
            <span className="text-[13px] font-semibold text-ink dark:text-[#f4f1ea]">
              Return rate
              {(() => {
                const done = rates.filter((x) => !x.is_part_month);
                return ["PostEx", "OwnEx"].map((cr) => {
                  const rows = done.filter((x) => x.courier === cr);
                  const now = rows[0], prev = rows[1];
                  if (!now) return null;
                  const pc = Number(now.return_pct ?? 0);
                  const d = prev ? pc - Number(prev.return_pct ?? 0) : null;
                  return (
                    <span key={cr} className="ml-3 text-[12.5px] font-normal text-muted dark:text-[#a89f93]">
                      {cr} <b className="text-ink dark:text-[#f4f1ea]">{pc.toFixed(1)}%</b>
                      {d !== null && (
                        <span className={d <= 0 ? "text-emerald-700" : "text-red-700"}>
                          {" "}{d > 0 ? "+" : ""}{d.toFixed(1)}
                        </span>
                      )}
                    </span>
                  );
                });
              })()}
            </span>
            <span className="shrink-0 text-[11.5px] font-semibold text-muted dark:text-[#a89f93]">
              {showRates ? "Hide months" : "Month by month"}
            </span>
          </button>
          {showRates && (
          <div className="overflow-x-auto border-t border-line dark:border-white/10">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted dark:border-white/[0.06] dark:text-[#a89f93]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Month</th>
                  <th className="px-4 py-2.5 font-semibold">Courier</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Delivered</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Returned</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Rate</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Change</th>
                  <th className="px-4 py-2.5 text-right font-semibold">COD returned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-white/[0.06]">
                {rates.filter((x) => x.courier === "PostEx" || x.courier === "OwnEx").map((x, i) => {
                  const pc = Number(x.return_pct ?? 0);
                  const d  = x.change_pts === null ? null : Number(x.change_pts);
                  return (
                    <tr key={`${x.month_label}-${x.courier}-${i}`} className="text-ink dark:text-[#e7e2d8]">
                      <td className="px-4 py-2.5">
                        {x.month_label}
                        {x.is_part_month && (
                          <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-hint dark:bg-white/[0.06]">
                            still running
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{x.courier}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted dark:text-[#a89f93]">{x.delivered}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{x.returned}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums">{pc.toFixed(1)}%</td>
                      {/* Fewer returns is better, so a fall is the green one. */}
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                        d === null ? "text-hint" : d <= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {d === null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted dark:text-[#a89f93]">
                        {rs(Number(x.cod_returned ?? 0))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-white/[0.03]">
        <table className="w-full min-w-[880px] text-left text-[13px]">
          <thead className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted dark:border-white/[0.06] dark:text-[#a89f93]">
            <tr>
              {isReturns && <th className="w-10 px-4 py-3" />}
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Store</th>
              <th className="px-4 py-3 font-semibold">Courier</th>
              <th className="px-4 py-3 font-semibold">Tracking</th>
              {/* Which settlement covered this parcel. On a return it shows what
                  the courier charged for the trip back; on a delivered parcel,
                  what paid for it. Either way it is the document to go to when
                  a figure is questioned. */}
              <th className="px-4 py-3 font-semibold">CPR / Invoice</th>
              <th className="px-4 py-3 font-semibold">{isReturns ? "Return date" : "Delivered"}</th>
              <th className="px-4 py-3 text-right font-semibold">COD</th>
              <th className="px-4 py-3 text-right font-semibold">Age</th>
              {isReturns
                ? <><th className="px-4 py-3 font-semibold">Stage</th><th className="px-4 py-3 font-semibold">Reason</th></>
                : <th className="px-4 py-3 font-semibold">Customer</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-white/[0.06]">
            {loading && <tr><td colSpan={11} className="px-4 py-8 text-center text-muted dark:text-[#a89f93]">Loading…</td></tr>}
            {/* "Nothing here." after a search reads as "this parcel does not
                exist", which is the wrong conclusion and the one that cost an
                afternoon. Say what was actually searched. */}
            {/* A SEARCH SHOWS ROWS FROM EVERY TAB, SO IT MUST SAY WHICH.
                Widening the search fixed "Nothing here." for parcels sitting in
                another tab — but an already-received return then appeared inside
                Pending with nothing to mark it, which reads as "this is stuck".
                Each row now carries where it actually belongs. */}
            {!loading && !filtered.length && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-muted dark:text-[#a89f93]">
                {q.trim()
                  ? <>No parcel matches <b className="text-ink dark:text-[#f4f1ea]">{q.trim()}</b> in any return, on any date.
                     <span className="mt-1 block text-[12px] text-hint">Checked every tab and the whole date range, not just this view.</span></>
                  : "Nothing here."}
              </td></tr>
            )}
            {!loading && filtered.map((r) => {
              const ret = r as ReturnRow;
              const up = r as UnpaidRow;
              // EVERY reason, not one winner. Agent, courier and customer often
              // disagree, and the disagreement is usually the useful part.
              const reasons = isReturns ? allReasons(ret) : [];
              return (
                <tr key={r.tracking_id} className="transition hover:bg-panel/60 dark:hover:bg-white/[0.04]">
                  {isReturns && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={picked.includes(r.tracking_id)}
                        onChange={(e) => setPicked((p) => e.target.checked ? [...p, r.tracking_id] : p.filter((x) => x !== r.tracking_id))} />
                    </td>
                  )}
                  <td className="px-4 py-3 font-semibold text-ink dark:text-[#f4f1ea]">{r.order_number ?? "—"}</td>
                  <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{r.store_code ?? "—"}</td>
                  <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{r.courier ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-muted dark:text-[#a89f93]">{r.tracking_id}</td>
                  <td className="px-4 py-3 font-mono text-[11.5px]">
                    {r.cpr_number
                      ? <span className="text-ink dark:text-[#e7e2d8]">{String(r.cpr_number)}</span>
                      : <span className="text-hint">not settled</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted dark:text-[#a89f93]">{(isReturns ? ret.return_date : up.delivery_date) ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink dark:text-[#f4f1ea]">{rs(Number(r.cod_amount ?? 0))}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${Number(r.age_days ?? 0) > 14 ? "text-danger" : "text-muted dark:text-[#a89f93]"}`}>
                    {r.age_days != null ? `${r.age_days}d` : "—"}
                  </td>
                  {isReturns
                    ? <>
                        <td className="px-4 py-3">
                          <span className="inline-block rounded-full bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted dark:bg-white/[0.08] dark:text-[#a89f93]">{ret.stage ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {reasons.length === 0
                            ? <span className="text-hint dark:text-[#8a8175]">no reason recorded</span>
                            : (
                              <div className="space-y-0.5">
                                {reasons.map((x, k) => (
                                  <div key={k} className="flex flex-wrap items-baseline gap-1.5">
                                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-hint dark:text-[#8a8175]">{x.from}</span>
                                    <span className={`text-[12.5px] ${x.tone}`}>{x.text}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                        </td>
                      </>
                    : <>
                        <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{up.customer_name ?? "—"}</td>
                      </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ReceiveDialog open={showReceive} count={picked.length} busy={busy}
        onClose={() => setShowReceive(false)} onSave={receive} />

      {rows.length >= PAGE && (
        <p className="mt-3 text-[11.5px] text-hint dark:text-[#8a8175]">
          Showing the first {PAGE.toLocaleString()} rows. The card totals above are counted in the database, so they are complete — narrow the range or the store to see the rest here.
        </p>
      )}
    </div>
  );
}


/* Tags that explain WHY a parcel came back, as opposed to tags that merely
   record what the team did. "WhatsApp: Not a User" means the number is not on
   WhatsApp; "Call Busy" means nobody answered; "WhatsApp: Payment Issue" means
   the customer balked at paying. Those are reasons. "Order Confirmed" and
   "Fulfillment Notified" are process steps and explain nothing. */
const REASON_TAG = /^(whatsapp|call|wa)\b|not a user|payment issue|busy|no answer|unreachable|refus|fake|wrong/i;
const PROCESS_TAG = /confirmed|notified|fulfill/i;

/* Some notes are written by apps, not people — a shipping notification is not
   an explanation, and showing it as one is worse than showing nothing. */
const AUTOMATED_NOTE = /has been shipped|tracking\s*\d|dispatched via|courier assigned/i;

/** Every reason this parcel has, not just the winning one.
 *
 *  THE OLD BEHAVIOUR PICKED ONE AND THREW THE REST AWAY.
 *  That was wrong for this business. A return usually has more than one side to
 *  it and they do not always agree:
 *
 *      agent    "customer refused, wants replacement"
 *      courier  "REFUSED TO RECEIVE"
 *      customer "size was too small"
 *
 *  Three different people saying three different things, and the disagreement
 *  is often the useful part — a courier saying REFUSED against a customer
 *  saying they never got a call is a courier problem, not a customer one.
 *  Collapsing that into one line hid it.
 *
 *  ORDER OF DISPLAY, most authoritative first:
 *      1. agent      a sentence one of your people typed
 *      2. courier    PostEx or OwnEx's own finding
 *      3. Shopify    the fixed cancel-reason dropdown
 *      4. customer   the order note, when a person wrote it
 *      5. tags       how it was handled — kept last, it is process not cause
 *
 *  The courier's STATUS ("Verifying Reason") is still excluded. That is the
 *  courier saying it has not decided; it is the absence of a reason and putting
 *  it here would pad the column with noise. It only appears when there is
 *  genuinely nothing else. */
type Reason = { from: string; text: string; tone: string };

function allReasons(r: ReturnRow): Reason[] {
  const out: Reason[] = [];
  if (r.agent_note?.trim())
    out.push({ from: "agent", text: r.agent_note.trim(), tone: "text-ink dark:text-[#f4f1ea]" });
  if (r.courier_reason_text?.trim())
    out.push({ from: "courier", text: r.courier_reason_text.trim(), tone: "text-ink dark:text-[#f4f1ea]" });
  if (r.shopify_reason?.trim())
    out.push({ from: "Shopify", text: r.shopify_reason.trim(), tone: "text-muted dark:text-[#a89f93]" });
  if (r.shopify_note?.trim() && !AUTOMATED_NOTE.test(r.shopify_note))
    out.push({ from: "customer", text: r.shopify_note.trim(), tone: "text-muted dark:text-[#a89f93]" });

  const tags = (r.order_tags ?? []).filter((t) => REASON_TAG.test(t) && !PROCESS_TAG.test(t));
  if (tags.length)
    out.push({ from: "tag", text: tags.join(" · "), tone: "text-muted dark:text-[#a89f93]" });

  // Only when nothing real exists at all.
  if (!out.length && r.courier_reason?.trim())
    out.push({ from: "courier status", text: r.courier_reason.trim(), tone: "text-hint dark:text-[#8a8175]" });
  return out;
}

/* Confirming receipt is a deliberate act with a record attached: who took it in,
   on what date, and what state it arrived in. Condition drives whether it goes
   back into sellable stock, so it cannot default silently. */
function ReceiveDialog({ open, count, busy, onClose, onSave }: {
  open: boolean; count: number; busy: boolean; onClose: () => void;
  onSave: (f: { date: string; by: string; condition: string; notes: string }) => void;
}) {
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), by: "", condition: "good", notes: "" });
  return (
    <Modal open={open} onClose={onClose} title="Confirm return received"
      subtitle={`${count} parcel(s) will be marked as physically in your inventory.`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date received"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Received by"><input className={inputCls} value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} placeholder="name" /></Field>
        <Field label="Condition">
          <select className={inputCls} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>
            <option value="good">Good — back in stock</option>
            <option value="damaged">Damaged</option>
            <option value="partial">Partial / items missing</option>
          </select>
        </Field>
        <Field label="Notes"><input className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <p className="mt-3 text-[12px] text-hint dark:text-[#8a8175]">
        Only confirm what you are actually holding — this closes any open claim on these parcels.
      </p>
      <div className="mt-5 flex gap-2">
        <button onClick={() => onSave(f)} disabled={busy} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Confirm received</button>
        <button onClick={onClose} className={btnGhost}>Cancel</button>
      </div>
    </Modal>
  );
}
