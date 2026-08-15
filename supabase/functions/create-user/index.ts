// =====================================================================
//  Edge Function: create-user
//  Manages login accounts from inside the app — SECURELY.
//  The service-role key lives ONLY here on Supabase's servers, never in
//  the browser. Every call first checks the CALLER is a signed-in admin
//  with the 'users.manage' permission.
//
//  Actions:
//    { action: "create", email, password, full_name, role_id }
//    { action: "delete", user_id }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not signed in." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Caller context — to check permission and identity.
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: allowed, error: permErr } = await caller.rpc("has_permission", { p_permission_code: "users.manage" });
    if (permErr) return json({ error: permErr.message }, 400);
    if (!allowed) return json({ error: "You do not have permission to manage users." }, 403);

    const jwt = authHeader.replace("Bearer ", "");
    const { data: meData } = await caller.auth.getUser(jwt);
    const callerId = meData?.user?.id ?? null;

    // Admin (service-role) client — the only place with elevated rights.
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "create");

    // ------------------------------- DELETE -------------------------------
    if (action === "delete") {
      const userId = String(body.user_id ?? "");
      if (!userId) return json({ error: "user_id is required." }, 400);
      if (userId === callerId) return json({ error: "You cannot remove your own account." }, 400);

      const { data: target } = await admin.from("app_users").select("is_super_admin").eq("id", userId).maybeSingle();
      if (target?.is_super_admin) return json({ error: "You cannot remove a Super Admin account." }, 400);

      await admin.from("user_roles").delete().eq("user_id", userId);
      const { error: delErr } = await admin.auth.admin.deleteUser(userId); // cascades app_users
      if (delErr) return json({ error: delErr.message }, 400);
      return json({ ok: true }, 200);
    }

    // ------------------------------- CREATE -------------------------------
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim() || email.split("@")[0];
    const roleId = body.role_id ? String(body.role_id) : null;
    if (!email || !password) return json({ error: "Email and password are required." }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (createErr) return json({ error: createErr.message }, 400);

    const newId = created.user?.id;
    if (newId) {
      await admin.from("app_users").upsert({ id: newId, full_name: fullName, email }, { onConflict: "id" });
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
