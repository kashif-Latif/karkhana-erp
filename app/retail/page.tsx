"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function RetailHome() {
  const router = useRouter();
  useEffect(() => { router.replace("/retail/dashboard"); }, [router]);
  return null;
}
