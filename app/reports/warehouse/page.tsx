"use client";
/* The combined report screen lived here. Each report is now its own route,
 * so this only forwards — an old link or a stale tab lands on a real screen
 * instead of breaking the build or showing the wrong thing.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace("/reports/warehouse/grn"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Opening reports…</p>;
}
