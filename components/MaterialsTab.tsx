"use client";
import { useEffect, useState, useCallback } from "react";
import { Loader2, Check, Minus } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Group = { id: string; name: string; has_category: boolean; has_color: boolean; has_size: boolean };
type Unit = { symbol: string | null; name: string };
type FlagKey = "has_category" | "has_color" | "has_size";

export default function MaterialsTab({ canManage }: { canManage: boolean }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [units, setUnits] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const [g, gu] = await Promise.all([
      supabase.from("material_groups").select("id,name,has_category,has_color,has_size").order("name"),
      supabase.from("group_units").select("group_id, units(symbol,name)"),
    ]);
    setGroups((g.data as unknown as Group[]) ?? []);
    const map: Record<string, string[]> = {};
    ((gu.data as unknown as { group_id: string; units: Unit }[]) ?? []).forEach((r) => {
      (map[r.group_id] ||= []).push(r.units.symbol || r.units.name);
    });
    setUnits(map);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(g: Group, key: FlagKey) {
    if (!canManage || !supabase) return;
    setBusy(g.id + key);
    await supabase.from("material_groups").update({ [key]: !g[key] }).eq("id", g.id);
    setBusy(null);
    load();
  }

  if (loading) {
    return <div className="flex items-center justify-center gap-2 rounded-card bg-surface py-14 text-muted shadow-card"><Loader2 size={18} className="animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">
        Each material carries its own rules. Turn an attribute on and it appears when you add items of that material.
        {!canManage && " (View only — ask an admin to change these.)"}
      </p>
      {groups.map((g) => (
        <div key={g.id} className="rounded-card bg-surface p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h3 className="text-[15px] font-extrabold text-ink">{g.name}</h3>
            <div className="flex flex-wrap items-center gap-2">
              {(["has_category", "has_color", "has_size"] as FlagKey[]).map((k) => {
                const on = g[k];
                const labels: Record<FlagKey, string> = { has_category: "Category", has_color: "Colour", has_size: "Size" };
                return (
                  <button key={k} disabled={!canManage || busy === g.id + k} onClick={() => toggle(g, k)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                      on ? "bg-success-soft text-[#166534]" : "bg-panel text-muted"} ${canManage ? "hover:opacity-80" : "cursor-default"}`}>
                    {busy === g.id + k ? <Loader2 size={12} className="animate-spin" /> : on ? <Check size={12} /> : <Minus size={12} />}
                    {labels[k]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11.5px] font-medium uppercase tracking-wide text-hint">Received in</span>
            {(units[g.id] ?? []).map((u) => (
              <span key={u} className="rounded-full bg-cream px-2.5 py-0.5 text-[11.5px] font-semibold text-ink/70">{u}</span>
            ))}
            {(units[g.id] ?? []).length === 0 && <span className="text-[12px] text-hint">—</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
