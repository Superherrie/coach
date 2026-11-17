// tr-garmin — puts the next 14 days of planned sessions on the athlete's intervals.icu calendar as structured workouts;
// intervals.icu then sends them to the Garmin watch / Edge ("Upload planned workouts" on its Garmin connection).
//   POST {}            → the signed-in user (app button "Send to Garmin")
//   POST {} + cron     → every user with garmin_push on and intervals.icu connected
// Only new or changed sessions are converted (Claude writes the intervals.icu workout text) and pushed; sessions that
// became rest are removed from the calendar. Upserts use uid "coach-<planned id>", so a change replaces the same event.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const sastToday = () => ymd(new Date(Date.now() + 2 * 3600e3));
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s) + n * 864e5));
const fmtPace = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
async function sha(s: string) { const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16); }

const TYPE: Record<string, string> = { run: "Run", ride: "Ride", race: "Run", gym_legs: "WeightTraining", gym_upper: "WeightTraining", mobility: "Workout" };

const Docs = z.object({ workouts: z.array(z.object({ planned_id: z.number().int(), text: z.string().describe("the workout in intervals.icu syntax") })) });

const RULES = `You convert planned training sessions into intervals.icu workout text, which intervals.icu turns into a structured workout on a Garmin watch.
Syntax (follow exactly):
- One step per line, starting with "- ", then optional short cue text, then duration, then target. Durations: 30s, 10m, 1h, 1m30. Distance steps: 2km, 400mtr.
- Power targets for rides: absolute watts "190-215w" (or "250w").
- Heart-rate targets for runs: percent of threshold HR "75-83% LTHR" (threshold HR is 168), or "Z1 HR"/"Z2 HR".
- Pace targets for runs: absolute pace "5:35-5:45/km Pace".
- Repeats: a header line "Main set 6x" followed by the repeated steps (each starting "- "); then a blank line.
- Section headers are plain lines without "- ": "Warmup", "Main set", "Cooldown". Separate sections with a blank line.
- Cadence (rides) optional: "90rpm". Free text is allowed after the target on the same line for cues, but keep it short (watch screens are small).
Rules:
- Use the session's own targets (watts, HR cap, pace) and the athlete's paces given. Easy runs: HR cap → "- 45m 70-83% LTHR" (83% of 168 ≈ 140). Long runs: whole duration as one or a few easy steps; add goal-pace blocks only when the description asks for them.
- Quality sessions: warm-up, the main set with repeats exactly as described, cool-down. Hills/downhill reps: time-based steps with a cue ("- 75s hard uphill Z4 HR"). Strides: "Strides 6x / - 20s fast / - 60s walk".
- Total time should match the session's planned duration (±10%).
- Keep it simple when the description is vague; never invent extra intensity.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const cron = Deno.env.get("TR_CRON_TOKEN");
  const byCron = !!cron && req.headers.get("x-cron-token") === cron;
  const body = await req.json().catch(() => ({}));
  let users: string[];
  if (byCron) {
    const { data } = await admin.from("tr_settings").select("user_id").eq("garmin_push", true);
    users = body.user_id ? [String(body.user_id)] : (data ?? []).map((r) => r.user_id);
  } else {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
    users = [(await asUser.auth.getUser()).data.user!.id];
  }
  const out = [];
  for (const uid of users) out.push(await pushOne(admin, uid, !!body.force));
  return json(users.length === 1 ? out[0] : { ok: true, users: out }, (out[0] as { error?: string })?.error && users.length === 1 ? 400 : 200);
});

// deno-lint-ignore no-explicit-any
async function pushOne(admin: any, uid: string, force: boolean) {
  try {
    const { data: s } = await admin.from("tr_settings").select("icu_athlete_id,ftp_w,paces,coach_model").eq("user_id", uid).maybeSingle();
    const { data: sec } = await admin.from("tr_secrets").select("value").eq("user_id", uid).eq("name", "icu_api_key").maybeSingle();
    if (!sec?.value) return { error: "intervals.icu is not connected — add the API key in Settings" };
    const athlete = s?.icu_athlete_id || "0";
    const auth = "Basic " + btoa("API_KEY:" + sec.value);
    const icu = async (method: string, path: string, payload: unknown) => {
      const r = await fetch(`https://intervals.icu/api/v1/athlete/${athlete}${path}`, { method, headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Mozilla/5.0 (coach app)" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      if (!r.ok) throw new Error(`intervals.icu ${path.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return r.json().catch(() => ({}));
    };

    const today = sastToday(), until = addDays(today, 13);
    const { data: rows, error: rowsErr } = await admin.from("tr_planned").select("id,date,slot,sport,title,description,duration_min,distance_km,intensity,targets,status,icu_event_id,icu_hash,icu_doc")
      .eq("user_id", uid).gte("date", today).lte("date", until).order("date");
    if (rowsErr) throw new Error(`reading the plan: ${rowsErr.message}`);
    const paces = s?.paces as { easy?: number[]; marathon?: number; threshold?: number; interval?: number } | null;
    const paceNote = paces?.easy ? `Athlete paces: easy ${fmtPace(paces.easy[0])}-${fmtPace(paces.easy[1])}/km, marathon ${fmtPace(paces.marathon!)}/km, tempo ${fmtPace(paces.threshold!)}/km, intervals ${fmtPace(paces.interval!)}/km. Comrades goal pace 5:50-6:00/km.` : "No run paces set yet; use heart rate for runs.";

    const live = (rows ?? []).filter((p) => p.sport !== "rest" && p.status !== "skipped");
    const withHash = await Promise.all(live.map(async (p) => ({ p, hash: await sha(JSON.stringify([p.date, p.slot, p.sport, p.title, p.description, p.duration_min, p.distance_km, p.targets, paceNote])) })));
    const changed = withHash.filter((x) => force || x.hash !== x.p.icu_hash);

    // structured text for runs and rides (Claude); gym and mobility go as a described workout
    const needDoc = changed.filter((x) => ["run", "ride", "race"].includes(x.p.sport));
    const docs = new Map<number, string>();
    if (needDoc.length) {
      const client = new Anthropic();
      const res = await client.messages.parse({
        model: s?.coach_model || "claude-opus-5-5", max_tokens: 16000,
        output_config: { effort: "low", format: zodOutputFormat(Docs) },
        system: RULES,
        messages: [{ role: "user", content: `FTP ${s?.ftp_w ?? "?"} W. ${paceNote}\n\nSessions (JSON):\n${JSON.stringify(needDoc.map((x) => ({ planned_id: x.p.id, sport: x.p.sport, title: x.p.title, description: x.p.description, duration_min: x.p.duration_min, distance_km: x.p.distance_km, intensity: x.p.intensity, targets: x.p.targets })))}` }],
      });
      for (const w of res.parsed_output?.workouts ?? []) docs.set(w.planned_id, w.text);
      await admin.from("tr_coach_runs").insert({ user_id: uid, kind: "garmin", summary: `${docs.size} workouts converted`, model: s?.coach_model || "claude-opus-5-5", usage: res.usage });
    }

    const eventFor = (p: { id: number; date: string; slot: string; sport: string; title: string; description: string | null; duration_min: number | null; targets: Record<string, unknown> | null }) => {
      const exercises = (p.targets?.exercises ?? []) as { name: string; sets: number; reps: number; kg: number | null }[];
      const gymText = exercises.length ? exercises.map((e) => `${e.name}: ${e.sets} x ${e.reps}${e.kg ? ` @ ${e.kg} kg` : ""}`).join("\n") : "";
      const text = docs.get(p.id) ?? p.icu_doc ?? [p.description ?? "", gymText].filter(Boolean).join("\n\n");
      return {
        category: p.sport === "race" ? "RACE_A" : "WORKOUT",
        start_date_local: `${p.date}T${p.slot === "am" ? "06:00:00" : "17:00:00"}`, type: TYPE[p.sport] ?? "Workout",
        name: p.title, description: text, moving_time: p.duration_min ? p.duration_min * 60 : undefined,
      };
    };

    // what is on the intervals.icu calendar now. intervals.icu ignores our own uid / external_id, so events are
    // tracked by its event id (tr_planned.icu_event_id); "ours" = tracked ids, or same date + same name as a session.
    type Ev = { id: number; name: string; start_date_local: string; push_errors?: unknown[] };
    const cal = (await icu("GET", `/events?oldest=${today}&newest=${until}T23:59:59`, undefined)) as Ev[];
    const tracked = new Set((rows ?? []).map((p) => p.icu_event_id).filter(Boolean));
    const key = (d: string, n: string) => `${d.slice(0, 10)}|${n}`;
    const liveKeys = new Map(live.map((p) => [key(p.date, p.title), p]));
    const allKeys = new Set((rows ?? []).map((p) => key(p.date, p.title)));
    const keep = new Map<number, number>();          // planned id -> event id to keep
    const doomed: number[] = [];
    for (const e of cal ?? []) {
      const ours = tracked.has(e.id) || allKeys.has(key(e.start_date_local, e.name));
      if (!ours) continue;                                                     // Herman's own events: never touched
      const owner = (rows ?? []).find((p) => p.icu_event_id === e.id) ?? liveKeys.get(key(e.start_date_local, e.name));
      if (owner && owner.sport !== "rest" && owner.status !== "skipped" && !keep.has(owner.id)) keep.set(owner.id, e.id);
      else doomed.push(e.id);                                                  // duplicate, or the session is now rest/skipped
    }
    let pushed = 0; const errors: string[] = [];
    const record = async (x: { p: { id: number; date: string; title: string }; hash: string }, e: Ev) => {
      const err = e.push_errors?.length ? JSON.stringify(e.push_errors).slice(0, 300) : null;
      if (err) errors.push(`${x.p.date} ${x.p.title}: ${err}`);
      await admin.from("tr_planned").update({ icu_event_id: e.id, icu_hash: x.hash, icu_doc: docs.get(x.p.id) ?? null, icu_pushed_at: new Date().toISOString(), icu_error: err }).eq("id", x.p.id);
      pushed++;
    };
    // changed sessions with an event already: update that event in place
    for (const x of changed.filter((c) => keep.has(c.p.id))) {
      const e = await icu("PUT", `/events/${keep.get(x.p.id)}`, eventFor(x.p)) as Ev;
      await record(x, e);
    }
    // unchanged sessions whose tracked id was lost: just re-link
    for (const x of withHash.filter((c) => !changed.includes(c) && keep.has(c.p.id) && keep.get(c.p.id) !== c.p.icu_event_id)) {
      await admin.from("tr_planned").update({ icu_event_id: keep.get(x.p.id) }).eq("id", x.p.id);
    }
    // sessions with no event yet: create them in one go (the reply keeps our order)
    const fresh = withHash.filter((c) => !keep.has(c.p.id));
    if (fresh.length) {
      const res = await icu("POST", "/events/bulk?upsertOnUid=false&updatePlanApplied=false", fresh.map((x) => eventFor(x.p))) as Ev[];
      for (const [i, e] of (res ?? []).entries()) if (fresh[i]) await record(fresh[i], e);
    }
    if (doomed.length) await icu("PUT", "/events/bulk-delete", doomed.map((id) => ({ id })));
    const gone = (rows ?? []).filter((p) => p.icu_event_id && (p.sport === "rest" || p.status === "skipped"));
    for (const p of gone) await admin.from("tr_planned").update({ icu_event_id: null, icu_hash: null, icu_pushed_at: null }).eq("id", p.id);
    await admin.from("tr_sync_log").insert({ user_id: uid, kind: "garmin", ok: !errors.length, detail: { pushed, removed: doomed.length, unchanged: live.length - pushed, errors } });
    return { ok: true, pushed, removed: doomed.length, unchanged: live.length - pushed, errors };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    await admin.from("tr_sync_log").insert({ user_id: uid, kind: "garmin", ok: false, detail: { error: msg } });
    return { error: msg };
  }
}
