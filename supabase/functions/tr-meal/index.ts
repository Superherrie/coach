// tr-meal — reads a meal from a photo and/or a typed or dictated description and estimates calories and macros.
// Stores nothing: the app shows the draft on a review screen and saves it to tr_meals once Herman confirms.
//   POST { image?: base64, media?: 'image/jpeg', text?: string, meal?: string }  →  { draft }
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Meal = z.object({
  is_food: z.boolean().describe("false when the photo/text is not food or drink"),
  title: z.string().describe("short name for the meal, e.g. 'Steak, chips and salad'"),
  items: z.array(z.object({
    name: z.string(),
    portion: z.string().describe("estimated amount in plain terms, e.g. '250 g', '2 slices', '1 large mug'"),
    kcal: z.number().int(), protein_g: z.number(), carbs_g: z.number(), fat_g: z.number(),
  })),
  confidence: z.enum(["high", "medium", "low"]).describe("how sure the portion estimate is"),
  check: z.string().nullable().describe("one short question or caveat that would change the estimate most (hidden oil, sauce, portion size), or null"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const cron = Deno.env.get("TR_CRON_TOKEN");
    const byCron = !!cron && req.headers.get("x-cron-token") === cron;   // scripts/call-fn.mjs (testing)
    const asUser = byCron ? createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
      : createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!byCron && !(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
    const { image, media, text, meal } = await req.json();
    if (!image && !String(text ?? "").trim()) return json({ error: "a photo or a description is needed" }, 400);
    const mediaType = (["image/png", "image/webp"].includes(media) ? media : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";
    const { data: s } = await asUser.from("tr_settings").select("coach_model").eq("id", 1).single();

    const content: Anthropic.ContentBlockParam[] = [];
    if (image) content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: image } });
    content.push({ type: "text", text:
`Estimate the energy and macros of this ${meal ?? "meal"} for a 96 kg male endurance athlete in Johannesburg who is tracking intake.
${image ? "Use the photo; judge portion size from the plate, cutlery and packaging." : ""}${text ? `\nHis description: "${String(text).trim()}"` : ""}
Rules: list each component separately with a realistic portion (South African servings and products — e.g. Woolworths, Checkers, Spur, Mugg & Bean, boerewors, pap, biltong, rusks — use the label values you know when a product is recognisable). Include cooking oil, butter, sauces and sugar in drinks when they are likely, as separate items. Where his description gives amounts, use them over the photo. Prefer a middle estimate, not the lowest. Round kcal to the nearest 5.` });

    const client = new Anthropic();
    const model = s?.coach_model || "claude-opus-5-5";
    const ask = (m: string) => client.messages.parse({
      model: m, max_tokens: 8000,
      output_config: { effort: "low", format: zodOutputFormat(Meal) },
      messages: [{ role: "user", content }],
    });
    let res = await ask(model);
    if (res.stop_reason === "refusal") res = await ask("claude-sonnet-5-5");
    const out = res.parsed_output;
    if (!out) return json({ error: "Couldn't read that meal — try again or type it" }, 422);
    if (!out.is_food) return json({ error: "That doesn't look like food or drink." }, 422);
    // count it in the Claude API spend card
    await createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!).from("tr_coach_runs")
      .insert({ kind: "meal", summary: out.title, model, usage: res.usage });
    const sum = (k: "kcal" | "protein_g" | "carbs_g" | "fat_g") => Math.round(out.items.reduce((x, i) => x + i[k], 0));
    return json({ draft: { ...out, kcal: sum("kcal"), protein_g: sum("protein_g"), carbs_g: sum("carbs_g"), fat_g: sum("fat_g"), source: image ? "photo" : "text" }, model, usage: res.usage });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy — try again in a minute" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API: ${e.message}` }, 502);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
