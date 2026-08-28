"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Topbar from "@/components/Topbar";
import UsersTab from "@/components/UsersTab";
import AdminEmployeesTab from "@/components/AdminEmployeesTab";
import RolesView from "@/components/RolesView";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ShieldAlert } from "lucide-react";

// Employees first: it is the tab people open most, and it is the one that
// makes this page the place where staff are managed rather than just logins.
const TABS = ["Employees", "Users", "Roles & Permissions"] as const;
type Tab = (typeof TABS)[number];

export default function AdministrationPage() {
  const [tab, setTab] = useState<Tab>("Employees");
  const [canManage, setCanManage] = useState<boolean | null>(null);

  useEffect(() => {
    if (!supabase) { setCanManage(false); return; }
    supabase.rpc("has_permission", { p_permission_code: "users.manage" }).then(({ data }) => setCanManage(!!data));
  }, []);

  return (
    <>
      <Topbar title="Administration" subtitle="Employees, logins, roles & access" />
      <div className="px-6 pb-10">
        {/* Administration is one of the four boxes on the home screen, not a
            page inside a department — so it needs its own way back. Without the
            factory sidebar there was no route out but the browser button. */}
        <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted transition hover:text-ink dark:text-[#a89f93] dark:hover:text-white">
          <ArrowLeft size={15} /> All departments
        </Link>
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to manage users.</div>
        ) : (
          <>
            {canManage === false && (
              <div className="mb-5 flex items-center gap-2.5 rounded-card bg-amber/25 px-4 py-3 text-[13px] text-ink/80">
                <ShieldAlert size={16} /> You can view this page, but only administrators can change accounts or roles.
              </div>
            )}
            <div className="mb-5 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${tab === t ? "bg-ink text-white" : "bg-surface text-muted hover:bg-panel"}`}>
                  {t}
                </button>
              ))}
            </div>

            {tab === "Employees" && <AdminEmployeesTab canManage={!!canManage} />}
            {tab === "Users" && <UsersTab canManage={!!canManage} />}
            {tab === "Roles & Permissions" && <RolesView />}
          </>
        )}
      </div>
    </>
  );
}
