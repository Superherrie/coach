// Seeds tr_phases, tr_events and the day-by-day tr_planned from the "Comrades 2027 — Sub-9 Training Plan" doc
// (phases, km ceilings, races, strength rules) and the Ride Joburg race week from the coach skill.
//   node scripts/seed-plan.mjs          → dry run: prints a week-by-week summary
//   node scripts/seed-plan.mjs --apply  → replaces phases/events and every SEED session from 17 Nov 2026 on
//                                          (sessions the coach or Herman changed are kept)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) process.env[m[1]] ??= m[2];
}
const APPLY = process.argv.includes('--apply');

const ymd = d => d.toISOString().slice(0, 10);
const add = (s, n) => ymd(new Date(Date.parse(s) + n * 864e5));
const dow = s => (new Date(s).getUTCDay() + 6) % 7;            // 0 = Monday
const IF = { rest: 0, recovery: 0.6, easy: 0.7, moderate: 0.8, hard: 0.88, race: 0.92 };
const load = (min, intensity, sport) => Math.round((min / 60) * 100 * IF[intensity] ** 2 * (sport === 'gym_upper' ? 0.3 : sport === 'gym_legs' ? 0.7 : 1));
const EASY_PACE = 6.4, Q_PACE = 6.0;                         // min/km planning estimates until the 10 km TT

