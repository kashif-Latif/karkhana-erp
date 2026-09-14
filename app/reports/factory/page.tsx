"use client";
import { Suspense } from "react";
import ReportsScreen from "@/components/ReportsScreen";

export default function Page() {
  return <Suspense fallback={null}><ReportsScreen side="factory" /></Suspense>;
}
