"use client";
import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { hasAny } from "@/lib/access";

// Loads the signed-in user's permission codes once, and exposes can().
// In preview mode (no Supabase keys) everything is allowed so the demo works.
export function usePermissions() {
  const [state, setState] = useState<{ ready: boolean; perms: Set<string>; all: boolean }>(
    { ready: false, perms: new Set(), all: false }
  );

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setState({ ready: true, perms: new Set(), all: true });
      return;
    }
    let active = true;
    supabase.rpc("my_permissions").then(({ data }) => {
      if (active) setState({ ready: true, perms: new Set((data as string[]) ?? []), all: false });
    });
    return () => { active = false; };
  }, []);

  const can = (required: string[] | null) => state.all || hasAny(state.perms, required);
  return { ready: state.ready, can, all: state.all };
}
