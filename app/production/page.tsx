"use client";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { Scissors, Shirt, Shrink, Flame, ShieldCheck, ChevronRight } from "lucide-react";

const DEPTS = [
  { name: "Cutting", href: "/production/cutting", Icon: Scissors, accent: "amber", desc: "Fabric issue → spreading → cutting → cut pieces + wastage" },
  { name: "Stitching", href: "/production/stitching", Icon: Shirt, accent: "lavender", desc: "Overlock · flatlock · zip attach — thread & zip consumed" },
  { name: "Clipping", href: "/production/clipping", Icon: Shrink, accent: "periwinkle", desc: "Trimming, accepted / rejected / rework" },
  { name: "Iron / Pressing", href: "/production/iron", Icon: Flame, accent: "pink", desc: "Pressing, accepted / rejected / rework" },
  { name: "QA/QC & Packing", href: "/production/qa-packing", Icon: ShieldCheck, accent: "salmon", desc: "Inspect → pass/fail → pack (sticker + shopper consumed)" },
] as const;

const DOT: Record<string, string> = {
  amber: "#E4B47E", lavender: "#B693DD", periwinkle: "#7FA3DC", pink: "#E07FBE", salmon: "#E1876B",
};

export default function Production() {
  return (
    <>
      <Topbar title="Production" subtitle="The five-stage workflow — open a department" />
      <div className="px-6 pb-10">
        <div className="space-y-3">
          {DEPTS.map((d, i) => (
            <Link
              key={d.name}
              href={d.href}
              className="flex items-center gap-4 rounded-card bg-surface p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
            >
              <span className="w-6 text-center text-[13px] font-bold text-ink/30">{i + 1}</span>
              <span className="flex h-11 w-11 items-center justify-center rounded-full text-white"
                style={{ background: DOT[d.accent] }}>
                <d.Icon size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-ink">{d.name}</h3>
                <p className="text-[12.5px] text-muted">{d.desc}</p>
              </div>
              <ChevronRight size={18} className="text-ink/30" />
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
