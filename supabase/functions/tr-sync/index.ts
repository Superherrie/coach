// tr-sync — pulls Garmin data from intervals.icu into the tr_ tables.
//   POST { days?: number, blocks?: number }   (default 10; first run back-fills 180)
//   Each sync also fetches per-block detail (laps / intervals) for up to `blocks` sessions that don't have it yet (default 25),
//   newest first, and refreshes it for sessions from the last 2 days (intervals.icu may still be re-analysing them).
// Auth: a member's JWT (the app's "Sync now") or x-cron-token = TR_CRON_TOKEN (the 05:15 schedule).
// Activities that intervals.icu got from Strava are skipped: Strava does not allow them to be passed on (or to an AI).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const sastToday = () => ymd(new Date(Date.now() + 2 * 3600e3));

function sportOf(t: string): string {
  const s = (t || "").toLowerCase();
  if (s.includes("run")) return "run";                      // Run, TrailRun, VirtualRun
  if (s.includes("ride") || s.includes("cycl")) return "ride"; // Ride, VirtualRide, GravelRide, MountainBikeRide, EBikeRide
  if (s.includes("weight") || s === "workout") return "gym";
  if (s.includes("yoga") || s.includes("pilates") || s.includes("stretch")) return "mobility";
  if (s.includes("walk") || s.includes("hike")) return "walk";
  return "other";
}

// ---- Daniels VDOT (same maths as src/lib/paces.ts) ----
const vo2 = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;
const pctMax = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
const velFor = (target: number) => (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (target + 4.6))) / (2 * 0.000104);
const vdotFrom = (m: number, s: number) => vo2(m / (s / 60)) / pctMax(s / 60);
const spk = (v: number) => Math.round(60000 / v);
function predictT(vdot: number, m: number) { let lo = 60, hi = 108000; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (vdotFrom(m, mid) > vdot) lo = mid; else hi = mid; } return Math.round((lo + hi) / 2); }
function pacesFrom(m: number, s: number, source: string, date: string) {
  const v = vdotFrom(m, s), mar = predictT(v, 42195);
  return { vdot: Math.round(v * 10) / 10, source, date, easy: [spk(velFor(v * 0.70)), spk(velFor(v * 0.62))], marathon: Math.round(mar / 42.195),
    threshold: spk(velFor(v * 0.88)), interval: spk(velFor(v * 0.975)), predict: { "10 km": predictT(v, 10000), "Half": predictT(v, 21097), "Marathon": mar, "50 km": predictT(v, 50000) } };
}

