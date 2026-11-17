import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { navyBf } from '../lib/body'
import type { Paces } from '../lib/paces'
import Icon from '../components/Icon'
import { Card, Scale, Stat } from '../components/ui'
import { LogSheet, PlanSheet, SessionCard } from '../components/Session'
import Proposals from '../components/Proposals'
import { FoodCard } from '../components/Food'
import { myId, getActs, getEvents, getLastRun, getPending, getPhases, getPlanned, getSets, getSettings, getWellness, useLoad } from '../lib/data'
import { addDays, daysBetween, dmy, num, stamp, today, weekday } from '../lib/format'
import { pmc, readiness } from '../lib/load'
import { supabase } from '../lib/supabase'
import type { Activity, Planned, Slot, Wellness } from '../lib/types'

// eslint-disable-next-line react-refresh/only-export-components
export function useSynced(reload: () => unknown) {
  useEffect(() => { const f = () => void reload(); window.addEventListener('tr-synced', f); return () => window.removeEventListener('tr-synced', f) }, [reload])
}

export default function Today() {
  const [params, setParams] = useSearchParams(); const nav = useNavigate()
  const [day, setDay] = useState(today())
  const { data, reload } = useLoad(async () => {
    const [planned, acts, well, phases, events, pending, run, settings, sets, weekly] = await Promise.all([
      getPlanned(day, day), getActs(addDays(day, -120), addDays(day, 0)), getWellness(addDays(day, -35), day), getPhases(), getEvents(), getPending(), getLastRun(), getSettings(), getSets(addDays(day, -120)), getLastRun('weekly'),
    ])
    const dayIds = acts.filter(a => a.date === day).map(a => a.id)
    const { data: reps } = dayIds.length ? await supabase.from('tr_session_reports').select('activity_id,report').in('activity_id', dayIds) : { data: [] }
    const reports = Object.fromEntries((reps ?? []).map(r => [r.activity_id, r.report]))
    return { planned, acts, well, phases, events, pending, run, settings, sets, weekly, reports }
  }, [day])
  useSynced(reload)
  const [log, setLog] = useState<{ slot: Slot; planned?: Planned; act?: Activity }>()
  const [edit, setEdit] = useState<Planned>()
  useEffect(() => { if (params.get('log')) { setLog({ slot: new Date().getHours() < 12 ? 'am' : 'pm' }); setParams({}, { replace: true }) } }, [params, setParams])
  // the "Meal" shortcut in the top bar lands here: jump to today and open Add a meal
  const [mealReq, setMealReq] = useState(0)
  useEffect(() => { if (params.get('meal')) { setDay(today()); setMealReq(n => n + 1); setParams({}, { replace: true }) } }, [params, setParams])

  const stats = useMemo(() => {
    if (!data) return null
    const p = pmc(data.acts, addDays(day, -120), day)
    return { form: p[p.length - 1], ...readiness(data.well, day) }
  }, [data, day])
  const lastKg = useMemo(() => {
    const m: Record<string, number> = {}; for (const s of data?.sets ?? []) if (s.kg) m[s.exercise] = s.kg; return m
  }, [data])

  if (!data || !stats) return <p className="text-muted py-10 text-center animate-pulse">Loading…</p>
  const phase = data.phases.find(p => day >= p.start_date && day <= p.end_date)
  const comrades = data.events.find(e => e.name.startsWith('Comrades'))
  const next = data.events.find(e => e.date >= day && e.kind !== 'checkpoint')
  const dayActs = data.acts.filter(a => a.date === day)
  const bySlot = (s: Slot) => {
    const p = data.planned.find(x => x.slot === s)
    return { p, acts: dayActs.filter(a => (p && a.planned_id === p.id) || (!a.planned_id && (a.slot ?? 'am') === s)) }
  }
  const w = stats.w
  const isToday = day === today()

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center gap-2">
        <button className="p-2 -ml-2 text-muted" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><Icon name="left" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="display text-3xl leading-none">{isToday ? 'Today' : weekday(day)}</h1>
          <p className="text-xs text-muted mt-1">{dmy(day, { weekday: true })}{phase ? ` · ${phase.name}` : ''}{comrades ? ` · ${daysBetween(day, comrades.date)} days to Comrades` : ''}</p>
        </div>
        {!isToday && <button className="chip" onClick={() => setDay(today())}>Today</button>}
        <button className="p-2 -mr-2 text-muted" onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><Icon name="right" /></button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Rest HR" value={num(w?.resting_hr)} sub={stats.rhrBase ? `avg ${Math.round(stats.rhrBase)}` : 'from Garmin'} tone={w?.resting_hr && stats.rhrBase && w.resting_hr - stats.rhrBase >= 5 ? 'bad' : undefined} />
        <Stat label="HRV" value={num(w?.hrv)} sub={stats.hrvBase ? `avg ${Math.round(stats.hrvBase)}` : 'overnight'} tone={w?.hrv && stats.hrvBase && w.hrv < stats.hrvBase * 0.85 ? 'bad' : undefined} />
        <Stat label="Sleep" value={w?.sleep_h ? `${w.sleep_h}h` : '—'} sub={w?.sleep_score ? `score ${Math.round(w.sleep_score)}` : ''} />
        <Stat label="Form" value={num(stats.form?.form)} sub={`fit ${num(stats.form?.fitness)} · fat ${num(stats.form?.fatigue)}`} tone={(stats.form?.form ?? 0) < -25 ? 'bad' : (stats.form?.form ?? 0) < -10 ? 'warn' : 'good'} />
      </div>
      {stats.flags.length > 0 && (
        <div className="rounded-2xl bg-bad/10 text-bad px-4 py-3 text-sm space-y-0.5">{stats.flags.map(f => <p key={f} className="flex gap-2"><Icon name="heart" size={16} className="shrink-0 mt-0.5" />{f}</p>)}</div>
      )}

      {isToday && data.weekly && Date.now() - Date.parse(data.weekly.created_at) < 36 * 3600e3 && (
        <Card title={<span className="flex items-center gap-2"><Icon name="calendar" size={18} className="text-ember" />Week review</span>} sub={stamp(data.weekly.created_at)}>
          {data.weekly.today_note && <p className="font-medium text-sm mb-1">{data.weekly.today_note}</p>}
          <p className="text-sm text-muted whitespace-pre-line">{data.weekly.summary}</p>
        </Card>
      )}
      {isToday && data.run && (
        <Card title={<span className="flex items-center gap-2"><Icon name="spark" size={18} className="text-ember" />Coach</span>} sub={`Review ${stamp(data.run.created_at)}`}
          right={<button className="chip" onClick={() => nav('/coach')}>Ask <Icon name="right" size={12} /></button>}>
          {data.run.today_note && <p className="font-medium text-sm mb-1.5">{data.run.today_note}</p>}
          <p className="text-sm text-muted whitespace-pre-line">{data.run.summary}</p>
        </Card>
      )}
      <Proposals items={data.pending} onDone={() => void reload()} />

      {(['am', 'pm'] as Slot[]).map(s => { const { p, acts } = bySlot(s); return (
        <SessionCard key={s} slot={s} p={p} acts={acts} paces={data.settings.paces as Paces | null} reports={data.reports} onLog={() => setLog({ slot: s, planned: p })} onEdit={() => p && setEdit(p)} onOpenAct={a => setLog({ slot: s, planned: p, act: a })} />
      ) })}

      <CheckIn day={day} w={w} onSaved={() => void reload()} height={data.settings.height_cm}
        last={{ waist: [...data.well].reverse().find(x => x.waist_cm)?.waist_cm ?? null, neck: [...data.well].reverse().find(x => x.neck_cm)?.neck_cm ?? null }} />

      <FoodCard day={day} acts={dayActs} openReq={mealReq} deficit={data.settings.kcal_deficit ?? 500} body={{
        weight: [...data.well].reverse().find(x => x.weight_kg)?.weight_kg ?? 96,
        height: data.settings.height_cm ?? 182,
        age: new Date(day).getFullYear() - (data.settings.birth_year ?? 1980),
        factor: data.settings.activity_factor ?? 1.25,
      }} />

      {next && <p className="text-xs text-muted text-center">Next: <span className="font-medium text-ink">{next.name}</span> · {dmy(next.date)} · {daysBetween(day, next.date)} days</p>}

      {log && <LogSheet date={day} slot={log.slot} planned={log.planned} act={log.act} lastKg={lastKg}
        existingSets={log.act ? data.sets.filter(x => x.activity_id === log.act!.id) : undefined}
        onClose={() => setLog(undefined)} onSaved={() => { setLog(undefined); void reload() }} />}
      {edit && <PlanSheet p={edit} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); void reload() }} onAskCoach={m => nav(`/coach?q=${encodeURIComponent(m)}`)} />}
    </div>
  )
}

