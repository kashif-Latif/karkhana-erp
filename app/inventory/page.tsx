"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { Boxes } from "lucide-react";

export default function Inventory() {
  return (
    <>
      <Topbar title="Inventory" subtitle="Stock, ledger & movements" />
      <SectionStub
        Icon={Boxes}
        phase="Phase 3 (highest priority)"
        intro="The heart of the system: a transaction-based stock ledger where every movement is a posted, immutable entry and the balance is always explainable from the ledger."
        features={[
          "Current stock by material → category → colour → size → batch → location",
          "Goods Receipt (GRN), Issue, Return, Transfer, Adjustment, Wastage",
          "Full stock ledger with running balance and rate history",
          "Server-side negative-stock prevention and concurrency safety",
          "Draft → Submitted → Approved → Posted approval workflow",
        ]}
      />
    </>
  );
}
