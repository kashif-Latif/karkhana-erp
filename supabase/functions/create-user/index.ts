// =====================================================================
//  Edge Function: create-user
//  Manages login accounts from inside the app — SECURELY.
//  The service-role key lives ONLY here on Supabase's servers, never in
//  the browser. Every call first checks the CALLER is a signed-in admin
//  with the 'users.manage' permission.
//
//  Actions:
//    { action: "create", email?, phone?, password, full_name?, role_id? }
//    { action: "delete", user_id }
//    { action: "reset_password", user_id, new_password }
//
//  Login by phone (no SMS): if a user has no email, we create them with an
//  internal email (<digits>@karkhana.local) and store their phone. They
//  sign in with phone + password; forgot-password = admin resets it here.
//
//  Auto-provided env vars (you do NOT set these):
//    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const digits = (s: string) => s.replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not signed in." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: allowed, error: permErr } = await caller.rpc("has_permission", { p_permission_code: "users.manage" });
    if (permErr) return json({ error: permErr.message }, 400);
    if (!allowed) return json({ error: "You do not have permission to manage users." }, 403);

    const jwt = authHeader.replace("Bearer ", "");
    const { data: meData } = await caller.auth.getUser(jwt);
    const callerId = meData?.user?.id ?? null;

    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "create");

    async function isSuper(id: string | null) {
      if (!id) return false;
      const { data } = await admin.from("app_users").select("is_super_admin").eq("id", id).maybeSingle();
      return !!data?.is_super_admin;
    }

    // ------------------------------- DELETE -------------------------------
    if (action === "delete") {
      const userId = String(body.user_id ?? "");
      if (!userId) return json({ error: "user_id is required." }, 400);
      if (userId === callerId) return json({ error: "You cannot remove your own account." }, 400);
      if (await isSuper(userId)) return json({ error: "You cannot remove a Super Admin account." }, 400);
      await admin.from("user_roles").delete().eq("user_id", userId);
      const { error: delErr } = await admin.auth.admin.deleteUser(userId); // cascades app_users
      if (delErr) return json({ error: delErr.message }, 400);
      return json({ ok: true }, 200);
    }

    // --------------------------- RESET PASSWORD ---------------------------
    if (action === "reset_password") {
      const userId = String(body.user_id ?? "");
      const newPassword = String(body.new_password ?? "");
      if (!userId || !newPassword) return json({ error: "user_id and new_password are required." }, 400);
      if (newPassword.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);
      if (await isSuper(userId) && userId !== callerId && !(await isSuper(callerId))) {
        return json({ error: "Only a Super Admin can reset a Super Admin's password." }, 400);
      }
      const { error: upErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
      if (upErr) return json({ error: upErr.message }, 400);
      await admin.from("app_users").update({ must_change_password: true }).eq("id", userId);
      return json({ ok: true }, 200);
    }

    // ------------------------------- CREATE -------------------------------
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = String(body.phone ?? "").trim();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim() || (email ? email.split("@")[0] : (phone || "User"));
    const roleId = body.role_id ? String(body.role_id) : null;

    if (!email && !phone) return json({ error: "Enter an email or a phone number." }, 400);
    if (!password) return json({ error: "Password is required." }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

    // Duplicate phone guard (few login users, so a simple scan is fine).
    if (phone) {
      const d = digits(phone);
      const { data: rows } = await admin.from("app_users").select("phone");
      const dupe = (rows ?? []).some((r: { phone: string | null }) => r.phone && digits(r.phone) === d && d !== "");
      if (dupe) return json({ error: "That phone number is already used by another account." }, 400);
    }

    const authEmail = email || `${digits(phone)}@karkhana.local`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: authEmail, password, email_confirm: true, user_metadata: { full_name: fullName, phone },
    });
    if (createErr) return json({ error: createErr.message }, 400);

    const newId = created.user?.id;
    if (newId) {
      await admin.from("app_users").upsert(
        { id: newId, full_name: fullName, email: authEmail, phone: phone || null, must_change_password: true },
        { onConflict: "id" }
      );
      if (roleId) {
        await admin.from("user_roles").delete().eq("user_id", newId);
        await admin.from("user_roles").insert({ user_id: newId, role_id: roleId });
      }
    }
    return json({ ok: true, user_id: newId }, 200);
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Unexpected error" }, 500);
  }
});
