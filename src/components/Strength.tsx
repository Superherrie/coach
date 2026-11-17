import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { Card, Scale } from './ui'
import { getSets, useLoad } from '../lib/data'
import { addDays, dmy, today } from '../lib/format'
import { history, suggest, type Suggestion } from '../lib/progression'
import { supabase } from '../lib/supabase'
import type { WEx, Workout } from '../pages/Workouts'

interface Row { kg: string; reps: string; done: boolean }
type ExS = WEx & { type?: string; rep_min?: number; rep_max?: number; increment_kg?: number; load?: string }

/** what the next session will ask for — shown on the workout page before starting */
// eslint-disable-next-line react-refresh/only-export-components
export function useSuggestions(w: Workout) {
  const { data } = useLoad(() => getSets(addDays(today(), -365)), [w.id])
  return useMemo(() => Object.fromEntries((w.exercises as ExS[]).map(e => [e.key, { s: suggest(e, history(data ?? [], e.name)), past: history(data ?? [], e.name) }])), [data, w])
}

export function NextWeights({ w }: { w: Workout }) {
  const sug = useSuggestions(w)
  return (
    <Card title="This session" sub="Weights from your last session, by double progression">
      <ul className="text-sm divide-y divide-line">
        {(w.exercises as ExS[]).map(e => { const x = sug[e.key]; return (
          <li key={e.key} className="py-2 flex items-center gap-2">
            <span className="flex-1 min-w-0">{e.name}<span className="block text-xs text-muted">{e.sets} × {e.rep_min}–{e.rep_max}{e.per_side ? ' each leg' : ''}{x?.past[0] ? ` · last ${dmy(x.past[0].date, { year: false })}` : ''}</span></span>
            <Dir s={x?.s} />
          </li>
        ) })}
      </ul>
    </Card>
  )
}

function Dir({ s }: { s?: Suggestion }) {
  if (!s) return null
  const c = s.dir === 'up' ? 'text-good' : s.dir === 'down' ? 'text-warn' : 'text-ink'
  return <span className={`num font-semibold ${c}`}>{s.dir === 'up' ? '↑ ' : s.dir === 'down' ? '↓ ' : ''}{s.kg != null ? `${s.kg} kg` : 'choose'}</span>
}

function beep() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.25, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3); o.start(); o.stop(ctx.currentTime + 0.3)
  } catch { /* no audio */ }
  try { navigator.vibrate?.([150, 80, 150]) } catch { /* no vibration */ }
}

