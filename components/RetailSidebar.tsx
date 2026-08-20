"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Receipt, Store, BookText, Percent, Wallet, ArrowLeft, LogOut, Building2, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import ThemeToggle from "@/components/ThemeToggle";

const NAV: { label: string; href: string; Icon: LucideIcon; soon?: boolean }[] = [
  { label: "Sales", href: "/retail/sales", Icon: Receipt },
  { label: "Branches", href: "/retail/branches", Icon: Building2 },
  { label: "Cash Book", href: "/retail/cashbook", Icon: BookText, soon: true },
  { label: "Commissions", href: "/retail/commissions", Icon: Percent, soon: true },
  { label: "Salaries", href: "/retail/salaries", Icon: Wallet, soon: true },
];

export default function RetailSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  async function logout() { if (supabase) await supabase.auth.signOut(); router.replace("/login"); }
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-surface dark:border-white/[0.06] dark:bg-[#201c17] md:flex">
      <Link href="/" className="flex items-center gap-2 px-5 pt-5 text-[12.5px] font-semibold text-muted transition hover:text-ink dark:text-[#a89f93] dark:hover:text-white">
        <ArrowLeft size={15} /> All departments
      </Link>
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white dark:bg-white dark:text-[#141414]"><Store size={18} /></span>
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight dark:text-[#f4f1ea]">FS Traders</div>
          <div className="text-[11px] text-muted dark:text-[#a89f93]">Retail shops</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ label, href, Icon, soon }) => {
          const on = active(href);
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 rounded-xl2 px-3.5 py-2.5 text-[14px] transition ${on ? "bg-salmon-soft font-semibold text-ink dark:bg-white/[0.10] dark:text-white" : "text-muted hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white"}`}>
              <Icon size={18} strokeWidth={2} />
              <span className="flex-1">{label}</span>
              {soon && <span className="rounded-full bg-panel px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-hint dark:bg-white/[0.06] dark:text-[#8a8175]">Soon</span>}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-line p-3 dark:border-white/[0.06]">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[11px] text-hint dark:text-[#8a8175]">Theme</span><ThemeToggle />
        </div>
        <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl2 px-3.5 py-2.5 text-[13.5px] font-semibold text-muted transition hover:bg-panel hover:text-ink dark:text-[#a89f93] dark:hover:bg-white/[0.06] dark:hover:text-white">
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </aside>
  );
}
