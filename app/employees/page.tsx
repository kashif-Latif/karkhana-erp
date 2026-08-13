"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/Topbar";
import MasterTab from "@/components/MasterTab";
import EmployeesTab from "@/components/EmployeesTab";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const TABS = ["Employees", "Designations"] as const;
type Tab = (typeof TABS)[number];

export default function EmployeesPage() {
  const [tab, setTab] = useState<Tab>("Employees");
  const [canManage, setCanManage] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [designations, setDesignations] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc("has_permission", { p_permission_code: "employees.manage" }).then(({ data }) => setCanManage(!!data));
  }, []);

  // refresh option lists whenever we land on the Employees tab (picks up new designations)
  useEffect(() => {
    if (!supabase || tab !== "Employees") return;
    supabase.from("departments").select("id,name").eq("is_active", true).order("name")
      .then(({ data }) => setDepartments((data as { id: string; name: string }[]) ?? []));
    supabase.from("designations").select("id,name").eq("is_active", true).order("name")
      .then(({ data }) => setDesignations((data as { id: string; name: string }[]) ?? []));
  }, [tab]);

  return (
    <>
      <Topbar title="Employees" subtitle="Your team & their roles" />
      <div className="px-6 pb-10">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to manage employees.</div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${tab === t ? "bg-ink text-white" : "bg-surface text-muted hover:bg-panel"}`}>
                  {t}
                </button>
              ))}
            </div>

            {tab === "Employees" && <EmployeesTab canManage={canManage} departments={departments} designations={designations} />}
            {tab === "Designations" && (
              <MasterTab table="designations" singular="Designation" canManage={canManage}
                cols={[{ key: "name", label: "Designation" }]}
                fields={[{ key: "name", label: "Designation name", required: true }]} />
            )}
          </>
        )}
      </div>
    </>
  );
}
