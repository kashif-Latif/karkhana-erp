"use client";
import { useEffect, useState, useCallback } from "react";
import { Loader2, ShieldCheck, Pencil, X, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Role = { id: string; code: string; name: string; description: string | null };
type Perm = { id: string; code: string; module: string; description: string | null };
type RP = { role_id: string; permission_id: string };

export default function RolesView() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [rp, setRp] = useState<RP[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);

  const [editing, setEditing] = useState<string | null>(null); // role id being edited
  const [draft, setDraft] = useState<Set<string>>(new Set());   // permission ids in the draft
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [r, p, m, can] = await Promise.all([
      supabase.from("roles").select("id,code,name,description").order("name"),
      supabase.from("permissions").select("id,code,module,description").order("module"),
      supabase.from("role_permissions").select("role_id,permission_id"),
      supabase.rpc("has_permission", { p_permission_code: "roles.manage" }),
    ]);
    setRoles((r.data as unknown as Role[]) ?? []);
    setPerms((p.data as unknown as Perm[]) ?? []);
    setRp((m.data as unknown as RP[]) ?? []);
    setCanManage(!!can.data);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>;

  // group permissions by module (stable order)
  const modules = Array.from(new Set(perms.map((p) => p.module)));
  const grantedFor = (roleId: string) => new Set(rp.filter((x) => x.role_id === roleId).map((x) => x.permission_id));

  function startEdit(roleId: string) {
    setDraft(grantedFor(roleId));
    setEditing(roleId);
    setError("");
  }
  function toggle(pid: string) {
    setDraft((d) => { const n = new Set(d); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }
  async function save(roleId: string) {
    if (!supabase) return;
    setSaving(true); setError("");
    const original = grantedFor(roleId);
    const toAdd = [...draft].filter((id) => !original.has(id));
    const toRemove = [...original].filter((id) => !draft.has(id));
    try {
      if (toRemove.length) {
        const { error } = await supabase.from("role_permissions").delete().eq("role_id", roleId).in("permission_id", toRemove);
        if (error) throw error;
      }
      if (toAdd.length) {
        const { error } = await supabase.from("role_permissions").insert(toAdd.map((pid) => ({ role_id: roleId, permission_id: pid })));
        if (error) throw error;
      }
      setEditing(null);
      await load();
    } catch (e) {
      const msg = (e as { message?: string })?.message || "Could not save.";
      setError(msg.toLowerCase().includes("row-level") ? "You don't have permission to change roles." : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mb-4 text-[13px] text-muted">
        What each role is allowed to do. {canManage ? "Tick or untick a feature, then Save." : "Ask an administrator to change these."}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {roles.map((role) => {
          const isSA = role.code === "super_admin";
          const isEditing = editing === role.id;
          const granted = grantedFor(role.id);
          const shown = isEditing ? draft : granted;

          return (
            <div key={role.id} className="rounded-card bg-surface p-5 shadow-card">
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-salmon-strong" />
                  <h3 className="text-[15px] font-extrabold text-ink">{role.name}</h3>
                </div>
                {canManage && !isSA && (
                  isEditing ? (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing(null)} disabled={saving} className="rounded-full p-1 text-muted hover:bg-panel" title="Cancel"><X size={16} /></button>
                      <button onClick={() => save(role.id)} disabled={saving} className="flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(role.id)} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-ink/70 hover:bg-panel">
                      <Pencil size={12} /> Edit
                    </button>
                  )
                )}
              </div>
              {role.description && <p className="mb-3 text-[12px] text-muted">{role.description}</p>}

              {isSA ? (
                <span className="inline-block rounded-full bg-lavender/40 px-3 py-1 text-[12px] font-semibold text-ink">Full access to everything</span>
              ) : (
                <div className="space-y-3">
                  {modules.map((mod) => {
                    const list = perms.filter((p) => p.module === mod);
                    if (!isEditing) {
                      const on = list.filter((p) => shown.has(p.id));
                      if (on.length === 0) return null;
                      return (
                        <div key={mod}>
                          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-hint">{mod}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {on.map((p) => (
                              <span key={p.id} className="rounded-full bg-panel px-2.5 py-1 text-[11.5px] text-ink/80" title={p.code}>{p.description || p.code}</span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    // editing: show all permissions in the module as checkboxes
                    return (
                      <div key={mod}>
                        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-hint">{mod}</p>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {list.map((p) => (
                            <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-canvas">
                              <input type="checkbox" checked={shown.has(p.id)} onChange={() => toggle(p.id)} className="mt-0.5 h-4 w-4 accent-salmon-strong" />
                              <span className="text-[12.5px] text-ink/85" title={p.code}>{p.description || p.code}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {!isEditing && granted.size === 0 && <p className="text-[12.5px] text-hint">No permissions assigned.</p>}
                </div>
              )}

              {isEditing && error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
