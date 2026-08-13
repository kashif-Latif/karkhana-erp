"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { Flame } from "lucide-react";

export default function Dept() {
  return (
    <>
      <Topbar title="Iron / Pressing" subtitle="Production department" />
      <SectionStub
        Icon={Flame}
        phase="Day 5 (Production)"
        intro="Pressing and finishing of garments, with accepted, rejected and rework counts."
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
