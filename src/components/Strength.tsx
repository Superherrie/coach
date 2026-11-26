import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { Card, Scale } from './ui'
import { getEvents, getPhases, getPlanned, getSets, useLoad } from '../lib/data'
import { addDays, dmy, monday, today } from '../lib/format'
import { e1rm, history, modeFor, suggest, type Mode, type Suggestion } from '../lib/progression'
import { supabase } from '../lib/supabase'
import type { GymSet } from '../lib/types'
import type { WEx, Workout } from '../pages/Workouts'

interface Row { kg: string; reps: string; rir: string; done: boolean }
// unit: a carry or similar logged as distance ('m') instead of reps — fixed sets, no 1RM records, distance in the reps column
type ExS = WEx & { type?: string; rep_min?: number; rep_max?: number; increment_kg?: number; load?: string; unit?: string }
const dosage = (e: ExS, sets?: number) => e.unit
  ? `${e.sets ?? 1} × ${e.rep_max} ${e.unit}`
  : `${sets || e.sets} × ${e.rep_min === e.rep_max ? e.rep_max : `${e.rep_min}–${e.rep_max}`}${e.per_side ? ' each leg' : ''}`

/** suggestions for today, aware of the training phase (build / hold / skip) */
// eslint-disable-next-line react-refresh/only-export-components
export function useSuggestions(w: Workout) {
  const { data } = useLoad(async () => {
    const t = today(), wk = monday(t)
    const [sets, phases, events, planned] = await Promise.all([getSets(addDays(t, -365)), getPhases(), getEvents(), getPlanned(addDays(wk, -7), addDays(wk, 6))])
    const load = (a: string, b: string) => planned.filter(p => p.date >= a && p.date <= b).reduce((s, p) => s + (p.planned_load ?? 0), 0)
    const mode = modeFor(t, phases, events, { thisWeek: load(wk, addDays(wk, 6)), lastWeek: load(addDays(wk, -7), addDays(wk, -1)) })
    return { sets, mode }
  }, [w.id])
  return useMemo(() => {
    const sets = data?.sets ?? []
    const per = Object.fromEntries((w.exercises as ExS[]).map(e => { const past = history(sets, e.name); return [e.key, { s: suggest(e, past, data?.mode), past }] }))
    return { per, mode: data?.mode, sets, ready: !!data }
  }, [data, w])
}

function ModeBanner({ m }: { m?: Mode }) {
  if (!m) return null
  const c = m.kind === 'skip' ? 'bg-bad/10 text-bad' : m.kind === 'hold' ? 'bg-warn/12 text-warn' : 'bg-good/10 text-good'
  return <p className={`rounded-xl px-3 py-2 text-sm ${c}`}><b>{m.label}.</b> {m.why}</p>
}

export function NextWeights({ w }: { w: Workout }) {
  const { per, mode } = useSuggestions(w)
  return (
    <Card title="This session" sub="Weights from your last session, by double progression, adjusted for where you are in the plan">
      <ModeBanner m={mode} />
      <ul className="text-sm divide-y divide-line mt-2">
        {(w.exercises as ExS[]).map(e => { const x = per[e.key]; return (
          <li key={e.key} className="py-2 flex items-center gap-2">
            <span className="flex-1 min-w-0">{e.name}<span className="block text-xs text-muted">{x?.s.sets ?? e.sets} × {e.rep_min}–{e.rep_max}{e.per_side ? ' each leg' : ''}{x?.past[0] ? ` · last ${dmy(x.past[0].date, { year: false })}` : ''}</span></span>
            <Dir s={x?.s} />
          </li>
        ) })}
      </ul>
    </Card>
  )
}

