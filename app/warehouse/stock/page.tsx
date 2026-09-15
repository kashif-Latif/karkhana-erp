"use client";
/* The warehouse has no separate stock screen — Products already shows what is
 * held. Kept only so an old link lands somewhere real.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace("/warehouse/products"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Opening Products…</p>;
}
