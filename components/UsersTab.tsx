"use client";
import { useEffect, useState, useCallback } from "react";
import { Loader2, UserPlus, ShieldCheck, X, KeyRound, Users } from "lucide-react";
import IconChip from "@/components/IconChip";
import { supabase } from "@/lib/supabase";

type Role = { id: string; name: string; code: string };
type AppUser = Record<string, unknown>;

export default function UsersTab({ canManage }: { canManage: boolean }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true); setError("");
    const [u, r] = await Promise.all([
      supabase.from("app_users")
        .select("id, full_name, email, status, is_super_admin, user_roles(role_id, roles(id,name))")
        .order("full_name"),
      supabase.from("roles").select("id,name,code").order("name"),
    ]);
    setUsers((u.data as unknown as AppUser[]) ?? []);
    setRoles((r.data as unknown as Role[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function changeRole(userId: string, roleId: string) {
    if (!supabase) return;
    setBusy(userId); setError("");
    const { error } = await supabase.rpc("set_user_role", { p_user_id: userId, p_role_id: roleId || null });
    setBusy(null);
    if (error) { setError(error.message); return; }
    load();
  }
  async function changeStatus(userId: string, status: string) {
    if (!supabase) return;
    setBusy(userId); setError("");
    const { error } = await supabase.from("app_users").update({ status }).eq("id", userId);
    setBusy(null);
    if (error) { setError(error.message.toLowerCase().includes("row-level") ? "You don't have permission to do this." : error.message); return; }
    load();
  }

  const roleOf = (u: AppUser): string => {
    const urs = u.user_roles as { role_id?: string }[] | undefined;
    return urs && urs.length > 0 ? (urs[0].role_id ?? "") : "";
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">People who can log in to the system.</p>
        {canManage && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
            <UserPlus size={16} /> Add account
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-[12.5px] font-medium text-danger">{error}</p>}

      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <IconChip Icon={Users} size={44} />
            <p className="text-[14px] font-semibold text-ink">No accounts yet</p>
            <p className="text-[12.5px] text-muted">Add your first login account.</p>
          </div>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const id = u.id as string;
                const isSA = u.is_super_admin as boolean;
                return (
                  <tr key={id} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        {u.full_name as string}
                        {isSA && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-lavender/40 px-2 py-0.5 text-[10.5px] font-semibold text-ink">
                            <ShieldCheck size={11} /> Super Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-ink/70">{(u.email as string) || "—"}</td>
                    <td className="px-5 py-3">
                      {canManage ? (
                        <div className="flex items-center gap-2">
                          <select value={roleOf(u)} disabled={busy === id}
                            onChange={(e) => changeRole(id, e.target.value)}
                            className="rounded-xl2 border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-salmon-strong/50 disabled:opacity-50">
                            <option value="">No role</option>
                            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          {isSA && <span className="text-[11px] text-hint" title="Super admins keep full access regardless of role">(full access)</span>}
                        </div>
                      ) : (
                        <span className="text-ink/70">{(u.user_roles as { roles?: { name?: string } }[] | undefined)?.[0]?.roles?.name || "—"}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {canManage ? (
                        <select value={(u.status as string) || "active"} disabled={busy === id}
                          onChange={(e) => changeStatus(id, e.target.value)}
                          className="rounded-xl2 border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-salmon-strong/50 disabled:opacity-50">
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      ) : (
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${u.status === "active" ? "bg-success-soft text-[#166534]" : "bg-panel text-muted"}`}>
                          {(u.status as string) || "active"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-[12px] text-muted">{users.length} account(s)</p>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-lg rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <IconChip Icon={KeyRound} size={38} />
                <h2 className="text-[17px] font-extrabold">Add a login account</h2>
              </div>
              <button onClick={() => setShowAdd(false)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>
            <p className="mb-4 text-[13px] leading-relaxed text-ink/80">
              For security, creating a login uses a protected key that must never live in the browser — so for now you create the login in Supabase, and it appears here instantly.
            </p>
            <ol className="space-y-3 text-[13px] text-ink/85">
              <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">1</span>
                <span>Open <b>Supabase → Authentication → Users → Add user → Create new user</b>. Enter their <b>email</b> and a <b>password</b>.</span></li>
              <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">2</span>
                <span>They appear in this list <b>automatically</b>. Set their <b>role</b> and <b>status</b> right here.</span></li>
              <li className="flex gap-2.5"><span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">3</span>
                <span>Share the email + password with them — they log in and see only what their role allows.</span></li>
            </ol>
            <div className="mt-5 rounded-xl2 bg-panel px-3.5 py-2.5 text-[12px] text-muted">
              Coming next: one-click account creation right here, through a secure server-side function.
            </div>
            <div className="mt-5 flex justify-end">
              <button onClick={() => { setShowAdd(false); load(); }} className="rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white">Got it — refresh list</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
