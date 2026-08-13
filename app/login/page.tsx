"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gem, Lock, Mail, ShieldCheck } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setErr("");
    if (!isSupabaseConfigured || !supabase) {
      // Preview mode: no backend yet — go straight to the dashboard preview.
      router.push("/");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setErr("Incorrect email or password.");
    else router.push("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[400px]">
        <div className="rounded-card bg-surface p-8 shadow-card">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white">
              <Gem size={20} />
            </span>
            <div className="leading-tight">
              <div className="text-lg font-extrabold tracking-tight">Karkhana</div>
              <div className="text-[12px] text-muted">Head Office ERP</div>
            </div>
          </div>

          <h1 className="text-xl font-extrabold">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">
            Accounts are created by an administrator. There is no public sign-up.
          </p>

          <label className="mt-6 block text-[12px] font-medium text-muted">Email</label>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl2 border border-line bg-canvas px-3.5 py-2.5">
            <Mail size={16} className="text-hint" />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="you@company.com"
              className="w-full bg-transparent text-[14px] outline-none placeholder:text-hint"
            />
          </div>

          <label className="mt-4 block text-[12px] font-medium text-muted">Password</label>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl2 border border-line bg-canvas px-3.5 py-2.5">
            <Lock size={16} className="text-hint" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="••••••••"
              className="w-full bg-transparent text-[14px] outline-none placeholder:text-hint"
            />
          </div>

          {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}

          <button
            onClick={submit}
            disabled={loading}
            className="mt-6 w-full rounded-xl2 bg-ink py-3 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Signing in…" : isSupabaseConfigured ? "Sign in" : "Enter preview"}
          </button>

          <div className="mt-5 flex items-center gap-2 rounded-xl2 bg-panel px-3 py-2.5 text-[11.5px] text-muted">
            <ShieldCheck size={15} className="shrink-0 text-success" />
            Protected by server-side authentication, role-based access, and full
            audit logging.
          </div>
        </div>

        {!isSupabaseConfigured && (
          <p className="mt-4 text-center text-[11.5px] text-hint">
            Preview build · connect Supabase to enable real logins
          </p>
        )}
      </div>
    </div>
  );
}
