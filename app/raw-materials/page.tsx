"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/Topbar";
import MasterTab from "@/components/MasterTab";
import ItemsTab from "@/components/ItemsTab";
import MaterialsTab from "@/components/MaterialsTab";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const TABS = ["Items", "Materials", "Categories", "Colours", "Sizes", "Units"] as const;
type Tab = (typeof TABS)[number];

/* Cloth is its own world. Fabric is bought by weight or by the metre, sorted
   by colour, and consumes most of the money. Zips, thread, stickers and
   shoppers are bought by the piece and behave nothing like it. Showing them
   in one list means a storekeeper looking for a fabric category wades past
   sticker sizes. FAB is the cloth family; everything else is trims. */
const CLOTH_GROUPS = ["FAB"];
type Family = "cloth" | "other";

export default function RawMaterialsPage() {
  const [tab, setTab] = useState<Tab>("Items");
  const [family, setFamily] = useState<Family>("cloth");
  const [canManage, setCanManage] = useState(false);
  const [catGroups, setCatGroups] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc("has_permission", { p_permission_code: "materials.manage" }).then(({ data }) => setCanManage(!!data));
    supabase.from("material_groups").select("id,name").eq("has_category", true).eq("is_active", true).order("name")
      .then(({ data }) => setCatGroups((data ?? []).map((g: { id: string; name: string }) => ({ value: g.id, label: g.name }))));
  }, []);

  return (
    <>
      <Topbar title="Raw Materials" subtitle="Materials, their items, and the shared building blocks" />
      <div className="px-6 pb-10">
        {!isSupabaseConfigured ? (
          <div className="rounded-card bg-surface p-8 text-center text-[14px] text-muted shadow-card">Connect Supabase to manage raw materials.</div>
        ) : (
          <>
            <div className="mb-4 inline-flex rounded-full bg-surface p-1 shadow-soft">
              {([["cloth", "Cloth"], ["other", "Other materials"]] as [Family, string][]).map(([f, label]) => (
                <button key={f} onClick={() => setFamily(f)}
                  className={`rounded-full px-5 py-2 text-[13px] font-semibold transition ${family === f ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mb-4 text-[12.5px] text-muted">
              {family === "cloth"
                ? "Fabric and its categories — bought by weight or by the metre, sorted by colour."
                : "Zip, Thread, Sticker and Packing Shopper — their categories and sizes."}
            </p>

            <div className="mb-5 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${tab === t ? "bg-ink text-white" : "bg-surface text-muted hover:bg-panel"}`}>
                  {t}
                </button>
              ))}
            </div>

            {tab === "Items" && <ItemsTab canManage={canManage} family={family} clothGroups={CLOTH_GROUPS} />}
            {tab === "Materials" && <MaterialsTab canManage={canManage} family={family} clothGroups={CLOTH_GROUPS} />}

            {tab === "Categories" && (
              <MasterTab table="material_categories" singular="Category" canManage={canManage}
                selectQuery="*, material_groups(name)"
                cols={[{ key: "name", label: "Category" }, { key: "group", label: "Material", render: (r) => (r.material_groups as { name?: string } | null)?.name || "—" }]}
                fields={[
                  { key: "name", label: "Category name", required: true },
                  { key: "group_id", label: "Material", type: "select", required: true, options: catGroups },
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
                fields={[{ key: "name", label: "Size name", required: true }, { key: "sort_order", label: "Sort order", type: "number" }]} />
            )}
            {tab === "Units" && (
              <MasterTab table="units" singular="Unit" canManage={canManage}
                cols={[{ key: "name", label: "Unit" }, { key: "symbol", label: "Symbol" }]}
                fields={[{ key: "name", label: "Unit name", required: true }, { key: "symbol", label: "Symbol (KG, pcs…)" }]} />
            )}
          </>
        )}
      </div>
    </>
  );
}
