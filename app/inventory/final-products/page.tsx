"use client";
import Topbar from "@/components/Topbar";
import { PackageCheck } from "lucide-react";

export default function FinalProducts() {
  return (
    <>
      <Topbar title="Final Product Inventory" subtitle="Finished garments ready to sell & ship" />
      <div className="px-6 pb-12">
        <div className="rounded-card bg-surface p-10 text-center shadow-card">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-panel text-ink"><PackageCheck size={28} /></span>
          <h2 className="mt-4 text-[18px] font-extrabold text-ink">No finished products yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-muted">
            This is where your <b>finished garments</b> (shirts, trousers — for kids, men, ladies) will appear as live stock once they come out of Packing. It fills up automatically when the <b>Production</b> module is running.
          </p>
          <p className="mx-auto mt-3 max-w-md text-[12.5px] text-hint">
            Coming in Day 5 — Production. Every finished piece will land here and be reconciled against the fabric it was made from.
          </p>
        </div>
      </div>
    </>
  );
}
