"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Boxes, Layers, Factory, Truck, Shirt, ClipboardList,
  FileBarChart, CheckSquare, Gem, LogOut, Wallet, ArrowLeftRight,
  Warehouse, PackageCheck,
  ChevronDown, ArrowLeft, type LucideIcon,
} from "lucide-react";
import { useProfile } from "@/lib/useProfile";
import { usePermissions } from "@/lib/usePermissions";
import { ROUTE_PERMS } from "@/lib/access";
import { supabase } from "@/lib/supabase";

type Child = { label: string; href: string };
type NavItem = { label: string; Icon: LucideIcon; href?: string; badge?: number; children?: Child[] };

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  /* Receiving comes before the material catalogue: stock arriving is the
     daily job, and the catalogue is the reference you consult while doing
     it. "Inventory" said nothing about what the section was for. */
  { label: "Receiving Stock", Icon: Boxes, children: [
    { label: "Received", href: "/inventory" },
    { label: "Sorting", href: "/inventory/sorting" },
  ] },
  /* Raw material that has been received and sorted, grouped the way it sits
     on the shelf: material, then category, then size. */
  { label: "Stock", href: "/stock", Icon: Warehouse },
  /* An article and an order are the same conversation — what we make, and how
     many of it. They were two separate menu entries for no reason. */
  { label: "Order", Icon: ClipboardList, children: [
    { label: "Articles", href: "/articles" },
    { label: "Order by cloth", href: "/orders" },
    { label: "Other material order", href: "/orders?tab=other" },
  ] },
  /* Cutting, overlock, flatlock and singlelock sit inside one unit. The stages
     are labels on the work, not gates a piece passes through one at a time —
     what matters is how many of the order are still out on the floor, and that
     count lives on the unit.

     Stock movements used to hang here as its own page. It is gone: issuing,
     returning and writing off material all belong to an order, and they are on
     the order now. A second door into the store is how 100 kg of unsorted
     fabric reached Cutting with no order behind it. */
  { label: "Main Factory Stitching Unit", Icon: Factory, children: [
    { label: "Work & wages", href: "/process" },
  ] },
  /* Finished garments. Not the same thing as Stock above, and named so the
     difference is obvious: Stock is what you buy, Inventory is what you make. */
  { label: "Inventory", href: "/inventory/final-products", Icon: PackageCheck },
  /* Not a step in the run — the catalogue you open when a material you have
     never bought before turns up and needs adding. Below the flow, not inside
     Receiving, so it is not hidden on the day you need it. */
  { label: "Raw Materials", href: "/raw-materials", Icon: Layers },
  { label: "Suppliers", href: "/suppliers", Icon: Truck },
  { label: "Payments", href: "/payments", Icon: Wallet },
  { label: "Reports", href: "/reports", Icon: FileBarChart },
  { label: "Approvals", href: "/approvals", Icon: CheckSquare, badge: 7 },
];

/* ADMINISTRATION AND EMPLOYEES ARE NOT KARKHANA THINGS.
   They were in this sidebar because the factory is where staff were first
   needed, not because they belong to it. People and access span every business
   — Karkhana, Hub, FS Traders — so they now live in their own box on the
   Grohub Solutions home screen, alongside the three departments rather than
   inside one of them.
   Leaving them here as well would mean two doors to the same room, and two
   places to look when something is wrong. The routes still exist and still
   work; only the duplicate entry points are gone. */

export default function Sidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useProfile();
  const { ready, can } = usePermissions();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }
  const name = profile?.name || "…";
  const role = profile?.roleName || "";
  const initial = (profile?.name || "?").charAt(0).toUpperCase();

  const items: NavItem[] = NAV.map((n) => {
    if (n.children) {
      const kids = n.children.filter((c) => can(ROUTE_PERMS[c.href] ?? null));
      return kids.length ? { ...n, children: kids } : null;
    }
    return n.href && can(ROUTE_PERMS[n.href] ?? null) ? n : null;
  }).filter((n): n is NavItem => n !== null);

  const leafActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const rawMaterialActive = () => pathname === "/inventory" || (pathname.startsWith("/inventory/") && !pathname.startsWith("/inventory/final-products"));
  const childActive = (href: string) => (href === "/inventory" ? rawMaterialActive() : leafActive(href));

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} />}
      <aside className={`flex w-[248px] shrink-0 flex-col border-r border-line bg-surface fixed inset-y-0 left-0 z-50 transition-transform md:static md:z-auto md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <Link href="/" onClick={onClose} className="flex items-center gap-2 px-6 pt-5 text-[12.5px] font-semibold text-muted transition hover:text-ink">
        <ArrowLeft size={15} /> All departments
      </Link>
      <div className="flex items-center gap-2.5 px-6 pb-5 pt-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white"><Gem size={18} /></span>
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight">Karkhana</div>
          <div className="text-[11px] text-muted">Head Office ERP</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onClose?.(); }}>
        {!ready ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mx-1 my-1 h-9 animate-pulse rounded-xl2 bg-panel/70" />
          ))
        ) : (
          items.map((item) => {
            if (item.children) {
              /* Was hardcoded to "/inventory", which worked only while
                 Receiving Stock was the single group in this menu. With three
                 groups, all three lit up and expanded whenever you opened a
                 receiving page. Each group now answers for its own children. */
              const anyActive = item.children.some((c) => childActive(c.href));
              const open = expanded[item.label] ?? anyActive;
              return (
                <div key={item.label}>
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [item.label]: !(e[item.label] ?? anyActive) }))}
                    className={`flex w-full items-center gap-3 rounded-xl2 px-3.5 py-2.5 text-[14px] transition ${anyActive ? "bg-salmon-soft font-semibold text-ink" : "text-muted hover:bg-panel hover:text-ink"}`}>
                    <item.Icon size={18} strokeWidth={2} />
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div className="mt-1 space-y-1 pl-3.5">
                      {item.children.map((c) => {
                        const on = childActive(c.href);
                        return (
                          <Link key={c.href} href={c.href}
                            className={`flex items-center gap-2.5 rounded-xl2 px-3.5 py-2 text-[13.5px] transition ${on ? "bg-salmon-soft font-semibold text-ink" : "text-muted hover:bg-panel hover:text-ink"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-salmon-strong" : "bg-current opacity-30"}`} />
                            {c.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            const active = leafActive(item.href!);
            return (
              <Link key={item.href} href={item.href!}
                className={`flex items-center gap-3 rounded-xl2 px-3.5 py-2.5 text-[14px] transition ${active ? "bg-salmon-soft font-semibold text-ink" : "text-muted hover:bg-panel hover:text-ink"}`}>
                <item.Icon size={18} strokeWidth={2} />
                <span className="flex-1">{item.label}</span>
                {item.badge && <span className="rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-bold text-white">{item.badge}</span>}
              </Link>
            );
          })
        )}
      </nav>

      <div className="m-3 rounded-xl2 bg-cream p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-salmon-strong text-[13px] font-bold text-white">{initial}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold">{name}</div>
            <div className="text-[11px] text-muted">{role}</div>
          </div>
          <button onClick={logout} title="Log out" className="shrink-0 rounded-full p-1.5 text-muted transition hover:bg-panel hover:text-ink">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}
