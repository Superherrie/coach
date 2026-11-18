// tr-inbody — reads an InBody result sheet (screenshot or photo) and returns the numbers for the athlete to check.
//   POST { path }  →  { read }   (nothing is saved here; the app saves the checked numbers to tr_inbody)
// The image is in the private 'tr-body' bucket under the caller's own folder.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const n = () => z.number().nullable();
const Seg = z.object({ right_arm: n(), left_arm: n(), trunk: n(), right_leg: n(), left_leg: n() });
const Read = z.object({
  is_inbody: z.boolean().describe("false if this is not an InBody (or similar BIA) result sheet"),
  date: z.string().nullable().describe("test date as YYYY-MM-DD if printed on the sheet"),
  device: z.string().nullable().describe("e.g. InBody 570"),
  weight_kg: n(), smm_kg: n().describe("Skeletal Muscle Mass"), bfm_kg: n().describe("Body Fat Mass"), pbf: n().describe("Percent Body Fat"),
  ffm_kg: n().describe("Fat Free Mass"), tbw_l: n().describe("Total Body Water"), ecw_ratio: n().describe("ECW/TBW ratio, e.g. 0.380"),
  visceral_level: n().describe("Visceral Fat Level"), bmr_kcal: n().describe("Basal Metabolic Rate"), inbody_score: n(),
  segment_lean_kg: Seg.nullable().describe("Segmental Lean Analysis in kg"), segment_fat_kg: Seg.nullable().describe("Segmental Fat Analysis in kg"),
  unclear: z.array(z.string()).describe("fields that were hard to read or might be wrong"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
    const uid = (await asUser.auth.getUser()).data.user!.id;
    const { path } = await req.json();
    if (typeof path !== "string" || !path.startsWith(`${uid}/`)) return json({ error: "not your image" }, 403);
    const { data: file, error } = await admin.storage.from("tr-body").download(path);
    if (error || !file) return json({ error: "image not found" }, 404);
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const { data: s } = await admin.from("tr_settings").select("coach_model").eq("user_id", uid).maybeSingle();

    const content: Anthropic.ContentBlockParam[] = [
      { type: "image", source: { type: "base64", media_type: (file.type || "image/jpeg") as "image/jpeg", data: btoa(bin) } },
      { type: "text", text: "This should be an InBody body-composition result sheet. Copy the measured values exactly as printed (the athlete's own result, not the normal-range columns). Use kg, litres, kcal. Leave a field null if it is not on the sheet; never estimate. List anything you could not read clearly in 'unclear'." },
    ];
    const client = new Anthropic();
    const model = s?.coach_model || "claude-opus-5-5";
    const ask = (m: string) => client.messages.parse({ model: m, max_tokens: 4000, output_config: { effort: "low", format: zodOutputFormat(Read) }, messages: [{ role: "user", content }] });
    let res = await ask(model);
    if (res.stop_reason === "refusal") res = await ask("claude-sonnet-5-5");
    const out = res.parsed_output;
    if (!out) return json({ error: `Claude couldn't read this sheet (${res.stop_reason})` }, 422);
    await admin.from("tr_coach_runs").insert({ user_id: uid, kind: "inbody", summary: out.is_inbody ? `${out.weight_kg ?? "?"} kg, ${out.pbf ?? "?"}%` : "not an InBody sheet", model, usage: res.usage });
    return json({ read: out });
  } catch (e) {
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API: ${e.message}` }, 502);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
