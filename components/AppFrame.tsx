"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import Link from "next/link";
import Sidebar from "./Sidebar";
import SetPassword from "./SetPassword";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { PermissionsProvider, usePermissions } from "@/lib/usePermissions";
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

// Inside the provider: has access to the shared permissions.
function FrameContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, can } = usePermissions();
  const allowed = can(requiredFor(pathname));
  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar />
      <main className="min-w-0 flex-1">
        {!ready ? null : allowed ? children : <AccessRestricted />}
      </main>
    </div>
  );
}

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [authReady, setAuthReady] = useState(false);
  const [mustChange, setMustChange] = useState<boolean | null>(null);

  useEffect(() => {
    if (isLogin) { setAuthReady(true); return; }
    if (!isSupabaseConfigured || !supabase) { setAuthReady(true); setMustChange(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      const { data: prof } = await supabase!
        .from("app_users").select("must_change_password").eq("id", data.session.user.id).maybeSingle();
      setMustChange(!!prof?.must_change_password);
      setAuthReady(true);
    });
  }, [isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (!authReady) return null;
  if (mustChange === null) return null;
  if (mustChange) return <SetPassword onDone={() => setMustChange(false)} />;

  // Only now (fully authenticated) do we load permissions — one shared copy.
  return (
    <PermissionsProvider>
      <FrameContent>{children}</FrameContent>
    </PermissionsProvider>
  );
}
