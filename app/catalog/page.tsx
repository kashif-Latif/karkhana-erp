"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/Topbar";
import MasterTab, { type Col } from "@/components/MasterTab";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const TABS = ["Categories", "Colours", "Sizes", "Units"] as const;
type Tab = (typeof TABS)[number];

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>("Categories");
  const [canManage, setCanManage] = useState(false);
  const [groups, setGroups] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc("has_permission", { p_permission_code: "materials.manage" })
      .then(({ data }) => setCanManage(!!data));
    supabase.from("material_groups").select("id,name").eq("is_active", true).order("name")
      .then(({ data }) => setGroups((data ?? []).map((g: { id: string; name: string }) => ({ value: g.id, label: g.name }))));
  }, []);

  const groupCol: Col = {
    key: "group",
    label: "Material group",
    render: (r) => {
      const g = r.material_groups as { name?: string } | null;
      return g?.name || "—";
    },
  };

  return (
    <>
      <Topbar title="Catalog" subtitle="The building blocks your materials are made of" />
      <div className="px-6 pb-10">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">
            Connect Supabase to manage the catalog.
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${
                    tab === t ? "bg-ink text-white" : "bg-surface text-muted hover:bg-panel"}`}>
                  {t}
                </button>
              ))}
            </div>

            {tab === "Categories" && (
              <MasterTab table="material_categories" singular="Category" canManage={canManage}
                selectQuery="*, material_groups(name)"
                cols={[{ key: "name", label: "Category" }, groupCol]}
                fields={[
                  { key: "name", label: "Category name", required: true },
                  { key: "group_id", label: "Material group", type: "select", required: true, options: groups },
                ]} />
            )}
            {tab === "Colours" && (
              <MasterTab table="colors" singular="Colour" canManage={canManage}
                cols={[{ key: "name", label: "Colour" }]}
                fields={[{ key: "name", label: "Colour name", required: true }]} />
            )}
            {tab === "Sizes" && (
              <MasterTab table="sizes" singular="Size" canManage={canManage}
                cols={[{ key: "name", label: "Size" }, { key: "sort_order", label: "Order" }]}
                fields={[
                  { key: "name", label: "Size name", required: true },
                  { key: "sort_order", label: "Sort order", type: "number" },
                ]} />
            )}
            {tab === "Units" && (
              <MasterTab table="units" singular="Unit" canManage={canManage}
                cols={[{ key: "name", label: "Unit" }, { key: "symbol", label: "Symbol" }]}
                fields={[
                  { key: "name", label: "Unit name", required: true },
                  { key: "symbol", label: "Symbol (KG, pcs…)" },
                ]} />
            )}
          </>
        )}
      </div>
    </>
  );
}
