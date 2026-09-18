"use client";
/* The warehouse's outward movement IS the STR screen, which lives with its
   parties and delivery numbers. This forwards there. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace("/warehouse/grn-out"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Opening STR…</p>;
}
