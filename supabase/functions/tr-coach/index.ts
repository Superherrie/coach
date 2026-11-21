// tr-coach — Claude reads the plan, what was actually done and the morning check-in, and adjusts the coming days.
//   POST { mode: 'daily' }                 → reviews and adjusts (the 05:15 schedule runs this after tr-sync)
//   POST { mode: 'daily', if_changed: true } → same, but returns { skipped } without calling Claude when the athlete's
//                                             data hasn't changed since the last daily review (the app calls this on refresh)
//   POST { mode: 'chat', message: '...' }  → answers the signed-in athlete; any plan change comes back as a one-tap proposal
// Small changes (next 7 days, not the long run, no extra load) apply automatically with a note; bigger ones become proposals.
// Data sent to Claude comes from intervals.icu (Garmin) and the athlete's own entries — never from Strava.
// Secrets: ANTHROPIC_API_KEY, TR_CRON_TOKEN. Model from tr_settings.coach_model (default claude-opus-5-5).
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s) + n * 864e5));
const sastToday = () => ymd(new Date(Date.now() + 2 * 3600e3));

// ---------- the stable part of the prompt (cached) ----------
const SYSTEM = `You are the training coach inside a personal training app. You plan and adjust two sessions a day (morning "am" and afternoon "pm"; often one is rest) towards the athlete's goal. Who the athlete is, their goal and the principles to follow are in the ATHLETE PROFILE that follows these instructions; the athlete's name is given there.

DATA YOU GET (per athlete, in the JSON)
- Plan, sessions done (Garmin via intervals.icu, or logged by hand; sessions from the last 14 days carry "blocks": each lap or work/recovery interval with min, km, avg/min/max HR, watts, NP, max watts, cadence, pace_s/gap_s (s per km), elev, gradient, respiration, decoupling, ef = W per beat (ride) or m/min per beat (run) — judge execution and fitness from the blocks: HR cost of each rep at the same output, fade or drift across reps, pacing of laps, hills; plus "extras": hr_recovery, variability_index, power_hr, trimp, temperature), morning check-in (legs, energy, pain), resting HR / HRV / sleep, gym sets.
- food_last_14_days: meals logged (estimated from photos or dictation, ±15–20%); unlogged days are not zero days. Flag under-fuelling before long or hard sessions; keep any deficit moderate; one concrete lever beats a diet plan.
- body_composition: tape (US Navy) and progress-photo body-fat estimates, plus InBody scans (measured muscle kg, fat kg, %, visceral level, BMR, ECW ratio — the most reliable of the three) — numbers only. A rising ECW ratio (>0.390) can mean inflammation or overreaching. Read the trend with weight; never treat one reading as a trend.
- settings.paces: the athlete's training paces (Daniels VDOT from a race or time trial): easy range, marathon, tempo (threshold), intervals, in seconds per km. Prescribe run targets from these; Johannesburg results include altitude.
- hard_rules: the athlete's NEVER rules. Your answer is checked against them after you reply (by code and by a second reviewer); a break gets your draft sent back, and anything still breaking a rule is shown to the athlete with a warning. your_recent_rule_breaks lists what you got wrong lately — don't repeat it.
- coach_memory: standing decisions, facts and preferences the athlete agreed with you or told you (id, date, text, expires_on). They are binding: follow them in every review and answer, and they override your defaults and the profile where they conflict. Never re-introduce something a memory item rules out.
- FUEL TARGETS (daily review → "fuel" for today): set the deficit and macros from today's and tomorrow's sessions and the phase. energy_today is the app's own burn (resting × activity factor + Garmin session calories already done; planned_sessions_kcal is an estimate for sessions not done yet) — base the deficit on it and never estimate burn yourself. Carbs by demand: rest/recovery 3–4 g/kg, easy day 4–5, hard or long day 6–8, carb loading 8–10 g/kg on the 1–2 days before a key race (no deficit then); protein 1.6–2.0 g/kg; fat 0.8–1.0 g/kg (lower on carb-load days). The weight-loss deficit (settings.kcal_deficit) applies on rest and easy days only, never before or after a long/hard session or race. Use the latest weight. Grams must add up to about the kcal (4/4/9).
- workout_library: guided workouts; schedule them as sport "mobility" (or as fits) with targets.workout_id set.

LOAD UNITS
- "load" is a TSS-like daily training load (intervals.icu where measured; estimated from duration × RPE otherwise). fitness (CTL, 42-day), fatigue (ATL, 7-day), form = fitness − fatigue. Sustainable fitness ramp ≈ 5–8 points a month.

OUTPUT RULES
- Write for a phone: short, plain English, numbers first. No pep talk, no persona.
- Sessions you change or add must be complete (sport, title, description with the exact workout, duration, intensity, targets, planned_load). Use sport values run | ride | gym_legs | gym_upper | mobility | rest | race. A rest slot is sport "rest", title "Rest".
- planned_load: estimate on the same TSS-like scale (easy 60 min run ≈ 50, 2 h long run ≈ 120, threshold 60 min ≈ 75, leg gym 60 min ≈ 35, upper gym ≈ 10, rest 0).
- Only change what needs changing. Never change dates in the past or sessions marked locked. Keep the structure of the plan (phases, races, key long runs) unless the evidence says otherwise — then propose it as a "big" change with the reason.
- scope "small": a day-level adjustment within the next 7 days (swap easy ↔ rest, trim duration, move a gym session, replace a hard session with easy because of fatigue). scope "big": anything to the long run, weekly volume, a phase, a race, or more load than planned.`;

