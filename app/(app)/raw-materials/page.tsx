"use client";
import Topbar from "@/components/Topbar";
import { Layers, Shirt, ArrowUpRight } from "lucide-react";

// The five fixed raw-material groups (from the spec). Categories/units are the
// planned structure; live stock & rates arrive with the inventory module (Phase 3).
const GROUPS = [
  { name: "Fabric", unit: "KG", accent: "amber", note: "Lycra · Jersey · Terry · Cotton — tracked by type + colour + lot" },
  { name: "Thread", unit: "KG / Pieces", accent: "lavender", note: "Multiple units per configuration; by type + colour" },
  { name: "Zip", unit: "Pieces", accent: "periwinkle", note: "Sizes 1–10 (master-managed) + optional colour" },
  { name: "Sticker", unit: "KG", accent: "pink", note: "By sticker type/category" },
  { name: "Packing Shopper", unit: "KG", accent: "salmon", note: "By shopper type" },
] as const;

const TINT: Record<string, string> = {
  amber: "#F7EAD3", lavender: "#ECE1F6", periwinkle: "#DCE7F5", pink: "#F8DCEE", salmon: "#F5D9CE",
};
const DOT: Record<string, string> = {
  amber: "#E4B47E", lavender: "#B693DD", periwinkle: "#7FA3DC", pink: "#E07FBE", salmon: "#E1876B",
};

export default function RawMaterials() {
  return (
    <>
      <Topbar title="Raw Materials" subtitle="Your five material groups" />
      <div className="px-6 pb-10">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {GROUPS.map((g) => (
            <div
              key={g.name}
              className="rounded-card p-5 shadow-soft"
              style={{ background: TINT[g.accent] }}
            >
              <div className="flex items-start justify-between">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full text-white"
                  style={{ background: DOT[g.accent] }}
                >
                  {g.name === "Fabric" ? <Shirt size={18} /> : <Layers size={18} />}
                </span>
                <ArrowUpRight size={18} className="text-ink/40" />
              </div>
              <h3 className="mt-4 text-[16px] font-extrabold text-ink">{g.name}</h3>
              <p className="mt-0.5 text-[12px] font-semibold text-ink/60">Unit: {g.unit}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink/70">{g.note}</p>
              <p className="mt-3 text-[11.5px] font-medium text-ink/50">
                Live stock &amp; rates appear once the inventory module is live.
              </p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
