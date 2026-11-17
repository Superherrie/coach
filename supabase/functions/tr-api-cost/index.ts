// tr-api-cost — account-wide Claude API spend from Anthropic's Usage & Cost API (all apps on the account, not just Coach).
//   POST {}  →  { since, since_usd, month_usd, last30_usd, by_key: [{ name, usd30 }], refreshed_at }
// Needs the Anthropic Admin API key Herman pasted in Settings (tr_secrets 'anthropic_admin_key'; never returned).
// Anthropic's data lands 4–24 h late, so today's spend is not in it yet.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const DAY = 864e5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const cron = Deno.env.get("TR_CRON_TOKEN");
    if (!(cron && req.headers.get("x-cron-token") === cron)) {
      const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
    }
    const { data: sec } = await admin.from("tr_secrets").select("value").eq("name", "anthropic_admin_key").maybeSingle();
    if (!sec?.value) return json({ error: "No Admin API key yet — add it in Settings", code: "no_key" }, 400);
    const { data: s } = await admin.from("tr_settings").select("api_credit_at").eq("id", 1).single();

    const client = new Anthropic({ apiKey: sec.value });
    const now = Date.now();
    const midnight = (t: number) => new Date(new Date(t).toISOString().slice(0, 10) + "T00:00:00Z").getTime();
    const end = midnight(now + DAY);                                           // through the end of today (UTC)
    const monthStart = Date.parse(new Date(now).toISOString().slice(0, 7) + "-01T00:00:00Z");
    const since = s?.api_credit_at ? midnight(Date.parse(s.api_credit_at)) : monthStart;
    const from = Math.max(Math.min(since, monthStart, now - 30 * DAY), now - 360 * DAY, Date.parse("2026-01-01T00:00:00Z"));

    // daily cost per API key; the API spans at most 31 days per request
    const rows: { day: number; key: string | null; usd: number }[] = [];
    let refreshed: string | null = null;
    for (let a = midnight(from); a < end; a += 31 * DAY) {
      const b = Math.min(a + 31 * DAY, end);
      const page = await client.beta.organization.analytics.cost.list({
        starting_at: new Date(a).toISOString(), ending_at: new Date(b).toISOString(),
        time_bucket_width: "1d", group_by: ["api_key_id"], limit: 1000,
      });
      // deno-lint-ignore no-explicit-any
      refreshed = ((page as any).data_refreshed_at ?? (page as any).body?.data_refreshed_at ?? refreshed) as string | null;
      for await (const r of page) {
        // deno-lint-ignore no-explicit-any
        const row = r as any;
        rows.push({ day: Date.parse(row.starting_at), key: row.group?.api_key_id ?? null, usd: Number(row.cost?.amount ?? 0) / 100 });
      }
    }
    const names = new Map<string, string>();
    try { for await (const k of client.beta.organization.apiKeys.list({ limit: 100 })) names.set(k.id, k.name); } catch { /* names are optional */ }

    const sum = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).reduce((x, r) => x + r.usd, 0);
    const last30 = now - 30 * DAY;
    const byKey = new Map<string, number>();
    for (const r of rows.filter((r) => r.day >= last30)) { const n = r.key ? (names.get(r.key) ?? r.key) : "Console / no key"; byKey.set(n, (byKey.get(n) ?? 0) + r.usd); }
    return json({
      since: new Date(since).toISOString(), since_usd: sum((r) => r.day >= since), month_usd: sum((r) => r.day >= monthStart), last30_usd: sum((r) => r.day >= last30),
      by_key: [...byKey.entries()].map(([name, usd30]) => ({ name, usd30 })).sort((a, b) => b.usd30 - a.usd30),
      refreshed_at: refreshed,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      return json({ error: "Anthropic rejected the Admin key — it must be an Admin API key (sk-ant-admin…) from an organisation account", code: "bad_key" }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: `Anthropic: ${e.message}` }, 502);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