const Exercise = z.object({ name: z.string(), sets: z.number().int(), reps: z.number().int(), kg: z.number().nullable() });
const Session = z.object({
  sport: z.enum(["run", "ride", "gym_legs", "gym_upper", "mobility", "rest", "race"]),
  title: z.string().describe("short, e.g. 'Easy run 45 min'"),
  description: z.string().describe("the exact workout, warm-up to cool-down, plus stopping rule / lap-button reminder where relevant"),
  duration_min: z.number().int().nullable(),
  distance_km: z.number().nullable(),
  intensity: z.enum(["rest", "recovery", "easy", "moderate", "hard", "race"]),
  targets: z.object({
    workout_id: z.string().nullable().describe("id from workout_library when the session is one of those guided workouts (sport 'mobility' etc.), else null"),
    hr_max: z.number().int().nullable(), pace: z.string().nullable().describe("e.g. '5:50–6:00/km'"),
    watts: z.string().nullable().describe("e.g. '190–215 W'"), exercises: z.array(Exercise).nullable(),
  }),
  planned_load: z.number().int(),
});
const Change = z.object({
  date: z.string().describe("YYYY-MM-DD"), slot: z.enum(["am", "pm"]), scope: z.enum(["small", "big"]),
  why: z.string().describe("one sentence shown on the session card"),
  after: Session.nullable().describe("null removes the session"),
});
const Fuel = z.object({
  deficit_kcal: z.number().int().describe("kcal below today's burn (energy_today) to eat: 0 for no deficit, settings.kcal_deficit on rest/easy days; the app recalculates the target live as burn − this"),
  kcal: z.number().int().describe("energy_today.total_so_far − deficit_kcal (for the note; the app recomputes as sessions sync)"),
  carbs_g: z.number().int(), protein_g: z.number().int(), fat_g: z.number().int(),
  why: z.string().describe("one short line, e.g. 'Carb load day 2: 9 g/kg, no deficit' or 'Rest day: 3 g/kg carbs, 500 kcal deficit'"),
});
const Daily = z.object({
  summary: z.string().describe("2–4 sentences for the athlete: how the last days went against plan, what the data says, what changed"),
  today_note: z.string().describe("one or two lines about today's sessions"),
  proposal_title: z.string().nullable().describe("title for the big changes, if any"),
  changes: z.array(Change),
  fuel: Fuel.nullable().describe("today's eating targets (daily review only; null in the weekly review)"),
});
const Memory = z.object({
  text: z.string().describe("one self-contained line in the third person, e.g. 'No hip mobility sessions until Herman asks for them' or 'Away in Cape Town 3–7 Dec: hotel gym only'"),
  kind: z.enum(["decision", "fact", "preference", "constraint"]),
  expires_on: z.string().nullable().describe("YYYY-MM-DD when it stops applying (trips, temporary injuries, race-week rules); null if it lasts"),
});
const Chat = z.object({
  reply: z.string().describe("the answer to the athlete, phone-length"),
  remember: z.array(Memory).describe("ONLY lasting things from this exchange that future reviews must know: a decision you agreed, a preference, a constraint (travel, injury, equipment, availability), a fact about the athlete. Not small talk, not one-off answers, not anything already in coach_memory or the profile. Usually empty."),
  forget: z.array(z.number().int()).describe("ids of coach_memory items this exchange makes outdated or the athlete cancelled"),
  proposal_title: z.string().nullable(),
  changes: z.array(Change).describe("only if he asked for a plan change or the answer requires one; these come to him as a proposal to accept"),
});

const Insight = z.object({
  headline: z.string().describe("one sentence: the single most important thing this chart says right now"),
  points: z.array(z.string()).describe("2–4 short bullets with the numbers behind it and what is driving it"),
  on_track: z.enum(["on_track", "watch", "concern", "too_little_data"]).describe("for this point in the Comrades build"),
  action: z.string().nullable().describe("the one thing worth doing about it, or null if nothing"),
});

// ---------- load maths (same as the app) ----------
const IF: Record<string, number> = { rest: 0, recovery: 0.6, easy: 0.7, moderate: 0.8, hard: 0.88, race: 0.9 };
function actLoad(a: { load: number | null; duration_s: number | null; rpe: number | null; sport: string }) {
  if (a.load != null) return a.load;
  const h = (a.duration_s ?? 0) / 3600, rpe = a.rpe ?? (a.sport.startsWith("gym") ? 5 : 4);
  const f = 0.5 + 0.05 * rpe;
  return Math.round(h * 100 * f * f * (a.sport === "gym_upper" ? 0.3 : a.sport === "gym_legs" ? 0.7 : a.sport === "mobility" ? 0.2 : 1));
}

// ---------- hard-rule guard ----------
type HardRule = { id: number; text: string; rule: { banned?: string[]; carbs_max_gkg?: { easy?: number; hard?: number }; burn_from_app?: boolean } | null };
type Violation = { rule_id: number; rule: string; where: string; date?: string | null; slot?: string | null; detail: string; source: "code" | "claude" };
// deno-lint-ignore no-explicit-any
type Draft = any;
const NEG = /\b(no|not|never|without|avoid|skip|zero)\b[^.;:]{0,25}$/i;   // "no carb loading" / "without loading" is fine
const NEG_AFTER = /^[^.;:]{0,30}\b(removed|replaced|gone|dropped|taken out|deleted)\b/i;   // "carb-load text removed" is fine

/** every coach-written text in a draft, labelled by where it sits */
function draftTexts(d: Draft): { where: string; date?: string; slot?: string; text: string }[] {
  const t: { where: string; date?: string; slot?: string; text: string }[] = [];
  for (const k of ["summary", "today_note", "reply", "proposal_title"]) if (d?.[k]) t.push({ where: k, text: String(d[k]) });
  if (d?.fuel?.why) t.push({ where: "fuel.why", text: String(d.fuel.why) });
  for (const c of d?.changes ?? []) {
    t.push({ where: "change.why", date: c.date, slot: c.slot, text: String(c.why ?? "") });
    if (c.after) t.push({ where: "session", date: c.date, slot: c.slot, text: `${c.after.title ?? ""}. ${c.after.description ?? ""}` });
  }
  return t;
}

