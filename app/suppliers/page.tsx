"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { Truck } from "lucide-react";

export default function Suppliers() {
  return (
    <>
      <Topbar title="Suppliers" subtitle="Supplier master & purchase history" />
      <SectionStub
        Icon={Truck}
        phase="Phase 2 (next module)"
        intro="Every goods receipt is tied to a supplier. This is the first real data screen we build next — add, edit and list your suppliers, then see purchase history per supplier."
        features={[
          "Supplier code, company, contact person, phone, email, address, NTN/tax",
          "Active / inactive status (never deleted if referenced by history)",
          "Supplier-wise purchase history and totals",
          "Feeds directly into GRN goods-receiving in Phase 3",
        ]}
      />
    </>
  );
}
