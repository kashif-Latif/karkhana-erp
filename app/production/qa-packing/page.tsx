"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { ShieldCheck } from "lucide-react";

export default function Dept() {
  return (
    <>
      <Topbar title="QA/QC & Packing" subtitle="Production department" />
      <SectionStub
        Icon={ShieldCheck}
        phase="Day 5 (Production)"
        intro="Final inspection, pass/fail, and packing — sticker and packing shopper consumed."
        features={[
          "Pieces received, completed, accepted, rejected, and rework",
          "Linked to the Production Order and the employee who did the work",
          "Material consumed at this stage recorded against inventory",
          "Daily figures feed piece-rate earnings (Day 6)",
        ]}
      />
    </>
  );
}