// ---------------- phases (from the doc) ----------------
const PHASES = [
  { name: 'Ride Joburg race week', start_date: '2026-11-16', end_date: '2026-11-22', focus: 'Taper and race — cycling first', run_km_from: 0, run_km_to: 0, long_run_from: null, long_run_to: null, leg_sessions: '0', key_sessions: 'Race-week openers; Ride Joburg Sun 22 Nov', strength_emphasis: 'No leg gym in race week' },
  { name: 'Rebuild', start_date: '2026-11-23', end_date: '2027-01-03', focus: 'Recovery from Ride Joburg, then run frequency and tendon load', run_km_from: 30, run_km_to: 55, long_run_from: 12, long_run_to: 22, leg_sessions: '2', key_sessions: '4–5 runs; 2 easy rides; 10 km time trial ~13 Dec; strength twice a week', strength_emphasis: 'Build to heavy while running volume is low' },
  { name: 'Base and qualifier', start_date: '2027-01-04', end_date: '2027-02-21', focus: 'Aerobic volume, hills', run_km_from: 55, run_km_to: 75, long_run_from: 25, long_run_to: 32, leg_sessions: '2', key_sessions: 'Weekly hill session and tempo run; Johnson Crane 21 km (24 Jan); Joburg North City 42 km (7 Feb)', strength_emphasis: 'Heavy maximum strength (3–5 × 3–6); skip Joburg North City race week' },
  { name: 'Cancún', start_date: '2027-02-22', end_date: '2027-02-28', focus: 'Recovery', run_km_from: 30, run_km_to: 40, long_run_from: null, long_run_to: null, leg_sessions: '0–1', key_sessions: 'Easy running only', strength_emphasis: 'Bodyweight only' },
  { name: 'Strength-endurance', start_date: '2027-03-01', end_date: '2027-04-04', focus: 'Marathon pace, downhill', run_km_from: 75, run_km_to: 95, long_run_from: 32, long_run_to: 42, leg_sessions: '2', key_sessions: 'Downhill repeats; marathon-pace runs; optional Vaal or Edenvale (7 Mar)', strength_emphasis: 'Heavy plus slow eccentrics; add short plyometrics' },
  { name: 'Ultra-specific', start_date: '2027-04-05', end_date: '2027-05-16', focus: 'Comrades-specific', run_km_from: 95, run_km_to: 115, long_run_from: 45, long_run_to: 60, leg_sessions: '1–2', key_sessions: 'Loskop 50 km (24 Apr); long runs ending at goal pace (5:50–6:00/km) on downhill routes; back-to-backs', strength_emphasis: 'Maintenance: heavy, 2–3 sets; skip Loskop week' },
  { name: 'Taper', start_date: '2027-05-17', end_date: '2027-06-13', focus: 'Freshness', run_km_from: 80, run_km_to: 40, long_run_from: 25, long_run_to: 15, leg_sessions: '1, then none', key_sessions: 'Short race-pace efforts; travel Fri 11 Jun', strength_emphasis: 'Light; last session about 10 days before Comrades' },
];
const EVENTS = [
  { date: '2026-11-22', name: '947 Ride Joburg', kind: 'race', distance_km: 97, purpose: 'Cycling goal race', target: '2:55 (PB 3:04:57)', entry_status: 'Entered, Batch B' },
  { date: '2026-12-13', name: '10 km time trial', kind: 'test', distance_km: 10, purpose: 'Sets training paces', target: 'Even effort, solo', on_track: 'Sets training paces' },
  { date: '2027-01-24', name: 'Johnson Crane, Benoni', kind: 'race', distance_km: 21.1, purpose: 'Fitness benchmark', target: 'Race effort', on_track: '≤ 1:45', borderline: '1:45–1:52', rethink: '> 1:52', entry_status: 'Not open' },
  { date: '2027-02-07', name: 'Joburg North City, Emmarentia', kind: 'race', distance_km: 42.2, purpose: 'Comrades qualifier', target: '3:55–4:05, controlled', on_track: '≤ 4:05 and felt controlled', borderline: '4:05–4:15', rethink: '> 4:15 or a struggle', entry_status: 'Open' },
  { date: '2027-02-22', name: 'Cancún', kind: 'travel', purpose: 'Recovery week (22–28 Feb)', target: 'Easy running only' },
  { date: '2027-03-07', name: 'Vaal or Edenvale marathon (optional)', kind: 'race', distance_km: 42.2, purpose: 'Optional seeding upgrade', target: 'Only if fresh', entry_status: 'Not open' },
  { date: '2027-04-24', name: 'Loskop, Middelburg to Loskop Dam', kind: 'race', distance_km: 50, purpose: 'Key ultra, Comrades rehearsal', target: '4:40–4:50', on_track: '≤ 4:45', borderline: '4:45–4:55', rethink: '> 5:00', entry_status: 'Not open' },
  { date: '2027-05-15', name: 'Body-weight checkpoint', kind: 'checkpoint', purpose: 'Mid-May weight', on_track: '≤ 91 kg', borderline: '91–93 kg', rethink: '> 93 kg' },
  { date: '2027-06-13', name: 'Comrades Down Run (centenary)', kind: 'race', distance_km: 91, purpose: 'Goal race — Bill Rowan', target: 'Sub-9 (~5:56/km)', entry_status: 'Entered' },
];
const RACE_WEEKS = ['2027-01-24', '2027-02-07', '2027-04-24', '2027-06-13'];   // no leg gym within 5 days before
const RECOVERY_WEEKS = ['2027-01-25', '2027-02-08', '2027-03-22', '2027-04-26'];   // Monday dates (~30% less)
// hand-set [run km ceiling, long run km] where a straight ramp would jump too fast (≤ ~10%/week, easing back after races and Cancún)
const WEEK = {
  '2026-12-07': [30, 12], '2026-12-14': [36, 10], '2026-12-21': [42, 16], '2026-12-28': [38, 14],
  '2027-01-04': [48, 18], '2027-01-11': [55, 22], '2027-02-08': [42, 16], '2027-02-15': [62, 28],
  '2027-03-01': [62, 26], '2027-03-08': [72, 30], '2027-03-29': [88, 38], '2027-04-26': [55, 22],
  '2027-05-03': [100, 45], '2027-05-10': [112, 56],      // peak week, then the taper
};

// ---------------- session builders ----------------
const S = (sport, title, description, duration_min, intensity, extra = {}) => ({ sport, title, description, duration_min, intensity, distance_km: extra.distance_km ?? null, targets: { hr_max: null, pace: null, watts: null, exercises: null, ...(extra.targets ?? {}) }, planned_load: load(duration_min ?? 0, intensity, sport) });
const REST = () => S('rest', 'Rest', 'Rest. Walk, stretch, sleep.', 0, 'rest');
const easyRun = (km, note = '') => S('run', `Easy run ${km} km`, `Conversational pace, HR under the easy cap the whole way. Flat or rolling route.${note}`, Math.round(km * EASY_PACE), 'easy', { distance_km: km, targets: { hr_max: 140 } });
const easyRide = (min) => S('ride', `Easy ride ${min} min`, `Easy spin, 190–215 W, HR under 135. Indoors on the Kickr is fine. Recovery volume, not training.`, min, 'easy', { targets: { watts: '190–215 W', hr_max: 135 } });
const upper = () => S('gym_upper', 'Upper body (recovery)', 'Moderate loads, 2–3 sets of 10–12, stop 3 reps short of failure. Push, pull, overhead press, rows, core. Must not leave you tired.', 40, 'recovery', { targets: { exercises: [
  { name: 'Bench or push-up', sets: 3, reps: 10, kg: null }, { name: 'Seated row', sets: 3, reps: 12, kg: null }, { name: 'Overhead press', sets: 2, reps: 10, kg: null }, { name: 'Lat pull-down', sets: 2, reps: 12, kg: null }, { name: 'Plank / dead bug', sets: 3, reps: 1, kg: null }] } });
