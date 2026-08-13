"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [ready, setReady] = useState(false);

  // Auth gate for every page except /login. Active once Supabase keys are set.
  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setReady(true); // preview mode
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else setReady(true);
    });
  }, [isLogin, router]);

  // Login page: no sidebar, no gate — it renders on its own.
  if (isLogin) return <>{children}</>;

  if (!ready) return null;

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
