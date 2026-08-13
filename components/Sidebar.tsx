"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  Layers,
  Factory,
  Users,
  Truck,
  FileBarChart,
  CheckSquare,
  Settings,
  Gem,
} from "lucide-react";

const NAV = [
  { label: "Dashboard", href: "/", Icon: LayoutDashboard },
  { label: "Inventory", href: "/inventory", Icon: Boxes },
  { label: "Raw Materials", href: "/raw-materials", Icon: Layers },
  { label: "Production", href: "/production", Icon: Factory },
  { label: "Employees", href: "/employees", Icon: Users },
  { label: "Suppliers", href: "/suppliers", Icon: Truck },
  { label: "Reports", href: "/reports", Icon: FileBarChart },
  { label: "Approvals", href: "/approvals", Icon: CheckSquare, badge: 7 },
  { label: "Administration", href: "/administration", Icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-surface md:flex">
      <Link href="/" className="flex items-center gap-2.5 px-6 py-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white">
          <Gem size={18} />
        </span>
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight">Karkhana</div>
          <div className="text-[11px] text-muted">Head Office ERP</div>
        </div>
      </Link>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ label, href, Icon, badge }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl2 px-3.5 py-2.5 text-[14px] transition ${
                active
                  ? "bg-salmon-soft font-semibold text-ink"
                  : "text-muted hover:bg-panel hover:text-ink"
              }`}
            >
              <Icon size={18} strokeWidth={2} />
              <span className="flex-1">{label}</span>
              {badge && (
                <span className="rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="m-3 rounded-xl2 bg-cream p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-salmon-strong text-[13px] font-bold text-white">
            K
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">Kashif</div>
            <div className="text-[11px] text-muted">Super Admin</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
