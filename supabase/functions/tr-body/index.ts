// tr-body — reads a set of progress photos (front / side / back) and compares it with the previous set.
//   POST { id }  →  { ai }   (also saved on tr_body_photos.ai)
// Photos come from the private 'tr-body' bucket with the service role; they are sent to Claude for this one call and
// never leave Supabase otherwise. The coach only ever sees the numbers, not the photos.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Read = z.object({
  usable: z.boolean().describe("false if the photos don't show the torso clearly enough to judge"),
  bf_low: z.number().describe("lower end of the body-fat % range"),
  bf_high: z.number().describe("upper end of the body-fat % range"),
  bf_best: z.number().describe("single best estimate"),
  confidence: z.enum(["low", "medium", "high"]),
  changes: z.array(z.string()).describe("visible changes since the previous set (empty if no previous set): waist, midsection, chest, shoulders, arms, legs; say 'no clear change' when that is the honest answer"),
  notes: z.string().describe("one or two sentences: what the estimate rests on, and what would make the next set more comparable (light, pose, time of day)"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
    const { id } = await req.json();
    const { data: cur } = await admin.from("tr_body_photos").select("*").eq("id", id).single();
    if (!cur) return json({ error: "photo set not found" }, 404);
    const { data: prevRows } = await admin.from("tr_body_photos").select("*").lt("date", cur.date).order("date", { ascending: false }).limit(1);
    const prev = prevRows?.[0];
    const { data: s } = await admin.from("tr_settings").select("height_cm,birth_year,coach_model").eq("id", 1).single();

    const img = async (path: string | null) => {
      if (!path) return null;
      const { data, error } = await admin.storage.from("tr-body").download(path);
      if (error || !data) return null;
      const buf = new Uint8Array(await data.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { type: "image" as const, source: { type: "base64" as const, media_type: (data.type || "image/jpeg") as "image/jpeg", data: btoa(bin) } };
    };
    const content: Anthropic.ContentBlockParam[] = [];
    const add = async (label: string, set: typeof cur) => {
      for (const [k, v] of [["front", set.front_path], ["side", set.side_path], ["back", set.back_path]] as const) {
        const b = await img(v); if (b) { content.push({ type: "text", text: `${label} — ${k} (${set.date})` }); content.push(b); }
      }
    };
    if (prev) await add("PREVIOUS SET", prev);
    await add("CURRENT SET", cur);
    if (!content.some((c) => c.type === "image")) return json({ error: "no photos in this set" }, 400);
    const age = s?.birth_year ? Number(String(cur.date).slice(0, 4)) - s.birth_year : null;
    content.push({ type: "text", text:
`Progress photos of Herman, ${age ?? "mid-40s"}, male, ${s?.height_cm ?? "?"} cm, endurance athlete (cycling, training for Comrades ultra, heavy leg strength work).
Current measurements: weight ${cur.weight_kg ?? "?"} kg, waist at navel ${cur.waist_cm ?? "?"} cm, neck ${cur.neck_cm ?? "?"} cm, US Navy tape estimate ${cur.navy_bf ?? "?"}%.
${prev ? `Previous set ${prev.date}: weight ${prev.weight_kg ?? "?"} kg, waist ${prev.waist_cm ?? "?"} cm, Navy ${prev.navy_bf ?? "?"}%, earlier visual read ${prev.ai?.bf_best ?? "?"}%.` : "This is the first set."}
Estimate body fat as a realistic range from the photos together with the measurements (visual estimates are ±4–5% at best — keep the range honest). Then describe what visibly changed versus the previous set, if there is one; lighting, pose and pump differences can fake a change, so say when that may be the case. Be factual and neutral; no comments on appearance beyond what bears on body composition.` });

    const client = new Anthropic();
    const model = s?.coach_model || "claude-opus-5-5";
    const ask = (m: string) => client.messages.parse({ model: m, max_tokens: 8000, output_config: { effort: "medium", format: zodOutputFormat(Read) }, messages: [{ role: "user", content }] });
    let res = await ask(model);
    if (res.stop_reason === "refusal") res = await ask("claude-sonnet-5-5");
    const out = res.parsed_output;
    if (!out) return json({ error: `Claude couldn't read these photos (${res.stop_reason})` }, 422);
    const ai = { ...out, compared_to: prev?.date ?? null, model };
    await admin.from("tr_body_photos").update({ ai }).eq("id", id);
    await admin.from("tr_coach_runs").insert({ kind: "body", summary: `${out.bf_low}–${out.bf_high}%`, model, usage: res.usage });
    return json({ ai });
  } catch (e) {
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API: ${e.message}` }, 502);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
