// tr-workout-draft — Claude drafts a library workout from a short description ("20 min core for runners, no kit").
//   POST { prompt }  →  { draft }   (the app shows it in the editor; nothing is saved until the user saves)
// Video links are never invented: the user pastes one per exercise, or the app offers a YouTube search.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Ex = z.object({
  name: z.string(), kind: z.enum(["timed", "reps", "strength"]).describe("timed = hold/seconds; reps = fixed reps; strength = rep range with progressive overload"),
  sets: z.number().int(), seconds: z.number().int().nullable(), reps: z.number().int().nullable(),
  rep_min: z.number().int().nullable(), rep_max: z.number().int().nullable(), increment_kg: z.number().nullable(),
  per_side: z.boolean(), rest_s: z.number().int(), load: z.string().nullable().describe("e.g. 'barbell', 'dumbbells (kg each hand)', 'bodyweight'"),
  cues: z.array(z.string()).describe("3–4 short form cues"), why: z.string().describe("one line: why it helps this athlete"),
});
const Draft = z.object({
  name: z.string(), category: z.enum(["mobility", "strength", "drills", "core", "recovery", "run", "ride", "other"]),
  summary: z.string(), duration_min: z.number().int(), equipment: z.string(), when_to_use: z.string(), exercises: z.array(Ex),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const cron = Deno.env.get("TR_CRON_TOKEN");
    let uid: string;
    if (cron && req.headers.get("x-cron-token") === cron) uid = (await admin.rpc("tr_owner")).data as string;   // scripts/call-fn.mjs (testing)
    else {
      const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
      uid = (await asUser.auth.getUser()).data.user!.id;
    }
    const { prompt } = await req.json();
    if (!String(prompt ?? "").trim()) return json({ error: "Describe the workout you want" }, 400);
    const { data: s } = await admin.from("tr_settings").select("coach_model,coach_profile").eq("user_id", uid).maybeSingle();
    const { data: lib } = await admin.from("tr_workouts").select("name,category");
    const client = new Anthropic();
    const model = s?.coach_model || "claude-opus-5-5";
    const res = await client.messages.parse({
      model, max_tokens: 12000, output_config: { effort: "medium", format: zodOutputFormat(Draft) },
      system: `You design workouts for a shared training-app library used by endurance athletes (runners and cyclists). Write safe, well-known exercises with clear names (so a demo video is easy to find), realistic doses, and short cues. Strength work uses kind "strength" with a rep range and a sensible increment (2.5 kg barbell, 2 kg dumbbells, 5 kg trap bar). Mobility/core holds use "timed"; drills use "reps". Total duration must match the request. Metric units.`,
      messages: [{ role: "user", content: `Request: ${String(prompt).trim()}\n\nRequesting athlete's profile (for context; the workout is shared with everyone, so keep it general unless asked):\n${s?.coach_profile ?? "(none)"}\n\nAlready in the library (avoid duplicates): ${JSON.stringify(lib ?? [])}` }],
    });
    if (!res.parsed_output) return json({ error: `No draft (${res.stop_reason})` }, 422);
    await admin.from("tr_coach_runs").insert({ user_id: uid, kind: "workout-draft", summary: res.parsed_output.name, model, usage: res.usage });
    return json({ draft: res.parsed_output });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