/** morning check-in: legs, energy, ankle, weight, waist (Garmin fills resting HR / HRV / sleep on its own) */
function CheckIn({ day, w, onSaved, height, last }: { day: string; w?: Wellness; onSaved: () => void; height: number | null; last: { waist: number | null; neck: number | null } }) {
  const [f, setF] = useState({ legs: w?.legs ?? null, energy: w?.energy ?? null, ankle_pain: w?.ankle_pain ?? null, weight_kg: w?.weight_kg ? String(w.weight_kg) : '', waist_cm: w?.waist_cm ? String(w.waist_cm) : '', neck_cm: w?.neck_cm ? String(w.neck_cm) : '', resting_hr: '', notes: w?.notes ?? '' })
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false)
  useEffect(() => { setF({ legs: w?.legs ?? null, energy: w?.energy ?? null, ankle_pain: w?.ankle_pain ?? null, weight_kg: w?.weight_kg ? String(w.weight_kg) : '', waist_cm: w?.waist_cm ? String(w.waist_cm) : '', neck_cm: w?.neck_cm ? String(w.neck_cm) : '', resting_hr: '', notes: w?.notes ?? '' }); setSaved(false) }, [w, day])
  const done = w?.legs != null || w?.ankle_pain != null
  async function save() {
    setBusy(true)
    const manual = { ...(w?.manual ?? {}) } as Record<string, boolean>
    const row: Record<string, unknown> = { date: day, legs: f.legs, energy: f.energy, ankle_pain: f.ankle_pain, notes: f.notes || null, updated_at: new Date().toISOString() }
    if (f.weight_kg && +f.weight_kg !== w?.weight_kg) { row.weight_kg = +f.weight_kg; manual.weight_kg = true }
    if (f.waist_cm && +f.waist_cm !== w?.waist_cm) { row.waist_cm = +f.waist_cm; manual.waist_cm = true }
    if (f.neck_cm && +f.neck_cm !== w?.neck_cm) { row.neck_cm = +f.neck_cm; manual.neck_cm = true }
    if (f.resting_hr) { row.resting_hr = +f.resting_hr; manual.resting_hr = true }
    row.manual = manual
    row.user_id = await myId()
    await supabase.from('tr_wellness').upsert(row, { onConflict: 'user_id,date' })
    setBusy(false); setSaved(true); onSaved()
  }
  const whtr = f.waist_cm && height ? +f.waist_cm / height : null
  // tape estimate uses today's numbers, or the last ones measured (neck barely changes week to week)
  const bf = navyBf(+f.waist_cm || last.waist, +f.neck_cm || last.neck, height)
  return (
    <Card title="Check-in" sub={done ? 'Saved — change anything and save again' : '20 seconds. Garmin fills resting HR, HRV and sleep.'}>
      <div className="space-y-3">
        <div><p className="label mb-1">Legs</p><Scale value={f.legs} onChange={v => setF({ ...f, legs: v })} min={1} max={5} labels={['fresh', 'very sore']} /></div>
        <div><p className="label mb-1">Energy</p><Scale value={f.energy} onChange={v => setF({ ...f, energy: v })} min={1} max={5} labels={['flat', 'great']} /></div>
        <div><p className="label mb-1">Ankle pain</p><Scale value={f.ankle_pain} onChange={v => setF({ ...f, ankle_pain: v })} min={0} max={10} labels={['none', 'worst']} />
          {(f.ankle_pain ?? 0) > 3 && <p className="text-xs text-bad mt-1">Above 3/10: the plan says back off running for a week. The coach will swap runs for rides.</p>}</div>
        <div className="grid grid-cols-4 gap-2">
          <label><span className="label">Weight kg</span><input inputMode="decimal" className="input mt-1" value={f.weight_kg} onChange={e => setF({ ...f, weight_kg: e.target.value })} /></label>
          <label><span className="label">Waist cm</span><input inputMode="decimal" className="input mt-1" value={f.waist_cm} placeholder={last.waist ? String(last.waist) : 'navel'} onChange={e => setF({ ...f, waist_cm: e.target.value })} /></label>
          <label><span className="label">Neck cm</span><input inputMode="decimal" className="input mt-1" value={f.neck_cm} placeholder={last.neck ? String(last.neck) : 'weekly'} onChange={e => setF({ ...f, neck_cm: e.target.value })} /></label>
          <label><span className="label">Rest HR</span><input inputMode="numeric" className="input mt-1" value={f.resting_hr} placeholder={w?.resting_hr ? String(w.resting_hr) : 'Garmin'} onChange={e => setF({ ...f, resting_hr: e.target.value })} /></label>
        </div>
        {(whtr || bf) && <p className="text-xs text-muted">
          {whtr ? `Waist-to-height ${whtr.toFixed(2)} ${whtr < 0.5 ? '(healthy, under 0.50)' : '(target under 0.50)'}` : ''}
          {whtr && bf ? ' · ' : ''}{bf ? `Body fat ≈ ${bf}% (tape, ±3–4%)` : ''}
        </p>}
        <p className="text-[11px] text-muted -mt-1">Waist at the navel and neck just below the Adam's apple, relaxed, same time of day. <Link to="/body" className="text-brand underline">Progress photos →</Link></p>
        <input className="input" placeholder="Anything else? (sick, travel, stress…)" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
        <button className="btn btn-primary w-full" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save check-in'}</button>
      </div>
    </Card>
  )
}
