"use client";
import { useState } from "react";
import OnlineSidebar from "@/components/OnlineSidebar";
import MobileBar from "@/components/MobileBar";
export default function OnlineLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-canvas dark:bg-[#17140f]">
      <OnlineSidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar title="Grohub Solutions" onOpen={() => setOpen(true)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
