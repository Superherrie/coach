// tr-coach — Claude reads the plan, what was actually done and the morning check-in, and adjusts the coming days.
//   POST { mode: 'daily' }                 → reviews and adjusts (the 05:15 schedule runs this after tr-sync)
//   POST { mode: 'chat', message: '...' }  → answers Herman; any plan change comes back as a one-tap proposal
// Small changes (next 7 days, not the long run, no extra load) apply automatically with a note; bigger ones become proposals.
// Data sent to Claude comes from intervals.icu (Garmin) and Herman's own entries — never from Strava.
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
const SYSTEM = `You are the training coach inside Herman de Vries's personal training app. You plan and adjust two sessions a day (morning "am" and afternoon "pm"; often one is rest) towards Comrades 2027.

ATHLETE
- Herman, 46, Johannesburg (Fourways), ~1,700 m altitude. Metric units, South African dates. Runner first: 5 Comrades finishes (PB 9:42 bronze, 2022 Down Run 9:41:58), 3 Two Oceans, many marathons. Big rider (~96 kg, unverified), strong aerobic base.
- Cycling: FTP 310 W (settled 28 Oct 2026), max HR 185. Very low HR for power (233 W at 122 bpm is normal). Easy rides 190–215 W, HR < 135; tempo 245–265 W; threshold 290–310 W; VO2 330–350 W. Power is the primary control on the bike, HR the cross-check. Compare efficiency factor only within a session type. Cadence changes are often gearing, not fatigue.
- Known patterns: escalation (goes out too hard, fades late) — largely fixed in training, keep naming it; watt-creep on easy days; Saturday creep (cap Saturday at 75 min when a long session follows Sunday); forgets the lap button on structured sessions.
- Health: right medial ankle niggle since Aug 2026 (posterior tibial / pronation), self-managed with calf and mobility work. Do not suggest a physio unless it flares. Plan rule: ankle pain above 3/10 during or after a run → back off running for a week (bike instead).
- Weight: steady loss toward 85–91 kg; no aggressive cutting in heavy blocks; no diet plans unless asked.

GOAL — Comrades Down Run, Sun 13 June 2027, ~91 km Pietermaritzburg → Durban, sub-9 (Bill Rowan): ~5:56/km average, first ~50 km ≈ 4:55, last ~40 km ≈ 4:05. In 2022 the last 15 km fell to 6:30–7:30/km with HR 120–130: the legs failed (quad durability on downhills), not the engine. Levers: downhill durability, pacing discipline over the first 30 km, body weight.

PRINCIPLES
- About 80% of running at conversational effort (easy HR cap from settings until the 10 km time trial sets paces). Weekly km in the phase table are CEILINGS, not targets; the ankle and the December time trial set the real numbers. Ramp run volume no more than ~10% a week; every 3rd or 4th week is a recovery week (~30% less), plus the weeks after the qualifier, Cancún and Loskop.
- Heavy leg strength through every phase (back squat or trap-bar deadlift, Romanian deadlift, Bulgarian split squat, slow eccentric step-downs, heavy straight- and bent-knee calf raises), capped at 2 leg sessions a week, heavy and low-rep. Leg gym goes on quality-run days, at least 6 hours after the run (pm slot). Never legs the day before a long run or within 5 days of a race that matters. If a gym session and a key run clash, the gym goes.
- Upper-body gym is recovery-grade: it must not add fatigue — moderate loads, no failure. It can sit on easy or rest days.
- Bike as support: 1–2 easy rides a week through April for low-impact aerobic volume (easy band above).
- Pacing rehearsal from April: long runs finish with 10–15 km at goal pace (5:50–6:00/km) on tired legs, on downhill routes. Practise race fuelling on every run over 2.5 h (60 g carbs/h).
- Two hard days a week is the cap (quality run, long run). Prescribe exact targets (pace or HR for runs, watts for rides, kg × reps for gym), a stopping rule for quality sessions, and remind him to press the lap button on structured sessions.
- Missing sessions: do not cram missed work into the following days. Re-flow the week: keep the long run and one quality session, drop the rest. Two or more missed key sessions or a sick/injured spell → reduce the next week and say so.
- Stronger than expected (e.g. easy pace improving at the same HR, quality sessions completed with HR lower than predicted, check-ins fresh): progress by small steps — one notch more volume or intensity, never both in one week.
- Fatigue signals: resting HR ≥ 5 bpm above its 7-day baseline, HRV clearly below baseline, legs 4–5/5, poor sleep, form (TSB) below about −25 → swap the day's hard session for easy or rest; two days in a row → reduce the week.
- Do not let one session become a trend. State uncertainty. When you were wrong before, say so plainly.

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
const Daily = z.object({
  summary: z.string().describe("2–4 sentences for Herman: how the last days went against plan, what the data says, what changed"),
  today_note: z.string().describe("one or two lines about today's sessions"),
  proposal_title: z.string().nullable().describe("title for the big changes, if any"),
  changes: z.array(Change),
});
const Chat = z.object({
  reply: z.string().describe("the answer to Herman, phone-length"),
  proposal_title: z.string().nullable(),
  changes: z.array(Change).describe("only if he asked for a plan change or the answer requires one; these come to him as a proposal to accept"),
});

// ---------- load maths (same as the app) ----------
const IF: Record<string, number> = { rest: 0, recovery: 0.6, easy: 0.7, moderate: 0.8, hard: 0.88, race: 0.9 };
function actLoad(a: { load: number | null; duration_s: number | null; rpe: number | null; sport: string }) {
  if (a.load != null) return a.load;
  const h = (a.duration_s ?? 0) / 3600, rpe = a.rpe ?? (a.sport.startsWith("gym") ? 5 : 4);
  const f = 0.5 + 0.05 * rpe;
  return Math.round(h * 100 * f * f * (a.sport === "gym_upper" ? 0.3 : a.sport === "gym_legs" ? 0.7 : a.sport === "mobility" ? 0.2 : 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let runId: number | null = null;
  try {
    const cron = Deno.env.get("TR_CRON_TOKEN");
    const byCron = !!cron && req.headers.get("x-cron-token") === cron;
    if (!byCron) {
      const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
    }
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "No ANTHROPIC_API_KEY secret in Supabase" }, 503);
    const body = await req.json().catch(() => ({}));
    const mode: "daily" | "chat" = body.mode === "chat" ? "chat" : "daily";
    if (mode === "chat" && !String(body.message ?? "").trim()) return json({ error: "message required" }, 400);

    const today = sastToday();
    const from = addDays(today, -28), to = addDays(today, 21), loadFrom = addDays(today, -120);
    const [settings, phases, events, planned, acts, well, sets, pending, chat] = await Promise.all([
      admin.from("tr_settings").select("height_cm,ftp_w,max_hr,run_max_hr,easy_run_hr_cap,goal_weight_kg,coach_auto,coach_model,notes").eq("id", 1).single(),
      admin.from("tr_phases").select("name,start_date,end_date,focus,run_km_from,run_km_to,long_run_from,long_run_to,leg_sessions,key_sessions,strength_emphasis").order("start_date"),
      admin.from("tr_events").select("date,name,kind,distance_km,purpose,target,on_track,borderline,rethink,result").order("date"),
      admin.from("tr_planned").select("id,date,slot,sport,title,description,duration_min,distance_km,intensity,targets,planned_load,status,locked,source,change_note").gte("date", from).lte("date", to).order("date"),
      admin.from("tr_activities").select("date,slot,sport,name,duration_s,distance_m,elev_m,avg_hr,max_hr,avg_watts,np_watts,avg_pace_s,gap_pace_s,load,ef,decoupling,rpe,notes,planned_id,trainer").gte("date", loadFrom).order("date"),
      admin.from("tr_wellness").select("date,resting_hr,hrv,sleep_h,weight_kg,waist_cm,legs,energy,ankle_pain,notes").gte("date", addDays(today, -42)).order("date"),
      admin.from("tr_gym_sets").select("date,exercise,set_no,reps,kg").gte("date", addDays(today, -35)).order("date"),
      admin.from("tr_proposals").select("id,created_at,title,why,changes").eq("status", "pending"),
      mode === "chat" ? admin.from("tr_chat").select("role,content,created_at").order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
    ]);

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
    }));
    const context = {
      today, weekday: new Date(today).toLocaleDateString("en-ZA", { weekday: "long" }),
      settings: settings.data, phases: phases.data, events: events.data,
      plan: (planned.data ?? []).map((p) => ({ ...p, past: p.date < today })),
      actuals_last_28_days: recentActs,
      wellness_last_42_days: well.data,
      gym_sets_last_35_days: sets.data,
      load_last_28_days: pmc.slice(-28),
      pending_proposals: pending.data,
    };

    const userText = mode === "daily"
      ? `Daily review for ${today}. Compare the last days with the plan, read the wellness trend and the check-in, then adjust the next 14 days only where needed. If nothing needs changing, return no changes.\n\nDATA (JSON):\n${JSON.stringify(context)}`
      : `DATA (JSON):\n${JSON.stringify(context)}\n\nRECENT CHAT (newest first):\n${JSON.stringify(chat.data)}\n\nHerman: ${String(body.message).trim()}`;

    const { data: run } = await admin.from("tr_coach_runs").insert({ kind: mode }).select("id").single();
    runId = run?.id ?? null;
    if (mode === "chat") await admin.from("tr_chat").insert({ role: "user", content: String(body.message).trim() });

    const client = new Anthropic();
    const primary = settings.data?.coach_model || "claude-opus-5-5";
    const ask = (model: string) => client.messages.parse({
      model, max_tokens: 16000,
      output_config: { effort: mode === "chat" ? "medium" : "high", format: zodOutputFormat(mode === "daily" ? Daily : Chat) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: userText }],
    });
    let res = await ask(primary); let model = primary;
    if (res.stop_reason === "refusal") { model = "claude-sonnet-5-5"; res = await ask(model); }   // client-side fallback
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`Claude returned no usable answer (${res.stop_reason})`);
    const out = res.parsed_output as z.infer<typeof Daily> & z.infer<typeof Chat>;

    // ---- decide: apply small changes, collect the rest into one proposal ----
    const plan = planned.data ?? [];
    const auto = mode === "daily" && settings.data?.coach_auto !== false;
    const applied: unknown[] = [], proposed: unknown[] = [];
    for (const c of out.changes ?? []) {
      if (c.date < today) continue;
      const before = plan.find((p) => p.date === c.date && p.slot === c.slot) ?? null;
      if (before?.locked) continue;
      const after = c.after ? { ...c.after, change_note: c.why } : null;
      const isLong = (s: { distance_km?: number | null; duration_min?: number | null; sport?: string } | null) =>
        !!s && (s.sport === "race" || (s.sport === "run" && ((s.distance_km ?? 0) >= 25 || (s.duration_min ?? 0) >= 150)) || (s.sport === "ride" && (s.duration_min ?? 0) >= 180));
      const moreLoad = (after?.planned_load ?? 0) > (before?.planned_load ?? 0) * 1.15 + 10;
      const small = c.scope === "small" && c.date <= addDays(today, 7) && !isLong(before) && !isLong(after) && !moreLoad;
      const entry = { date: c.date, slot: c.slot, why: c.why, before: before && { sport: before.sport, title: before.title, duration_min: before.duration_min, distance_km: before.distance_km, planned_load: before.planned_load }, after };
      if (auto && small) {
        if (after) {
          const { error } = await admin.from("tr_planned").upsert({
            date: c.date, slot: c.slot, sport: after.sport, title: after.title, description: after.description, duration_min: after.duration_min,
            distance_km: after.distance_km, intensity: after.intensity, targets: after.targets, planned_load: after.planned_load,
            source: "coach", change_note: c.why, status: "planned", updated_at: new Date().toISOString(),
          }, { onConflict: "date,slot" });
          if (error) throw error;
        } else if (before) await admin.from("tr_planned").delete().eq("id", before.id);
        applied.push(entry);
      } else proposed.push(entry);
    }
    let proposalId: number | null = null;
    if (proposed.length) {
      const { data: p } = await admin.from("tr_proposals").insert({ run_id: runId, title: out.proposal_title || "Plan change", why: mode === "daily" ? out.summary : out.reply, changes: proposed }).select("id").single();
      proposalId = p?.id ?? null;
    }
    const summary = mode === "daily" ? out.summary : out.reply;
    await admin.from("tr_coach_runs").update({ summary, today_note: out.today_note ?? null, model, usage: { ...res.usage, applied: applied.length, proposed: proposed.length } }).eq("id", runId);
    if (mode === "chat") await admin.from("tr_chat").insert({ role: "assistant", content: out.reply });
    return json({ ok: true, summary, today_note: out.today_note ?? null, applied, proposal_id: proposalId, proposed: proposed.length, model, usage: res.usage });
  } catch (e) {
    const msg = e instanceof Anthropic.RateLimitError ? "Claude is rate-limited — try again in a minute"
      : e instanceof Anthropic.AuthenticationError ? "The ANTHROPIC_API_KEY was rejected — check the Supabase secret"
      : e instanceof Anthropic.APIError ? `Claude API: ${e.message}` : String((e as Error)?.message ?? e);
    if (runId) await admin.from("tr_coach_runs").update({ error: msg }).eq("id", runId);
    return json({ error: msg }, 500);
  }
});
