"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import Link from "next/link";
import Sidebar from "./Sidebar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { usePermissions } from "@/lib/usePermissions";
import { requiredFor } from "@/lib/access";

function AccessRestricted() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-panel text-muted"><Lock size={24} /></span>
      <h2 className="text-[18px] font-extrabold text-ink">You don&apos;t have access to this area</h2>
      <p className="mt-1 max-w-sm text-[13px] text-muted">Your role doesn&apos;t include this section. If you need it, ask an administrator to grant you access.</p>
      <Link href="/" className="mt-5 rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-white">Back to Home</Link>
    </div>
  );
}

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [authReady, setAuthReady] = useState(false);
  const { ready: permsReady, can } = usePermissions();

  // Auth gate for every page except /login.
  useEffect(() => {
    if (isLogin) { setAuthReady(true); return; }
    if (!isSupabaseConfigured || !supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else setAuthReady(true);
    });
  }, [isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (!authReady) return null;

  const allowed = can(requiredFor(pathname));

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar />
      <main className="min-w-0 flex-1">
        {!permsReady ? null : allowed ? children : <AccessRestricted />}
      </main>
    </div>
  );
}
