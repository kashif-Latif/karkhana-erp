"use client";
import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Layers, RefreshCw } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type Branch = { id: number; code: string; name: string; chain: string; business?: string; active?: boolean; color?: string };

export default function BranchesPage() {
  const [rows, setRows] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.from("retail_branches").select("id,code,name,chain,business,active,color").order("chain").order("name");
    if (error) setErr(error.message);
    setRows((data as Branch[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const cards = useMemo(() => [
    { label: "Branches", value: rows.length, Icon: Building2, bg: "bg-salmon-soft" },
    { label: "Active", value: rows.filter((b) => b.active !== false).length, Icon: CheckCircle2, bg: "bg-success-soft" },
    { label: "Chains", value: new Set(rows.map((b) => b.chain)).size, Icon: Layers, bg: "bg-periwinkle-soft" },
  ], [rows]);

  return (
    <div className="px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink dark:text-[#f4f1ea]">Branches</h1>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Your shops — Top Shop, Fashion Collection &amp; Head Office.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3.5">
        {cards.map(({ label, value, Icon, bg }) => (
          <div key={label} className={`rounded-card border border-line ${bg} p-4 dark:border-white/[0.06] dark:bg-[#201c17]`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-white dark:text-[#141414]"><Icon size={16} /></span>
            <div className="mt-3 text-[24px] font-extrabold tabular-nums text-ink dark:text-[#f4f1ea]">{loading ? "—" : value.toLocaleString()}</div>
            <div className="text-[12px] font-medium text-muted dark:text-[#a89f93]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-hint dark:border-white/[0.06] dark:text-[#8a8175]">
                <th className="px-4 py-3 font-semibold">Code</th><th className="px-4 py-3 font-semibold">Name</th><th className="px-4 py-3 font-semibold">Chain</th><th className="px-4 py-3 font-semibold">Business</th><th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-white/[0.05]">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-panel/70 dark:bg-white/[0.05]" /></td></tr>)
              ) : err ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-[13px] text-danger">Couldn&apos;t load branches: {err}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-16 text-center text-[13px] text-muted dark:text-[#a89f93]">No branches yet — these come in with your shop data.</td></tr>
              ) : (
                rows.map((b) => (
                  <tr key={b.id} className="text-ink transition hover:bg-panel/50 dark:text-[#e7e2d8] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color || "#185FA5" }} />{b.code}</span></td>
                    <td className="px-4 py-3 font-semibold">{b.name}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{b.chain}</td>
                    <td className="px-4 py-3 text-muted dark:text-[#a89f93]">{b.business ?? "—"}</td>
                    <td className="px-4 py-3">{b.active !== false ? <span className="text-[12px] font-semibold text-success">Active</span> : <span className="text-[12px] font-semibold text-muted">Inactive</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!isSupabaseConfigured && <p className="mt-4 text-center text-[12px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to load branches.</p>}
    </div>
  );
}
