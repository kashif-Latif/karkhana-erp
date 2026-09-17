"use client";
/* Staff is two screens now — induction and payroll. This forwards. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace("/staff/induction"); }, [router]);
  return <p className="p-8 text-[13px] text-muted">Opening staff…</p>;
}