function legs(phase, variant, light = false) {
  const scheme = light ? [3, 8] : phase === 'Rebuild' ? [3, 6] : phase === 'Base and qualifier' ? [4, 5] : phase === 'Strength-endurance' ? [3, 5] : [2, 5];
  const [sets, reps] = scheme;
  const ecc = phase === 'Strength-endurance' || phase === 'Ultra-specific' ? ' Lower every rep for 3 seconds.' : '';
  const plyo = phase === 'Strength-endurance' ? ' Finish with 3 × 5 box jumps or bounds.' : '';
  const A = [{ name: 'Back squat', sets, reps, kg: null }, { name: 'Romanian deadlift', sets, reps, kg: null }, { name: 'Calf raise, straight knee', sets: 3, reps: 10, kg: null }, { name: 'Calf raise, bent knee', sets: 3, reps: 12, kg: null }];
  const B = [{ name: 'Bulgarian split squat', sets, reps, kg: null }, { name: 'Eccentric step-down', sets: 3, reps: 8, kg: null }, { name: 'Trap-bar deadlift', sets, reps, kg: null }, { name: 'Calf raise, straight knee', sets: 3, reps: 10, kg: null }];
  const title = light ? `Legs ${variant} (technique)` : `Legs ${variant} (heavy)`;
  const desc = (light ? 'Technique and moderate loads only — nothing that leaves you sore for the next run.' : `Heavy and low-rep: pick a load you could lift 2 more times than prescribed.${ecc}${plyo}`) + ' At least 6 hours after the morning run. Log the kg so the strength trend works.';
  return S('gym_legs', title, desc, 55, light ? 'easy' : 'moderate', { targets: { exercises: variant === 'A' ? A : B } });
}
function quality(phase, kind, km) {
  const min = Math.round(km * Q_PACE);
  const T = {
    strides: ['Easy + strides', `${km} km easy, then 6 × 20 s relaxed strides with full walk-back recovery.`, 'easy'],
    hills: ['Hill repeats', `Warm up 15 min easy. ${phase === 'Rebuild' ? '6–8' : '8–12'} × 75 s uphill at hard-but-controlled effort, jog down. Cool down 10 min. Stop if form breaks or the ankle complains. Press the lap button for each rep.`, 'hard'],
    tempo: ['Tempo run', `Warm up 15 min. ${phase === 'Base and qualifier' ? '25–35' : '20–25'} min at comfortably hard (HR roughly 150–160 until the TT sets paces). Cool down 10 min. Stopping rule: if HR passes 165 before halfway, finish at easy pace. Lap button on.`, 'hard'],
    downhill: ['Downhill repeats', 'Warm up 15 min. 6–10 × 2–3 min on a steady downhill at goal-pace-or-faster, quick light feet, jog back up. Cool down 10 min. Builds the quads for the Down Run. Lap button on.', 'hard'],
    mp: ['Marathon-pace run', `Warm up 2 km. ${Math.max(8, Math.round(km * 0.6))} km at 5:35–5:45/km. Cool down 2 km. Stopping rule: if pace needs HR over 160 in the first half, drop to easy. Lap button on.`, 'hard'],
    goal: ['Goal-pace run', `Warm up 2 km. ${Math.max(6, Math.round(km * 0.5))} km at 5:50–6:00/km (Comrades pace), rest easy.`, 'moderate'],
  }[kind];
  return S('run', `${T[0]} ${km} km`, T[1], min, T[2], { distance_km: km, targets: { pace: kind === 'mp' ? '5:35–5:45/km' : kind === 'goal' ? '5:50–6:00/km' : null } });
}
function longRun(phase, km) {
  const tail = phase === 'Ultra-specific' ? ` Last ${Math.min(15, Math.round(km * 0.25))} km at goal pace 5:50–6:00/km on a downhill-heavy route.` : phase === 'Strength-endurance' ? ' Include long downhills; last 5 km at marathon pace if it feels good.' : '';
  const fuel = km >= 25 ? ' Practise race fuelling: 60 g carbs per hour from the first 30 min.' : '';
  return S('run', `Long run ${km} km`, `Easy and steady, HR under the easy cap for the first two-thirds.${tail}${fuel}`, Math.round(km * EASY_PACE), km >= 30 ? 'moderate' : 'easy', { distance_km: km });
}
const raceDay = (name, km, target) => S('race', name, `Race. ${target}. Pacing discipline over the first third; fuel from the start.`, Math.round(km * 5.9), 'race', { distance_km: km });

