"use client";
/* Head Office has no landing screen of its own. The cash flow is what the
   person opening this section came to look at, so they are sent straight
   there rather than shown a menu they already used to get here. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function HoHome() {
  const router = useRouter();
  useEffect(() => { router.replace("/retail/ho/cashflow"); }, [router]);
  return null;
}
