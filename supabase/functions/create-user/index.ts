// =====================================================================
//  Edge Function: create-user
//  Creates a login account from inside the app — SECURELY.
//  The service-role key lives ONLY here on Supabase's servers, never
//  in the browser. Before creating anyone, it checks that the CALLER
//  is a signed-in admin with the 'users.manage' permission.
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

    // 1) Act as the caller, and check they are allowed to manage users.
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: allowed, error: permErr } = await caller.rpc("has_permission", { p_permission_code: "users.manage" });
    if (permErr) return json({ error: permErr.message }, 400);
    if (!allowed) return json({ error: "You do not have permission to create users." }, 403);

    // 2) Read & validate input.
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim() || email.split("@")[0];
    const roleId = body.role_id ? String(body.role_id) : null;
    if (!email || !password) return json({ error: "Email and password are required." }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

    // 3) Create the login using the service role (admin) client.
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr) return json({ error: createErr.message }, 400);

    const newId = created.user?.id;
    if (newId) {
      // ensure the profile exists with the right name (trigger also does this)
      await admin.from("app_users").upsert({ id: newId, full_name: fullName, email }, { onConflict: "id" });
      // assign the chosen role (single role)
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
