"use client";
import Topbar from "@/components/Topbar";
import SectionStub from "@/components/SectionStub";
import { Settings } from "lucide-react";

export default function Administration() {
  return (
    <>
      <Topbar title="Administration" subtitle="Users, roles & system settings" />
      <SectionStub
        Icon={Settings}
        phase="Phase 1–2 (foundation already live)"
        intro="The control room. The 8-role permission system and audit framework are already live in your database — these screens will let you manage them without touching code."
        features={[
          "Users — create logins, assign roles (admin-only, no public sign-up)",
          "Roles & permissions matrix (8 roles, 25 action-level permissions)",
          "Departments, designations, colours, sizes, units, material categories",
          "System settings, approval thresholds, and the full audit trail",
        ]}
      />
    </>
  );
}