// ---------------- build the days ----------------
const plan = [];
const put = (date, slot, s) => plan.push({ date, slot, ...s, source: 'seed', status: 'planned' });
const phaseOf = d => PHASES.find(p => d >= p.start_date && d <= p.end_date);
const lerp = (a, b, t) => a + (b - a) * t;
const r1 = x => Math.round(x);

// Ride Joburg race week (from the coach skill), from today
const RJ = {
  '2026-11-17': S('ride', 'Race-week sharpener 60 min', '15 min easy, 2 × 8 min at 250–260 W (race effort), 3 × 1 min at 330–350 W with 2 min easy, then easy. Stopping rule: if 250 feels hard in the first block, stop after it. Lap button on.', 60, 'moderate', { targets: { watts: '250–260 W' } }),
  '2026-11-18': S('ride', 'Easy ride 45–60 min', '190–215 W with 3 × 20 s spin-ups. Bike check today at the latest.', 50, 'easy', { targets: { watts: '190–215 W' } }),
  '2026-11-19': S('ride', 'Openers 45 min', '3 × 3 min at 290–300 W, 2 × 30 s at about 350 W, rest easy. Carb loading starts today (6–7 g/kg).', 45, 'moderate', { targets: { watts: '290–300 W' } }),
  '2026-11-20': REST(),
  '2026-11-21': S('ride', 'Pre-race openers 30–40 min', '15 min easy, 3 × 1 min at 260–280 W, 2 × 15 s hard, spin home. Kit, bottles and bike ready by evening.', 35, 'easy', { targets: { watts: '260–280 W' } }),
  '2026-11-22': S('race', '947 Ride Joburg', 'Race. First 40 km average HR under 150; climbs 290–300 W max, HR under 155; flats easy in the bunch. 60–80 g carbs/h from 20–30 min.', 175, 'race', { distance_km: 97, targets: { watts: '≤ 300 W on climbs', hr_max: 155 } }),
};
for (const [d, s] of Object.entries(RJ)) { put(d, 'am', s); put(d, 'pm', d === '2026-11-17' ? REST() : REST()); }

// Recovery after Ride Joburg (23 Nov – 6 Dec), from the skill
const REC = {
  '2026-11-23': ['rest', 'upper'], '2026-11-24': ['spin', 'rest'], '2026-11-25': ['rest', 'upper'], '2026-11-26': [easyRun(5, ' First run back — stop if the ankle complains.'), 'rest'],
  '2026-11-27': ['spin', 'rest'], '2026-11-28': [easyRun(6), 'rest'], '2026-11-29': [S('ride', 'Easy ride 60 min', 'Outdoors if you like, social pace, nothing above 215 W.', 60, 'easy'), 'rest'],
  '2026-11-30': ['rest', 'upper'], '2026-12-01': [easyRun(6), legs('Rebuild', 'A', true)], '2026-12-02': [easyRide(60), 'rest'], '2026-12-03': [quality('Rebuild', 'strides', 6), 'rest'],
  '2026-12-04': ['rest', 'upper'], '2026-12-05': [longRun('Rebuild', 10), 'rest'], '2026-12-06': [easyRide(75), 'rest'],
};
const tok = x => x === 'rest' ? REST() : x === 'upper' ? upper() : x === 'spin' ? S('ride', 'Recovery spin 30–40 min', 'Under 170 W, legs only turning over.', 35, 'recovery', { targets: { watts: '< 170 W' } }) : x;
for (const [d, [am, pm]] of Object.entries(REC)) { put(d, 'am', tok(am)); put(d, 'pm', tok(pm)); }

