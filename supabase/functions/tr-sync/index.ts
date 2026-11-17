// tr-sync — pulls Garmin data from intervals.icu into the tr_ tables.
//   POST { days?: number }   (default 10; first run back-fills 180)
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
    const { data: planned } = await admin.from("tr_planned").select("id,date,slot,sport").eq("user_id", uid).gte("date", oldest).lte("date", newest);
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

    // anything planned before today with no session against it counts as skipped (rest days stay as they are)
    const { data: linked } = await admin.from("tr_activities").select("planned_id").eq("user_id", uid).gte("date", oldest).not("planned_id", "is", null);
    const linkedIds = new Set((linked ?? []).map((l) => l.planned_id));
    const missed = (planned ?? []).filter((p) => p.date < newest && p.sport !== "rest" && !linkedIds.has(p.id)).map((p) => p.id);
    if (missed.length) await admin.from("tr_planned").update({ status: "skipped" }).in("id", missed).eq("status", "planned");

    // a session imported earlier from Strava history and now delivered by Garmin: keep the Garmin copy
    const { data: deduped } = await admin.rpc("tr_dedupe_strava", { p_user: uid });

    const detail = { oldest, newest, wellness: wRows.length, activities: aRows.length, skipped_strava: skippedStrava, missed: missed.length, replaced_strava: deduped ?? 0 };
    await admin.from("tr_sync_log").insert({ user_id: uid, kind, ok: true, detail });
    return { ok: true, ...detail };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    await admin.from("tr_sync_log").insert({ user_id: uid, kind: "error", ok: false, detail: { error: msg } });
    return { error: msg, code: (e as { code?: string }).code };
  }
}
