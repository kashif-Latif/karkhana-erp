"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Profile = { name: string; email: string; isSuperAdmin: boolean };

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
        .select("full_name, is_super_admin")
        .eq("id", user.id)
        .maybeSingle();
      setProfile({
        name: data?.full_name || user.email || "",
        email: user.email || "",
        isSuperAdmin: !!data?.is_super_admin,
      });
    })();
  }, []);

  return profile;
}
