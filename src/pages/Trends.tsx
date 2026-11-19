import { useMemo, useState } from 'react'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { AXIS, Card, Empty, FitChart, GRID, Legend, Stat, Tip } from '../components/ui'
import { fetchAll, getActs, getEvents, getPlanned, getSets, getSettings, getWellness, useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import { bodyFrom, kcalOut, KCAL_PER_KG } from '../lib/calories'
import { navyBf } from '../lib/body'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { addDays, dm, monday, num, pace, today } from '../lib/format'
import { e1rm, pmc, rolling } from '../lib/load'
import { useSynced } from './Today'

const RANGES = [{ k: 42, l: '6 wk' }, { k: 91, l: '3 mo' }, { k: 182, l: '6 mo' }, { k: 365, l: '1 yr' }]
const tick = (d: string) => dm(d)
const H = 200

export default function Trends() {
  const [days, setDays] = useState(91)
  const t = today(), from = addDays(t, -days), warm = addDays(from, -120)
  const { data, reload } = useLoad(async () => {
    const [acts, well, planned, sets, settings, events, meals] = await Promise.all([getActs(warm, t), getWellness(from, t), getPlanned(from, addDays(t, 210)), getSets(from), getSettings(), getEvents(),
      fetchAll<{ date: string; kcal: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null }>(() => supabase.from('tr_meals').select('date,kcal,protein_g,carbs_g,fat_g').gte('date', from).order('date'))])
    const { data: photos } = await supabase.from('tr_body_photos').select('date,ai').gte('date', from).order('date')
    const { data: scans } = await supabase.from('tr_inbody').select('date,weight_kg,smm_kg,bfm_kg,pbf,visceral_level,bmr_kcal').gte('date', addDays(from, -120)).order('date')
    return { acts, well, planned, sets, settings, events, meals, scans: (scans ?? []) as { date: string; weight_kg: number | null; smm_kg: number | null; bfm_kg: number | null; pbf: number | null; visceral_level: number | null; bmr_kcal: number | null }[], photos: (photos ?? []) as { date: string; ai: { usable: boolean; bf_low: number; bf_high: number; bf_best: number } | null }[] }
  }, [days])
  useSynced(reload)

  const v = useMemo(() => {
    if (!data) return null
    const race = data.events.find(e => e.name.startsWith('Comrades'))?.date ?? addDays(t, 200)
    // fitness / fatigue / form: actuals to today, then the planned sessions as a dashed projection to race day
    const future: Record<string, number> = {}
    for (const p of data.planned) if (p.date > t) future[p.date] = (future[p.date] ?? 0) + (p.planned_load ?? 0)
    const all = pmc(data.acts, warm, race, future)
    const pm = all.filter(d => d.date >= from).map(d => d.date <= t ? { ...d, pFit: null as number | null, pFat: null as number | null } : { date: d.date, load: d.load, fitness: null, fatigue: null, form: null, pFit: d.fitness, pFat: d.fatigue })
    const nowIdx = pm.findIndex(d => d.date === t); if (nowIdx >= 0) { pm[nowIdx].pFit = pm[nowIdx].fitness; pm[nowIdx].pFat = pm[nowIdx].fatigue }
    const atRace = all[all.length - 1]
    const nowP = all.find(d => d.date === t)
    const ramp = nowP && all.find(d => d.date === addDays(t, -28)) ? nowP.fitness - all.find(d => d.date === addDays(t, -28))!.fitness : null

    // weekly volume by sport (hours) + run km vs planned
    const weeks = new Map<string, { wk: string; run: number; ride: number; legs: number; upper: number; other: number; km: number; kmPlan: number; long: number; done: number; due: number }>()
    const W = (d: string) => { const k = monday(d); if (!weeks.has(k)) weeks.set(k, { wk: k, run: 0, ride: 0, legs: 0, upper: 0, other: 0, km: 0, kmPlan: 0, long: 0, done: 0, due: 0 }); return weeks.get(k)! }
    for (let d = monday(from); d <= t; d = addDays(d, 7)) W(d)
    for (const a of data.acts.filter(a => a.date >= monday(from))) {
      const w = W(a.date), h = (a.duration_s ?? 0) / 3600
      if (a.sport === 'run') { w.run += h; w.km += (a.distance_m ?? 0) / 1000; w.long = Math.max(w.long, (a.distance_m ?? 0) / 1000) }
      else if (a.sport === 'ride') w.ride += h; else if (a.sport === 'gym_legs') w.legs += h; else if (a.sport === 'gym_upper') w.upper += h; else w.other += h
    }
    for (const p of data.planned.filter(p => p.date <= t && p.date >= monday(from))) {
      const w = W(p.date)
      if (p.sport === 'run') w.kmPlan += p.distance_km ?? 0
      if (p.sport !== 'rest') { w.due++; if (p.status === 'done') w.done++ }
    }
    const wk = [...weeks.values()].sort((a, b) => a.wk.localeCompare(b.wk)).map(w => ({ ...w, run: +w.run.toFixed(1), ride: +w.ride.toFixed(1), legs: +w.legs.toFixed(1), upper: +w.upper.toFixed(1), other: +w.other.toFixed(1), km: Math.round(w.km), kmPlan: Math.round(w.kmPlan), long: Math.round(w.long), pct: w.due ? Math.round((w.done / w.due) * 100) : null }))

    // wellness with 7-day averages
    const wl = data.well
    const rhr7 = rolling(wl, w => w.resting_hr, 7), hrv7 = rolling(wl, w => w.hrv, 7), kg7 = rolling(wl, w => w.weight_kg, 7)
    const well = wl.map((w, i) => ({ date: w.date, rhr: w.resting_hr, rhr7: rhr7[i], hrv: w.hrv, hrv7: hrv7[i], kg: w.weight_kg, kg7: kg7[i], waist: w.waist_cm, sleep: w.sleep_h }))
    const lastKg = [...wl].reverse().find(w => w.weight_kg)?.weight_kg ?? null
    const lastWaist = [...wl].reverse().find(w => w.waist_cm)?.waist_cm ?? null

    // easy-run efficiency: metres per minute per heartbeat (higher = fitter), and pace on those runs
    const easyRuns = data.acts.filter(a => a.date >= from && a.sport === 'run' && a.avg_hr && a.distance_m && a.duration_s && a.avg_hr <= (data.settings.easy_run_hr_cap ?? 140) + 5 && (a.distance_m ?? 0) > 4000)
      .map(a => ({ x: Date.parse(a.date), date: a.date, eff: +(((a.distance_m! / (a.duration_s! / 60)) / a.avg_hr!)).toFixed(3), pace: Math.round(a.gap_pace_s ?? a.avg_pace_s ?? 0), hr: a.avg_hr, km: Math.round(a.distance_m! / 100) / 10 }))
    const easyRides = data.acts.filter(a => a.date >= from && a.sport === 'ride' && a.avg_watts && a.avg_hr && (a.intensity ?? 100) < 75)
      .map(a => ({ x: Date.parse(a.date), date: a.date, eff: +(a.avg_watts! / a.avg_hr!).toFixed(2), w: a.avg_watts, hr: a.avg_hr }))

    // intensity distribution for runs (HR zones, last 4 weeks by week): easy = Z1–Z2
    const zoneWeeks = new Map<string, { wk: string; easy: number; mid: number; hard: number }>()
    for (const a of data.acts.filter(a => a.date >= from && a.sport === 'run' && a.hr_zone_s?.length)) {
      const k = monday(a.date); const z = a.hr_zone_s!; const e = (z[0] ?? 0) + (z[1] ?? 0), m = z[2] ?? 0, h = z.slice(3).reduce((s, x) => s + (x ?? 0), 0)
      const r = zoneWeeks.get(k) ?? { wk: k, easy: 0, mid: 0, hard: 0 }; r.easy += e; r.mid += m; r.hard += h; zoneWeeks.set(k, r)
    }
    const zones = [...zoneWeeks.values()].sort((a, b) => a.wk.localeCompare(b.wk)).map(r => { const s = r.easy + r.mid + r.hard || 1; return { wk: r.wk, easy: Math.round((r.easy / s) * 100), mid: Math.round((r.mid / s) * 100), hard: Math.round((r.hard / s) * 100) } })

    // gym: best estimated 1RM per session for the main lifts
    const LIFTS = ['Back squat', 'Romanian deadlift', 'Bulgarian split squat', 'Trap-bar deadlift']
    const byDate = new Map<string, Record<string, number | string>>()
    for (const s of data.sets) if (s.kg && s.reps && LIFTS.includes(s.exercise)) {
      const r = byDate.get(s.date) ?? { date: s.date }; r[s.exercise] = Math.max(Number(r[s.exercise] ?? 0), Math.round(e1rm(s.kg, s.reps))); byDate.set(s.date, r)
    }
    const gym = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    const liftsSeen = LIFTS.filter(l => gym.some(g => g[l]))

    // calories: only days with food logged count, so a forgotten day doesn't look like a 3,000 kcal deficit
    const body = bodyFrom(data.settings, data.well, t, data.scans)
    const inBy = new Map<string, { kcal: number; p: number }>()
    for (const m of data.meals) { const x = inBy.get(m.date) ?? { kcal: 0, p: 0 }; x.kcal += m.kcal; x.p += m.protein_g ?? 0; inBy.set(m.date, x) }
    const calWeeks = new Map<string, { wk: string; days: number; inK: number; outK: number; protein: number }>()
    for (const [d, x] of inBy) {
      const k = monday(d); const w = calWeeks.get(k) ?? { wk: k, days: 0, inK: 0, outK: 0, protein: 0 }
      w.days++; w.inK += x.kcal; w.protein += x.p; w.outK += kcalOut(data.acts.filter(a => a.date === d), body).total; calWeeks.set(k, w)
    }
    const cal = [...calWeeks.values()].sort((a, b) => a.wk.localeCompare(b.wk)).map(w => ({ wk: w.wk, days: w.days, in: Math.round(w.inK / w.days), out: Math.round(w.outK / w.days), net: Math.round((w.inK - w.outK) / w.days), protein: Math.round(w.protein / w.days), kgWeek: +(((w.inK - w.outK) / w.days) * 7 / KCAL_PER_KG).toFixed(2) }))

    // body fat: tape (Navy) on every day with a waist reading, carrying the last neck; photo reads as points with their range
    // waist and neck are rarely measured on the same day: carry the last of each forward, plot on days either was logged
    let lastNeck: number | null = null, lastWaistCm: number | null = null
    const bfMap = new Map<string, { date: string; tape: number | null; photo: number | null; lo: number | null; hi: number | null; inbody?: number | null }>()
    for (const w of data.well) {
      if (w.neck_cm) lastNeck = w.neck_cm
      if (w.waist_cm) lastWaistCm = w.waist_cm
      if (!w.neck_cm && !w.waist_cm) continue
      const t = navyBf(lastWaistCm, lastNeck, data.settings.height_cm)
      if (t != null) bfMap.set(w.date, { date: w.date, tape: t, photo: null, lo: null, hi: null })
    }
    for (const p of data.photos) if (p.ai?.usable) { const r = bfMap.get(p.date) ?? { date: p.date, tape: null, photo: null, lo: null, hi: null }; r.photo = p.ai.bf_best; r.lo = p.ai.bf_low; r.hi = p.ai.bf_high; bfMap.set(p.date, r) }
    for (const sc of data.scans) if (sc.pbf != null && sc.date >= from) { const r = bfMap.get(sc.date) ?? { date: sc.date, tape: null, photo: null, lo: null, hi: null }; r.inbody = Number(sc.pbf); bfMap.set(sc.date, r) }
    const inbody = data.scans.filter(sc => sc.date >= from).map(sc => ({ date: sc.date, muscle: sc.smm_kg, fat: sc.bfm_kg, visceral: sc.visceral_level }))
    const bf = [...bfMap.values()].sort((a, b) => a.date.localeCompare(b.date))

    // FTP as intervals.icu saw it on each ride
    const ftp = data.acts.filter(a => a.date >= from && a.sport === 'ride' && a.ftp).map(a => ({ date: a.date, ftp: a.ftp }))
    // daily balance on logged days: intake split by macro (kcal), burn, target (burn − deficit), net
    const deficit = Number(data.settings.kcal_deficit ?? 500)
    const dayMap = new Map<string, { p: number; c: number; f: number; kcal: number }>()
    for (const m of data.meals) { const x = dayMap.get(m.date) ?? { p: 0, c: 0, f: 0, kcal: 0 }; x.kcal += m.kcal; x.p += m.protein_g ?? 0; x.c += m.carbs_g ?? 0; x.f += m.fat_g ?? 0; dayMap.set(m.date, x) }
    const calDays = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, x]) => {
      const out = kcalOut(data.acts.filter(a => a.date === d), bodyFrom(data.settings, data.well, d, data.scans)).total
      const pk = Math.round(x.p * 4), ck = Math.round(x.c * 4), fk = Math.round(x.f * 9)
      const other = Math.max(0, Math.round(x.kcal) - pk - ck - fk)   // alcohol / rounding
      return { date: d, today: d === t, in: Math.round(x.kcal), pK: pk, cK: ck, fK: fk, oK: other, out, target: out - deficit, net: Math.round(x.kcal - out), protein: Math.round(x.p), carbs: Math.round(x.c), fat: Math.round(x.f) }
    })
    const full = calDays.filter(d => !d.today)          // today is still in progress
    const avg = (k: 'in' | 'out' | 'net' | 'protein' | 'carbs') => (full.length ? Math.round(full.reduce((a, d) => a + d[k], 0) / full.length) : null)
    const kgW = full.length ? +((full.reduce((a, d) => a + d.net, 0) / full.length) * 7 / KCAL_PER_KG).toFixed(2) : null
    const kgs = data.well.filter(w => w.weight_kg && (!full.length || w.date >= full[0].date))
    const actualKgW = kgs.length >= 2 && full.length ? +(((Number(kgs[kgs.length - 1].weight_kg) - Number(kgs[0].weight_kg)) / Math.max(1, (Date.parse(kgs[kgs.length - 1].date) - Date.parse(kgs[0].date)) / 864e5)) * 7).toFixed(2) : null
    const calSum = { days: full.length, inAvg: avg('in'), outAvg: avg('out'), netAvg: avg('net'), protein: avg('protein'), carbs: avg('carbs'), kgW, actualKgW, deficit,
      proteinAim: Math.round(bodyFrom(data.settings, data.well, t, data.scans).weight * 1.6) }
    return { bf, inbody, cal, calDays, calSum, pm, atRace, nowP, ramp, wk, well, lastKg, lastWaist, easyRuns, easyRides, zones, gym, liftsSeen, ftp, race }
  }, [data, from, t, warm])

  if (!data || !v) return <p className="text-muted py-10 text-center animate-pulse">Loading…</p>
  const h = data.settings.height_cm
  // with only a few weigh-ins, start the weight chart a few days before the first one so the dots aren't squeezed into the right edge
  const firstKg = v.well.findIndex(w => w.kg)
  const weightRows = firstKg >= 0 && v.well.filter(w => w.kg).length < 14 ? v.well.slice(Math.max(0, firstKg - 5)) : v.well
  const whtr = v.lastWaist && h ? v.lastWaist / h : null
  const avgPct = (() => { const z = v.zones.slice(-4); return z.length ? Math.round(z.reduce((s, x) => s + x.easy, 0) / z.length) : null })()
  const range = RANGES.find(r => r.k === days)?.l ?? `${days} days`
  // what each chart plots, handed to the AI button (rounded and trimmed so the request stays small)
  const r1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10)
  const AI = {
    pmc: { key: 'pmc', title: 'Fitness, fatigue and form', range, about: 'Daily TSS-like load as fitness (42-day CTL), fatigue (7-day ATL) and form (TSB). Values after today are a projection of the planned sessions to Comrades.',
      data: v.pm.filter((_, i, a) => a.length < 200 || i % 2 === 0 || a[i].date === t).map(d => ({ d: d.date, load: d.load, fit: r1(d.fitness ?? d.pFit), fat: r1(d.fatigue ?? d.pFat), form: r1(d.form), plan: d.date > t })) },
    volume: { key: 'run-volume', title: 'Running volume', range, about: 'Weekly running km done vs planned km (the plan km are ceilings), and the longest run each week.', data: v.wk.map(w => ({ wk: w.wk, km: w.km, plan: w.kmPlan, long: w.long })) },
    hours: { key: 'hours', title: 'Hours by type', range, about: 'Weekly training hours by type (run, ride, leg gym, upper gym, other).', data: v.wk.map(w => ({ wk: w.wk, run: w.run, ride: w.ride, legs: w.legs, upper: w.upper, other: w.other })) },
    rhr: { key: 'rhr', title: 'Resting heart rate', range, about: 'Morning resting HR from Garmin with a 7-day average.', data: v.well.map(w => ({ d: w.date, rhr: w.rhr, avg7: w.rhr7 })) },
    hrv: { key: 'hrv', title: 'HRV', range, about: 'Overnight HRV (rMSSD) from Garmin with a 7-day average.', data: v.well.map(w => ({ d: w.date, hrv: w.hrv, avg7: w.hrv7, sleep_h: w.sleep })) },
    weight: { key: 'weight', title: 'Weight', range, about: `Weigh-ins with a 7-day average; goal ≤ ${data.settings.goal_weight_kg ?? 91} kg by mid-May 2027 (plan target 85–91 kg).`, data: v.well.filter(w => w.kg).map(w => ({ d: w.date, kg: w.kg, avg7: w.kg7 })) },
    waist: { key: 'waist', title: 'Waist', range, about: `Waist in cm; height ${h ?? 'unknown'} cm, waist-to-height target under 0.50.`, data: v.well.filter(w => w.waist).map(w => ({ d: w.date, cm: w.waist })) },
    runEff: { key: 'run-efficiency', title: 'Easy-run efficiency', range, about: 'Easy runs only: metres per minute per heartbeat (higher = fitter), with pace (s/km, grade-adjusted where available) and HR.', data: v.easyRuns.map(r => ({ d: r.date, eff: r.eff, pace_s: r.pace, hr: r.hr, km: r.km })) },
    rideEff: { key: 'ride-efficiency', title: 'Easy-ride efficiency', range, about: 'Easy rides only: average watts ÷ average HR (EF). Indoor vs outdoor and the bike used affect this.', data: v.easyRides.map(r => ({ d: r.date, ef: r.eff, w: r.w, hr: r.hr })) },
    zones: { key: 'run-intensity', title: 'Run intensity (80/20)', range, about: 'Share of weekly running time in HR zones: easy Z1–2, moderate Z3, hard Z4–5. Target ~80% easy.', data: v.zones },
    gym: { key: 'leg-strength', title: 'Leg strength', range, about: 'Best estimated one-rep max (Epley, from logged kg × reps) per session for the main leg lifts.', data: v.gym },
    compliance: { key: 'compliance', title: 'Plan compliance', range, about: 'Share of planned (non-rest) sessions done each week.', data: v.wk.filter(w => w.pct != null).map(w => ({ wk: w.wk, pct: w.pct })) },
    bodyfat: { key: 'body-fat', title: 'Body fat', range, about: 'Body-fat %: tape estimate (US Navy method from waist at navel, neck and height, ±3–4%) on each day with a waist reading, and visual reads of monthly progress photos (best estimate with low–high range, ±4–5%), and InBody scan readings (bioimpedance, most consistent of the three when conditions match). Weight is in the context; fat vs lean mass follows from weight × body fat.', data: { bf: v.bf, weight7: v.well.filter(w => w.kg7).map(w => ({ d: w.date, kg7: w.kg7 })) } },
    calories: { key: 'calories', title: 'Calories in and out', range, about: 'Weekly averages per logged day: kcal eaten (meals read from photos/dictation, reviewed by Herman) vs kcal out (resting burn × non-exercise factor + Garmin session calories), net, protein, and the weight change that net implies (7,700 kcal ≈ 1 kg). Compare with the actual weight trend.', data: { days: v.calDays.map(d => ({ d: d.date, in: d.in, out: d.out, target: d.target, net: d.net, p: d.protein, c: d.carbs, f: d.fat, partial: d.today || undefined })), weeks: v.cal, summary: v.calSum, weight: v.well.filter(w => w.kg7).map(w => ({ d: w.date, kg7: w.kg7 })) } },
    inbody: { key: 'inbody', title: 'InBody: muscle and fat', range, about: 'InBody scans: skeletal muscle mass kg, body fat mass kg and visceral fat level. During a fat-loss phase the goal is fat down with muscle holding.', data: v.inbody },
    ftp: { key: 'ftp', title: 'FTP', range, about: `FTP as intervals.icu applied it per ride; working value ${data.settings.ftp_w ?? 310} W.`, data: v.ftp },
  }

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="display text-3xl leading-none flex-1">Trends</h1>
        <div className="flex gap-1">{RANGES.map(r => <button key={r.k} className={`chip !py-1.5 !px-3 ${days === r.k ? '!bg-brand !text-surface' : ''}`} onClick={() => setDays(r.k)}>{r.l}</button>)}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Fitness" value={num(v.nowP?.fitness)} sub={v.ramp != null ? `${v.ramp >= 0 ? '+' : ''}${num(v.ramp)} in 4 weeks` : ''} tone={v.ramp != null && v.ramp > 8 ? 'warn' : undefined} />
        <Stat label="Form" value={num(v.nowP?.form)} sub="fitness − fatigue" tone={(v.nowP?.form ?? 0) < -25 ? 'bad' : undefined} />
        <Stat label="Weight" value={v.lastKg ? `${num(v.lastKg, 1)}` : '—'} sub={`goal ≤ ${data.settings.goal_weight_kg ?? 91} kg by mid-May`} />
        <Stat label="Waist / height" value={whtr ? whtr.toFixed(2) : '—'} sub={v.lastWaist ? `${v.lastWaist} cm${h ? '' : ' · add height in Settings'}` : 'log waist in check-in'} tone={whtr ? (whtr < 0.5 ? 'good' : 'warn') : undefined} />
      </div>

      <Card ai={AI.pmc} title="Fitness, fatigue and form" sub={`Daily training load as fitness (42-day) and fatigue (7-day). Dashed = what the plan would do to race day (fitness ${num(v.atRace?.fitness)} on ${dm(v.race)}).`}>
        <Legend items={[{ label: 'Fitness', color: 'var(--s2)' }, { label: 'Fatigue', color: 'var(--s1)' }, { label: 'Planned', color: 'var(--muted)', dashed: true }]} />
        <FitChart height={H}>
          <LineChart data={v.pm} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} />
            <Tooltip content={<Tip labelFormat={tick} />} />
            <Line dataKey="fitness" name="Fitness" stroke="var(--s2)" strokeWidth={2} dot={false} connectNulls={false} />
            <Line dataKey="fatigue" name="Fatigue" stroke="var(--s1)" strokeWidth={2} dot={false} />
            <Line dataKey="pFit" name="Fitness (plan)" stroke="var(--s2)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
            <Line dataKey="pFat" name="Fatigue (plan)" stroke="var(--s1)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            <ReferenceLine x={t} stroke="var(--muted)" />
          </LineChart>
        </FitChart>
        <p className="label mt-3 mb-1">Form</p>
        <FitChart height={110}>
          <ComposedChart data={v.pm.filter(d => d.date <= t)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} />
            <Tooltip content={<Tip labelFormat={tick} />} />
            <ReferenceLine y={-25} stroke="var(--bad)" strokeDasharray="3 3" /><ReferenceLine y={0} stroke="var(--line)" />
            <Area dataKey="form" name="Form" stroke="var(--s7)" fill="var(--s7)" fillOpacity={0.15} strokeWidth={2} />
          </ComposedChart>
        </FitChart>
        <p className="text-xs text-muted mt-1">Below −25 (red line) = deep fatigue; the coach eases the next day. Fitness rising more than ~8 a month is a fast ramp.</p>
      </Card>

      <Card ai={AI.volume} title="Running volume" sub="Weekly km done against the planned km (the plan's ceiling), and the week's longest run">
        <Legend items={[{ label: 'Run km', color: 'var(--s1)', box: true }, { label: 'Planned', color: 'var(--muted)', dashed: true }, { label: 'Longest run', color: 'var(--s2)' }]} />
        <FitChart height={H}>
          <ComposedChart data={v.wk} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} />
            <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} />} />
            <Bar dataKey="km" name="Run km" fill="var(--s1)" radius={[4, 4, 0, 0]} />
            <Line dataKey="kmPlan" name="Planned km" stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={2} dot={false} />
            <Line dataKey="long" name="Longest run" stroke="var(--s2)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </FitChart>
      </Card>

      <Card ai={AI.hours} title="Hours by type" sub="Weekly training time. Upper-body gym is recovery-grade and counts at 30% in the load.">
        <Legend items={[{ label: 'Run', color: 'var(--s1)', box: true }, { label: 'Ride', color: 'var(--s2)', box: true }, { label: 'Legs', color: 'var(--s3)', box: true }, { label: 'Upper', color: 'var(--s7)', box: true }, { label: 'Other', color: 'var(--s-other)', box: true }]} />
        <FitChart height={H}>
          <BarChart data={v.wk} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} />
            <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} fmt={x => `${x} h`} />} />
            {(['run', 'ride', 'legs', 'upper', 'other'] as const).map((k, i, arr) => (
              <Bar key={k} dataKey={k} name={k[0].toUpperCase() + k.slice(1)} stackId="h" stroke="var(--surface)" strokeWidth={1}
                fill={{ run: 'var(--s1)', ride: 'var(--s2)', legs: 'var(--s3)', upper: 'var(--s7)', other: 'var(--s-other)' }[k]} radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </FitChart>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card ai={AI.rhr} title="Resting heart rate" sub="Morning value from Garmin, 7-day average">
          {v.well.some(w => w.rhr) ? <>
            <Legend items={[{ label: 'Daily', color: 'var(--s8)' }, { label: '7-day', color: 'var(--ink)' }]} />
            <FitChart height={170}>
              <LineChart data={v.well} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 3', 'dataMax + 3']} />
                <Tooltip content={<Tip labelFormat={tick} />} />
                <Line dataKey="rhr" name="Resting HR" stroke="var(--s8)" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
                <Line dataKey="rhr7" name="7-day" stroke="var(--ink)" strokeWidth={2} dot={false} />
              </LineChart>
            </FitChart></> : <Empty>Comes from your Garmin once intervals.icu is connected.</Empty>}
        </Card>
        <Card ai={AI.hrv} title="HRV" sub="Overnight HRV (rMSSD) from Garmin, 7-day average — falling = fatigue or illness">
          {v.well.some(w => w.hrv) ? <>
            <Legend items={[{ label: 'Nightly', color: 'var(--s3)' }, { label: '7-day', color: 'var(--ink)' }]} />
            <FitChart height={170}>
              <LineChart data={v.well} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip content={<Tip labelFormat={tick} />} />
                <Line dataKey="hrv" name="HRV" stroke="var(--s3)" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
                <Line dataKey="hrv7" name="7-day" stroke="var(--ink)" strokeWidth={2} dot={false} />
              </LineChart>
            </FitChart></> : <Empty>Comes from your Garmin once intervals.icu is connected.</Empty>}
        </Card>
        <Card ai={AI.weight} title="Weight" sub={`Daily weigh-ins and 7-day average · checkpoint ≤ ${data.settings.goal_weight_kg ?? 91} kg mid-May`}>
          {v.well.some(w => w.kg) ? <>
            <Legend items={[{ label: 'Weigh-in', color: 'var(--s2)' }, { label: '7-day', color: 'var(--ink)' }, { label: 'Goal', color: 'var(--good)', dashed: true }]} />
            <FitChart height={170}>
              <LineChart data={weightRows} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={[(min: number) => Math.floor(Math.min(min, Number(data.settings.goal_weight_kg ?? 91)) - 1), (max: number) => Math.ceil(max + 1)]} />
                <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} kg`} />} />
                <ReferenceLine y={Number(data.settings.goal_weight_kg ?? 91)} stroke="var(--good)" strokeDasharray="4 4" />
                <Line dataKey="kg" name="Weight" stroke="var(--s2)" strokeWidth={0} dot={{ r: 4, fill: 'var(--s2)', stroke: 'var(--surface)', strokeWidth: 1.5 }} connectNulls={false} isAnimationActive={false} />
                <Line dataKey="kg7" name="7-day" stroke="var(--ink)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </FitChart></> : <Empty>Log weight in the check-in (or a Garmin scale syncs it).</Empty>}
        </Card>
        <Card ai={AI.waist} title="Waist" sub={h ? `cm · waist-to-height under 0.50 = under ${Math.round(h * 0.5)} cm` : 'cm · add your height in Settings for the ratio'}>
          {v.well.some(w => w.waist) ? (
            <FitChart height={170}>
              <LineChart data={v.well.filter(w => w.waist)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 2', 'dataMax + 2']} />
                <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} cm`} />} />
                {h && <ReferenceLine y={Math.round(h * 0.5)} stroke="var(--good)" strokeDasharray="4 4" />}
                <Line dataKey="waist" name="Waist" stroke="var(--s4)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </FitChart>) : <Empty>Measure weekly at the navel, same time of day, and log it in the check-in.</Empty>}
        </Card>
      </div>

      <Card ai={AI.bodyfat} title="Body fat" sub="Tape estimate (waist + neck + height) and progress-photo reads. Trend matters more than any one number."
        right={<Link to="/body" className="chip !py-1 !px-2.5"><Icon name="camera" size={13} />Photos</Link>}>
        {v.bf.length ? <>
          <Legend items={[{ label: 'Tape (Navy)', color: 'var(--s5)' }, { label: 'Photo read', color: 'var(--s7)' }, ...(v.bf.some(x => x.inbody != null) ? [{ label: 'InBody', color: 'var(--s2)' }] : [])]} />
          <FitChart height={180}>
            <ComposedChart data={v.bf} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 2', 'dataMax + 2']} />
              <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x}%`} />} />
              <Line dataKey="tape" name="Tape" stroke="var(--s5)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line dataKey="photo" name="Photo" stroke="var(--s7)" strokeWidth={0} dot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} connectNulls={false} />
              <Line dataKey="inbody" name="InBody" stroke="var(--s2)" strokeWidth={1.5} strokeDasharray="3 3" dot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} connectNulls />
            </ComposedChart>
          </FitChart>
        </> : <Empty>Log waist and neck in the check-in, or add progress photos.</Empty>}
      </Card>

      {v.inbody.length > 0 && (
        <Card ai={AI.inbody} title="InBody: muscle and fat" sub="Skeletal muscle and body fat mass (kg) per scan. Fat down with muscle holding is the goal."
          right={<Link to="/body" className="chip !py-1 !px-2.5"><Icon name="plus" size={13} />Scan</Link>}>
          <Legend items={[{ label: 'Muscle kg', color: 'var(--s1)' }, { label: 'Fat kg', color: 'var(--s4)' }]} />
          <FitChart height={180}>
            <LineChart data={v.inbody} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 3', 'dataMax + 3']} />
              <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} kg`} />} />
              <Line dataKey="muscle" name="Muscle" stroke="var(--s1)" strokeWidth={2} dot={{ r: 4 }} connectNulls />
              <Line dataKey="fat" name="Fat" stroke="var(--s4)" strokeWidth={2} dot={{ r: 4 }} connectNulls />
            </LineChart>
          </FitChart>
        </Card>
      )}

      <CaloriesCard ai={AI.calories} days={v.calDays} weeks={v.cal} sum={v.calSum} />

      <div className="grid md:grid-cols-2 gap-4">
        <Card ai={AI.runEff} title="Easy-run efficiency" sub="Metres per minute per heartbeat on easy runs (higher = fitter at the same effort). Uses grade-adjusted pace where Garmin has it.">
          {v.easyRuns.length >= 2 ? (
            <FitChart height={180}>
              <ScatterChart margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} {...AXIS} tickFormatter={x => dm(new Date(x).toISOString().slice(0, 10))} />
                <YAxis dataKey="eff" {...AXIS} domain={['dataMin - 0.05', 'dataMax + 0.05']} tickFormatter={x => x.toFixed(2)} /><ZAxis range={[60, 60]} />
                <Tooltip content={({ active, payload }) => active && payload?.[0] ? (() => { const p = payload[0].payload; return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"><p className="font-semibold">{dm(p.date)} · {p.km} km</p><p className="text-muted num">{pace(p.pace)} at HR {p.hr} · {p.eff}</p></div> })() : null} />
                <Scatter data={v.easyRuns} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} />
              </ScatterChart>
            </FitChart>) : <Empty>Needs a few easy runs from Garmin.</Empty>}
        </Card>
        <Card ai={AI.rideEff} title="Easy-ride efficiency" sub="Watts per heartbeat on easy rides (your 1.74–1.93 range in Oct 2026). Compare within type only.">
          {v.easyRides.length >= 2 ? (
            <FitChart height={180}>
              <ScatterChart margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} {...AXIS} tickFormatter={x => dm(new Date(x).toISOString().slice(0, 10))} />
                <YAxis dataKey="eff" {...AXIS} domain={['dataMin - 0.1', 'dataMax + 0.1']} tickFormatter={x => x.toFixed(2)} /><ZAxis range={[60, 60]} />
                <Tooltip content={({ active, payload }) => active && payload?.[0] ? (() => { const p = payload[0].payload; return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"><p className="font-semibold">{dm(p.date)}</p><p className="text-muted num">{p.w} W at HR {p.hr} · EF {p.eff}</p></div> })() : null} />
                <Scatter data={v.easyRides} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2} />
              </ScatterChart>
            </FitChart>) : <Empty>Needs a few easy rides with power from Garmin.</Empty>}
        </Card>
      </div>

      <Card ai={AI.zones} title="Run intensity (80/20)" sub={`Share of running time by HR zone. Target about 80% easy (Z1–Z2).${avgPct != null ? ` Last 4 weeks: ${avgPct}% easy.` : ''}`}>
        {v.zones.length ? <>
          <Legend items={[{ label: 'Easy Z1–2', color: 'var(--s3)', box: true }, { label: 'Moderate Z3', color: 'var(--s4)', box: true }, { label: 'Hard Z4–5', color: 'var(--s8)', box: true }]} />
          <FitChart height={170}>
            <BarChart data={v.zones} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} domain={[0, 100]} />
              <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} fmt={x => `${x}%`} />} />
              <ReferenceLine y={80} stroke="var(--muted)" strokeDasharray="4 4" />
              <Bar dataKey="easy" name="Easy" stackId="z" fill="var(--s3)" stroke="var(--surface)" strokeWidth={1} />
              <Bar dataKey="mid" name="Moderate" stackId="z" fill="var(--s4)" stroke="var(--surface)" strokeWidth={1} />
              <Bar dataKey="hard" name="Hard" stackId="z" fill="var(--s8)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
            </BarChart>
          </FitChart></> : <Empty>Needs runs with heart rate from Garmin.</Empty>}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card ai={AI.gym} title="Leg strength" sub="Best estimated one-rep max per session (from kg × reps you log)">
          {v.gym.length ? <>
            <Legend items={v.liftsSeen.map((l, i) => ({ label: l, color: ['var(--s3)', 'var(--s2)', 'var(--s1)', 'var(--s7)'][i] }))} />
            <FitChart height={180}>
              <LineChart data={v.gym} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} />
                <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} kg`} />} />
                {v.liftsSeen.map((l, i) => <Line key={l} dataKey={l} name={l} stroke={['var(--s3)', 'var(--s2)', 'var(--s1)', 'var(--s7)'][i]} strokeWidth={2} dot={{ r: 3 }} connectNulls />)}
              </LineChart>
            </FitChart></> : <Empty>Log kg on your leg sessions and the trend appears here.</Empty>}
        </Card>
        <Card ai={AI.compliance} title="Plan compliance" sub="Share of planned sessions done each week">
          <FitChart height={180}>
            <BarChart data={v.wk.filter(w => w.pct != null)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} domain={[0, 100]} />
              <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} fmt={x => `${x}%`} />} />
              <Bar dataKey="pct" name="Done" fill="var(--s2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </FitChart>
        </Card>
      </div>

      {v.ftp.length > 0 && (
        <Card ai={AI.ftp} title="FTP" sub={`As intervals.icu applied it per ride · working value ${data.settings.ftp_w ?? 310} W`}>
          <FitChart height={150}>
            <LineChart data={v.ftp} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 10', 'dataMax + 10']} />
              <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} W`} />} />
              <Line dataKey="ftp" name="FTP" stroke="var(--s2)" strokeWidth={2} dot={false} type="stepAfter" />
            </LineChart>
          </FitChart>
        </Card>
      )}
      <p className="text-[11px] text-muted text-center">Load is a TSS-like score: intervals.icu's figure where Garmin measured it, otherwise estimated from minutes × effort.</p>
    </div>
  )
}

