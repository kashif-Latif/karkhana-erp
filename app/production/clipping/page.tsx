"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { Shrink } from "lucide-react";

export default function Dept() {
  return (
    <>
      <Topbar title="Clipping" subtitle="Production department" />
      <SectionStub
        Icon={Shrink}
        phase="Day 5 (Production)"
        intro="Trimming and clipping of stitched pieces, with accepted, rejected and rework counts."
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
