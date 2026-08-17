"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CatalogRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/raw-materials"); }, [router]);
  return null;
}