/** hard or long session → "hard" carb ceiling; race days are exempt (race-day fuelling is allowed) */
// deno-lint-ignore no-explicit-any
function dayKind(sessions: any[]): "easy" | "hard" | "race" {
  if (sessions.some((p) => p?.sport === "race" || p?.intensity === "race")) return "race";
  const long = (p: { sport?: string; duration_min?: number | null; distance_km?: number | null }) =>
    (p.sport === "run" && ((p.duration_min ?? 0) >= 90 || (p.distance_km ?? 0) >= 18)) || (p.sport === "ride" && (p.duration_min ?? 0) >= 150);
  return sessions.some((p) => p?.intensity === "hard" || long(p)) ? "hard" : "easy";
}

/** carbs a text prescribes for the day: the highest "x g/kg" next to "carb", or the highest 3–4 digit gram total next to "carb" (÷ kg) */
function carbGkg(text: string, kg: number): number | null {
  let best: number | null = null;
  const near = (i: number) => /carb/i.test(text.slice(Math.max(0, i - 60), i + 60));
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*g\s*\/\s*kg/gi)) {
    if (!near(m.index ?? 0)) continue;
    const v = Number(String(m[2] ?? m[1]).replace(",", ".")); if (v > 0 && v < 20) best = Math.max(best ?? 0, v);
  }
  for (const m of text.matchAll(/(\d{3,4})\s*(?:[–-]\s*(\d{3,4}))?\s*g\b(?!\s*\/)/gi)) {
    const i = m.index ?? 0; const ctx = text.slice(Math.max(0, i - 60), i + 60);
    if (!/carb/i.test(ctx) || /breakfast|per hour|\/h|an hour|during the race|in-race|on the bike/i.test(ctx)) continue;   // race breakfast / in-race carbs are allowed
    const v = Number(m[2] ?? m[1]) / kg; if (v > 0) best = Math.max(best ?? 0, Math.round(v * 10) / 10);
  }
  return best;
}

// deno-lint-ignore no-explicit-any
function codeCheck(d: Draft, rules: HardRule[], ctx: { kg: number; today: string; plan: any[]; energy: { total_so_far: number } }): Violation[] {
  const v: Violation[] = [];
  const texts = draftTexts(d);
  for (const r of rules) {
    const cfg = r.rule ?? {};
    for (const pat of cfg.banned ?? []) {
      const re = new RegExp(pat, "gi");
      for (const t of texts) for (const m of t.text.matchAll(re)) {
        if (NEG.test(t.text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0)) || NEG_AFTER.test(t.text.slice((m.index ?? 0) + m[0].length))) continue;
        v.push({ rule_id: r.id, rule: r.text, where: t.where, date: t.date ?? null, slot: t.slot ?? null, detail: `says "${t.text.slice(Math.max(0, (m.index ?? 0) - 25), (m.index ?? 0) + m[0].length + 25).trim()}"`, source: "code" });
        break;
      }
    }
    if (cfg.carbs_max_gkg) {
      const sessionsOn = (date: string) => {
        const changed = (d?.changes ?? []).filter((c: { date: string }) => c.date === date);
        const kept = ctx.plan.filter((p) => p.date === date && !changed.some((c: { slot: string }) => c.slot === p.slot));
        return [...kept, ...changed.map((c: { after: unknown }) => c.after).filter(Boolean)];
      };
      const check = (date: string, gkg: number | null, where: string, slot: string | null) => {
        if (gkg == null) return;
        const kind = dayKind(sessionsOn(date)); if (kind === "race") return;
        const max = (kind === "hard" ? cfg.carbs_max_gkg!.hard : cfg.carbs_max_gkg!.easy) ?? 99;
        if (gkg > max + 0.05) v.push({ rule_id: r.id, rule: r.text, where, date, slot, detail: `${gkg} g/kg carbs on a${kind === "easy" ? "n easy/openers/rest" : " hard/long"} day (ceiling ${max} g/kg = ${Math.round(max * ctx.kg)} g)`, source: "code" });
      };
      if (d?.fuel?.carbs_g) check(ctx.today, Math.round((d.fuel.carbs_g / ctx.kg) * 10) / 10, "fuel", null);
      for (const c of d?.changes ?? []) if (c.after) check(c.date, carbGkg(`${c.after.description ?? ""} ${c.why ?? ""}`, ctx.kg), "session", c.slot);
    }
    if (cfg.burn_from_app && d?.fuel && typeof d.fuel.kcal === "number" && typeof d.fuel.deficit_kcal === "number") {
      const want = ctx.energy.total_so_far - d.fuel.deficit_kcal;
      if (Math.abs(d.fuel.kcal - want) > 60) v.push({ rule_id: r.id, rule: r.text, where: "fuel", date: ctx.today, slot: null, detail: `fuel kcal ${d.fuel.kcal} ≠ app burn ${ctx.energy.total_so_far} − deficit ${d.fuel.deficit_kcal} = ${want}`, source: "code" });
    }
  }
  return v;
}

const Verdict = z.object({ violations: z.array(z.object({
  rule_id: z.number().int(), date: z.string().nullable().describe("YYYY-MM-DD of the session concerned, or null"), slot: z.enum(["am", "pm"]).nullable(), where: z.string(),
  detail: z.string().describe("quote the words and say how they break the rule"),
  is_break: z.boolean().describe("your verdict after the detail: true only if it clearly breaks the rule"),
})) });

