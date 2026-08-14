"use client";
import { useEffect, useState, useCallback } from "react";
import { Loader2, UserPlus, ShieldCheck, X, KeyRound, Users } from "lucide-react";
import IconChip from "@/components/IconChip";
import { supabase } from "@/lib/supabase";

type Role = { id: string; name: string; code: string };
type AppUser = Record<string, unknown>;
type NewForm = { full_name: string; email: string; password: string; role_id: string };
const EMPTY_NEW: NewForm = { full_name: "", email: "", password: "", role_id: "" };

export default function UsersTab({ canManage }: { canManage: boolean }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [nf, setNf] = useState<NewForm>({ ...EMPTY_NEW });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createdMsg, setCreatedMsg] = useState("");

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

  function openAdd() { setNf({ ...EMPTY_NEW }); setCreateError(""); setCreatedMsg(""); setShowAdd(true); }

  async function createUser() {
    if (!supabase) return;
    if (!nf.email.trim() || !nf.password) { setCreateError("Email and password are required."); return; }
    if (nf.password.length < 6) { setCreateError("Password must be at least 6 characters."); return; }
    setCreating(true); setCreateError("");
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: { full_name: nf.full_name, email: nf.email, password: nf.password, role_id: nf.role_id || null },
    });
    setCreating(false);

    if (error) {
      let msg = error.message || "Could not create the account.";
      try {
        const ctx = (error as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") { const b = await ctx.json(); if (b?.error) msg = b.error; }
      } catch { /* keep msg */ }
      if (/fetch|not found|failed to send|404/i.test(msg)) {
        msg = "The account-creation function isn't deployed yet. Deploy 'create-user' once (steps I gave you), then try again.";
      }
      setCreateError(msg);
      return;
    }
    if ((data as { error?: string })?.error) { setCreateError((data as { error: string }).error); return; }

    setCreatedMsg(`Account created for ${nf.email.trim()}. Share the email + password with them.`);
    setNf({ ...EMPTY_NEW });
    load();
  }

  const roleOf = (u: AppUser): string => {
    const urs = u.user_roles as { role_id?: string }[] | undefined;
    return urs && urs.length > 0 ? (urs[0].role_id ?? "") : "";
  };
  const nSet = (k: keyof NewForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setNf((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">People who can log in to the system.</p>
        {canManage && (
          <button onClick={openAdd} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-white">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !creating && setShowAdd(false)}>
          <div className="w-full max-w-lg rounded-card bg-surface p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <IconChip Icon={KeyRound} size={38} />
                <h2 className="text-[17px] font-extrabold">Add a login account</h2>
              </div>
              <button onClick={() => setShowAdd(false)} className="rounded-full p-1.5 text-muted hover:bg-panel"><X size={18} /></button>
            </div>

            {createdMsg ? (
              <>
                <div className="rounded-xl2 bg-success-soft px-4 py-3 text-[13px] font-medium text-[#166534]">{createdMsg}</div>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => { setCreatedMsg(""); }} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Add another</button>
                  <button onClick={() => setShowAdd(false)} className="rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white">Done</button>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Lbl label="Full name"><input value={nf.full_name} onChange={nSet("full_name")} placeholder="e.g. Bilal Khan" className={inp} /></Lbl></div>
                  <div className="sm:col-span-2"><Lbl label="Email *"><input value={nf.email} onChange={nSet("email")} placeholder="name@factory.com" className={inp} /></Lbl></div>
                  <Lbl label="Temporary password *"><input value={nf.password} onChange={nSet("password")} placeholder="min 6 characters" className={inp} /></Lbl>
                  <Lbl label="Role">
                    <select value={nf.role_id} onChange={nSet("role_id")} className={inp}>
                      <option value="">No role (set later)</option>
                      {roles.filter((r) => r.code !== "super_admin").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </Lbl>
                </div>
                <p className="mt-2 text-[11.5px] text-hint">You set a temporary password and share it with them. They see only what their role allows.</p>
                {createError && <p className="mt-3 text-[12.5px] font-medium text-danger">{createError}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setShowAdd(false)} disabled={creating} className="rounded-xl2 border border-line px-4 py-2.5 text-[13px] font-semibold text-ink/70 hover:bg-panel">Cancel</button>
                  <button onClick={createUser} disabled={creating} className="flex items-center gap-1.5 rounded-xl2 bg-ink px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                    {creating && <Loader2 size={15} className="animate-spin" />}Create account
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
function Lbl({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>{children}</label>;
}
