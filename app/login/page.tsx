"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gem, Lock, User, ShieldCheck } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  async function submit() {
    setErr("");
    if (!isSupabaseConfigured || !supabase) { router.push("/"); return; }
    if (!identifier.trim() || !password) { setErr("Enter your email or phone, and your password."); return; }
    setLoading(true);
    // Map email-or-phone to the login email, then sign in with password.
    const { data: email, error: rpcErr } = await supabase.rpc("resolve_login_email", { p_identifier: identifier.trim() });
    if (rpcErr || !email) { setLoading(false); setErr("No account found for that email or phone."); return; }
    const { error } = await supabase.auth.signInWithPassword({ email: email as string, password });
    setLoading(false);
    if (error) setErr("Incorrect email/phone or password.");
    else router.push("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[400px]">
        <div className="rounded-card bg-surface p-8 shadow-card">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white"><Gem size={20} /></span>
            <div className="leading-tight">
              <div className="text-lg font-extrabold tracking-tight">Karkhana</div>
              <div className="text-[12px] text-muted">Head Office ERP</div>
            </div>
          </div>

          <h1 className="text-xl font-extrabold">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">Accounts are created by an administrator. There is no public sign-up.</p>

          <label className="mt-6 block text-[12px] font-medium text-muted">Email or phone number</label>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl2 border border-line bg-canvas px-3.5 py-2.5">
            <User size={16} className="text-hint" />
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="you@company.com  or  0300 1234567"
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

          <button onClick={submit} disabled={loading}
            className="mt-6 w-full rounded-xl2 bg-ink py-3 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {loading ? "Signing in…" : isSupabaseConfigured ? "Sign in" : "Enter preview"}
          </button>

          <button onClick={() => setShowForgot((s) => !s)} className="mt-3 w-full text-center text-[12.5px] text-muted hover:text-ink">
            Forgot password?
          </button>
          {showForgot && (
            <div className="mt-2 rounded-xl2 bg-panel px-3.5 py-3 text-[12px] leading-relaxed text-muted">
              Please ask your administrator to reset your password for you. (Email-based self-reset will be enabled once the email service is set up.)
            </div>
          )}

          <div className="mt-5 flex items-center gap-2 rounded-xl2 bg-panel px-3 py-2.5 text-[11.5px] text-muted">
            <ShieldCheck size={15} className="shrink-0 text-success" />
            Protected by server-side authentication, role-based access, and full audit logging.
          </div>
        </div>

        {!isSupabaseConfigured && (
          <p className="mt-4 text-center text-[11.5px] text-hint">Preview build · connect Supabase to enable real logins</p>
        )}
      </div>
    </div>
  );
}