// From Mon 7 Dec: the weekly template
for (let wk = '2026-12-07'; wk <= '2027-06-07'; wk = add(wk, 7)) {
  const ph = phaseOf(wk) ?? phaseOf(add(wk, 6));
  const pStart = Date.parse(ph.start_date), pEnd = Date.parse(ph.end_date);
  const t = Math.min(1, Math.max(0, (Date.parse(wk) - pStart) / Math.max(1, pEnd - pStart - 6 * 864e5)));
  let km = lerp(ph.run_km_from, ph.run_km_to, t);
  let long = ph.long_run_from ? lerp(ph.long_run_from, ph.long_run_to, t) : 0;
  const recovery = RECOVERY_WEEKS.includes(wk);
  if (WEEK[wk]) [km, long] = WEEK[wk];
  else if (recovery) { km *= 0.7; long *= 0.7; }
  const days = [...Array(7)].map((_, i) => add(wk, i));
  const raceIn = RACE_WEEKS.find(r => r >= wk && r <= add(wk, 6));
  const noLegs = !!raceIn || ph.name === 'Cancún' || (ph.name === 'Taper' && wk >= '2027-05-31');
  const name = ph.name;

  if (name === 'Cancún') {
    for (const d of days) { const i = dow(d); put(d, 'am', [1, 3, 5].includes(i) ? easyRun(i === 5 ? 12 : 8, ' Holiday running — easy, early, hydrate.') : i === 6 ? easyRun(6) : REST()); put(d, 'pm', REST()); }
    continue;
  }
  if (name === 'Taper' && wk === '2027-06-07') {           // race week
    const RW = [[REST(), upper()], [easyRun(8, ' Include 4 × 1 min at goal pace.'), REST()], [easyRun(6), REST()], [easyRun(5, ' 3 × 2 min at goal pace.'), REST()],
      [S('rest', 'Travel to Pietermaritzburg', 'Fly Lanseria → King Shaka. Walk, eat carbs (8 g/kg), sleep.', 0, 'rest'), REST()], [easyRun(3, ' 15 min shake-out. Number pickup. Kit laid out.'), REST()],
      [raceDay('Comrades Down Run', 91, 'Sub-9: first 50 km ≈ 4:55, Rob Roy to Durban ≈ 4:05; nothing faster than 5:30/km on the early climbs'), REST()]];
    days.forEach((d, i) => { put(d, 'am', RW[i][0]); put(d, 'pm', RW[i][1]); });
    continue;
  }

  // weekly structure: Mon rest+upper · Tue quality+legs A · Wed easy (+ride in Rebuild) · Thu quality/steady+legs B · Fri easy or rest+upper · Sat long · Sun easy ride / easy run
  long = r1(long);
  const rest = Math.max(0, km - long);
  const share = km >= 60 ? { tue: .26, wed: .2, thu: .26, fri: .12, sun: .16 } : km >= 45 ? { tue: .3, wed: .22, thu: .3, fri: 0, sun: .18 } : { tue: .34, wed: .3, thu: .36, fri: 0, sun: 0 };
  const kmFor = k => Math.max(5, r1(rest * share[k]));
  const qTue = name === 'Rebuild' ? (wk < '2026-12-14' ? 'strides' : 'hills') : name === 'Base and qualifier' ? 'hills' : name === 'Strength-endurance' ? 'downhill' : name === 'Ultra-specific' ? 'downhill' : 'goal';
  const qThu = name === 'Rebuild' ? 'strides' : name === 'Base and qualifier' ? 'tempo' : name === 'Strength-endurance' ? 'mp' : name === 'Ultra-specific' ? 'mp' : 'goal';

  for (const d of days) {
    const i = dow(d);
    const isRaceDay = EVENTS.find(e => e.date === d && e.kind !== 'travel' && e.kind !== 'checkpoint');
    if (isRaceDay && d !== '2026-11-22') {
      if (isRaceDay.kind === 'test') put(d, 'am', S('run', '10 km time trial', 'Warm up 15 min with 4 strides. 10 km solo, even effort (first km no faster than the average). Cool down 10 min. This result sets your training paces — log it.', 70, 'race', { distance_km: 10 }));
      else if (isRaceDay.name.startsWith('Vaal')) put(d, 'am', easyRun(kmFor('sun'), ' Optional Vaal/Edenvale marathon today — only if fresh and entered; otherwise this easy run.'));
      else put(d, 'am', raceDay(isRaceDay.name, isRaceDay.distance_km, isRaceDay.target));
      put(d, 'pm', REST()); continue;
    }
    if (raceIn && d === add(raceIn, -1)) { put(d, 'am', easyRun(4, ' Shake-out with 3 strides.')); put(d, 'pm', REST()); continue; }
    if (raceIn && raceIn !== '2026-12-13' && d > raceIn) { put(d, 'am', i === 0 ? REST() : easyRun(6)); put(d, 'pm', REST()); continue; }
    switch (i) {
      case 0: put(d, 'am', REST()); put(d, 'pm', upper()); break;
      case 1: put(d, 'am', raceIn && raceIn !== '2026-12-13' ? easyRun(kmFor('tue'), ' Race week: 4 × 1 min at race pace.') : quality(name, qTue, kmFor('tue'))); put(d, 'pm', noLegs ? REST() : legs(name, 'A')); break;
      case 2: put(d, 'am', easyRun(kmFor('wed'))); put(d, 'pm', name === 'Rebuild' ? easyRide(60) : REST()); break;
      case 3: put(d, 'am', raceIn ? easyRun(kmFor('thu')) : quality(name, qThu, kmFor('thu'))); put(d, 'pm', noLegs || name === 'Taper' || (name === 'Ultra-specific' && wk >= '2027-05-03') || recovery ? REST() : legs(name, 'B')); break;
      case 4: put(d, 'am', share.fri ? easyRun(kmFor('fri')) : REST()); put(d, 'pm', share.fri ? REST() : upper()); break;
      case 5: put(d, 'am', raceIn && raceIn > d ? easyRun(6) : longRun(name, long)); put(d, 'pm', REST()); break;
      case 6: put(d, 'am', share.sun ? easyRun(kmFor('sun'), name === 'Ultra-specific' && !recovery ? ' Back-to-back: on tired legs from Saturday.' : '') : easyRide(name === 'Taper' ? 45 : 75)); put(d, 'pm', share.sun && name !== 'Taper' ? easyRide(45) : REST()); break;
    }
  }
}

