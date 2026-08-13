"use client";
import Link from "next/link";
import {
  LayoutDashboard, Layers, Scissors, Shirt, Shrink, Flame, ShieldCheck,
  Truck, Users, Boxes, FileBarChart, CheckSquare, Settings, ArrowUpRight,
  type LucideIcon,
} from "lucide-react";

const TINT: Record<string, string> = {
  salmon: "#F5D9CE", amber: "#F7EAD3", lavender: "#ECE1F6",
  periwinkle: "#DCE7F5", pink: "#F8DCEE", ink: "#EDEBE6",
};
const DOT: Record<string, string> = {
  salmon: "#E1876B", amber: "#E4B47E", lavender: "#B693DD",
  periwinkle: "#7FA3DC", pink: "#E07FBE", ink: "#141414",
};

function Tile({
  href, label, sub, Icon, accent = "ink", big = false,
}: { href: string; label: string; sub?: string; Icon: LucideIcon; accent?: string; big?: boolean }) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between rounded-card p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
      style={{ background: TINT[accent] }}
    >
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-full text-white"
          style={{ background: DOT[accent] }}>
          <Icon size={20} />
        </span>
        <ArrowUpRight size={18} className="text-ink/40 transition group-hover:text-ink" />
      </div>
      <div className="mt-4">
        <div className={`font-extrabold text-ink ${big ? "text-lg" : "text-[15px]"}`}>{label}</div>
        {sub && <div className="mt-0.5 text-[12px] text-ink/60">{sub}</div>}
      </div>
    </Link>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function Home() {
  return (
    <div className="px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink">Welcome back 👋</h1>
        <p className="mt-1 text-[14px] text-muted">Choose an area to work in.</p>
      </header>

      <div className="space-y-8">
        <Group title="Overview">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Tile href="/dashboard" label="Main Dashboard" sub="Inventory & production at a glance" Icon={LayoutDashboard} accent="salmon" big />
            <Tile href="/raw-materials" label="Raw Materials" sub="Fabric · Thread · Zip · Sticker · Packing" Icon={Layers} accent="amber" big />
          </div>
        </Group>

        <Group title="Production Departments">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Tile href="/production/cutting" label="Cutting" Icon={Scissors} accent="amber" />
            <Tile href="/production/stitching" label="Stitching" Icon={Shirt} accent="lavender" />
            <Tile href="/production/clipping" label="Clipping" Icon={Shrink} accent="periwinkle" />
            <Tile href="/production/iron" label="Iron / Pressing" Icon={Flame} accent="pink" />
            <Tile href="/production/qa-packing" label="QA/QC & Packing" Icon={ShieldCheck} accent="salmon" />
          </div>
        </Group>

        <Group title="Manage">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Tile href="/suppliers" label="Suppliers" Icon={Truck} accent="ink" />
            <Tile href="/employees" label="Employees" Icon={Users} accent="ink" />
            <Tile href="/inventory" label="Inventory" Icon={Boxes} accent="ink" />
            <Tile href="/reports" label="Reports" Icon={FileBarChart} accent="ink" />
            <Tile href="/approvals" label="Approvals" Icon={CheckSquare} accent="ink" />
            <Tile href="/administration" label="Administration" Icon={Settings} accent="ink" />
          </div>
        </Group>
      </div>
    </div>
  );
}