// ---- per-block detail (laps / work + recovery intervals) from intervals.icu ----
const r1 = (x: unknown, d = 0) => (x == null || x === "" || !isFinite(Number(x)) ? null : Math.round(Number(x) * 10 ** d) / 10 ** d);
const spkm = (mps: unknown) => (mps && Number(mps) > 0.5 ? Math.round(1000 / Number(mps)) : null);   // m/s → s per km
// deno-lint-ignore no-explicit-any
export function blocksOf(d: any, sport: string) {
  const run = sport === "run";
  // deno-lint-ignore no-explicit-any
  const blocks = ((d.icu_intervals ?? []) as any[]).filter((i) => Number(i.moving_time) >= 20).map((i, n) => {
    const b: Record<string, unknown> = {
      n: n + 1, type: i.type ?? null, label: i.label || null, start_s: r1(i.start_time), min: r1(Number(i.moving_time) / 60, 1),
      km: i.distance ? r1(Number(i.distance) / 1000, 2) : null,
      hr: r1(i.average_heartrate), min_hr: r1(i.min_heartrate), max_hr: r1(i.max_heartrate),
      cad: r1(i.average_cadence), elev_m: r1(i.total_elevation_gain), grad: r1(i.average_gradient, 1),
      resp: r1(i.average_respiration, 1), decoupling: r1(i.decoupling, 1), zone: i.zone ?? null, intensity: r1(i.intensity), load: r1(i.training_load),
    };
    if (run) { b.pace_s = spkm(i.average_speed); b.gap_s = spkm(i.gap); b.stride_m = r1(i.average_stride, 2); }
    else { b.w = r1(i.average_watts); b.np = r1(i.weighted_average_watts); b.max_w = r1(i.max_watts); b.torque = r1(i.average_torque, 1); b.kmh = i.average_speed ? r1(Number(i.average_speed) * 3.6, 1) : null; }
    if (b.hr && (b.w || b.pace_s)) b.ef = b.w ? r1(Number(b.w) / Number(b.hr), 2) : r1((60000 / Number(b.pace_s)) / Number(b.hr), 2);   // W per beat, or m/min per beat
    for (const k of Object.keys(b)) if (b[k] == null) delete b[k];
    return b;
  });
  const extras: Record<string, unknown> = {
    hr_recovery: d.icu_hrr ?? null, variability_index: r1(d.icu_variability_index, 2), power_hr: r1(d.icu_power_hr, 2),
    power_hr_z2: r1(d.icu_power_hr_z2, 2), trimp: r1(d.trimp), warmup_s: d.icu_warmup_time ?? null, cooldown_s: d.icu_cooldown_time ?? null,
    cadence: r1(d.average_cadence), temp_c: r1(d.average_temp, 1), feels_like_c: r1(d.average_feels_like, 1), joules_above_ftp: d.icu_joules_above_ftp ?? null,
    max_wbal_depletion: d.icu_max_wbal_depletion ?? null, rolling_ftp: d.icu_rolling_ftp ?? null, stride_m: r1(d.average_stride, 2),
    vertical_ratio: r1(d.average_vertical_ratio, 1), ground_contact_ms: r1(d.average_stance_time), summary: d.interval_summary ?? null,
    strain: r1(d.strain_score), lap_count: d.icu_lap_count ?? null,
  };
  for (const k of Object.keys(extras)) if (extras[k] == null) delete extras[k];
  return { blocks, extras };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const cron = Deno.env.get("TR_CRON_TOKEN");
  const byCron = !!cron && req.headers.get("x-cron-token") === cron;
  const body = await req.json().catch(() => ({}));
  // who to sync: the signed-in member, or (schedule) every member with intervals.icu connected — or one given user_id
  let users: string[];
  if (byCron) {
    if (body.user_id) users = [String(body.user_id)];
    else users = [...new Set(((await admin.from("tr_secrets").select("user_id").eq("name", "icu_api_key")).data ?? []).map((r) => r.user_id as string))];
  } else {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await asUser.rpc("tr_is_member")).data) return json({ error: "not a member" }, 403);
    const { data: u } = await asUser.auth.getUser();
    users = [u.user!.id];
  }
  const results: Record<string, unknown>[] = [];
  for (const uid of users) {
    const r = await syncOne(admin, uid, body, byCron ? "cron" : "app");
    results.push(r);
  }
  if (!byCron) { const r = results[0] as { error?: string; code?: string }; return r.error ? json(r, r.code === "bad_key" || r.code === "no_key" ? 400 : 500) : json(r); }
  return json(users.length === 1 ? results[0] : { ok: true, users: results });
});

