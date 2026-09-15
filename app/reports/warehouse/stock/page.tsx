"use client";
/* Stock reporting belongs to the factory. The warehouse reads its holdings
 * from Products.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace("/warehouse/products"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Opening Products…</p>;
}
