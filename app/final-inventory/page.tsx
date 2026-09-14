"use client";
/* The warehouse is now four screens. This forwards to its stock. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace("/warehouse/stock"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Opening warehouse…</p>;
}
