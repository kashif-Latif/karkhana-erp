"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { CheckSquare } from "lucide-react";

export default function Approvals() {
  return (
    <>
      <Topbar title="Approvals" subtitle="Pending items awaiting sign-off" />
      <SectionStub
        Icon={CheckSquare}
        phase="Phase 3 onward"
        intro="A single queue of everything waiting for approval, with the right people able to approve, reject or reverse — enforced by role, in the database."
        features={[
          "GRNs, issues, transfers, stock adjustments, wastage, rate changes",
          "Draft → Submitted → Approved → Posted (or Rejected) lifecycle",
          "Approve / reject / reverse — permission-checked server-side",
          "Every decision written to the audit trail",
        ]}
      />
    </>
  );
}
