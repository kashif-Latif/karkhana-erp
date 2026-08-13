"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { Shirt } from "lucide-react";

export default function Dept() {
  return (
    <>
      <Topbar title="Stitching" subtitle="Production department" />
      <SectionStub
        Icon={Shirt}
        phase="Day 5 (Production)"
        intro="Overlock, flatlock and zip attach — thread and zip consumed against inventory."
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