type CalDay = { date: string; today: boolean; in: number; pK: number; cK: number; fK: number; oK: number; out: number; target: number; net: number; protein: number; carbs: number; fat: number }
type CalWeek = { wk: string; days: number; in: number; out: number; net: number; protein: number; kgWeek: number }
type CalSum = { days: number; inAvg: number | null; outAvg: number | null; netAvg: number | null; protein: number | null; carbs: number | null; kgW: number | null; actualKgW: number | null; deficit: number; proteinAim: number }

/** calories: daily (intake stacked by macro vs burn and target, net bar) or weekly averages */
function CaloriesCard({ ai, days, weeks, sum }: { ai: Parameters<typeof Card>[0]['ai']; days: CalDay[]; weeks: CalWeek[]; sum: CalSum }) {
  const [view, setView] = useState<'day' | 'week'>('day')
  const shown = days.slice(-28)
  const sign = (x: number | null, unit = '') => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x)}${unit}`)
  return (
    <Card ai={ai} title="Calories in and out"
      sub={view === 'day' ? `Logged days (last 28). Bars = eaten, split by protein / carbs / fat. Line = burned, dashed = target (${sum.deficit} below burn). Today is still filling up.` : 'Average per logged day, by week.'}
      right={<span className="flex rounded-full bg-surface-2 p-0.5 text-xs">{(['day', 'week'] as const).map(k => <button key={k} className={`px-2.5 py-1 rounded-full ${view === k ? 'bg-surface shadow font-medium' : 'text-muted'}`} onClick={() => setView(k)}>{k === 'day' ? 'Daily' : 'Weekly'}</button>)}</span>}>
      {!days.length ? <Empty>Log meals on the Today screen and the balance shows here.</Empty> : <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <Stat label="Eaten" value={sum.inAvg != null ? num(sum.inAvg) : '—'} sub={`kcal/day · ${sum.days} full day${sum.days === 1 ? '' : 's'}`} />
          <Stat label="Burned" value={sum.outAvg != null ? num(sum.outAvg) : '—'} sub="kcal/day" />
          <Stat label="Net" value={sign(sum.netAvg)} sub={sum.kgW != null ? `≈ ${sign(sum.kgW, ' kg')}/week${sum.actualKgW != null ? ` · scale ${sign(sum.actualKgW, ' kg')}` : ''}` : 'kcal/day'} tone={sum.netAvg != null && sum.netAvg < -1000 ? 'warn' : undefined} />
          <Stat label="Protein" value={sum.protein != null ? `${sum.protein} g` : '—'} sub={`aim ~${sum.proteinAim} g · carbs ${sum.carbs ?? '—'} g`} tone={sum.protein != null && sum.protein < sum.proteinAim * 0.8 ? 'warn' : undefined} />
        </div>
        {view === 'day' ? <>
          <Legend items={[{ label: 'Protein', color: 'var(--s1)', box: true }, { label: 'Carbs', color: 'var(--s4)', box: true }, { label: 'Fat', color: 'var(--s7)', box: true }, { label: 'Burned', color: 'var(--s2)' }, { label: 'Target', color: 'var(--good)', dashed: true }]} />
          <FitChart height={H}>
            <ComposedChart data={shown} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={20} /><YAxis {...AXIS} />
              <Tooltip content={({ active, payload }) => active && payload?.[0] ? (() => { const d = payload[0].payload as CalDay; return (
                <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg num">
                  <p className="font-semibold">{tick(d.date)}{d.today ? ' (so far)' : ''}</p>
                  <p>Eaten {num(d.in)} · burned {num(d.out)} · target {num(d.target)}</p>
                  <p className={d.net < 0 ? 'text-good' : 'text-bad'}>Net {d.net > 0 ? '+' : ''}{num(d.net)} kcal</p>
                  <p className="text-muted">P {d.protein} g · C {d.carbs} g · F {d.fat} g</p>
                </div>) })() : null} />
              <Bar dataKey="pK" name="Protein" stackId="in" fill="var(--s1)" isAnimationActive={false} />
              <Bar dataKey="cK" name="Carbs" stackId="in" fill="var(--s4)" isAnimationActive={false} />
              <Bar dataKey="fK" name="Fat" stackId="in" fill="var(--s7)" isAnimationActive={false} />
              <Bar dataKey="oK" name="Other" stackId="in" fill="var(--line)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line dataKey="out" name="Burned" stroke="var(--s2)" strokeWidth={2} dot={{ r: 3, fill: 'var(--s2)' }} isAnimationActive={false} />
              <Line dataKey="target" name="Target" stroke="var(--good)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </FitChart>
          <p className="label mt-3 mb-1">Daily balance (eaten − burned)</p>
          <FitChart height={90}>
            <BarChart data={shown} margin={{ top: 0, right: 5, left: -10, bottom: 0 }}>
              <XAxis dataKey="date" hide /><YAxis {...AXIS} />
              <ReferenceLine y={0} stroke="var(--line)" /><ReferenceLine y={-sum.deficit} stroke="var(--good)" strokeDasharray="4 4" />
              <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x > 0 ? '+' : ''}${num(x)} kcal`} />} />
              <Bar dataKey="net" name="Net" isAnimationActive={false} radius={[3, 3, 3, 3]}>
                {shown.map(d => <Cell key={d.date} fill={d.today ? 'var(--line)' : d.net > 0 ? 'var(--bad)' : d.net < -1000 ? 'var(--warn)' : 'var(--good)'} />)}
              </Bar>
            </BarChart>
          </FitChart>
          <p className="text-[11px] text-muted mt-1">Green = deficit, orange = more than 1,000 below (under-fuelling), red = surplus, grey = today so far. Only days with food logged count; meal estimates are ±15–20%.</p>
        </> : <>
          <Legend items={[{ label: 'In (eaten)', color: 'var(--s4)', box: true }, { label: 'Out (burned)', color: 'var(--s2)' }]} />
          <FitChart height={H}>
            <ComposedChart data={weeks} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} />
              <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} fmt={x => `${num(x)} kcal`} />} />
              <Bar dataKey="in" name="In" fill="var(--s4)" radius={[4, 4, 0, 0]} />
              <Line dataKey="out" name="Out" stroke="var(--s2)" strokeWidth={2} dot={{ r: 3, fill: 'var(--s2)' }} />
            </ComposedChart>
          </FitChart>
          {weeks.length > 0 && (() => { const last = weeks[weeks.length - 1]; return <p className="text-xs text-muted mt-1 num">Week of {tick(last.wk)}: {last.days} days logged · net {last.net > 0 ? '+' : ''}{num(last.net)} kcal/day ≈ {last.kgWeek > 0 ? '+' : ''}{last.kgWeek} kg/week · protein {num(last.protein)} g/day</p> })()}
        </>}
      </>}
    </Card>
  )
}
