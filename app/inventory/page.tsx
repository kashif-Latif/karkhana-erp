"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { Boxes, PackagePlus, Loader2, FileText } from "lucide-react";
import IconChip from "@/components/IconChip";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type StockRow = { item_id: string; label: string; unit: string; balance: number };
type GrnRow = Record<string, unknown>;

function itemLabel(it: Record<string, unknown>): string {
  const g = (it.material_groups as { name?: string } | null)?.name;
  const c = (it.material_categories as { name?: string } | null)?.name;
  const col = (it.colors as { name?: string } | null)?.name;
  const s = (it.sizes as { name?: string } | null)?.name;
  return [g, c, col, s].filter(Boolean).join(" · ") || (it.name as string) || (it.code as string);
}
const money = (n: number) => "Rs " + Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const qty = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 3 });
const when = (s: string) => new Date(s).toLocaleString("en-PK", { day: "2-digit", month: "short", year: "numeric" });

export default function InventoryPage() {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [bal, items, g] = await Promise.all([
      supabase.from("stock_balances").select("item_id, balance"),
      supabase.from("material_items").select("id, code, name, material_groups(name), material_categories(name), colors(name), sizes(name), units(symbol,name)"),
      supabase.from("grns").select("id, grn_number, received_at, total, suppliers(company_name)").order("created_at", { ascending: false }).limit(15),
    ]);
    const meta = new Map<string, { label: string; unit: string }>();
    ((items.data as unknown as Record<string, unknown>[]) ?? []).forEach((it) => {
      meta.set(it.id as string, {
        label: itemLabel(it),
        unit: ((it.units as { symbol?: string; name?: string } | null)?.symbol) || ((it.units as { name?: string } | null)?.name) || "",
      });
    });
    const rows = ((bal.data as { item_id: string; balance: number }[]) ?? [])
      .map((b) => ({ item_id: b.item_id, balance: Number(b.balance), label: meta.get(b.item_id)?.label || "—", unit: meta.get(b.item_id)?.unit || "" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    setStock(rows);
    setGrns((g.data as unknown as GrnRow[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Topbar title="Inventory" subtitle="Live stock & receiving" />
      <div className="px-6 pb-10">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">Stock is calculated live from every receipt — always reconcilable.</p>
          <Link href="/inventory/receive" className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
            <PackagePlus size={16} /> Receive Stock
          </Link>
        </div>

        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to see inventory.</div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* current stock */}
            <div className="overflow-hidden rounded-card bg-surface shadow-card">
              <div className="border-b border-line px-5 py-3.5 text-[14px] font-extrabold text-ink">Current Stock</div>
              {stock.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <IconChip Icon={Boxes} size={42} />
                  <p className="text-[13px] font-semibold text-ink">No stock yet</p>
                  <p className="text-[12.5px] text-muted">Receive your first delivery to see stock here.</p>
                </div>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                      <th className="px-5 py-2.5 font-semibold">Material</th>
                      <th className="px-5 py-2.5 text-right font-semibold">In stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map((r) => (
                      <tr key={r.item_id} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                        <td className="px-5 py-2.5 font-medium text-ink">{r.label}</td>
                        <td className="px-5 py-2.5 text-right"><span className="tnum font-semibold text-ink">{qty(r.balance)}</span> <span className="text-[12px] text-muted">{r.unit}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* recent GRNs */}
            <div className="overflow-hidden rounded-card bg-surface shadow-card">
              <div className="border-b border-line px-5 py-3.5 text-[14px] font-extrabold text-ink">Recent Receipts (GRN)</div>
              {grns.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <IconChip Icon={FileText} size={42} />
                  <p className="text-[13px] font-semibold text-ink">No receipts yet</p>
                </div>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                      <th className="px-5 py-2.5 font-semibold">GRN</th>
                      <th className="px-5 py-2.5 font-semibold">Supplier</th>
                      <th className="px-5 py-2.5 font-semibold">Date</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grns.map((g) => (
                      <tr key={g.id as string} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                        <td className="px-5 py-2.5 font-mono text-[12px] tnum text-muted">{g.grn_number as string}</td>
                        <td className="px-5 py-2.5 text-ink/80">{(g.suppliers as { company_name?: string } | null)?.company_name || "—"}</td>
                        <td className="px-5 py-2.5 text-ink/70">{when(g.received_at as string)}</td>
                        <td className="px-5 py-2.5 text-right tnum font-semibold text-ink">{money(g.total as number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
