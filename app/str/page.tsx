"use client";
/* STR is now one screen per department. This forwards to the factory one. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace("/str/factory"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Opening STR…</p>;
}
