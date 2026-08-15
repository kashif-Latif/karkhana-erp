"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home, LayoutDashboard, Boxes, Layers, BookOpen, Factory, Users, Truck,
  FileBarChart, CheckSquare, Settings, Gem, LogOut,
} from "lucide-react";
import { useProfile } from "@/lib/useProfile";
import { usePermissions } from "@/lib/usePermissions";
import { ROUTE_PERMS } from "@/lib/access";
import { supabase } from "@/lib/supabase";

const NAV = [
  { label: "Home", href: "/", Icon: Home },
  { label: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { label: "Inventory", href: "/inventory", Icon: Boxes },
  { label: "Raw Materials", href: "/raw-materials", Icon: Layers },
  { label: "Catalog", href: "/catalog", Icon: BookOpen },
  { label: "Production", href: "/production", Icon: Factory },
  { label: "Employees", href: "/employees", Icon: Users },
  { label: "Suppliers", href: "/suppliers", Icon: Truck },
  { label: "Reports", href: "/reports", Icon: FileBarChart },
  { label: "Approvals", href: "/approvals", Icon: CheckSquare, badge: 7 },
  { label: "Administration", href: "/administration", Icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useProfile();
  const { ready, can } = usePermissions();

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }
  const name = profile?.name || "…";
  const role = profile ? (profile.isSuperAdmin ? "Super Admin" : "User") : "";
  const initial = (profile?.name || "?").charAt(0).toUpperCase();

  const items = NAV.filter((n) => can(ROUTE_PERMS[n.href] ?? null));

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
        {!ready ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mx-1 my-1 h-9 animate-pulse rounded-xl2 bg-panel/70" />
          ))
        ) : (
          items.map(({ label, href, Icon, badge }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-xl2 px-3.5 py-2.5 text-[14px] transition ${
                  active ? "bg-salmon-soft font-semibold text-ink" : "text-muted hover:bg-panel hover:text-ink"
                }`}
              >
                <Icon size={18} strokeWidth={2} />
                <span className="flex-1">{label}</span>
                {badge && (
                  <span className="rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-bold text-white">{badge}</span>
                )}
              </Link>
            );
          })
        )}
      </nav>

      <div className="m-3 rounded-xl2 bg-cream p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-salmon-strong text-[13px] font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold">{name}</div>
            <div className="text-[11px] text-muted">{role}</div>
          </div>
          <button onClick={logout} title="Log out"
            className="shrink-0 rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
