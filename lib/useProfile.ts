"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Profile = { name: string; email: string; isSuperAdmin: boolean; roleName: string };

/** Loads the signed-in user's profile (full name + role) once. */
export function useProfile(): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("app_users")
        .select("full_name, is_super_admin, user_roles(roles(name))")
        .eq("id", user.id)
        .maybeSingle();

      const isSA = !!data?.is_super_admin;
      const urs = (data as { user_roles?: { roles?: { name?: string } }[] } | null)?.user_roles;
      const firstRole = urs && urs.length > 0 ? urs[0].roles?.name : undefined;
      const roleName = isSA ? "Super Admin" : (firstRole || "User");

      setProfile({
        name: data?.full_name || user.email || "",
        email: user.email || "",
        isSuperAdmin: isSA,
        roleName,
      });
    })();
  }, []);

  return profile;
}