// ---------------- report / apply ----------------
const byWeek = new Map();
for (const p of plan) {
  const d = new Date(p.date); const mon = add(p.date, -dow(p.date));
  const w = byWeek.get(mon) ?? { km: 0, load: 0, legs: 0, long: 0 }; byWeek.set(mon, w);
  if (p.sport === 'run' || (p.sport === 'race' && p.distance_km && p.date !== '2026-11-22')) { w.km += p.distance_km ?? 0; w.long = Math.max(w.long, p.distance_km ?? 0); }
  if (p.sport === 'gym_legs') w.legs++;
  w.load += p.planned_load ?? 0; void d;
}
for (const [w, v] of byWeek) console.log(w, (phaseOf(w) ?? phaseOf(add(w, 6)))?.name.padEnd(20), `run ${String(Math.round(v.km)).padStart(3)} km  long ${String(v.long).padStart(4)}  legs ${v.legs}  load ${v.load}`);
console.log(`${plan.length} sessions`);

if (APPLY) {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const owner = (await db.rpc('tr_owner')).data;   // this plan is Herman's
  let r = await db.from('tr_phases').delete().gte('id', 0); if (r.error) throw r.error;
  r = await db.from('tr_phases').insert(PHASES); if (r.error) throw r.error;
  r = await db.from('tr_events').delete().gte('id', 0); if (r.error) throw r.error;
  r = await db.from('tr_events').insert(EVENTS.map(e => ({ on_track: null, borderline: null, rethink: null, entry_status: null, ...e }))); if (r.error) throw r.error;
  const { data: kept } = await db.from('tr_planned').select('date,slot').gte('date', '2026-11-17').neq('source', 'seed');
  const keep = new Set((kept ?? []).map(k => k.date + k.slot));
  r = await db.from('tr_planned').delete().gte('date', '2026-11-17').eq('source', 'seed'); if (r.error) throw r.error;
  const rows = plan.filter(p => !keep.has(p.date + p.slot));
  for (let i = 0; i < rows.length; i += 200) { r = await db.from('tr_planned').upsert(rows.slice(i, i + 200).map(r => ({ ...r, user_id: owner })), { onConflict: 'user_id,date,slot' }); if (r.error) throw r.error; }
  console.log(`applied: ${PHASES.length} phases, ${EVENTS.length} events, ${rows.length} sessions (${keep.size} coach/manual sessions kept)`);
}
