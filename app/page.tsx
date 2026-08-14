"use client";
import Link from "next/link";
import {
  LayoutDashboard, Layers, Scissors, Shirt, Shrink, Flame, ShieldCheck,
  Truck, Users, Boxes, FileBarChart, CheckSquare, Settings, ArrowUpRight,
  BookOpen, type LucideIcon,
} from "lucide-react";
import { useProfile } from "@/lib/useProfile";
import { usePermissions } from "@/lib/usePermissions";
import { ROUTE_PERMS } from "@/lib/access";
import Clock from "@/components/Clock";

const TINT: Record<string, string> = {
  salmon: "#F5D9CE", amber: "#F7EAD3", lavender: "#ECE1F6",
  periwinkle: "#DCE7F5", pink: "#F8DCEE", ink: "#EDEBE6",
};
const DOT: Record<string, string> = {
  salmon: "#E1876B", amber: "#E4B47E", lavender: "#B693DD",
  periwinkle: "#7FA3DC", pink: "#E07FBE", ink: "#141414",
};

type TileDef = { href: string; label: string; sub?: string; Icon: LucideIcon; accent?: string; big?: boolean; perm: string[] | null };

const PROD = ROUTE_PERMS["/production"];
const OVERVIEW: TileDef[] = [
  { href: "/dashboard", label: "Main Dashboard", sub: "Inventory & production at a glance", Icon: LayoutDashboard, accent: "salmon", big: true, perm: ROUTE_PERMS["/dashboard"] },
  { href: "/raw-materials", label: "Raw Materials", sub: "Fabric · Thread · Zip · Sticker · Packing", Icon: Layers, accent: "amber", big: true, perm: ROUTE_PERMS["/raw-materials"] },
];
const DEPTS: TileDef[] = [
  { href: "/production/cutting", label: "Cutting", Icon: Scissors, accent: "amber", perm: PROD },
  { href: "/production/stitching", label: "Stitching", Icon: Shirt, accent: "lavender", perm: PROD },
  { href: "/production/clipping", label: "Clipping", Icon: Shrink, accent: "periwinkle", perm: PROD },
  { href: "/production/iron", label: "Iron / Pressing", Icon: Flame, accent: "pink", perm: PROD },
  { href: "/production/qa-packing", label: "QA/QC & Packing", Icon: ShieldCheck, accent: "salmon", perm: PROD },
];
const MANAGE: TileDef[] = [
  { href: "/suppliers", label: "Suppliers", Icon: Truck, accent: "ink", perm: ROUTE_PERMS["/suppliers"] },
  { href: "/catalog", label: "Catalog", Icon: BookOpen, accent: "ink", perm: ROUTE_PERMS["/catalog"] },
  { href: "/employees", label: "Employees", Icon: Users, accent: "ink", perm: ROUTE_PERMS["/employees"] },
  { href: "/inventory", label: "Inventory", Icon: Boxes, accent: "ink", perm: ROUTE_PERMS["/inventory"] },
  { href: "/reports", label: "Reports", Icon: FileBarChart, accent: "ink", perm: ROUTE_PERMS["/reports"] },
  { href: "/approvals", label: "Approvals", Icon: CheckSquare, accent: "ink", perm: ROUTE_PERMS["/approvals"] },
  { href: "/administration", label: "Administration", Icon: Settings, accent: "ink", perm: ROUTE_PERMS["/administration"] },
];

function Tile({ href, label, sub, Icon, accent = "ink", big = false }: TileDef) {
  return (
    <Link href={href}
      className="group flex flex-col justify-between rounded-card p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
      style={{ background: TINT[accent] }}>
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-full text-white" style={{ background: DOT[accent] }}>
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

export default function Home() {
  const profile = useProfile();
  const { can } = usePermissions();
  const firstName = profile?.name ? profile.name.split(" ")[0] : "";

  const overview = OVERVIEW.filter((t) => can(t.perm));
  const depts = DEPTS.filter((t) => can(t.perm));
  const manage = MANAGE.filter((t) => can(t.perm));

  return (
    <div className="px-6 py-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-ink">
            Welcome back{firstName ? `, ${firstName}` : ""} 👋
          </h1>
          <p className="mt-1 text-[14px] text-muted">Choose an area to work in.</p>
        </div>
        <Clock />
      </header>

      <div className="space-y-8">
        {overview.length > 0 && (
          <section>
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted">Overview</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {overview.map((t) => <Tile key={t.href} {...t} />)}
            </div>
          </section>
        )}

        {depts.length > 0 && (
          <section>
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted">Production Departments</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {depts.map((t) => <Tile key={t.href} {...t} />)}
            </div>
          </section>
        )}

        {manage.length > 0 && (
          <section>
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted">Manage</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {manage.map((t) => <Tile key={t.href} {...t} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
