// Loads Strava history (exported through the Strava connector into scripts/data/strava-*.json) into tr_activities.
//   node scripts/import-strava.mjs          → dry run: weekly summary
//   node scripts/import-strava.mjs --apply  → upsert (re-runnable; Garmin rows from intervals.icu replace these later)
// Load is TSS-like so it sits on the same scale as intervals.icu:
//   rides with power: hours × (NP/FTP)² × 100, FTP 310 W except 325 W between the 4 Aug and 10 Sep 2026 tests
//   runs / rides without power: hrTSS-style hours × (avgHR/LTHR)² × 100, LTHR 165 run / 155 ride
//   walks and other easy activity: hours × 0.5² × 100;  weight training: left empty (app estimates from minutes × RPE)
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) process.env[m[1]] ??= m[2]; }
const APPLY = process.argv.includes('--apply');
const dir = join(here, 'data');
const rows = readdirSync(dir).filter(f => /^strava-.*\.json$/.test(f)).flatMap(f => JSON.parse(readFileSync(join(dir, f), 'utf8').replace(/^﻿/, '')));

const ftpOn = d => (d >= '2026-08-04' && d < '2026-09-10' ? 325 : 310);
const sportOf = t => /run/i.test(t) ? 'run' : /ride/i.test(t) ? 'ride' : /weight/i.test(t) ? 'gym_legs' : /walk|hike/i.test(t) ? 'walk' : 'other';

const seen = new Set();
const out = [];
for (const a of rows) {
  if (seen.has(a.id)) continue; seen.add(a.id);
  const sport = sportOf(a.sport_type);
  const date = a.start_local.slice(0, 10), hour = +a.start_local.slice(11, 13);
  const h = (a.moving_s ?? 0) / 3600;
  const np = a.weighted_avg_watts ?? a.avg_watts;
  const ftp = ftpOn(date);
  let load = null, intensity = null;
  if (sport === 'ride' && a.has_power && np) { intensity = Math.round((np / ftp) * 100); load = Math.round(h * (np / ftp) ** 2 * 100) }
  else if ((sport === 'run' || sport === 'ride') && a.avg_hr) { const lthr = sport === 'run' ? 165 : 155; load = Math.round(h * (a.avg_hr / lthr) ** 2 * 100) }
  else if (sport === 'walk' || sport === 'other') load = Math.round(h * 25);
  const pace = sport === 'run' && a.distance_m > 0 && a.moving_s ? Math.round(a.moving_s / (a.distance_m / 1000)) : null;
  out.push({
    id: `s-${a.id}`, source: 'strava', strava_id: a.id, date, start_local: a.start_local, slot: hour < 12 ? 'am' : 'pm', sport,
    name: a.name, trainer: a.trainer ?? null, duration_s: a.moving_s ?? null, distance_m: a.distance_m || null, elev_m: a.elev_m ?? null,
    avg_hr: a.has_hr ? (a.avg_hr != null ? Math.round(a.avg_hr) : null) : null, max_hr: a.has_hr ? a.max_hr ?? null : null,
    // watts and EF only for rides (runs carry Stryd-style running power, a different scale)
    avg_watts: sport === 'ride' && a.has_power && a.avg_watts ? Math.round(a.avg_watts) : null, np_watts: sport === 'ride' && a.has_power && a.weighted_avg_watts ? Math.round(a.weighted_avg_watts) : null,
    ftp: sport === 'ride' ? ftp : null, avg_pace_s: pace, load, intensity,
    ef: sport === 'ride' && a.has_power && a.has_hr && np && a.avg_hr ? +(np / a.avg_hr).toFixed(2) : null,
    rpe: a.perceived_exertion ?? null,
    raw: { sport_type: a.sport_type, relative_effort: a.relative_effort, calories: a.calories, cadence: a.avg_cadence, laps: a.laps, from: 'strava-connector' },
    updated_at: new Date().toISOString(),
  });
}
out.sort((a, b) => a.start_local.localeCompare(b.start_local));

const wk = new Map();
for (const r of out) {
  const d = new Date(r.date + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = d.toISOString().slice(0, 10);
  const w = wk.get(k) ?? { n: 0, h: 0, runKm: 0, load: 0, noLoad: 0 }; wk.set(k, w);
  w.n++; w.h += (r.duration_s ?? 0) / 3600; if (r.sport === 'run') w.runKm += (r.distance_m ?? 0) / 1000; w.load += r.load ?? 0; if (r.load == null && r.sport !== 'gym_legs') w.noLoad++;
}
for (const [k, w] of wk) console.log(k, `${String(w.n).padStart(2)} sessions  ${w.h.toFixed(1).padStart(4)} h  run ${w.runKm.toFixed(0).padStart(3)} km  load ${String(w.load).padStart(4)}${w.noLoad ? `  (${w.noLoad} without load)` : ''}`);
const by = s => out.filter(r => r.sport === s).length;
console.log(`${out.length} activities: ${by('ride')} rides (${out.filter(r => r.sport === 'ride' && r.avg_watts).length} with power), ${by('run')} runs, ${by('gym_legs')} gym, ${by('walk')} walks, ${by('other')} other`);

if (APPLY) {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // keep anything Herman already added (RPE, notes, plan link) on a re-import
  const { data: prev } = await db.from('tr_activities').select('id,rpe,notes,planned_id,sport').eq('source', 'strava');
  const p = new Map((prev ?? []).map(x => [x.id, x]));
  const rowsIn = out.map(r => { const x = p.get(r.id); return x ? { ...r, rpe: x.rpe ?? r.rpe, notes: x.notes, planned_id: x.planned_id, sport: x.sport?.startsWith('gym') ? x.sport : r.sport } : r });
  for (let i = 0; i < rowsIn.length; i += 200) { const { error } = await db.from('tr_activities').upsert(rowsIn.slice(i, i + 200), { onConflict: 'id' }); if (error) throw error; }
  // match this week's planned sessions (the plan starts 17 Nov)
  const { data: planned } = await db.from('tr_planned').select('id,date,slot,sport').gte('date', out[0]?.date ?? '2026-01-01');
  let linked = 0;
  for (const r of rowsIn) {
    const hit = (planned ?? []).find(pp => pp.date === r.date && (pp.sport === r.sport || (pp.sport === 'race' && r.sport === 'ride')));
    if (hit && !r.planned_id) { await db.from('tr_activities').update({ planned_id: hit.id, slot: hit.slot }).eq('id', r.id); await db.from('tr_planned').update({ status: 'done' }).eq('id', hit.id); linked++ }
  }
  console.log(`applied ${rowsIn.length} activities; linked ${linked} to the plan`);
}