function Dir({ s }: { s?: Suggestion }) {
  if (!s) return null
  const c = s.dir === 'up' ? 'text-good' : s.dir === 'down' ? 'text-warn' : s.dir === 'skip' ? 'text-bad' : 'text-ink'
  return <span className={`num font-semibold ${c}`}>{s.dir === 'up' ? '↑ ' : s.dir === 'down' ? '↓ ' : s.dir === 'hold' ? '= ' : ''}{s.dir === 'skip' ? 'skip' : s.kg != null ? `${s.kg} kg` : 'choose'}</span>
}

function beep() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.25, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3); o.start(); o.stop(ctx.currentTime + 0.3)
  } catch { /* no audio */ }
  try { navigator.vibrate?.([150, 80, 150]) } catch { /* no vibration */ }
}

/** personal records: today's best estimated 1RM per lift against everything before today */
function prs(exs: ExS[], rows: Record<string, Row[]>, past: GymSet[]) {
  return exs.filter(e => !e.unit).flatMap(e => {
    const todayBest = Math.max(0, ...(rows[e.key] ?? []).filter(r => r.done && +r.kg > 0 && +r.reps > 0).map(r => e1rm(+r.kg, +r.reps)))
    const before = Math.max(0, ...past.filter(s => s.exercise.toLowerCase() === e.name.toLowerCase() && s.date < today() && s.kg && s.reps).map(s => e1rm(s.kg!, s.reps!)))
    return todayBest > 0 && todayBest > before ? [{ name: e.name, e1rm: Math.round(todayBest), prev: before ? Math.round(before) : null }] : []
  })
}

