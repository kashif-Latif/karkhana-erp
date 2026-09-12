"use client";
import { useState } from "react";
import OnlineSidebar from "@/components/OnlineSidebar";
import MobileBar from "@/components/MobileBar";
import HubBell from "@/components/HubBell";

/* The bell is in two places on purpose. On a desktop it sits in the sidebar
   beside the department name; on a phone the sidebar is a closed drawer, so it
   also sits in the header bar where it can actually be seen. Same component,
   same unread count — it is one bell shown twice, not two. */
export default function OnlineLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas dark:bg-[#17140f]">
      <OnlineSidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar title="Hub Department" onOpen={() => setOpen(true)} right={<HubBell />} />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
