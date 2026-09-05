"use client";
/* This page is retired. Issue, return and wastage live on the order
 * (K125/K132); keeping a second door open is how 100 kg of unsorted
 * fabric once reached a closed floor — and how Hub employees kept
 * appearing in a factory dropdown after every other screen was fenced.
 * The route stays only so a stale browser tab lands somewhere sane
 * instead of a 404. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function RetiredMovementsPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/orders"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Stock movements now live on the order — taking you there…</p>;
}
