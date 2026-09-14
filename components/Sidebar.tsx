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

/* A child is either a link, or a heading that groups the links under it.
   Karkhana has nine screens; nine in a row reads as a wall. Headings turn
   it into four short stacks you can scan. */
/* A child is a link, a plain heading, or a sub-group that opens and closes
   on its own. Reports is the third kind: five screens that belong together
   but should not take five lines of the sidebar when you are not using them. */
type Child = { label: string; href: string; heading?: false; sub?: undefined }
            | { label: string; heading: true; href?: undefined; sub?: undefined }
            | { label: string; sub: { label: string; href: string }[]; href?: undefined; heading?: false };
type NavItem = { label: string; Icon: LucideIcon; href?: string; badge?: number; children?: Child[] };

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },

  /* Articles sit above Karkhana, not inside it: an article is a product
     definition, and both departments read it — Karkhana to know the recipe,
     the warehouse to know the barcode. */
  { label: "Add New Article", href: "/add-article", Icon: Shirt },

  /* ═══ KARKHANA ═══ material in, pieces out, finished and packed.
     Grouped in the order the work actually happens. */
  { label: "Karkhana", Icon: Factory, children: [
    { label: "Receiving store", heading: true },
    { label: "New GRN", href: "/grn" },
    { label: "GR out", href: "/grn/out" },
    { label: "STR", href: "/str/factory" },
    { label: "Reports", sub: [
      { label: "New GRN report", href: "/reports/factory/grn" },
      { label: "GR out report", href: "/reports/factory/grout" },
      { label: "STR report", href: "/reports/factory/str" },
      { label: "Low quantity", href: "/reports/factory/low" },
      { label: "Blocked items", href: "/reports/factory/blocked" },
    ] },


    { label: "Order", heading: true },
    { label: "Articles", href: "/articles" },
    { label: "Order by cloth", href: "/orders" },
    { label: "Order by other material", href: "/orders?tab=other" },

    { label: "Production", heading: true },
    { label: "Stitching unit", href: "/process" },

    { label: "Finishing", heading: true },
    { label: "Fixing · Clipping · Pressing · Packing", href: "/packing" },

    /* Stock and Raw materials are gone: everything they showed is now read
       back through a report, filtered however you need it. One place to look
       instead of two that could disagree. */


  ] },

  /* ═══ WAREHOUSE ═══ receives from Karkhana, ships to shops and online. */
  /* The warehouse GRN — receiving from Karkhana — is the next build. Until
     it exists this is one page with its own tabs, not a dead link. */
  /* One screen with tabs, surfaced as a dropdown so each is reachable in one
     click instead of landing on Stock and hunting for the right tab. */
  /* Four screens, not one screen with tabs. Clicking Stock shows stock —
     nothing else on the page. */
  { label: "Warehouse", Icon: Boxes, children: [
    { label: "New GRN", href: "/warehouse/grn-in" },
    { label: "GR out", href: "/warehouse/grn-out" },
    { label: "STR", href: "/str/warehouse" },
    { label: "Reports", sub: [
      { label: "New GRN report", href: "/reports/warehouse/grn" },
      { label: "GR out report", href: "/reports/warehouse/grout" },
      { label: "STR report", href: "/reports/warehouse/str" },
      { label: "Low quantity", href: "/reports/warehouse/low" },
      { label: "Blocked items", href: "/reports/warehouse/blocked" },
    ] },
    { label: "Products", href: "/warehouse/products" },


  ] },

  /* ═══ PAYMENTS ═══ its own section, serving both departments. */
  { label: "Payments", Icon: Wallet, children: [
    { label: "Suppliers", href: "/suppliers" },
    { label: "Payments made", href: "/payments" },
    { label: "Approvals", href: "/approvals" },
  ] },


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
      const visible = n.children
        .map((c) => c.sub
          ? { ...c, sub: c.sub.filter((x) => can(ROUTE_PERMS[x.href] ?? null)) }
          : c)
        .filter((c) => c.heading || (c.sub ? c.sub.length > 0 : can(ROUTE_PERMS[c.href!] ?? null)));
      /* A heading with nothing left under it is noise — drop it. */
      const kids = visible.filter((c, i) =>
        !c.heading || visible.slice(i + 1).some((x) => !x.heading));
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
          <div className="text-[15px] font-extrabold tracking-tight">Factory</div>
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
              /* Headings carry no href — skip them before asking whether a
                 child is the active route. */
              const anyActive = item.children.some((c) => !c.heading && childActive(c.href!));
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
                      {item.children.map((c, ci) => {
                        if (c.sub) {
                          const anySubActive = c.sub.some((x) => childActive(x.href));
                          const subOpen = expanded[item.label + "/" + c.label] ?? anySubActive;
                          return (
                            <div key={`s-${ci}`}>
                              <button
                                onClick={() => setExpanded((e) => ({ ...e, [item.label + "/" + c.label]: !subOpen }))}
                                className={`flex w-full items-center justify-between rounded-xl2 px-3.5 py-2 text-[13px] font-semibold transition ${anySubActive ? "text-ink" : "text-ink/65 hover:bg-panel"}`}>
                                {c.label}
                                <ChevronDown size={14} className={`transition ${subOpen ? "rotate-180" : ""}`} />
                              </button>
                              {subOpen && (
                                <div className="ml-3 border-l border-line pl-2">
                                  {c.sub.map((x) => (
                                    <Link key={x.href} href={x.href}
                                      className={`block rounded-xl2 px-3 py-1.5 text-[12.5px] transition ${childActive(x.href) ? "bg-panel font-semibold text-ink" : "text-ink/60 hover:bg-panel"}`}>
                                      {x.label}
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        }
                        if (c.heading) return (
                          <p key={`h-${ci}`}
                            className={`px-3.5 pb-0.5 text-[10.5px] font-bold uppercase tracking-wide text-hint ${ci ? "pt-2.5" : "pt-1"}`}>
                            {c.label}
                          </p>
                        );
                        const on = childActive(c.href!);
                        return (
                          <Link key={c.href} href={c.href!}
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
