"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { Scissors } from "lucide-react";

export default function Dept() {
  return (
    <>
      <Topbar title="Cutting" subtitle="Production department" />
      <SectionStub
        Icon={Scissors}
        phase="Day 5 (Production)"
        intro="Fabric issue, spreading and cutting into parts — with cut pieces and wastage recorded."
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
