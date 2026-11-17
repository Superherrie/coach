import { useMemo, useState } from 'react'
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { AXIS, Card, Empty, GRID, Legend, Stat, Tip } from '../components/ui'
import { getActs, getEvents, getPlanned, getSets, getSettings, getWellness, useLoad } from '../lib/data'
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
    const [acts, well, planned, sets, settings, events] = await Promise.all([getActs(warm, t), getWellness(from, t), getPlanned(from, addDays(t, 210)), getSets(from), getSettings(), getEvents()])
    return { acts, well, planned, sets, settings, events }
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

    // FTP as intervals.icu saw it on each ride
    const ftp = data.acts.filter(a => a.date >= from && a.sport === 'ride' && a.ftp).map(a => ({ date: a.date, ftp: a.ftp }))
    return { pm, atRace, nowP, ramp, wk, well, lastKg, lastWaist, easyRuns, easyRides, zones, gym, liftsSeen, ftp, race }
  }, [data, from, t, warm])

  if (!data || !v) return <p className="text-muted py-10 text-center animate-pulse">Loading…</p>
  const h = data.settings.height_cm
  const whtr = v.lastWaist && h ? v.lastWaist / h : null
  const avgPct = (() => { const z = v.zones.slice(-4); return z.length ? Math.round(z.reduce((s, x) => s + x.easy, 0) / z.length) : null })()

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

      <Card title="Fitness, fatigue and form" sub={`Daily training load as fitness (42-day) and fatigue (7-day). Dashed = what the plan would do to race day (fitness ${num(v.atRace?.fitness)} on ${dm(v.race)}).`}>
        <Legend items={[{ label: 'Fitness', color: 'var(--s2)' }, { label: 'Fatigue', color: 'var(--s1)' }, { label: 'Planned', color: 'var(--muted)', dashed: true }]} />
        <ResponsiveContainer width="100%" height={H}>
          <LineChart data={v.pm} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} />
            <Tooltip content={<Tip labelFormat={tick} />} />
            <Line dataKey="fitness" name="Fitness" stroke="var(--s2)" strokeWidth={2} dot={false} connectNulls={false} />
            <Line dataKey="fatigue" name="Fatigue" stroke="var(--s1)" strokeWidth={2} dot={false} />
            <Line dataKey="pFit" name="Fitness (plan)" stroke="var(--s2)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
            <Line dataKey="pFat" name="Fatigue (plan)" stroke="var(--s1)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            <ReferenceLine x={t} stroke="var(--muted)" />
          </LineChart>
        </ResponsiveContainer>
        <p className="label mt-3 mb-1">Form</p>
        <ResponsiveContainer width="100%" height={110}>
          <ComposedChart data={v.pm.filter(d => d.date <= t)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} />
            <Tooltip content={<Tip labelFormat={tick} />} />
            <ReferenceLine y={-25} stroke="var(--bad)" strokeDasharray="3 3" /><ReferenceLine y={0} stroke="var(--line)" />
            <Area dataKey="form" name="Form" stroke="var(--s7)" fill="var(--s7)" fillOpacity={0.15} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted mt-1">Below −25 (red line) = deep fatigue; the coach eases the next day. Fitness rising more than ~8 a month is a fast ramp.</p>
      </Card>

      <Card title="Running volume" sub="Weekly km done against the planned km (the plan's ceiling), and the week's longest run">
        <Legend items={[{ label: 'Run km', color: 'var(--s1)', box: true }, { label: 'Planned', color: 'var(--muted)', dashed: true }, { label: 'Longest run', color: 'var(--s2)' }]} />
        <ResponsiveContainer width="100%" height={H}>
          <ComposedChart data={v.wk} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} />
            <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} />} />
            <Bar dataKey="km" name="Run km" fill="var(--s1)" radius={[4, 4, 0, 0]} />
            <Line dataKey="kmPlan" name="Planned km" stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={2} dot={false} />
            <Line dataKey="long" name="Longest run" stroke="var(--s2)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Hours by type" sub="Weekly training time. Upper-body gym is recovery-grade and counts at 30% in the load.">
        <Legend items={[{ label: 'Run', color: 'var(--s1)', box: true }, { label: 'Ride', color: 'var(--s2)', box: true }, { label: 'Legs', color: 'var(--s3)', box: true }, { label: 'Upper', color: 'var(--s7)', box: true }, { label: 'Other', color: 'var(--s-other)', box: true }]} />
        <ResponsiveContainer width="100%" height={H}>
          <BarChart data={v.wk} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} />
            <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} fmt={x => `${x} h`} />} />
            {(['run', 'ride', 'legs', 'upper', 'other'] as const).map((k, i, arr) => (
              <Bar key={k} dataKey={k} name={k[0].toUpperCase() + k.slice(1)} stackId="h" stroke="var(--surface)" strokeWidth={1}
                fill={{ run: 'var(--s1)', ride: 'var(--s2)', legs: 'var(--s3)', upper: 'var(--s7)', other: 'var(--s-other)' }[k]} radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Resting heart rate" sub="Morning value from Garmin, 7-day average">
          {v.well.some(w => w.rhr) ? <>
            <Legend items={[{ label: 'Daily', color: 'var(--s8)' }, { label: '7-day', color: 'var(--ink)' }]} />
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={v.well} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 3', 'dataMax + 3']} />
                <Tooltip content={<Tip labelFormat={tick} />} />
                <Line dataKey="rhr" name="Resting HR" stroke="var(--s8)" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
                <Line dataKey="rhr7" name="7-day" stroke="var(--ink)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer></> : <Empty>Comes from your Garmin once intervals.icu is connected.</Empty>}
        </Card>
        <Card title="HRV" sub="Overnight HRV (rMSSD) from Garmin, 7-day average — falling = fatigue or illness">
          {v.well.some(w => w.hrv) ? <>
            <Legend items={[{ label: 'Nightly', color: 'var(--s3)' }, { label: '7-day', color: 'var(--ink)' }]} />
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={v.well} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip content={<Tip labelFormat={tick} />} />
                <Line dataKey="hrv" name="HRV" stroke="var(--s3)" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
                <Line dataKey="hrv7" name="7-day" stroke="var(--ink)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer></> : <Empty>Comes from your Garmin once intervals.icu is connected.</Empty>}
        </Card>
        <Card title="Weight" sub={`Daily weigh-ins and 7-day average · checkpoint ≤ ${data.settings.goal_weight_kg ?? 91} kg mid-May`}>
          {v.well.some(w => w.kg) ? <>
            <Legend items={[{ label: 'Weigh-in', color: 'var(--s2)' }, { label: '7-day', color: 'var(--ink)' }, { label: 'Goal', color: 'var(--good)', dashed: true }]} />
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={v.well} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={[(min: number) => Math.min(min, data.settings.goal_weight_kg ?? 91) - 1, 'dataMax + 1']} />
                <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} kg`} />} />
                <ReferenceLine y={data.settings.goal_weight_kg ?? 91} stroke="var(--good)" strokeDasharray="4 4" />
                <Line dataKey="kg" name="Weight" stroke="var(--s2)" strokeWidth={0} dot={{ r: 3 }} connectNulls={false} />
                <Line dataKey="kg7" name="7-day" stroke="var(--ink)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer></> : <Empty>Log weight in the check-in (or a Garmin scale syncs it).</Empty>}
        </Card>
        <Card title="Waist" sub={h ? `cm · waist-to-height under 0.50 = under ${Math.round(h * 0.5)} cm` : 'cm · add your height in Settings for the ratio'}>
          {v.well.some(w => w.waist) ? (
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={v.well.filter(w => w.waist)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 2', 'dataMax + 2']} />
                <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} cm`} />} />
                {h && <ReferenceLine y={Math.round(h * 0.5)} stroke="var(--good)" strokeDasharray="4 4" />}
                <Line dataKey="waist" name="Waist" stroke="var(--s4)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>) : <Empty>Measure weekly at the navel, same time of day, and log it in the check-in.</Empty>}
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Easy-run efficiency" sub="Metres per minute per heartbeat on easy runs (higher = fitter at the same effort). Uses grade-adjusted pace where Garmin has it.">
          {v.easyRuns.length >= 2 ? (
            <ResponsiveContainer width="100%" height={180}>
              <ScatterChart margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} {...AXIS} tickFormatter={x => dm(new Date(x).toISOString().slice(0, 10))} />
                <YAxis dataKey="eff" {...AXIS} domain={['dataMin - 0.05', 'dataMax + 0.05']} tickFormatter={x => x.toFixed(2)} /><ZAxis range={[60, 60]} />
                <Tooltip content={({ active, payload }) => active && payload?.[0] ? (() => { const p = payload[0].payload; return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"><p className="font-semibold">{dm(p.date)} · {p.km} km</p><p className="text-muted num">{pace(p.pace)} at HR {p.hr} · {p.eff}</p></div> })() : null} />
                <Scatter data={v.easyRuns} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} />
              </ScatterChart>
            </ResponsiveContainer>) : <Empty>Needs a few easy runs from Garmin.</Empty>}
        </Card>
        <Card title="Easy-ride efficiency" sub="Watts per heartbeat on easy rides (your 1.74–1.93 range in Oct 2026). Compare within type only.">
          {v.easyRides.length >= 2 ? (
            <ResponsiveContainer width="100%" height={180}>
              <ScatterChart margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} {...AXIS} tickFormatter={x => dm(new Date(x).toISOString().slice(0, 10))} />
                <YAxis dataKey="eff" {...AXIS} domain={['dataMin - 0.1', 'dataMax + 0.1']} tickFormatter={x => x.toFixed(2)} /><ZAxis range={[60, 60]} />
                <Tooltip content={({ active, payload }) => active && payload?.[0] ? (() => { const p = payload[0].payload; return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"><p className="font-semibold">{dm(p.date)}</p><p className="text-muted num">{p.w} W at HR {p.hr} · EF {p.eff}</p></div> })() : null} />
                <Scatter data={v.easyRides} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2} />
              </ScatterChart>
            </ResponsiveContainer>) : <Empty>Needs a few easy rides with power from Garmin.</Empty>}
        </Card>
      </div>

      <Card title="Run intensity (80/20)" sub={`Share of running time by HR zone. Target about 80% easy (Z1–Z2).${avgPct != null ? ` Last 4 weeks: ${avgPct}% easy.` : ''}`}>
        {v.zones.length ? <>
          <Legend items={[{ label: 'Easy Z1–2', color: 'var(--s3)', box: true }, { label: 'Moderate Z3', color: 'var(--s4)', box: true }, { label: 'Hard Z4–5', color: 'var(--s8)', box: true }]} />
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={v.zones} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} domain={[0, 100]} />
              <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} fmt={x => `${x}%`} />} />
              <ReferenceLine y={80} stroke="var(--muted)" strokeDasharray="4 4" />
              <Bar dataKey="easy" name="Easy" stackId="z" fill="var(--s3)" stroke="var(--surface)" strokeWidth={1} />
              <Bar dataKey="mid" name="Moderate" stackId="z" fill="var(--s4)" stroke="var(--surface)" strokeWidth={1} />
              <Bar dataKey="hard" name="Hard" stackId="z" fill="var(--s8)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer></> : <Empty>Needs runs with heart rate from Garmin.</Empty>}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Leg strength" sub="Best estimated one-rep max per session (from kg × reps you log)">
          {v.gym.length ? <>
            <Legend items={v.liftsSeen.map((l, i) => ({ label: l, color: ['var(--s3)', 'var(--s2)', 'var(--s1)', 'var(--s7)'][i] }))} />
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={v.gym} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} />
                <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} kg`} />} />
                {v.liftsSeen.map((l, i) => <Line key={l} dataKey={l} name={l} stroke={['var(--s3)', 'var(--s2)', 'var(--s1)', 'var(--s7)'][i]} strokeWidth={2} dot={{ r: 3 }} connectNulls />)}
              </LineChart>
            </ResponsiveContainer></> : <Empty>Log kg on your leg sessions and the trend appears here.</Empty>}
        </Card>
        <Card title="Plan compliance" sub="Share of planned sessions done each week">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={v.wk.filter(w => w.pct != null)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="wk" {...AXIS} tickFormatter={tick} minTickGap={30} /><YAxis {...AXIS} domain={[0, 100]} />
              <Tooltip content={<Tip labelFormat={l => `Week of ${tick(l)}`} fmt={x => `${x}%`} />} />
              <Bar dataKey="pct" name="Done" fill="var(--s2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {v.ftp.length > 0 && (
        <Card title="FTP" sub={`As intervals.icu applied it per ride · working value ${data.settings.ftp_w ?? 310} W`}>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={v.ftp} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <CartesianGrid {...GRID} /><XAxis dataKey="date" {...AXIS} tickFormatter={tick} minTickGap={40} /><YAxis {...AXIS} domain={['dataMin - 10', 'dataMax + 10']} />
              <Tooltip content={<Tip labelFormat={tick} fmt={x => `${x} W`} />} />
              <Line dataKey="ftp" name="FTP" stroke="var(--s2)" strokeWidth={2} dot={false} type="stepAfter" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
      <p className="text-[11px] text-muted text-center">Load is a TSS-like score: intervals.icu's figure where Garmin measured it, otherwise estimated from minutes × effort.</p>
    </div>
  )
}