/** the gym session: every exercise with its sets; kg / reps pre-filled from the progression, ✓ starts the rest timer */
export function StrengthPlayer({ w, onExit }: { w: Workout; onExit: () => void }) {
  const nav = useNavigate()
  const { per, mode, sets: past, ready } = useSuggestions(w)
  const exs = w.exercises as ExS[]
  const [rows, setRows] = useState<Record<string, Row[]>>({})
  const [rest, setRest] = useState<{ left: number; next: string } | null>(null)
  const [rpe, setRpe] = useState<number | null>(null); const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>()
  const [done, setDone] = useState<{ minutes: number; records: ReturnType<typeof prs>; sets: number } | null>(null)
  const started = useRef(Date.now())

  // pre-fill once the history has loaded; the phase decides how many sets
  useEffect(() => {
    if (Object.keys(rows).length || !ready) return
    setRows(Object.fromEntries(exs.map(e => {
      const s = per[e.key]?.s; const n = e.unit ? (e.sets ?? 1) : s && s.sets > 0 ? s.sets : (e.sets ?? 3)
      return [e.key, [...Array(n)].map(() => ({ kg: s?.kg != null ? String(s.kg) : '', reps: String(s?.reps || e.rep_max || ''), rir: '', done: false }))]
    })))
  }, [ready, per, exs, rows])
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lock: any; (navigator as any).wakeLock?.request('screen').then((l: unknown) => { lock = l }).catch(() => {})
    return () => { lock?.release?.() }
  }, [])
  useEffect(() => {
    if (!rest) return
    if (rest.left <= 0) { beep(); setRest(null); return }
    const t = setTimeout(() => setRest(r => (r ? { ...r, left: r.left - 1 } : r)), 1000)
    return () => clearTimeout(t)
  }, [rest])

  const set = (k: string, i: number, f: Partial<Row>) => setRows(r => ({ ...r, [k]: r[k].map((x, j) => (j === i ? { ...x, ...f } : x)) }))
  function tick(e: ExS, i: number) {
    const r = rows[e.key][i]; const nowDone = !r.done
    setRows(all => ({ ...all, [e.key]: all[e.key].map((x, j) => (j === i ? { ...x, done: nowDone } : j > i && !x.done && i === 0 ? { ...x, kg: r.kg } : x)) }))
    if (nowDone) {
      const left = rows[e.key].filter((x, j) => j !== i && !x.done).length
      const nextEx = exs[exs.indexOf(e) + 1]
      setRest({ left: e.rest_s ?? 90, next: left ? `${e.name} — set ${i + 2}` : nextEx ? nextEx.name : 'Finish' })
    }
  }
  const doneSets = Object.values(rows).flat().filter(r => r.done).length

  async function save() {
    setBusy(true); setErr(undefined)
    try {
      const minutes = Math.max(1, Math.round((Date.now() - started.current) / 60000))
      const { data: p } = await supabase.from('tr_planned').select('id,slot').eq('date', today()).or(`targets->>workout_id.eq.${w.id},sport.eq.gym_legs`).limit(1)
      const id = `m-${crypto.randomUUID()}`
      const slot = p?.[0]?.slot ?? (new Date().getHours() < 12 ? 'am' : 'pm')
      const { error } = await supabase.from('tr_activities').insert({ id, source: 'manual', date: today(), slot, sport: 'gym_legs', name: w.name, duration_s: minutes * 60, rpe, notes: notes || null, planned_id: p?.[0]?.id ?? null })
      if (error) throw new Error(error.message)
      const out = exs.flatMap(e => (rows[e.key] ?? []).filter(r => r.done).map((r, j) => ({ activity_id: id, date: today(), exercise: e.name, set_no: j + 1, reps: r.reps ? +r.reps : null, kg: r.kg !== '' ? +r.kg : null, rir: r.rir !== '' ? +r.rir : null })))
      if (out.length) { const g = await supabase.from('tr_gym_sets').insert(out); if (g.error) throw new Error(g.error.message) }
      await supabase.from('tr_workout_log').insert({ workout_id: w.id, date: today(), minutes })
      if (p?.[0]) await supabase.from('tr_planned').update({ status: 'done' }).eq('id', p[0].id)
      setDone({ minutes, records: prs(exs, rows, past), sets: out.length })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (done) return (
    <div className="py-10 text-center space-y-4">
      <p className="display text-4xl">Done 💪</p>
      <p className="text-muted">{w.name} · {done.sets} sets · {done.minutes} min</p>
      {done.records.length > 0 && (
        <div className="card p-4 text-left">
          <p className="label text-ember">Personal records 🏆</p>
          <ul className="text-sm mt-1 space-y-1">{done.records.map(r => <li key={r.name} className="flex justify-between"><span>{r.name}</span><span className="num font-semibold">{r.e1rm} kg est. 1RM{r.prev ? <span className="text-muted font-normal"> (was {r.prev})</span> : ' (first)'}</span></li>)}</ul>
        </div>
      )}
      <button className="btn btn-primary w-full" onClick={() => nav('/')}>Back to Today</button>
    </div>
  )

  return (
    <div className="py-3 space-y-4 pb-32" data-busy>
      <div className="flex items-center gap-2">
        <button className="text-sm text-muted flex items-center gap-1" onClick={() => { if (!doneSets || confirm('Leave without saving these sets?')) onExit() }}><Icon name="close" size={16} />End</button>
        <h1 className="display text-2xl flex-1 truncate">{w.name}</h1>
        <span className="text-xs text-muted num">{doneSets} sets</span>
      </div>
      <ModeBanner m={mode} />
      {exs.map(e => { const x = per[e.key]; return (
        <Card key={e.key} title={e.name} sub={`${dosage(e, x?.s.sets)} · ${e.load ?? ''} · rest ${Math.round((e.rest_s ?? 90) / 60 * 10) / 10} min`} right={e.unit ? undefined : <Dir s={x?.s} />}>
          {x?.s && !e.unit && <p className={`text-xs mb-2 ${x.s.dir === 'up' ? 'text-good' : x.s.dir === 'down' || x.s.dir === 'hold' ? 'text-warn' : 'text-muted'}`}>{x.s.why}</p>}
          <div className="space-y-1.5">
            <div className="grid grid-cols-[2rem_1fr_1fr_3.6rem_2.6rem] gap-1.5 text-[11px] text-muted px-1"><span>Set</span><span>kg{e.load?.includes('each') ? ' (each)' : ''}</span><span>{e.unit === 'm' ? 'Metres' : e.unit ?? `Reps${e.per_side ? '/leg' : ''}`}</span><span title="Reps in reserve: how many more you could have done">In tank</span><span /></div>
            {(rows[e.key] ?? []).map((r, i) => (
              <div key={i} className={`grid grid-cols-[2rem_1fr_1fr_3.6rem_2.6rem] gap-1.5 items-center rounded-xl px-1 ${r.done ? 'bg-good/10' : ''}`}>
                <span className="num text-sm text-center">{i + 1}</span>
                <input className="input !py-1.5 num" inputMode="decimal" value={r.kg} placeholder="kg" onChange={ev => set(e.key, i, { kg: ev.target.value })} />
                <input className="input !py-1.5 num" inputMode="numeric" value={r.reps} onChange={ev => set(e.key, i, { reps: ev.target.value })} />
                <select className="input !py-1.5 !px-1 num text-sm" value={r.rir} onChange={ev => set(e.key, i, { rir: ev.target.value })} aria-label="Reps in reserve">
                  <option value="">–</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3+</option>
                </select>
                <button onClick={() => tick(e, i)} aria-label={`Set ${i + 1} done`} className={`h-9 rounded-xl grid place-items-center ${r.done ? 'bg-good text-white' : 'bg-surface-2 text-muted'}`}><Icon name="check" size={18} /></button>
              </div>
            ))}
          </div>
          <button className="text-xs text-muted underline mt-2" onClick={() => setRows(all => ({ ...all, [e.key]: [...all[e.key], { kg: all[e.key][all[e.key].length - 1]?.kg ?? '', reps: all[e.key][all[e.key].length - 1]?.reps ?? '', rir: '', done: false }] }))}>+ add a set</button>
          <details className="mt-2"><summary className="text-xs text-brand cursor-pointer">Form cues{e.video_id ? ' and demo' : ''}</summary>
            <ul className="text-sm space-y-1 mt-1">{e.cues.map(c => <li key={c} className="flex gap-2"><span className="text-muted">•</span>{c}</li>)}</ul>
            {e.video_id && <a className="text-xs text-brand underline" href={`https://www.youtube.com/watch?v=${e.video_id}`} target="_blank" rel="noreferrer">▶ {e.video_title}</a>}
          </details>
        </Card>
      ) })}
      <p className="text-[11px] text-muted -mt-2">"In tank" = reps in reserve: how many more you could have done (0 = failure). Weight only goes up when the last set wasn't to failure.</p>

      <Card title="How did it feel?">
        <Scale value={rpe} onChange={setRpe} min={1} max={10} labels={['easy', 'max effort']} />
        <input className="input mt-2" placeholder="Notes (sore knee, felt strong…)" value={notes} onChange={e => setNotes(e.target.value)} />
        {err && <p className="text-sm text-bad mt-2">{err}</p>}
        <button className="btn btn-primary w-full mt-3" disabled={busy || !doneSets} onClick={() => void save()}>{busy ? 'Saving…' : `Save session (${doneSets} sets)`}</button>
      </Card>

      {rest && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 z-30 px-4">
          <div className="mx-auto max-w-md rounded-2xl bg-brand-deep text-white px-4 py-3 shadow-xl flex items-center gap-3">
            <span className="display text-4xl num w-20">{Math.floor(rest.left / 60)}:{String(rest.left % 60).padStart(2, '0')}</span>
            <span className="flex-1 min-w-0 text-sm"><span className="block text-white/60 text-xs">Rest · next</span><span className="truncate block">{rest.next}</span></span>
            <button className="chip !bg-white/15 !text-white" onClick={() => setRest(r => (r ? { ...r, left: r.left + 30 } : r))}>+30s</button>
            <button className="chip !bg-white/15 !text-white" onClick={() => setRest(null)}>Skip</button>
          </div>
        </div>
      )}
    </div>
  )
}