/** Claude reads every hard rule (any wording) against the draft */
async function claudeCheck(client: Anthropic, d: Draft, rules: HardRule[], ctx: { who: string; chatMessage?: string }): Promise<Violation[]> {
  if (!rules.length) return [];
  const draft = { summary: d?.summary, today_note: d?.today_note, reply: d?.reply, fuel: d?.fuel, changes: (d?.changes ?? []).map((c: Draft) => ({ date: c.date, slot: c.slot, why: c.why, after: c.after && { sport: c.after.sport, title: c.after.title, intensity: c.after.intensity, duration_min: c.after.duration_min, description: c.after.description } })) };
  const res = await client.messages.parse({ model: "claude-sonnet-5-5", max_tokens: 3000, output_config: { effort: "low", format: zodOutputFormat(Verdict) },
    messages: [{ role: "user", content: `You audit a training coach's draft against the athlete's HARD RULES. List only clear breaks of a rule's intent (including the same thing under another name), not style; if nothing breaks a rule, return an empty list. Negations ("no carb loading") are not breaks. Race-day breakfast and in-race fuelling are allowed unless a rule says otherwise.${ctx.chatMessage ? ` If the athlete explicitly asked for something in this message, doing it is not a break: "${ctx.chatMessage}"` : ""}

HARD RULES of ${ctx.who}:
${rules.map((r) => `[${r.id}] ${r.text}`).join("\n")}

DRAFT:
${JSON.stringify(draft)}` }] });
  return (res.parsed_output?.violations ?? []).filter((x) => x.is_break && !/not a (clear )?break|no (clear )?break|is fine|acceptable|within the (cap|ceiling|rule)/i.test(x.detail)).map(({ is_break: _b, ...x }) => ({ ...x, rule: rules.find((r) => r.id === x.rule_id)?.text ?? "", source: "claude" as const }));
}

