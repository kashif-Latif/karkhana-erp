"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Gem, Lock, ShieldCheck, CheckCircle2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export default function ResetPassword() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setChecking(false); return; }
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) { setReady(true); setChecking(false); }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      setChecking(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function save() {
    setErr("");
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw !== pw2) { setErr("The two passwords don't match."); return; }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (!error) { try { await supabase.rpc("clear_must_change_password"); } catch {} }
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    await supabase.auth.signOut();
    setTimeout(() => router.push("/login"), 2500);
  }

  const field = "mt-1.5 flex items-center gap-2 rounded-xl2 border border-line bg-canvas px-3.5 py-2.5";
  const inputCls = "w-full bg-transparent text-[14px] outline-none placeholder:text-hint";

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

          {done ? (
            <div className="flex flex-col items-center py-4 text-center">
              <CheckCircle2 size={44} className="text-success" />
              <h1 className="mt-3 text-xl font-extrabold">Password updated</h1>
              <p className="mt-1 text-[13px] text-muted">You can now sign in with your new password. Taking you to the login screen…</p>
            </div>
          ) : checking ? (
            <p className="py-8 text-center text-[13px] text-muted">Checking your reset link…</p>
          ) : !ready ? (
            <>
              <h1 className="text-xl font-extrabold">Link expired</h1>
              <p className="mt-1 text-[13px] text-muted">This reset link is invalid or has expired. Please go back and request a new one.</p>
              <button onClick={() => router.push("/login")} className="mt-5 w-full rounded-xl2 bg-ink py-3 text-[14px] font-semibold text-white">Back to sign in</button>
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold">Set a new password</h1>
              <p className="mt-1 text-[13px] text-muted">Choose a new password for your account.</p>
              <label className="mt-5 block text-[12px] font-medium text-muted">New password</label>
              <div className={field}><Lock size={16} className="text-hint" /><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" className={inputCls} /></div>
              <label className="mt-4 block text-[12px] font-medium text-muted">Confirm new password</label>
              <div className={field}><Lock size={16} className="text-hint" /><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Repeat the password" className={inputCls} /></div>
              {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}
              <button onClick={save} disabled={busy} className="mt-6 w-full rounded-xl2 bg-ink py-3 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50">{busy ? "Saving…" : "Update password"}</button>
            </>
          )}

          <div className="mt-5 flex items-center gap-2 rounded-xl2 bg-panel px-3 py-2.5 text-[11.5px] text-muted">
            <ShieldCheck size={15} className="shrink-0 text-success" /> Your password is encrypted and never shared.
          </div>
        </div>
      </div>
    </div>
  );
}
