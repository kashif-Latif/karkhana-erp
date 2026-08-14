"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/Topbar";
import UsersTab from "@/components/UsersTab";
import RolesView from "@/components/RolesView";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ShieldAlert } from "lucide-react";

const TABS = ["Users", "Roles & Permissions"] as const;
type Tab = (typeof TABS)[number];

export default function AdministrationPage() {
  const [tab, setTab] = useState<Tab>("Users");
  const [canManage, setCanManage] = useState<boolean | null>(null);

  useEffect(() => {
    if (!supabase) { setCanManage(false); return; }
    supabase.rpc("has_permission", { p_permission_code: "users.manage" }).then(({ data }) => setCanManage(!!data));
  }, []);

  return (
    <>
      <Topbar title="Administration" subtitle="Accounts, roles & access" />
      <div className="px-6 pb-10">
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

            {tab === "Users" && <UsersTab canManage={!!canManage} />}
            {tab === "Roles & Permissions" && <RolesView />}
          </>
        )}
      </div>
    </>
  );
}
