"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { Users } from "lucide-react";

export default function Employees() {
  return (
    <>
      <Topbar title="Employees" subtitle="Staff, piece rates & earnings" />
      <SectionStub
        Icon={Users}
        phase="Phase 2 (master) & Phase 5 (piece-rate)"
        intro="The employee master plus the piece-rate engine: wages are calculated from accepted pieces at the rate that applied on that date, with a per-employee earnings ledger."
        features={[
          "Employee master — code, name, department, designation, status",
          "Piece rates by employee / operation / product, with rate history",
          "Daily production entry → accepted pieces × applicable rate",
          "Per-employee earnings ledger: daily, weekly, monthly, payroll",
        ]}
      />
    </>
  );
}
