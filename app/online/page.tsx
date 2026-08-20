"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function OnlineHome() {
  const router = useRouter();
  useEffect(() => { router.replace("/online/orders"); }, [router]);
  return null;
}