const vKey = (x: Violation) => `${x.rule_id}|${x.date ?? ""}|${x.slot ?? ""}|${x.where}`;
function merge(a: Violation[], b: Violation[]) { const seen = new Set(a.map(vKey)); return [...a, ...b.filter((x) => !seen.has(vKey(x)))]; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let runId: number | null = null;
  try {
    const cron = Deno.env.get("TR_CRON_TOKEN");
    const byCron = !!cron && req.headers.get("x-cron-token") === cron;
    const body = await req.json().catch(() => ({}));
    let uid: string;
    if (byCron) {
      if (!body.user_id) {
        // the morning schedule: review every member who has a plan, one call each
        const { data: ms } = await admin.from("tr_members").select("user_id");
        const out: unknown[] = [];
        for (const m of ms ?? []) {
          const { count } = await admin.from("tr_planned").select("id", { count: "exact", head: true }).eq("user_id", m.user_id);
          if (!count) continue;
          const r = await fetch(`${url}/functions/v1/tr-coach`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-token": cron! }, body: JSON.stringify({ ...body, user_id: m.user_id }) });
          out.push({ user_id: m.user_id, status: r.status });
        }
        return json({ ok: true, users: out });
      }
      uid = String(body.user_id);
    } else {
      const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
      uid = (await asUser.auth.getUser()).data.user!.id;
    }
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "No ANTHROPIC_API_KEY secret in Supabase" }, 503);
    const { data: me } = await admin.from("tr_members").select("display_name").eq("user_id", uid).maybeSingle();
    const who = me?.display_name ?? "the athlete";
    const mode: "daily" | "weekly" | "chat" | "insight" = body.mode === "chat" ? "chat" : body.mode === "insight" ? "insight" : body.mode === "weekly" ? "weekly" : "daily";
    const review = mode === "daily" || mode === "weekly";
    if (mode === "chat" && !String(body.message ?? "").trim()) return json({ error: "message required" }, 400);
    if (mode === "insight" && (!body.chart || !body.data)) return json({ error: "chart and data required" }, 400);

    const today = sastToday();
    const profileOf = (p: string | null | undefined) => `ATHLETE PROFILE — ${who}\n${p?.trim() || "No profile written yet. Ask about their goal, event, history, injuries and weekly availability before prescribing anything ambitious; keep sessions conservative until then. Units metric."}`;
    const from = addDays(today, -28), to = addDays(today, 21), loadFrom = addDays(today, -365);
    const [settings, phases, events, planned, acts, well, sets, pending, chat, meals] = await Promise.all([
      admin.from("tr_settings").select("height_cm,ftp_w,max_hr,run_max_hr,easy_run_hr_cap,goal_weight_kg,coach_auto,coach_model,notes,birth_year,activity_factor,kcal_deficit,sex,coach_profile,paces").eq("user_id", uid).maybeSingle(),
      admin.from("tr_phases").select("name,start_date,end_date,focus,run_km_from,run_km_to,long_run_from,long_run_to,leg_sessions,key_sessions,strength_emphasis").eq("user_id", uid).order("start_date"),
      admin.from("tr_events").select("date,name,kind,distance_km,purpose,target,on_track,borderline,rethink,result").eq("user_id", uid).order("date"),
      admin.from("tr_planned").select("id,date,slot,sport,title,description,duration_min,distance_km,intensity,targets,planned_load,status,locked,source,change_note").eq("user_id", uid).gte("date", from).lte("date", to).order("date"),
      admin.from("tr_activities").select("date,slot,sport,name,duration_s,distance_m,elev_m,avg_hr,max_hr,avg_watts,np_watts,avg_pace_s,gap_pace_s,load,ef,decoupling,rpe,notes,planned_id,trainer,calories,blocks,extras").eq("user_id", uid).gte("date", loadFrom).order("date"),
      admin.from("tr_wellness").select("date,resting_hr,hrv,sleep_h,weight_kg,waist_cm,legs,energy,ankle_pain,notes").eq("user_id", uid).gte("date", addDays(today, -42)).order("date"),
      admin.from("tr_gym_sets").select("date,exercise,set_no,reps,kg").eq("user_id", uid).gte("date", addDays(today, -35)).order("date"),
      admin.from("tr_proposals").select("id,created_at,title,why,changes").eq("user_id", uid).eq("status", "pending"),
      mode === "chat" ? admin.from("tr_chat").select("role,content,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
      admin.from("tr_meals").select("date,meal,description,kcal,protein_g,carbs_g,fat_g").eq("user_id", uid).gte("date", addDays(today, -14)).order("date"),
    ]);
    const { data: library } = await admin.from("tr_workouts").select("id,name,category,duration_min,when_to_use");
    // body composition trend: tape (US Navy) from waist/neck/height and visual reads of progress photos — numbers only, never photos
    const { data: bodyRows } = await admin.from("tr_wellness").select("date,weight_kg,waist_cm,neck_cm").eq("user_id", uid).gte("date", addDays(today, -120)).order("date");
    const { data: photoReads } = await admin.from("tr_body_photos").select("date,weight_kg,ai").eq("user_id", uid).gte("date", addDays(today, -365)).order("date");
    const { data: scans } = await admin.from("tr_inbody").select("date,weight_kg,smm_kg,bfm_kg,pbf,ffm_kg,ecw_ratio,visceral_level,bmr_kcal,segments").eq("user_id", uid).gte("date", addDays(today, -365)).order("date");
    const { data: memRows } = await admin.from("tr_coach_memory").select("id,created_at,text,kind,expires_on").eq("user_id", uid).eq("active", true)
      .or(`expires_on.is.null,expires_on.gte.${today}`).order("created_at");
    const memory = (memRows ?? []).map((m) => ({ id: m.id, date: String(m.created_at).slice(0, 10), kind: m.kind, text: m.text, expires_on: m.expires_on }));
    const { data: hardRows } = await admin.from("tr_coach_memory").select("id,text,rule").eq("user_id", uid).eq("active", true).eq("hard", true).order("id");
    const hardRules = (hardRows ?? []) as HardRule[];
    const { data: guardRows } = await admin.from("tr_coach_runs").select("created_at,guard").eq("user_id", uid).not("guard", "is", null).gte("created_at", addDays(today, -14)).order("created_at", { ascending: false }).limit(10);
    const recentBreaks = (guardRows ?? []).flatMap((g) => ((g.guard?.violations ?? []) as Violation[]).map((x) => ({ on: String(g.created_at).slice(0, 10), rule: x.rule, detail: x.detail }))).slice(0, 12);
    const profile = profileOf(settings.data?.coach_profile);
    const h = Number(settings.data?.height_cm ?? 0);
    let neck: number | null = null, waist: number | null = null;
    const tape = (bodyRows ?? []).flatMap((r) => {
      if (r.neck_cm) neck = Number(r.neck_cm);
      if (r.waist_cm) waist = Number(r.waist_cm);
      if (!r.waist_cm && !r.neck_cm) return [];
      if (!waist || !neck || !h || waist <= neck) return [];
      const bf = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(h)) - 450;
      return [{ date: r.date, waist_cm: waist, neck_cm: neck, weight_kg: r.weight_kg, tape_bf: Math.round(bf * 10) / 10 }];
    });
    const body_composition = {
      tape_estimates: tape.slice(-20),
      inbody_scans: scans ?? [],
      photo_reads: (photoReads ?? []).filter((p) => p.ai?.usable).map((p) => ({ date: p.date, weight_kg: p.weight_kg, bf_low: p.ai.bf_low, bf_high: p.ai.bf_high, bf_best: p.ai.bf_best, changes: p.ai.changes })),
    };
    // food per day, with Garmin session calories alongside for the balance
    const foodDays = new Map<string, { kcal: number; protein_g: number; carbs_g: number; meals: string[] }>();
    for (const m of meals.data ?? []) {
      const f = foodDays.get(m.date) ?? { kcal: 0, protein_g: 0, carbs_g: 0, meals: [] };
      f.kcal += m.kcal; f.protein_g += Number(m.protein_g ?? 0); f.carbs_g += Number(m.carbs_g ?? 0); f.meals.push(`${m.meal}: ${m.description} (${m.kcal})`); foodDays.set(m.date, f);
    }
    // today's burn exactly as the app's Food card computes it (src/lib/calories.ts): Mifflin by sex (or InBody BMR ≤120 days old) × factor + sessions
    const energy_today = (() => {
      const st = settings.data ?? {} as Record<string, unknown>;
      const female = st.sex === "female";
      const kg = Number([...(well.data ?? [])].reverse().find((w) => w.weight_kg && w.date <= today)?.weight_kg ?? st.goal_weight_kg ?? (female ? 68 : 82));
      const age = Number(today.slice(0, 4)) - Number(st.birth_year ?? 1985);
      const scan = [...(scans ?? [])].filter((x) => x.bmr_kcal && x.date <= today && x.date >= addDays(today, -120)).pop();
      const bmr = scan ? Number(scan.bmr_kcal) : Math.round(10 * kg + 6.25 * Number(st.height_cm ?? (female ? 168 : 178)) - 5 * age + (female ? -161 : 5));
      const factor = Number(st.activity_factor ?? 1.25);
      const resting = Math.round(bmr * factor);
      const sess = (a: Record<string, unknown>) => {
        const min = Number(a.duration_s ?? 0) / 60, share = (bmr * factor / 1440) * min;
        const gross = a.calories ? Number(a.calories) : a.sport === "ride" && a.avg_watts && a.duration_s ? Number(a.avg_watts) * Number(a.duration_s) / 1000
          : a.sport === "run" && a.distance_m ? kg * Number(a.distance_m) / 1000 : String(a.sport).startsWith("gym") ? 6 * min : 4 * min;
        return Math.max(0, Math.round(gross - share));
      };
      const done = (acts.data ?? []).filter((a) => a.date === today);
      const sessions = done.reduce((s, a) => s + sess(a as Record<string, unknown>), 0);
      const doneIds = new Set(done.map((a) => a.planned_id).filter(Boolean));
      const plannedLeft = (planned.data ?? []).filter((p) => p.date === today && p.sport !== "rest" && !doneIds.has(p.id) && p.status !== "done");
      const planned_sessions_kcal = plannedLeft.reduce((s, p) => s + Math.round((Number(p.duration_min ?? 0)) * (p.sport === "ride" ? 11 : p.sport === "run" ? 12 : 6) * (p.intensity === "hard" ? 1.2 : 1)), 0);
      return { bmr, bmr_from: scan ? `InBody ${scan.date}` : "Mifflin–St Jeor", weight_kg: kg, activity_factor: factor, resting, sessions_done_kcal: sessions, total_so_far: resting + sessions, planned_sessions_kcal, kcal_deficit_setting: Number(st.kcal_deficit ?? 500) };
    })();
    const sessionKcal = (d: string) => (acts.data ?? []).filter((a) => a.date === d).reduce((s, a) => s + Number((a as { calories?: number }).calories ?? 0), 0);
    const food = [...foodDays.entries()].map(([date, f]) => ({ date, kcal_in: Math.round(f.kcal), protein_g: Math.round(f.protein_g), carbs_g: Math.round(f.carbs_g), garmin_session_kcal: sessionKcal(date), meals: f.meals }));

    // daily load → fitness / fatigue / form
    const byDay = new Map<string, number>();
    for (const a of acts.data ?? []) byDay.set(a.date, (byDay.get(a.date) ?? 0) + actLoad(a));
    let ctl = 0, atl = 0; const pmc: { date: string; load: number; fitness: number; fatigue: number; form: number }[] = [];
    for (let d = loadFrom; d <= today; d = addDays(d, 1)) {
      const l = byDay.get(d) ?? 0; const form = ctl - atl;
      ctl += (l - ctl) / 42; atl += (l - atl) / 7;
      pmc.push({ date: d, load: l, fitness: Math.round(ctl), fatigue: Math.round(atl), form: Math.round(form) });
    }
    const recentActs = (acts.data ?? []).filter((a) => a.date >= from).map((a) => ({
      date: a.date, slot: a.slot, sport: a.sport, name: a.name, min: a.duration_s ? Math.round(a.duration_s / 60) : null,
      km: a.distance_m ? Math.round(a.distance_m / 100) / 10 : null, elev: a.elev_m, hr: a.avg_hr, hr_max: a.max_hr,
      watts: a.avg_watts, np: a.np_watts, pace: a.avg_pace_s ? `${Math.floor(a.avg_pace_s / 60)}:${String(Math.round(a.avg_pace_s % 60)).padStart(2, "0")}/km` : null,
      load: actLoad(a), ef: a.ef, decoupling: a.decoupling, rpe: a.rpe, notes: a.notes, indoor: a.trainer, planned_id: a.planned_id,
      // per-block detail for the last 14 days (older sessions: averages only, to keep the request small)
      ...(a.date >= addDays(today, -14) ? { blocks: a.blocks ?? undefined, extras: a.extras ?? undefined } : {}),
    }));
    const context = {
      today, weekday: new Date(today).toLocaleDateString("en-ZA", { weekday: "long" }),
      settings: { ...(settings.data ?? {}), coach_profile: undefined }, phases: phases.data, events: events.data,
      plan: (planned.data ?? []).map((p) => ({ ...p, past: p.date < today })),
      actuals_last_28_days: recentActs,
      wellness_last_42_days: well.data,
      gym_sets_last_35_days: sets.data,
      food_last_14_days: food,
      energy_today,
      workout_library: library ?? [],
      body_composition,
      load_last_28_days: pmc.slice(-28),
      pending_proposals: pending.data,
      coach_memory: memory,
      hard_rules: hardRules.map((r) => ({ id: r.id, text: r.text })),
      your_recent_rule_breaks: recentBreaks,
    };

    // ---- chart insight: read-only analysis of one Trends chart, never changes the plan ----
    if (mode === "insight") {
      const chart = String(body.chart).slice(0, 60);
      const kind = `insight:${chart}`;
      const { data: run } = await admin.from("tr_coach_runs").insert({ user_id: uid, kind }).select("id").single();
      runId = run?.id ?? null;
      const text = `${who} tapped the AI button on the "${String(body.title ?? chart)}" chart on the Trends screen (range: ${String(body.range ?? "")}).
What the chart shows: ${String(body.about ?? "")}

CHART DATA (JSON, exactly what is plotted):
${JSON.stringify(body.data).slice(0, 120000)}

Give ${who} insight on THIS chart: what the trend actually is (with the numbers), what is driving it (use the plan, sessions, wellness, phases and races in the context), whether it is where it should be for this point of their build towards the goal in the profile, and the one thing worth doing about it. Say plainly when the data is too thin or a measurement quirk could explain it (e.g. Strava-imported rides scored on average watts, HR strap spikes, gearing). Do not repeat the chart back; interpret it. Do not change the plan here.

CONTEXT (JSON):
${JSON.stringify(context)}`;
      const client = new Anthropic();
      const primary = settings.data?.coach_model || "claude-opus-5-5";
      const ask = (model: string) => client.messages.parse({
        model, max_tokens: 16000,
        output_config: { effort: "medium", format: zodOutputFormat(Insight) },
        system: [{ type: "text", text: SYSTEM }, { type: "text", text: profile, cache_control: { type: "ephemeral", ttl: "1h" } }],
        messages: [{ role: "user", content: text }],
      });
      let res = await ask(primary); let model = primary;
      if (res.stop_reason === "refusal") { model = "claude-sonnet-5-5"; res = await ask(model); }
      if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`Claude returned no usable answer (${res.stop_reason})`);
      const insight = res.parsed_output;
      await admin.from("tr_coach_runs").update({ summary: JSON.stringify(insight), model, usage: res.usage }).eq("id", runId);
      return json({ ok: true, insight, created_at: new Date().toISOString(), model });
    }

    const weekStart = addDays(today, -((new Date(today).getUTCDay() + 6) % 7));     // Monday of this week
    const userText = mode === "weekly"
      ? `Weekly review, ${today} (${new Date(today).toLocaleDateString("en-ZA", { weekday: "long" })}). Review the week ${weekStart} to ${addDays(weekStart, 6)}: sessions done vs planned (count, run km vs the phase ceiling, long run, quality sessions, leg gym), load and the fitness ramp, resting HR / HRV / sleep trend, ankle and legs, food and body-composition trend if logged. Then look at NEXT week (${addDays(weekStart, 7)} to ${addDays(weekStart, 13)}) and the one after: rebuild what needs rebuilding so the phase targets stay realistic — every change goes into ONE proposal the athlete accepts with one tap (mark them scope "big"). If next week is right as planned, return no changes and say so.
"summary": 4–6 short lines, numbers first: what happened, what it means, what changes. "today_note": one line headline for next week.

DATA (JSON):
${JSON.stringify(context)}`
      : mode === "daily"
      ? `Daily review for ${today}. Compare the last days with the plan, read the wellness trend and the check-in, then adjust the next 14 days only where needed. If nothing needs changing, return no changes.\n\nDATA (JSON):\n${JSON.stringify(context)}`
      : `DATA (JSON):\n${JSON.stringify(context)}\n\nRECENT CHAT (newest first):\n${JSON.stringify(chat.data)}\n\n${who}: ${String(body.message).trim()}`;

    // fingerprint of what the review reads that the athlete or Garmin can change (not the coach's own plan edits, not timestamps)
    let sig: string | null = null;
    if (mode === "daily") {
      const recent = addDays(today, -7);
      const basis = {
        today,
        acts: (acts.data ?? []).filter((a) => a.date >= recent).map((a) => [a.date, a.slot, a.sport, a.duration_s, a.distance_m, a.load, a.rpe, a.notes, a.planned_id]),
        well: (well.data ?? []).filter((w) => w.date >= addDays(today, -3)),
        sets: (sets.data ?? []).filter((x) => x.date >= recent).length,
        mine: (planned.data ?? []).filter((p) => p.source !== "coach" && p.date >= recent).map((p) => [p.id, p.date, p.slot, p.title, p.duration_min, p.distance_km, p.status, p.locked]),
        pending: (pending.data ?? []).map((p) => p.id),
        meals: (meals.data ?? []).filter((m) => m.date >= addDays(today, -1)).map((m) => [m.date, m.kcal]),
        memory: memory.map((m) => [m.id, m.text, m.expires_on]),
        notes: settings.data?.notes ?? null,
      };
      const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(JSON.stringify(basis)));
      sig = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (body.if_changed) {
        const { data: last } = await admin.from("tr_coach_runs").select("created_at,summary,error,input_sig").eq("user_id", uid).eq("kind", "daily").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (last && !last.summary && !last.error && Date.now() - Date.parse(last.created_at) < 4 * 60e3) return json({ skipped: "running" });
        if (last?.summary && last.input_sig === sig) return json({ skipped: "unchanged" });
      }
    }

    if (body.guard_dry_run) {
      if (!byCron) return json({ error: "dry run needs the schedule token" }, 403);
      const d = body.guard_dry_run;
      const gctx = { kg: energy_today.weight_kg, today: String(body.as_of ?? today), plan: planned.data ?? [], energy: energy_today };
      const code = codeCheck(d, hardRules, gctx);
      const ai = await claudeCheck(new Anthropic(), d, hardRules, { who });
      return json({ rules: hardRules.map((r) => r.text), code, claude: ai, caught: code.length + ai.length > 0 });
    }

    const { data: run } = await admin.from("tr_coach_runs").insert({ user_id: uid, kind: mode, input_sig: sig }).select("id").single();   // daily | weekly | chat
    runId = run?.id ?? null;
    if (mode === "chat") await admin.from("tr_chat").insert({ user_id: uid, role: "user", content: String(body.message).trim() });

    const client = new Anthropic();
    const primary = settings.data?.coach_model || "claude-opus-5-5";
    const ask = (model: string) => client.messages.parse({
      model, max_tokens: 16000,
      output_config: { effort: mode === "chat" ? "medium" : "high", format: zodOutputFormat(review ? Daily : Chat) },
      system: [{ type: "text", text: SYSTEM }, { type: "text", text: profile, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: userText }],
    });
    let res = await ask(primary); let model = primary;
    if (res.stop_reason === "refusal") { model = "claude-sonnet-5-5"; res = await ask(model); }   // client-side fallback
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`Claude returned no usable answer (${res.stop_reason})`);
    let out = res.parsed_output as z.infer<typeof Daily> & z.infer<typeof Chat>;

    // ---- hard-rule guard: code checks + a Claude check; one corrected draft; what still breaks a rule is flagged ----
    const gctx = { kg: energy_today.weight_kg, today, plan: planned.data ?? [], energy: energy_today };
    const chatMessage = mode === "chat" ? String(body.message ?? "") : undefined;
    const checkAll = async (d: Draft) => merge(codeCheck(d, hardRules, gctx), await claudeCheck(client, d, hardRules, { who, chatMessage }).catch(() => []));
    let violations = hardRules.length ? await checkAll(out) : [];
    const first = violations;
    // race sessions and today/tomorrow's sessions are never rewritten by the fix — those are flagged only
    const frozen = (x: Violation) => !!x.date && x.where !== "fuel" && (x.date <= addDays(today, 1) || (planned.data ?? []).some((p) => p.date === x.date && p.sport === "race"));
    if (violations.some((x) => !frozen(x))) {
      const fix = await client.messages.parse({
        model, max_tokens: 16000, output_config: { effort: "medium", format: zodOutputFormat(review ? Daily : Chat) },
        system: [{ type: "text", text: SYSTEM }, { type: "text", text: profile, cache_control: { type: "ephemeral", ttl: "1h" } }],
        messages: [{ role: "user", content: userText }, { role: "assistant", content: JSON.stringify(out) },
          { role: "user", content: `Your draft breaks the athlete's HARD RULES:\n${violations.map((x) => `- [${x.rule_id}] ${x.rule} → ${x.where}${x.date ? ` ${x.date} ${x.slot ?? ""}` : ""}: ${x.detail}`).join("\n")}\nReturn the full corrected output. Change only what is needed to obey the rules${violations.some(frozen) ? "; leave changes dated on or before " + addDays(today, 1) + " and race sessions exactly as they were" : ""}.` }],
      }).catch(() => null);
      if (fix?.parsed_output) {
        const fixed = fix.parsed_output as typeof out;
        // keep the original for frozen sessions
        fixed.changes = (fixed.changes ?? []).map((c) => (out.changes ?? []).find((o) => o.date === c.date && o.slot === c.slot && frozen({ rule_id: 0, rule: "", where: "session", date: c.date, slot: c.slot, detail: "", source: "code" })) ?? c);
        out = fixed;
        violations = await checkAll(out);
      }
    }
    // fuel numbers the code can correct itself: carbs over the ceiling → the ceiling; kcal → app burn − deficit
    if (mode === "daily" && out.fuel) {
      const burnRule = hardRules.find((r) => r.rule?.burn_from_app);
      if (burnRule && typeof out.fuel.deficit_kcal === "number") out.fuel.kcal = energy_today.total_so_far - out.fuel.deficit_kcal;
      for (const x of violations.filter((x) => x.where === "fuel" && x.source === "code" && /g\/kg carbs/.test(x.detail))) {
        const max = Number(x.detail.match(/ceiling ([\d.]+) g\/kg/)?.[1]); if (max) out.fuel.carbs_g = Math.round(max * gctx.kg);
      }
      violations = violations.filter((x) => !(x.where === "fuel" && x.source === "code"));
    }
    const flagged = violations;
    const flagFor = (date: string, slot: string) => flagged.filter((x) => x.date === date && x.slot === slot);
    const guard = hardRules.length ? { checked: hardRules.length, violations: first, fixed: first.filter((x) => !flagged.some((y) => vKey(y) === vKey(x))).map((x) => x.detail), flagged } : null;

    // ---- decide: apply small changes, collect the rest into one proposal ----
    const plan = planned.data ?? [];
    const auto = mode === "daily" && settings.data?.coach_auto !== false;
    const applied: unknown[] = [], proposed: unknown[] = [];
    for (const c of out.changes ?? []) {
      if (c.date < today) continue;
      const before = plan.find((p) => p.date === c.date && p.slot === c.slot) ?? null;
      if (before?.locked) continue;
      const fl = flagFor(c.date, c.slot);
      if (fl.length) c.why = `⚠ Breaks your rule: ${fl[0].rule.slice(0, 80)} — ${c.why}`;
      const after = c.after ? { ...c.after, change_note: c.why } : null;
      const isLong = (s: { distance_km?: number | null; duration_min?: number | null; sport?: string } | null) =>
        !!s && (s.sport === "race" || (s.sport === "run" && ((s.distance_km ?? 0) >= 25 || (s.duration_min ?? 0) >= 150)) || (s.sport === "ride" && (s.duration_min ?? 0) >= 180));
      const moreLoad = (after?.planned_load ?? 0) > (before?.planned_load ?? 0) * 1.15 + 10;
      const small = c.scope === "small" && c.date <= addDays(today, 7) && !isLong(before) && !isLong(after) && !moreLoad;
      const entry = { date: c.date, slot: c.slot, why: c.why, before: before && { sport: before.sport, title: before.title, duration_min: before.duration_min, distance_km: before.distance_km, planned_load: before.planned_load }, after };
      if (auto && small && !fl.length) {
        if (after) {
          const { error } = await admin.from("tr_planned").upsert({
            user_id: uid, date: c.date, slot: c.slot, sport: after.sport, title: after.title, description: after.description, duration_min: after.duration_min,
            distance_km: after.distance_km, intensity: after.intensity, targets: after.targets, planned_load: after.planned_load,
            source: "coach", change_note: c.why, status: "planned", updated_at: new Date().toISOString(),
          }, { onConflict: "user_id,date,slot" });
          if (error) throw error;
        } else if (before) await admin.from("tr_planned").delete().eq("id", before.id);
        applied.push(entry);
      } else proposed.push(entry);
    }
    let proposalId: number | null = null;
    if (proposed.length) {
      const { data: p } = await admin.from("tr_proposals").insert({ user_id: uid, run_id: runId, title: out.proposal_title || (mode === "weekly" ? "Next week" : "Plan change"), why: review ? out.summary : out.reply, changes: proposed }).select("id").single();
      proposalId = p?.id ?? null;
    }
    const summary = review ? out.summary : out.reply;
    await admin.from("tr_coach_runs").update({ summary, today_note: out.today_note ?? null, fuel: mode === "daily" ? (out.fuel ?? null) : null, guard, model, usage: { ...res.usage, applied: applied.length, proposed: proposed.length } }).eq("id", runId);
    // chat → save lasting decisions / retire outdated ones
    let memMeta: { saved: string[]; retired: string[] } | null = null;
    if (mode === "chat") {
      const saved: string[] = [], retired: string[] = [];
      for (const m of out.remember ?? []) {
        if (!m.text?.trim()) continue;
        const exp = m.expires_on && /^\d{4}-\d{2}-\d{2}$/.test(m.expires_on) ? m.expires_on : null;
        const { error } = await admin.from("tr_coach_memory").insert({ user_id: uid, text: m.text.trim(), kind: m.kind, expires_on: exp, source: "chat" });
        if (!error) saved.push(m.text.trim());
      }
      const ids = (out.forget ?? []).filter((id) => memory.some((m) => m.id === id));
      if (ids.length) {
        await admin.from("tr_coach_memory").update({ active: false, updated_at: new Date().toISOString() }).in("id", ids).eq("user_id", uid);
        retired.push(...memory.filter((m) => ids.includes(m.id)).map((m) => m.text));
      }
      if (saved.length || retired.length) memMeta = { saved, retired };
      await admin.from("tr_chat").insert({ user_id: uid, role: "assistant", content: out.reply, meta: memMeta });
    }
    return json({ ok: true, summary, today_note: out.today_note ?? null, fuel: out.fuel ?? null, guard, memory: memMeta, applied, proposal_id: proposalId, proposed: proposed.length, model, usage: res.usage });
  } catch (e) {
    const msg = e instanceof Anthropic.RateLimitError ? "Claude is rate-limited — try again in a minute"
      : e instanceof Anthropic.AuthenticationError ? "The ANTHROPIC_API_KEY was rejected — check the Supabase secret"
      : e instanceof Anthropic.APIError ? `Claude API: ${e.message}` : String((e as Error)?.message ?? e);
    if (runId) await admin.from("tr_coach_runs").update({ error: msg }).eq("id", runId);
    return json({ error: msg }, 500);
  }
});
