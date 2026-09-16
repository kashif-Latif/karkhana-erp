"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Receipt, Store, BookText, Percent, Wallet, ArrowLeft, LogOut,
  Building2, Upload, CreditCard, Landmark, Users, CalendarCheck, CalendarRange, Coins,
  NotebookPen, Banknote, ArrowLeftRight, ChevronDown, Briefcase, type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { ROUTE_PERMS } from "@/lib/access";
import ThemeToggle from "@/components/ThemeToggle";

type Child = { label: string; href: string; Icon: LucideIcon };
type NavItem = { label: string; href: string; Icon: LucideIcon; children?: Child[] };

/* THE MENU IS THE OLD APP'S MENU.
   Same items, same order, same names. Somebody who has been running these nine
   shops for two years knows where "Non-cash" is and what it holds; renaming it
   to something tidier would be an improvement to nobody.

   Two things did change, both because this sidebar is 248px wide and the old
   one was a full-screen drawer:

   1. Head Office had Employee as a THIRD level (Head Office › Employee ›
      Attendance). Three levels in a panel this narrow leaves about 90px for a
      label. Head Office's staff screens are listed directly under Head Office
      instead, which is one tap shorter and reads the same.

   2. Import was reachable only from inside the Sales screen. It is the screen
      the day actually starts on, so it gets a line of its own. */
const NAV: NavItem[] = [
  { label: "Dashboard", href: "/retail/dashboard", Icon: LayoutDashboard },
  { label: "Sales", href: "/retail/sales", Icon: Receipt },
  { label: "Import", href: "/retail/import", Icon: Upload },
  { label: "Expenses", href: "/retail/expenses", Icon: NotebookPen },
  { label: "Non-cash", href: "/retail/payments", Icon: ArrowLeftRight },
  { label: "Cash Book", href: "/retail/cashbook", Icon: BookText },
  { label: "Commissions", href: "/retail/commissions", Icon: Percent },

  /* Shop staff. One group, because marking attendance, checking the month and
     recording an advance against the same person is one job done by one
     person on one afternoon. */
  { label: "Employee", href: "/retail/employees", Icon: Users, children: [
      { label: "Attendance",      href: "/retail/employees/attendance", Icon: CalendarCheck },
      { label: "Monthly Summary", href: "/retail/employees/summary",    Icon: CalendarRange },
      { label: "Ledger",          href: "/retail/employees/ledger",     Icon: NotebookPen },
      { label: "Repayments",      href: "/retail/employees/repayments", Icon: Coins },
      { label: "Employees",       href: "/retail/employees",            Icon: Users },
  ] },

  /* Head Office is its own business inside the business: its own cash flow,
     its own end of day, its own staff. Kept separate for the same reason the
     old app kept it separate — the shop team never opens any of it. */
  { label: "Head Office", href: "/retail/ho", Icon: Briefcase, children: [
      { label: "Daily cash flow", href: "/retail/ho/cashflow",   Icon: ArrowLeftRight },
      { label: "End of day",      href: "/retail/ho/eod",        Icon: Banknote },
      { label: "Attendance",      href: "/retail/ho/attendance", Icon: CalendarCheck },
      { label: "Monthly Summary", href: "/retail/ho/summary",    Icon: CalendarRange },
      { label: "Employees",       href: "/retail/ho/employees",  Icon: Users },
      { label: "Ledger",          href: "/retail/ho/ledger",     Icon: NotebookPen },
      { label: "Repayments",      href: "/retail/ho/repayments", Icon: Coins },
  ] },

  { label: "Card Reconciliation", href: "/retail/cards", Icon: CreditCard },
  { label: "Bank Statements", href: "/retail/bank", Icon: Landmark },
  { label: "Salary", href: "/retail/salaries", Icon: Wallet },
  { label: "Branches", href: "/retail/branches", Icon: Building2 },
];

export default function RetailSidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, can } = usePermissions();

  /* Opened by hand wins; otherwise a group opens because you are standing in
     it. Same rule as the Hub sidebar — the arrow is a button that owns the
     state, so pressing it toggles rather than navigating. */
  const [manual, setManual] = useState<Record<string, boolean>>({});

  /* THE MENU SHOWS ONLY WHAT THE PERSON CAN OPEN.
     Until 0119 this department had a single permission, so this filter had
     nothing to filter on and every line showed for everybody. Now the shop
     accounts person sees Expenses and Cash Book and does not see Bank
     Statements, which is the arrangement that was always intended.

     A group vanishes when none of its children survive: "Head Office" pointing
     at nothing is a heading that lies. */
  const visible = NAV.map((n) => {
    if (n.children) {
      const kids = n.children.filter((c) => can(ROUTE_PERMS[c.href] ?? null));
      return kids.length ? { ...n, children: kids } : null;
    }
    return can(ROUTE_PERMS[n.href] ?? null) ? n : null;
  }).filter((n): n is NavItem => n !== null);

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
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white dark:bg-white dark:text-[#141414]"><Store size={18} /></span>
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-extrabold tracking-tight dark:text-[#f4f1ea]">FS Traders</div>
            <div className="text-[11px] text-muted dark:text-[#a89f93]">Retail shops</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-2" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onClose?.(); }}>
          {ready && visible.map(({ label, href, Icon, children }) => {
            const on = active(href);
            const openGroup = !!children && (manual[href] ?? on);
            /* A group's parent link points at its first surviving child rather
               than at a bare /retail/ho, so pressing the heading lands
               somewhere real instead of on a redirect. */
            const target = children ? children[0].href : href;
            return (
              <div key={href}>
                <Link href={target} className={`flex items-center gap-3 rounded-xl2 px-3.5 py-2.5 text-[14px] transition ${on ? "bg-salmon-soft font-semibold text-ink dark:bg-white/[0.10] dark:text-white" : "text-muted hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white"}`}>
                  <Icon size={18} strokeWidth={2} />
                  <span className="flex-1 truncate">{label}</span>
                  {children && (
                    <button type="button" aria-label={openGroup ? `Collapse ${label}` : `Expand ${label}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setManual((m) => ({ ...m, [href]: !openGroup })); }}
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
                          <span className="truncate">{c.label}</span>
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
