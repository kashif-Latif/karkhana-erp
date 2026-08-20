"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gem, Lock, Mail, Phone, ShieldCheck, ArrowLeft, MailCheck } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import ThemeToggle from "@/components/ThemeToggle";

type Mode = "email" | "phone";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [forgot, setForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetErr, setResetErr] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  async function submit() {
    setErr("");
    if (!isSupabaseConfigured || !supabase) { router.push("/"); return; }
    if (!identifier.trim() || !password) { setErr(mode === "email" ? "Enter your email and password." : "Enter your phone number and password."); return; }
    setLoading(true);
    const { data: email, error: rpcErr } = await supabase.rpc("resolve_login_email", { p_identifier: identifier.trim() });
    if (rpcErr || !email) { setLoading(false); setErr(mode === "email" ? "No account found for that email." : "No account found for that phone number."); return; }
    const { error } = await supabase.auth.signInWithPassword({ email: email as string, password });
    setLoading(false);
    if (error) setErr(mode === "email" ? "Incorrect email or password." : "Incorrect phone number or password.");
    else router.push("/");
  }

  async function sendReset() {
    setResetErr("");
    if (!supabase) return;
    if (!resetEmail.trim() || !resetEmail.includes("@")) { setResetErr("Enter the email address on your account."); return; }
    setResetBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setResetBusy(false);
    if (error) { setResetErr(error.message); return; }
    setResetSent(true);
  }

  function switchMode(m: Mode) { setMode(m); setErr(""); setIdentifier(""); }
  function openForgot() { setForgot(true); setResetSent(false); setResetErr(""); setResetEmail(mode === "email" ? identifier.trim() : ""); }
  function closeForgot() { setForgot(false); setResetSent(false); setResetErr(""); }

  const field = "mt-1.5 flex items-center gap-2 rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 dark:border-white/10 dark:bg-white/[0.05]";
  const inputCls = "w-full bg-transparent text-[14px] outline-none placeholder:text-hint dark:text-[#f4f1ea] dark:placeholder:text-[#6f675c]";

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 dark:bg-[#17140f]">
      <div className="w-full max-w-[400px]">
        <div className="rounded-card bg-surface p-8 shadow-card dark:border dark:border-white/[0.06] dark:bg-[#201c17] dark:shadow-none">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white dark:bg-white dark:text-[#141414]"><Gem size={20} /></span>
              <div className="leading-tight">
                <div className="text-lg font-extrabold tracking-tight dark:text-[#f4f1ea]">Karkhana</div>
                <div className="text-[12px] text-muted dark:text-[#a89f93]">Head Office ERP</div>
              </div>
            </div>
            <ThemeToggle />
          </div>

          {forgot ? (
            <>
              <button onClick={closeForgot} className="mb-3 flex items-center gap-1 text-[12.5px] text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"><ArrowLeft size={14} /> Back to sign in</button>
              <h1 className="text-xl font-extrabold dark:text-[#f4f1ea]">Reset password</h1>

              {mode === "email" ? (
                resetSent ? (
                  <div className="mt-4 flex gap-2.5 rounded-xl2 bg-panel px-4 py-4 text-[13px] leading-relaxed text-ink/80 dark:bg-white/[0.05] dark:text-[#d8d2c8]">
                    <MailCheck size={18} className="mt-0.5 shrink-0 text-success" />
                    <span>We&apos;ve sent a reset link to <b>{resetEmail}</b>. Open the email and click the link to set a new password. If you don&apos;t see it, check your spam folder.</span>
                  </div>
                ) : (
                  <>
                    <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Enter the email on your account and we&apos;ll send a link to set a new password.</p>
                    <label className="mt-5 block text-[12px] font-medium text-muted dark:text-[#a89f93]">Email</label>
                    <div className={field}><Mail size={16} className="text-hint dark:text-[#8a8175]" /><input type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReset()} placeholder="you@company.com" className={inputCls} /></div>
                    {resetErr && <p className="mt-3 text-[12.5px] font-medium text-danger">{resetErr}</p>}
                    <button onClick={sendReset} disabled={resetBusy} className="mt-5 w-full rounded-xl2 bg-ink py-3 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-[#141414]">{resetBusy ? "Sending…" : "Send reset link"}</button>
                  </>
                )
              ) : (
                <div className="mt-4 flex gap-2.5 rounded-xl2 bg-panel px-4 py-4 text-[13px] leading-relaxed text-ink/80 dark:bg-white/[0.05] dark:text-[#d8d2c8]">
                  <ShieldCheck size={18} className="mt-0.5 shrink-0 text-muted dark:text-[#a89f93]" />
                  <span>Phone accounts can&apos;t reset their own password. Please <b>contact your administrator</b> — they&apos;ll reset it for you from the Users screen in a few seconds.</span>
                </div>
              )}
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold dark:text-[#f4f1ea]">Sign in</h1>
              <p className="mt-1 text-[13px] text-muted dark:text-[#a89f93]">Accounts are created by an administrator. There is no public sign-up.</p>

              <div className="mt-5 flex gap-1 rounded-full bg-panel p-1 dark:bg-white/[0.05]">
                {(["email", "phone"] as Mode[]).map((m) => (
                  <button key={m} onClick={() => switchMode(m)}
                    className={`flex-1 rounded-full py-2 text-[13px] font-semibold transition ${mode === m ? "bg-ink text-white dark:bg-white dark:text-[#141414]" : "text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white"}`}>
                    {m === "email" ? "Email" : "Phone"}
                  </button>
                ))}
              </div>

              <label className="mt-4 block text-[12px] font-medium text-muted dark:text-[#a89f93]">{mode === "email" ? "Email" : "Phone number"}</label>
              <div className={field}>
                {mode === "email" ? <Mail size={16} className="text-hint dark:text-[#8a8175]" /> : <Phone size={16} className="text-hint dark:text-[#8a8175]" />}
                <input value={identifier} type={mode === "email" ? "email" : "tel"} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={mode === "email" ? "you@company.com" : "0300 1234567"} className={inputCls} />
              </div>

              <label className="mt-4 block text-[12px] font-medium text-muted dark:text-[#a89f93]">Password</label>
              <div className={field}><Lock size={16} className="text-hint dark:text-[#8a8175]" /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••" className={inputCls} /></div>

              {err && <p className="mt-3 text-[12.5px] font-medium text-danger">{err}</p>}

              <button onClick={submit} disabled={loading} className="mt-6 w-full rounded-xl2 bg-ink py-3 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-[#141414]">
                {loading ? "Signing in…" : isSupabaseConfigured ? "Sign in" : "Enter preview"}
              </button>

              <button onClick={openForgot} className="mt-3 w-full text-center text-[12.5px] text-muted hover:text-ink dark:text-[#a89f93] dark:hover:text-white">Forgot password?</button>
            </>
          )}

          <div className="mt-5 flex items-center gap-2 rounded-xl2 bg-panel px-3 py-2.5 text-[11.5px] text-muted dark:bg-white/[0.05] dark:text-[#a89f93]">
            <ShieldCheck size={15} className="shrink-0 text-success" />
            Protected by server-side authentication, role-based access, and full audit logging.
          </div>
        </div>

        {!isSupabaseConfigured && <p className="mt-4 text-center text-[11.5px] text-hint dark:text-[#8a8175]">Preview build · connect Supabase to enable real logins</p>}
      </div>
    </div>
  );
}
