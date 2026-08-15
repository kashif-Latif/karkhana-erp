"use client";
import { createContext, useContext, useEffect, useState, createElement, type ReactNode } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { hasAny } from "@/lib/access";

type Ctx = { ready: boolean; all: boolean; can: (req: string[] | null) => boolean };
const PermissionsCtx = createContext<Ctx>({ ready: false, all: false, can: () => false });

// Single source of truth for the signed-in user's permissions.
// Fetched ONCE, only after the session is confirmed. Super admins always
// get full access (belt-and-suspenders so they can never be locked out).
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; perms: Set<string>; all: boolean }>(
    { ready: false, perms: new Set(), all: false }
  );

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setState({ ready: true, perms: new Set(), all: true });
      return;
    }
    let active = true;
    (async () => {
      const { data: { session } } = await supabase!.auth.getSession();
      if (!session) { if (active) setState({ ready: true, perms: new Set(), all: false }); return; }
      const [prof, permRes] = await Promise.all([
        supabase!.from("app_users").select("is_super_admin").eq("id", session.user.id).maybeSingle(),
        supabase!.rpc("my_permissions"),
      ]);
      if (!active) return;
      const isSuperAdmin = !!prof.data?.is_super_admin;
      setState({ ready: true, perms: new Set((permRes.data as string[]) ?? []), all: isSuperAdmin });
    })();
    return () => { active = false; };
  }, []);

  const can = (req: string[] | null) => state.all || hasAny(state.perms, req);
  return createElement(PermissionsCtx.Provider, { value: { ready: state.ready, all: state.all, can } }, children);
}

export function usePermissions() {
  return useContext(PermissionsCtx);
}
