"use client";
import Link from "next/link";
import { Factory, ShoppingBag, Store, ChevronRight } from "lucide-react";

// The three departments. `href` points where each card opens.
// Garment Factory -> your existing dashboard (untouched).
const DEPARTMENTS = [
  {
    href: "/dashboard",
    title: "Garment Factory",
    subtitle: "Production, materials, inventory & payroll",
    icon: Factory,
    bg: "bg-amber-soft",
  },
  {
    href: "/online",
    title: "Grohub Solutions",
    subtitle: "Online orders · Little Minors, TopShop, Trenzee",
    icon: ShoppingBag,
    bg: "bg-periwinkle-soft",
  },
  {
    href: "/retail",
    title: "FS Traders",
    subtitle: "Retail shops · sales, cash book & commissions",
    icon: Store,
    bg: "bg-salmon-soft",
  },
];

export default function DepartmentChooser() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5 py-8">
      <div className="w-full max-w-[560px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-[18px] bg-ink text-white shadow-card">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="M3 7l9 5 9-5" /><path d="M12 12v10" />
            </svg>
          </span>
          <h1 className="text-[26px] font-extrabold tracking-tight text-ink">Karkhana</h1>
          <p className="mt-1.5 text-[14px] font-medium text-muted">Choose a department</p>
        </div>

        <div className="flex flex-col gap-3.5">
          {DEPARTMENTS.map(({ href, title, subtitle, icon: Icon, bg }) => (
            <Link
              key={href}
              href={href}
              className={`reveal flex items-center gap-4 rounded-card border border-line ${bg} px-5 py-[18px] shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card`}
            >
              <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[15px] bg-ink text-white">
                <Icon size={24} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16.5px] font-bold tracking-tight text-ink">{title}</span>
                <span className="mt-0.5 block text-[13px] font-medium text-muted">{subtitle}</span>
              </span>
              <ChevronRight size={18} className="flex-none text-hint" />
            </Link>
          ))}
        </div>

        <p className="mt-6 text-center text-[12px] font-medium text-hint">Grohub Solutions</p>
      </div>
    </div>
  );
}
