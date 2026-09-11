"use client";
/* The old GRN screen lived here. It is replaced by /grn, which keeps the
 * three divisions apart. This stays only so an old link, a bookmark or a
 * stale tab lands somewhere correct instead of on a page showing counts
 * that no longer mean anything.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RetiredInventoryPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/grn"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Moved to GRN — taking you there…</p>;
}
