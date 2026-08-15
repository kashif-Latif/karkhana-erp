"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function SetPassword({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (pw.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (pw !== pw2) { setError("The two passwords don't match."); return; }
    if (!supabase) return;
    setSaving(true); setError("");
    const { error: upErr } = await supabase.auth.updateUser({ password: pw });
    if (upErr) { setSaving(false); setError(upErr.message); return; }
    await supabase.rpc("clear_must_change_password");
    setSaving(false);
    onDone();
  }
  async function logout() {
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-card bg-surface p-8 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-white"><KeyRound size={20} /></span>
          <div>
            <h1 className="text-[18px] font-extrabold text-ink">Set your password</h1>
            <p className="text-[12.5px] text-muted">For your security, please choose your own password to continue.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted">New password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="min 6 characters"
              className={inp} onKeyDown={(e) => e.key === "Enter" && save()} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted">Confirm password</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="re-type password"
              className={inp} onKeyDown={(e) => e.key === "Enter" && save()} />
          </div>
        </div>

        {error && <p className="mt-3 text-[12.5px] font-medium text-danger">{error}</p>}

        <button onClick={save} disabled={saving}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl2 bg-ink px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50">
          {saving && <Loader2 size={16} className="animate-spin" />} Save &amp; continue
        </button>
        <button onClick={logout} className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
          <LogOut size={14} /> Log out
        </button>
      </div>
    </div>
  );
}

const inp = "w-full rounded-xl2 border border-line bg-canvas px-3.5 py-2.5 text-[14px] outline-none placeholder:text-hint focus:border-salmon-strong/50";
