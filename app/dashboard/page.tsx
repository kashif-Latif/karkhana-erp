"use client";
import { Wallet, PackagePlus, PackageMinus, ClipboardCheck, TrendingUp } from "lucide-react";
import Topbar from "@/components/Topbar";
import MetricCard from "@/components/MetricCard";
import RadialGauge from "@/components/RadialGauge";
import DotMatrix from "@/components/DotMatrix";
import IconChip from "@/components/IconChip";
import { StockPanel, ApprovalsPanel } from "@/components/Panels";
import { kpis, consumption, months } from "@/lib/sampleData";
import { isSupabaseConfigured } from "@/lib/supabase";

const ICONS = { value: Wallet, receipts: PackagePlus, issues: PackageMinus, approvals: ClipboardCheck };

export default function Dashboard() {
  return (
    <>
      <Topbar title="Dashboard" subtitle="Head-office inventory & production at a glance" action={{ label: "New GRN", href: "/inventory/receive" }} />

      {!isSupabaseConfigured && (
        <div className="mx-6 mb-4 rounded-xl2 border border-amber-strong/30 bg-amber-soft px-4 py-2.5 text-[12.5px] text-ink/80">
          Preview mode — showing sample data. Add your Supabase keys to switch on live data.
        </div>
      )}

      <div className="space-y-5 px-6 pb-10">
        {/* KPI row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k, i) => (
            <div key={k.key} className="reveal" style={{ animationDelay: `${i * 80}ms` }}>
              <MetricCard
                label={k.label}
                value={k.value}
                delta={k.delta}
                up={k.up}
                accent={k.accent}
                Icon={ICONS[k.key as keyof typeof ICONS]}
              />
            </div>
          ))}
        </div>

        {/* Gauge + consumption */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="reveal rounded-card bg-surface p-5 shadow-card lg:col-span-1" style={{ animationDelay: "340ms" }}>
            <div className="mb-2 flex items-center gap-3">
              <IconChip Icon={TrendingUp} size={32} />
              <h3 className="text-[15px] font-bold">Inventory Score</h3>
            </div>
            <RadialGauge score={87} />
            <p className="mt-2 text-center text-[12px] text-muted">
              Healthy coverage across all material groups
            </p>
          </div>

          <div className="reveal rounded-card bg-surface p-5 shadow-card lg:col-span-2" style={{ animationDelay: "400ms" }}>
            <div className="mb-1 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-bold">Material Consumption</h3>
                <p className="text-[12px] text-muted">Last 12 months</p>
              </div>
              <span className="rounded-full bg-success-soft px-2.5 py-1 text-[11.5px] font-semibold text-[#166534]">
                +12.4% vs last year
              </span>
            </div>
            <div className="mt-3">
              <DotMatrix values={consumption} labels={months} />
            </div>
          </div>
        </div>

        {/* Stock + approvals */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="reveal" style={{ animationDelay: "460ms" }}><StockPanel /></div>
          <div className="reveal" style={{ animationDelay: "520ms" }}><ApprovalsPanel /></div>
        </div>
      </div>
    </>
  );
}