/** the gym session: every exercise with its sets; kg and reps pre-filled from the progression, ✓ starts the rest timer */
export function StrengthPlayer({ w, onExit }: { w: Workout; onExit: () => void }) {
  const nav = useNavigate()
  const sug = useSuggestions(w)
  const exs = w.exercises as ExS[]
  const [rows, setRows] = useState<Record<string, Row[]>>({})
  const [rest, setRest] = useState<{ left: number; total: number; next: string } | null>(null)
  const [rpe, setRpe] = useState<number | null>(null); const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>()
  const started = useRef(Date.now())

  // pre-fill once the history has loaded
  useEffect(() => {
    if (Object.keys(rows).length || !Object.keys(sug).length) return
    setRows(Object.fromEntries(exs.map(e => [e.key, [...Array(e.sets ?? 3)].map(() => ({ kg: sug[e.key]?.s.kg != null ? String(sug[e.key].s.kg) : '', reps: String(sug[e.key]?.s.reps ?? e.rep_max ?? ''), done: false }))])))
  }, [sug, exs, rows])
  // keep the screen on
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
    // typing a weight on set 1 carries it to the later sets that aren't done yet
    setRows(all => ({ ...all, [e.key]: all[e.key].map((x, j) => (j === i ? { ...x, done: nowDone } : j > i && !x.done && i === 0 ? { ...x, kg: r.kg } : x)) }))
    if (nowDone) {
      const left = rows[e.key].filter((x, j) => j !== i && !x.done).length
      const nextEx = exs[exs.indexOf(e) + 1]
      setRest({ left: e.rest_s ?? 90, total: e.rest_s ?? 90, next: left ? `${e.name} — set ${i + 2}` : nextEx ? nextEx.name : 'Finish' })
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
      const sets = exs.flatMap(e => (rows[e.key] ?? []).filter(r => r.done).map((r, j) => ({ activity_id: id, date: today(), exercise: e.name, set_no: j + 1, reps: r.reps ? +r.reps : null, kg: r.kg !== '' ? +r.kg : null })))
      if (sets.length) { const g = await supabase.from('tr_gym_sets').insert(sets); if (g.error) throw new Error(g.error.message) }
      await supabase.from('tr_workout_log').insert({ workout_id: w.id, date: today(), minutes })
      if (p?.[0]) await supabase.from('tr_planned').update({ status: 'done' }).eq('id', p[0].id)
      nav('/')
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="py-3 space-y-4 pb-32" data-busy>
      <div className="flex items-center gap-2">
        <button className="text-sm text-muted flex items-center gap-1" onClick={() => { if (!doneSets || confirm('Leave without saving these sets?')) onExit() }}><Icon name="close" size={16} />End</button>
        <h1 className="display text-2xl flex-1 truncate">{w.name}</h1>
        <span className="text-xs text-muted num">{doneSets} sets</span>
      </div>
      {exs.map(e => { const x = sug[e.key]; return (
        <Card key={e.key} title={e.name} sub={`${e.sets} × ${e.rep_min}–${e.rep_max}${e.per_side ? ' each leg' : ''} · ${e.load ?? ''} · rest ${Math.round((e.rest_s ?? 90) / 60 * 10) / 10} min`} right={<Dir s={x?.s} />}>
          {x?.s && <p className={`text-xs mb-2 ${x.s.dir === 'up' ? 'text-good' : x.s.dir === 'down' ? 'text-warn' : 'text-muted'}`}>{x.s.why}</p>}
          <div className="space-y-1.5">
            <div className="grid grid-cols-[2.5rem_1fr_1fr_3rem] gap-2 text-[11px] text-muted px-1"><span>Set</span><span>kg{e.load?.includes('each') ? ' (each)' : ''}</span><span>Reps{e.per_side ? ' / leg' : ''}</span><span /></div>
            {(rows[e.key] ?? []).map((r, i) => (
              <div key={i} className={`grid grid-cols-[2.5rem_1fr_1fr_3rem] gap-2 items-center rounded-xl px-1 ${r.done ? 'bg-good/10' : ''}`}>
                <span className="num text-sm text-center">{i + 1}</span>
                <input className="input !py-1.5 num" inputMode="decimal" value={r.kg} placeholder="kg" onChange={ev => set(e.key, i, { kg: ev.target.value })} />
                <input className="input !py-1.5 num" inputMode="numeric" value={r.reps} onChange={ev => set(e.key, i, { reps: ev.target.value })} />
                <button onClick={() => tick(e, i)} aria-label={`Set ${i + 1} done`} className={`h-9 rounded-xl grid place-items-center ${r.done ? 'bg-good text-white' : 'bg-surface-2 text-muted'}`}><Icon name="check" size={18} /></button>
              </div>
            ))}
          </div>
          <button className="text-xs text-muted underline mt-2" onClick={() => setRows(all => ({ ...all, [e.key]: [...all[e.key], { kg: all[e.key][all[e.key].length - 1]?.kg ?? '', reps: all[e.key][all[e.key].length - 1]?.reps ?? '', done: false }] }))}>+ add a set</button>
          <details className="mt-2"><summary className="text-xs text-brand cursor-pointer">Form cues{e.video_id ? ' and demo' : ''}</summary>
            <ul className="text-sm space-y-1 mt-1">{e.cues.map(c => <li key={c} className="flex gap-2"><span className="text-muted">•</span>{c}</li>)}</ul>
            {e.video_id && <a className="text-xs text-brand underline" href={`https://www.youtube.com/watch?v=${e.video_id}`} target="_blank" rel="noreferrer">▶ {e.video_title}</a>}
          </details>
        </Card>
      ) })}

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
