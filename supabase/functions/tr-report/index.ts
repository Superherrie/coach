// tr-report — automatic analysis of a long run, long ride, race or quality session.
//   POST { activity_id }                 (app: "Analyse" button; signed-in user)
//   POST { activity_id, user_id } + cron (called by tr-sync for new qualifying sessions)
// Pulls the laps/intervals and the streams from intervals.icu, computes thirds (pace, HR, power, efficiency), heart-rate
// drift and the fade, then Claude writes a short report against the planned session. Saved in tr_session_reports.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const pace = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km` : null);
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

const Report = z.object({
  headline: z.string().describe("one bold sentence: the single most important finding"),
  verdict: z.enum(["as_planned", "better", "harder_than_planned", "easier_than_planned", "incomplete", "faded"]),
  numbers: z.array(z.object({ label: z.string(), value: z.string() })).describe("3–6 key numbers, e.g. 'Thirds pace' '5:58 / 6:02 / 6:20'"),
  points: z.array(z.string()).describe("2–4 short points: what it means, compared with plan and with the athlete's patterns"),
  next: z.string().nullable().describe("one concrete thing for the next similar session, or null"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const cron = Deno.env.get("TR_CRON_TOKEN");
    const byCron = !!cron && req.headers.get("x-cron-token") === cron;
    const body = await req.json().catch(() => ({}));
    let uid: string;
    if (byCron) uid = String(body.user_id);
    else {
      const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
      uid = (await asUser.auth.getUser()).data.user!.id;
    }
    const { data: act } = await admin.from("tr_activities").select("*").eq("id", String(body.activity_id)).eq("user_id", uid).maybeSingle();
    if (!act) return json({ error: "session not found" }, 404);
    if (act.source !== "icu") return json({ error: "Reports need the Garmin copy from intervals.icu" }, 400);
    const { data: s } = await admin.from("tr_settings").select("icu_athlete_id,ftp_w,paces,coach_model,coach_profile").eq("user_id", uid).maybeSingle();
    const { data: sec } = await admin.from("tr_secrets").select("value").eq("user_id", uid).eq("name", "icu_api_key").maybeSingle();
    if (!sec?.value) return json({ error: "intervals.icu not connected" }, 400);
    const auth = "Basic " + btoa("API_KEY:" + sec.value);
    const get = async (path: string) => {
      const r = await fetch(`https://intervals.icu/api/v1${path}`, { headers: { Authorization: auth, Accept: "application/json", "User-Agent": "Mozilla/5.0 (coach app)" } });
      if (!r.ok) throw new Error(`intervals.icu ${path.split("?")[0]}: HTTP ${r.status}`);
      return r.json();
    };
    const detail = await get(`/activity/${act.id}?intervals=true`);
    const streams = await get(`/activity/${act.id}/streams?types=time,distance,heartrate,watts,velocity_smooth,altitude`) as { type: string; data: number[] }[];
    const st = (t: string) => streams.find((x) => x.type === t)?.data ?? [];
    const T = st("time"), D = st("distance"), HR = st("heartrate"), W = st("watts"), V = st("velocity_smooth"), ALT = st("altitude");

    // thirds by distance (runs) or time (rides): pace / power, HR, efficiency; first-vs-second-half HR drift (decoupling)
    const n = T.length, isRun = act.sport === "run";
    const cut = (k: number) => { if (!n) return 0; if (isRun && D.length) { const total = D[n - 1]; return D.findIndex((d) => d >= (total * k) / 3); } return Math.floor((n * k) / 3); };
    const idx = [0, cut(1), cut(2), n];
    const thirds = [0, 1, 2].map((i) => {
      const a = idx[i], b = Math.max(idx[i + 1], a + 1);
      const secs = (T[b - 1] ?? 0) - (T[a] ?? 0), dist = (D[b - 1] ?? 0) - (D[a] ?? 0);
      const hr = avg(HR.slice(a, b).filter((x) => x > 40)), w = avg(W.slice(a, b).filter((x) => x >= 0));
      const climb = ALT.slice(a, b).reduce((acc, v, j, arr) => acc + (j && v > arr[j - 1] ? v - arr[j - 1] : 0), 0);
      const descent = ALT.slice(a, b).reduce((acc, v, j, arr) => acc + (j && v < arr[j - 1] ? arr[j - 1] - v : 0), 0);
      return { km: Math.round(dist / 100) / 10, min: Math.round(secs / 60), pace: isRun && dist > 0 ? pace(secs / (dist / 1000)) : null,
        hr: hr ? Math.round(hr) : null, watts: !isRun && w ? Math.round(w) : null, ef: !isRun && w && hr ? Math.round((w / hr) * 100) / 100 : isRun && dist && hr ? Math.round(((dist / secs) * 60 / hr) * 1000) / 1000 : null,
        climb_m: Math.round(climb), descent_m: Math.round(descent) };
    });
    const intervals = ((detail.icu_intervals ?? []) as Record<string, number | string>[]).filter((i) => i.type === "WORK").slice(0, 20).map((i) => ({
      min: Math.round(Number(i.moving_time) / 60 * 10) / 10, km: i.distance ? Math.round(Number(i.distance) / 100) / 10 : null,
      watts: i.average_watts ?? null, hr: i.average_heartrate ?? null, max_hr: i.max_heartrate ?? null,
      pace: isRun && i.average_speed ? pace(1000 / Number(i.average_speed)) : null, gap: isRun && i.gap ? pace(1000 / Number(i.gap)) : null,
    }));
    const { data: planned } = act.planned_id ? await admin.from("tr_planned").select("title,description,duration_min,distance_km,intensity,targets").eq("id", act.planned_id).maybeSingle() : { data: null };
    const { data: similar } = await admin.from("tr_activities").select("date,name,duration_s,distance_m,avg_hr,avg_watts,avg_pace_s,decoupling,load").eq("user_id", uid).eq("sport", act.sport)
      .lt("date", act.date).gte("duration_s", Math.round((act.duration_s ?? 0) * 0.7)).order("date", { ascending: false }).limit(5);

    const facts = {
      session: { date: act.date, sport: act.sport, name: act.name, km: act.distance_m ? Math.round(act.distance_m / 100) / 10 : null, min: Math.round((act.duration_s ?? 0) / 60),
        avg_hr: act.avg_hr, max_hr: act.max_hr, avg_watts: act.avg_watts, np: act.np_watts, pace: pace(act.avg_pace_s), gap: pace(act.gap_pace_s), load: act.load,
        decoupling_pct: act.decoupling, ef: act.ef, rpe: act.rpe, notes: act.notes, elev_m: act.elev_m, indoor: act.trainer },
      planned, thirds, work_intervals: intervals, similar_recent_sessions: similar, ftp: s?.ftp_w, paces: s?.paces,
    };
    const client = new Anthropic();
    const model = s?.coach_model || "claude-opus-5-5";
    const res = await client.messages.parse({
      model, max_tokens: 8000, output_config: { effort: "medium", format: zodOutputFormat(Report) },
      system: [{ type: "text", text: `You analyse one training session for an endurance athlete and report on a phone screen: numbers first, short, plain English, no pep talk.\nCheck: planned vs actual (state both), pacing across the thirds (a rising effort in the last third against plan = escalation; a falling pace/power with rising HR = fade), heart-rate drift (decoupling >5% on an easy long session = aerobic limit or heat/fuelling), work intervals vs targets and against each other (flat is the goal), comparison with the recent similar sessions. Note measurement quirks (HR strap spikes, GPS, gearing) when they could explain a number. One session is not a trend.\n\nATHLETE PROFILE\n${s?.coach_profile ?? "(none)"}` }],
      messages: [{ role: "user", content: `SESSION DATA (JSON):\n${JSON.stringify(facts)}` }],
    });
    if (!res.parsed_output) throw new Error(`no report (${res.stop_reason})`);
    const report = { ...res.parsed_output, thirds, intervals };
    await admin.from("tr_session_reports").upsert({ user_id: uid, activity_id: act.id, report, model, usage: res.usage }, { onConflict: "activity_id" });
    await admin.from("tr_coach_runs").insert({ user_id: uid, kind: "report", summary: res.parsed_output.headline, model, usage: res.usage });
    return json({ ok: true, report });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
