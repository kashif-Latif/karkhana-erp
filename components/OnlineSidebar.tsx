"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ClipboardList, Truck, Wallet, CalendarCheck, Users, ArrowLeft, LogOut, ShoppingBag, Undo2, ChevronDown, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { ROUTE_PERMS } from "@/lib/access";
import ThemeToggle from "@/components/ThemeToggle";

type NavItem = {
  label: string; href: string; Icon: LucideIcon; soon?: boolean;
  children?: { label: string; href: string; Icon: LucideIcon }[];
};

/* Returns sit under Logistics, not Finance. A return is a parcel problem before
   it is a money problem, and the people chasing one are the logistics team. */
const NAV: NavItem[] = [
  { label: "Dashboard", href: "/online/dashboard", Icon: LayoutDashboard },
  { label: "Orders", href: "/online/orders", Icon: ClipboardList },
  { label: "Logistics", href: "/online/logistics", Icon: Truck, children: [
      { label: "Shipments", href: "/online/logistics", Icon: Truck },
      { label: "Returns", href: "/online/logistics/returns", Icon: Undo2 },
  ] },
  { label: "Finance", href: "/online/finance", Icon: Wallet },
  /* People, grouped. The department's accounts person adds staff and marks
     attendance in one place, because that is one job. Logins and permissions
     stay in Administration — adding a person and granting them access to money
     are different decisions, and only one of them belongs to a department. */
  { label: "People", href: "/online/attendance", Icon: CalendarCheck, children: [
      { label: "Attendance", href: "/online/attendance", Icon: CalendarCheck },
      { label: "Employees",  href: "/online/employees",  Icon: Users },
  ] },
];

export default function OnlineSidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  /* Which groups the person has opened by hand.
     A group used to open only while you were inside it, so the arrow was
     decoration — it turned, but pressing it navigated instead of toggling and
     there was no way to close a section you were standing in. Now the arrow is
     a button that owns the state, and the route only decides what is open
     BEFORE anyone touches it. */
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const { ready, can } = usePermissions();

  /* THE MENU SHOWS ONLY WHAT THE PERSON CAN OPEN.
     The Karkhana sidebar has filtered like this all along; this one did not, so
     somebody granted Finance alone still saw Orders, Logistics and Returns and
     was refused at each. Listing doors that all turn you away is worse than
     listing none — it tells someone the system has places for them and then
     does not let them in.

     A parent disappears when none of its children survive: a People group with
     nothing under it is a heading pointing at nothing. */
  const visible = NAV.map((n) => {
    if (n.children) {
      const kids = n.children.filter((c) => can(ROUTE_PERMS[c.href] ?? null));
      return kids.length ? { ...n, children: kids } : null;
    }
    return can(ROUTE_PERMS[n.href] ?? null) ? n : null;
  }).filter((n): n is (typeof NAV)[number] => n !== null);
  const pathname = usePathname();
  const router = useRouter();
  async function logout() { if (supabase) await supabase.auth.signOut(); router.replace("/login"); }
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} />}
      <aside className={`flex w-[248px] shrink-0 flex-col border-r border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17] fixed inset-y-0 left-0 z-50 transition-transform md:static md:z-auto md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <Link href="/" onClick={onClose} className="flex items-center gap-2 px-5 pt-5 text-[12.5px] font-semibold text-muted transition hover:text-ink dark:text-[#a89f93] dark:hover:text-white">
          <ArrowLeft size={15} /> All departments
        </Link>
        <div className="flex items-center gap-2.5 px-5 pb-5 pt-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white dark:bg-white dark:text-[#141414]"><ShoppingBag size={18} /></span>
          <div className="leading-tight">
            <div className="text-[15px] font-extrabold tracking-tight dark:text-[#f4f1ea]">Hub Department</div>
            <div className="text-[11px] text-muted dark:text-[#a89f93]">Online orders</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onClose?.(); }}>
          {ready && visible.map(({ label, href, Icon, soon, children }) => {
            const on = active(href);
            // Opened by hand wins; otherwise a section opens because you are in it.
            const openGroup = !!children && (manual[href] ?? on);
            return (
              <div key={href}>
                <Link href={href} className={`flex items-center gap-3 rounded-xl2 px-3.5 py-2.5 text-[14px] transition ${on ? "bg-periwinkle-soft font-semibold text-ink dark:bg-white/[0.10] dark:text-white" : "text-muted hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white"}`}>
                  <Icon size={18} strokeWidth={2} />
                  <span className="flex-1">{label}</span>
                  {soon && <span className="rounded-full bg-panel px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-hint dark:bg-white/[0.06] dark:text-[#8a8175]">Soon</span>}
                  {children && (
                    /* Inside the Link, so the arrow has to stop the click from
                       navigating — otherwise pressing it would open the section
                       AND move you, which is not what an arrow means. */
                    <button type="button" aria-label={openGroup ? `Collapse ${label}` : `Expand ${label}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation();
                                        setManual((m) => ({ ...m, [href]: !openGroup })); }}
                      className="-mr-1 rounded-full p-1 hover:bg-black/5 dark:hover:bg-white/10">
                      <ChevronDown size={15} className={`transition ${openGroup ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </Link>
                {openGroup && (
                  <div className="ml-4 mt-1 space-y-0.5 border-l border-line pl-3 dark:border-white/[0.08]">
                    {children!.map((c) => {
                      const cOn = pathname === c.href;
                      return (
                        <Link key={c.href} href={c.href} className={`flex items-center gap-2.5 rounded-xl2 px-3 py-2 text-[13px] transition ${cOn ? "font-semibold text-ink dark:text-white" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
                          <c.Icon size={15} strokeWidth={2} />
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-line p-3 dark:border-white/[0.06]">
          <div className="flex items-center justify-between px-2 py-1"><span className="text-[11px] text-hint dark:text-[#8a8175]">Theme</span><ThemeToggle /></div>
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl2 px-3.5 py-2.5 text-[13.5px] font-semibold text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white"><LogOut size={16} /> Sign out</button>
        </div>
      </aside>
    </>
  );
}
