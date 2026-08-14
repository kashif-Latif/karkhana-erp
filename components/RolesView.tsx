"use client";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Role = { id: string; code: string; name: string; description: string | null };
type Perm = { id: string; code: string; module: string; description: string | null };
type RP = { role_id: string; permission_id: string };

export default function RolesView() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [rp, setRp] = useState<RP[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    (async () => {
      const [r, p, m] = await Promise.all([
        supabase.from("roles").select("id,code,name,description").order("name"),
        supabase.from("permissions").select("id,code,module,description").order("module"),
        supabase.from("role_permissions").select("role_id,permission_id"),
      ]);
      setRoles((r.data as unknown as Role[]) ?? []);
      setPerms((p.data as unknown as Perm[]) ?? []);
      setRp((m.data as unknown as RP[]) ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>;

  const permById = new Map(perms.map((p) => [p.id, p]));

  return (
    <div>
      <p className="mb-4 text-[13px] text-muted">What each role is allowed to do. These 8 roles and their permissions are enforced in the database.</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {roles.map((role) => {
          const mine = rp.filter((x) => x.role_id === role.id).map((x) => permById.get(x.permission_id)).filter(Boolean) as Perm[];
          const byModule = mine.reduce<Record<string, Perm[]>>((acc, p) => { (acc[p.module] ??= []).push(p); return acc; }, {});
          const isSA = role.code === "super_admin";
          return (
            <div key={role.id} className="rounded-card bg-surface p-5 shadow-card">
              <div className="mb-1 flex items-center gap-2">
                <ShieldCheck size={16} className="text-salmon-strong" />
                <h3 className="text-[15px] font-extrabold text-ink">{role.name}</h3>
              </div>
              {role.description && <p className="mb-3 text-[12px] text-muted">{role.description}</p>}
              {isSA ? (
                <span className="inline-block rounded-full bg-lavender/40 px-3 py-1 text-[12px] font-semibold text-ink">Full access to everything</span>
              ) : mine.length === 0 ? (
                <p className="text-[12.5px] text-hint">No permissions assigned.</p>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(byModule).map(([mod, list]) => (
                    <div key={mod}>
                      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-hint">{mod}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((p) => (
                          <span key={p.id} className="rounded-full bg-panel px-2.5 py-1 text-[11.5px] text-ink/80" title={p.code}>
                            {p.description || p.code}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
