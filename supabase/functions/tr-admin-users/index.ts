// tr-admin-users — the owner manages Coach users. Owner only.
//   POST { action: 'list' }                                   → { users: [...] }
//   POST { action: 'create', email, name, sex? }              → { user, temp_password }   (shown once in the app)
//   POST { action: 'reset', user_id }                         → { temp_password }
//   POST { action: 'remove', user_id }                        → removes Coach access only (their data and login stay)
// A temporary password must be changed at the next sign-in (tr_members.must_change_pw).
// The project's logins are shared with other apps (Kompas etc.): an existing login is reused, never duplicated.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** 12 characters, no look-alikes (0/O, 1/l/I), always letters + digits */
function tempPassword() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ", a = "abcdefghijkmnopqrstuvwxyz", d = "23456789", all = A + a + d;
  const r = crypto.getRandomValues(new Uint32Array(12));
  const pick = (s: string, n: number) => s[n % s.length];
  const chars = [pick(A, r[0]), pick(a, r[1]), pick(d, r[2]), ...Array.from(r.slice(3), (n) => pick(all, n))];
  for (let i = chars.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await asUser.rpc("tr_is_owner")).data) return json({ error: "Only the owner can manage users" }, 403);
    const me = (await asUser.auth.getUser()).data.user!.id;
    const body = await req.json().catch(() => ({}));

    if (body.action === "list") {
      const { data: ms } = await admin.from("tr_members").select("user_id,display_name,email,role,must_change_pw,created_at").order("created_at");
      const out = [];
      for (const m of ms ?? []) {
        const { data } = await admin.auth.admin.getUserById(m.user_id);
        out.push({ ...m, last_sign_in_at: data.user?.last_sign_in_at ?? null });
      }
      return json({ users: out });
    }

    if (body.action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return json({ error: "A valid e-mail and a name are needed" }, 400);
      const pw = tempPassword();
      // reuse a login that already exists in the project (other apps); otherwise create one
      let uid: string | null = null; let existed = false;
      for (let page = 1; page < 50 && !uid; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const hit = data.users.find((u) => u.email?.toLowerCase() === email);
        if (hit) { uid = hit.id; existed = true; }
        if (data.users.length < 200) break;
      }
      if (uid) {
        const { data: already } = await admin.from("tr_members").select("user_id").eq("user_id", uid).maybeSingle();
        if (already) return json({ error: `${email} already has access to Coach — use Reset password instead` }, 409);
        const { error } = await admin.auth.admin.updateUserById(uid, { password: pw });
        if (error) throw error;
      } else {
        const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { name } });
        if (error) throw error;
        uid = data.user!.id;
      }
      await admin.from("tr_members").insert({ user_id: uid, display_name: name, email, role: "member", must_change_pw: true });
      await admin.from("tr_settings").upsert({ user_id: uid, sex: body.sex ?? null, coach_model: "claude-opus-5-5", coach_auto: true }, { onConflict: "user_id" });
      return json({ user: { user_id: uid, email, display_name: name }, temp_password: pw, existing_login: existed });
    }

    if (body.action === "reset") {
      const uid = String(body.user_id ?? "");
      const { data: m } = await admin.from("tr_members").select("user_id").eq("user_id", uid).maybeSingle();
      if (!m) return json({ error: "not a Coach user" }, 404);
      const pw = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(uid, { password: pw });
      if (error) throw error;
      await admin.from("tr_members").update({ must_change_pw: true }).eq("user_id", uid);
      return json({ temp_password: pw });
    }

    if (body.action === "remove") {
      const uid = String(body.user_id ?? "");
      if (uid === me) return json({ error: "You can't remove yourself" }, 400);
      await admin.from("tr_members").delete().eq("user_id", uid).neq("role", "owner");
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