// deno-lint-ignore no-explicit-any
async function syncOne(admin: any, uid: string, body: Record<string, unknown>, kind: string): Promise<Record<string, unknown>> {
  try {
    const { data: settings } = await admin.from("tr_settings").select("*").eq("user_id", uid).maybeSingle();
    const { data: sec } = await admin.from("tr_secrets").select("value").eq("user_id", uid).eq("name", "icu_api_key").maybeSingle();
    if (!sec?.value) return { error: "intervals.icu is not connected yet — add the API key in Settings", code: "no_key" };
    const athlete = settings?.icu_athlete_id || "0";
    const { count } = await admin.from("tr_activities").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("source", "icu");
    const days = Math.min(400, Number(body.days) || (count ? 10 : 180));
    const newest = sastToday();
    const oldest = ymd(new Date(Date.parse(newest) - days * 864e5));

    const auth = "Basic " + btoa("API_KEY:" + sec.value);
    const icu = async (path: string) => {
      const r = await fetch(`https://intervals.icu/api/v1/athlete/${athlete}${path}`, { headers: { Authorization: auth, Accept: "application/json", "User-Agent": "Mozilla/5.0 (coach app)" } });
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error("intervals.icu rejected the API key or athlete id — check Settings"), { code: "bad_key" });
      if (!r.ok) throw new Error(`intervals.icu ${path.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return r.json();
    };

    // ---- wellness ----
    const well: Record<string, unknown>[] = await icu(`/wellness?oldest=${oldest}&newest=${newest}`);
    const { data: existing } = await admin.from("tr_wellness").select("date,manual").eq("user_id", uid).gte("date", oldest);
    const manualBy = new Map((existing ?? []).map((w) => [w.date, (w.manual ?? {}) as Record<string, boolean>]));
    const wRows = well.map((w) => {
      const date = String(w.id);
      const man = manualBy.get(date) ?? {};
      const row: Record<string, unknown> = { user_id: uid, date, updated_at: new Date().toISOString() };
      const put = (k: string, v: unknown) => { if (v !== null && v !== undefined && !man[k]) row[k] = v; };
      put("resting_hr", w.restingHR); put("hrv", w.hrv);
      put("sleep_h", w.sleepSecs ? Math.round(Number(w.sleepSecs) / 360) / 10 : null); put("sleep_score", w.sleepScore);
      put("weight_kg", w.weight); put("body_fat", w.bodyFat); put("waist_cm", w.abdomen);
      put("icu_ctl", w.ctl); put("icu_atl", w.atl); put("icu_ramp", w.rampRate);
      return row;
    });
    if (wRows.length) { const { error } = await admin.from("tr_wellness").upsert(wRows, { onConflict: "user_id,date" }); if (error) throw error; }

    // ---- activities ----
    const acts: Record<string, unknown>[] = await icu(`/activities?oldest=${oldest}&newest=${newest}T23:59:59`);
    const usable = acts.filter((a) => String(a.source ?? "").toUpperCase() !== "STRAVA" && a.start_date_local);
    const skippedStrava = acts.length - usable.length;
    const { data: planned } = await admin.from("tr_planned").select("id,date,slot,sport,intensity,title").eq("user_id", uid).gte("date", oldest).lte("date", newest);
    const { data: known } = await admin.from("tr_activities").select("id,sport,slot,planned_id,rpe,notes").eq("user_id", uid).gte("date", oldest).eq("source", "icu");
    const knownBy = new Map((known ?? []).map((k) => [k.id, k]));
    const aRows = usable.map((a) => {
      const id = String(a.id);
      const start = String(a.start_date_local);
      const date = start.slice(0, 10);
      const hour = Number(start.slice(11, 13));
      let sport = sportOf(String(a.type));
      const prev = knownBy.get(id);
      const slot = prev?.slot ?? (hour < 12 ? "am" : "pm");
      // a strength session is legs unless the plan said upper body for that slot (Herman can flip it in the app)
      if (sport === "gym") {
        const p = (planned ?? []).find((p) => p.date === date && p.slot === slot && p.sport.startsWith("gym"));
        sport = prev?.sport?.startsWith("gym") ? prev.sport : (p?.sport ?? "gym_legs");
      }
      const dist = Number(a.distance ?? a.icu_distance ?? 0);
      const moving = Number(a.moving_time ?? a.elapsed_time ?? 0);
      const pace = sport === "run" && dist > 0 ? moving / (dist / 1000) : null;
      const gap = sport === "run" && a.gap ? 1000 / Number(a.gap) : null;          // gap is m/s
      const zones = Array.isArray(a.icu_hr_zone_times) ? (a.icu_hr_zone_times as number[]) : null;
      return {
        id, user_id: uid, source: "icu", date, start_local: start, slot, sport, icu_type: a.type, name: a.name, trainer: a.trainer ?? null,
        duration_s: moving || null, distance_m: dist || null, elev_m: a.total_elevation_gain ?? null,
        avg_hr: a.average_heartrate ?? null, max_hr: a.max_heartrate ?? null,
        avg_watts: a.icu_average_watts ?? null, np_watts: a.icu_weighted_avg_watts ?? null, ftp: a.icu_ftp ?? null,
        avg_pace_s: pace ? Math.round(pace) : null, gap_pace_s: gap ? Math.round(gap) : null,
        load: a.icu_training_load ?? null, intensity: a.icu_intensity ?? null, ef: a.icu_efficiency_factor ?? null,
        decoupling: a.decoupling ?? null, calories: a.calories ?? null, rpe: prev?.rpe ?? a.icu_rpe ?? null, feel: a.feel ?? null, hr_zone_s: zones,
        notes: prev?.notes ?? null, planned_id: prev?.planned_id ?? null,
        raw: { type: a.type, device: a.device_name, source: a.source, lap_count: a.icu_lap_count, kg_lifted: a.kg_lifted, polarization: a.polarization_index },
        updated_at: new Date().toISOString(),
      };
    });

    // match to the plan: same day + slot + sport, else same day + sport
    const taken = new Set(aRows.map((r) => r.planned_id).filter(Boolean));
    for (const r of aRows) {
      if (r.planned_id) continue;
      const day = (planned ?? []).filter((p) => p.date === r.date && !taken.has(p.id));
      const same = (p: { sport: string }) => p.sport === r.sport || (p.sport.startsWith("gym") && r.sport.startsWith("gym")) || (p.sport === "race" && (r.sport === "run" || r.sport === "ride"));
      const hit = day.find((p) => p.slot === r.slot && same(p)) ?? day.find(same);
      if (hit) { r.planned_id = hit.id; r.slot = hit.slot; taken.add(hit.id); }
    }
    if (aRows.length) { const { error } = await admin.from("tr_activities").upsert(aRows, { onConflict: "id" }); if (error) throw error; }
    const doneIds = aRows.map((r) => r.planned_id).filter(Boolean);
    if (doneIds.length) await admin.from("tr_planned").update({ status: "done" }).in("id", doneIds);

    // per-block detail: recent sessions (last 2 days) are refreshed, then older ones without it, newest first
    let blocksFetched = 0;
    {
      const limit = Math.min(200, Number(body.blocks ?? 25));
      const { data: need } = await admin.from("tr_activities").select("id,sport,date,blocks_at").eq("user_id", uid).eq("source", "icu")
        .or(`blocks_at.is.null,date.gte.${ymd(new Date(Date.parse(newest) - 2 * 864e5))}`).order("date", { ascending: false }).limit(limit);
      for (const a of need ?? []) {
        const r = await fetch(`https://intervals.icu/api/v1/activity/${a.id}?intervals=true`, { headers: { Authorization: auth, Accept: "application/json", "User-Agent": "Mozilla/5.0 (coach app)" } });
        if (r.status === 429) break;                       // rate-limited: the next sync carries on
        if (!r.ok) { await admin.from("tr_activities").update({ blocks_at: new Date().toISOString(), blocks: [] }).eq("id", a.id); continue; }
        const { blocks, extras } = blocksOf(await r.json(), a.sport);
        await admin.from("tr_activities").update({ blocks, extras, blocks_at: new Date().toISOString() }).eq("id", a.id);
        blocksFetched++;
      }
    }

    // anything planned before today with no session against it counts as skipped (rest days stay as they are)
    const { data: linked } = await admin.from("tr_activities").select("planned_id").eq("user_id", uid).gte("date", oldest).not("planned_id", "is", null);
    const linkedIds = new Set((linked ?? []).map((l) => l.planned_id));
    const missed = (planned ?? []).filter((p) => p.date < newest && p.sport !== "rest" && !linkedIds.has(p.id)).map((p) => p.id);
    if (missed.length) await admin.from("tr_planned").update({ status: "skipped" }).in("id", missed).eq("status", "planned");

    // a time trial or running race just synced → new training paces (Daniels VDOT), if it's newer than what's set
    let pacesUpdated: string | null = null;
    const { data: tests } = await admin.from("tr_planned").select("id,title,sport,date").eq("user_id", uid).in("id", doneIds.length ? doneIds : [-1]);
    for (const t of (tests ?? []).filter((t) => /time trial/i.test(t.title) || t.sport === "race")) {
      const a = aRows.find((r) => r.planned_id === t.id && r.sport === "run" && (r.distance_m ?? 0) >= 4900 && r.duration_s);
      if (!a) continue;
      const cur = settings?.paces as { date?: string } | null;
      if (cur?.date && cur.date >= a.date && !/target|estimate/.test(String((cur as { source?: string }).source ?? ""))) continue;
      const p = pacesFrom(Number(a.distance_m), Number(a.duration_s), `${t.title} on ${a.date} (${Math.round(Number(a.distance_m) / 100) / 10} km in ${Math.floor(Number(a.duration_s) / 60)}:${String(Number(a.duration_s) % 60).padStart(2, "0")})`, a.date);
      await admin.from("tr_settings").update({ paces: p }).eq("user_id", uid);
      pacesUpdated = `VDOT ${p.vdot}`;
    }

    // automatic reports for new long / hard sessions (not during a big back-fill; at most 3 per sync)
    let reports = 0;
    if (days <= 14) {
      const fresh = aRows.filter((r) => !knownBy.has(r.id));
      const qualifies = (r: typeof aRows[number]) => {
        const p = (planned ?? []).find((x) => x.id === r.planned_id);
        const min = (r.duration_s ?? 0) / 60, km = (r.distance_m ?? 0) / 1000;
        return (r.sport === "run" && (min >= 75 || km >= 18)) || (r.sport === "ride" && min >= 150)
          || (!!p && ["hard", "race"].includes(String(p.intensity)) && (r.sport === "run" || r.sport === "ride"));
      };
      for (const r of fresh.filter(qualifies).slice(0, 3)) {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/tr-report`, { method: "POST",
          headers: { "Content-Type": "application/json", "x-cron-token": Deno.env.get("TR_CRON_TOKEN")! }, body: JSON.stringify({ user_id: uid, activity_id: r.id }) });
        if (res.ok) reports++;
      }
    }

    // a session imported earlier from Strava history and now delivered by Garmin: keep the Garmin copy
    const { data: deduped } = await admin.rpc("tr_dedupe_strava", { p_user: uid });

    const detail = { oldest, newest, wellness: wRows.length, activities: aRows.length, skipped_strava: skippedStrava, missed: missed.length, replaced_strava: deduped ?? 0, paces_updated: pacesUpdated, reports, blocks: blocksFetched };
    await admin.from("tr_sync_log").insert({ user_id: uid, kind, ok: true, detail });
    return { ok: true, ...detail };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    await admin.from("tr_sync_log").insert({ user_id: uid, kind: "error", ok: false, detail: { error: msg } });
    return { error: msg, code: (e as { code?: string }).code };
  }
}
