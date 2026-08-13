"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { FileBarChart } from "lucide-react";

export default function Reports() {
  return (
    <>
      <Topbar title="Reports" subtitle="Inventory, purchase, production & payroll" />
      <SectionStub
        Icon={FileBarChart}
        phase="Phase 6"
        intro="Filterable, exportable reports across the whole system, with date, material, department, employee, supplier and production-order filters."
        features={[
          "Inventory: current stock, ledger, movement, valuation, low stock, wastage",
          "Purchases: supplier-wise, material-wise, rate history, monthly",
          "Production: WIP, department productivity, actual vs expected consumption",
          "Employee: production, piece earnings, monthly payroll",
          "Export to Excel / CSV / PDF",
        ]}
      />
    </>
  );
}
