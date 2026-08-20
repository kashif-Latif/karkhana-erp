"use client";
import { useState } from "react";
import RetailSidebar from "@/components/RetailSidebar";
import MobileBar from "@/components/MobileBar";
export default function RetailLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas dark:bg-[#17140f]">
      <RetailSidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar title="FS Traders" onOpen={() => setOpen(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
