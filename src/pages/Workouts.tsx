import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { Card, Empty } from '../components/ui'
import { useLoad } from '../lib/data'
import { dmy, today } from '../lib/format'
import { supabase } from '../lib/supabase'
import { NextWeights, StrengthPlayer } from '../components/Strength'
import { AddToPlan, WorkoutEditor } from '../components/WorkoutEditor'
import { useAuth } from '../context/AuthContext'
import { myId } from '../lib/data'

export interface WEx { key: string; name: string; sets?: number; reps?: number; seconds?: number; per_side?: boolean; rest_s?: number; cues: string[]; why?: string; video_id: string | null; video_title: string | null; video_channel: string | null }
export interface Workout { id: string; created_by?: string | null; name: string; category: string; summary: string | null; duration_min: number | null; equipment: string | null; when_to_use: string | null; exercises: WEx[] }

const dose = (e: WEx & { rep_min?: number; rep_max?: number }) => e.rep_min
  ? `${e.sets ?? 3} × ${e.rep_min}–${e.rep_max} reps${e.per_side ? ' each leg' : ''}`
  : `${e.sets && e.sets > 1 ? `${e.sets} × ` : ''}${e.reps ? `${e.reps} reps` : `${e.seconds} s`}${e.per_side ? ' each side' : ''}`

/** /workouts — the library; /workouts/:id — one workout with its exercises and the guided player */
export default function Workouts() {
  const { id } = useParams()
  const nav = useNavigate()
  const { member } = useAuth()
  const { data, reload } = useLoad(async () => {
    const [w, log, me] = await Promise.all([
      supabase.from('tr_workouts').select('*').order('category').order('name'),
      supabase.from('tr_workout_log').select('workout_id,date').order('date', { ascending: false }).limit(200),
      myId(),
    ])
    return { list: (w.data ?? []) as Workout[], log: (log.data ?? []) as { workout_id: string; date: string }[], me }
  }, [])
  const [q, setQ] = useState(''); const [cat, setCat] = useState('all'); const [editing, setEditing] = useState<Workout | 'new'>()
  if (!data) return <p className="text-muted py-10 text-center animate-pulse">Loading…</p>
  const w = id ? data.list.find(x => x.id === id) : undefined
  const canEdit = (x: Workout) => x.created_by === data.me || member?.role === 'owner'
  if (id && w) return <>
    <WorkoutDetail w={w} last={data.log.find(l => l.workout_id === w.id)?.date} onEdit={canEdit(w) ? () => setEditing(w) : undefined} />
    {editing && editing !== 'new' && <WorkoutEditor w={editing} onClose={() => setEditing(undefined)} onSaved={nid => { setEditing(undefined); void reload(); if (!nid) nav('/workouts') }} />}
  </>
  const cats = ['all', ...new Set(data.list.map(x => x.category))]
  const shown = data.list.filter(x => (cat === 'all' || x.category === cat) && (!q || `${x.name} ${x.summary ?? ''} ${x.exercises.map(e => e.name).join(' ')}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center gap-2">
        <h1 className="display text-3xl leading-none flex-1">Workouts</h1>
        <button className="btn btn-primary !py-1.5 text-sm" onClick={() => setEditing('new')}><Icon name="plus" size={15} />New</button>
      </div>
      <p className="text-xs text-muted -mt-2">A shared library: everyone can use every workout and add their own.</p>
      <div className="flex gap-2 items-center">
        <input className="input flex-1 min-w-0" placeholder="Search workouts or exercises" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5">{cats.map(c => <button key={c} onClick={() => setCat(c)} className={`chip !py-1.5 !px-3 capitalize ${cat === c ? '!bg-brand !text-surface' : ''}`}>{c}</button>)}</div>
      {shown.map(x => (
        <Link key={x.id} to={`/workouts/${x.id}`} className="card p-4 flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-xl text-white shrink-0" style={{ background: x.category === 'strength' ? 'var(--s3)' : 'var(--s4)' }}><Icon name={x.category === 'strength' ? 'dumbbell' : 'stretch'} size={24} /></span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold">{x.name}</span>
            <span className="block text-xs text-muted">{x.duration_min} min · {x.exercises.length} exercises · {x.category}{data.log.find(l => l.workout_id === x.id) ? ` · last done ${dmy(data.log.find(l => l.workout_id === x.id)!.date, { year: false })}` : ''}</span>
          </span>
          <Icon name="right" className="text-muted" />
        </Link>
      ))}
      {!shown.length && <Empty>{data.list.length ? 'Nothing matches.' : 'No workouts yet.'}</Empty>}
      {editing === 'new' && <WorkoutEditor onClose={() => setEditing(undefined)} onSaved={nid => { setEditing(undefined); void reload(); if (nid) nav(`/workouts/${nid}`) }} />}
    </div>
  )
}

function Video({ e }: { e: WEx }) {
  const [open, setOpen] = useState(false)
  if (!e.video_id) return <a className="text-xs text-brand underline" target="_blank" rel="noreferrer" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(e.name + ' exercise demo')}`}>Find a demo video</a>
  return open ? (
    <div className="mt-2">
      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ paddingTop: '56.25%' }}>
        <iframe className="absolute inset-0 w-full h-full" src={`https://www.youtube-nocookie.com/embed/${e.video_id}?rel=0&playsinline=1&modestbranding=1`} title={e.video_title ?? e.name}
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      </div>
      <p className="text-[11px] text-muted mt-1">{e.video_title}{e.video_channel ? ` — ${e.video_channel}` : ''}</p>
    </div>
  ) : (
    <button onClick={() => setOpen(true)} className="mt-2 relative block w-full overflow-hidden rounded-xl bg-black" style={{ paddingTop: '56.25%' }} aria-label={`Play demo: ${e.name}`}>
      <img src={`https://i.ytimg.com/vi/${e.video_id}/hqdefault.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" loading="lazy" />
      <span className="absolute inset-0 grid place-items-center"><span className="grid place-items-center w-14 h-14 rounded-full bg-ember text-white text-2xl shadow-lg">▶</span></span>
    </button>
  )
}

function WorkoutDetail({ w, last, onEdit }: { w: Workout; last?: string; onEdit?: () => void }) {
  const [play, setPlay] = useState(false); const [adding, setAdding] = useState(false)
  const strength = w.category === 'strength'
  if (play) return strength ? <StrengthPlayer w={w} onExit={() => setPlay(false)} /> : <Player w={w} onExit={() => setPlay(false)} />
  return (
    <div className="space-y-4 py-3">
      <Link to="/workouts" className="text-sm text-muted flex items-center gap-1"><Icon name="left" size={16} />Workouts</Link>
      <div>
        <h1 className="display text-3xl leading-none">{w.name}</h1>
        <p className="text-xs text-muted mt-1">{w.duration_min} min · {w.exercises.length} exercises{last ? ` · last done ${dmy(last)}` : ''}</p>
      </div>
      <button className="btn btn-ember w-full !py-3 text-base" onClick={() => setPlay(true)}>{strength ? '▶ Start session (log sets)' : '▶ Start guided session'}</button>
      <div className="flex gap-2">
        <button className="btn btn-ghost flex-1" onClick={() => setAdding(true)}><Icon name="calendar" size={16} />Add to my plan</button>
        {onEdit && <button className="btn btn-ghost" onClick={onEdit}><Icon name="edit" size={16} />Edit</button>}
      </div>
      {adding && <AddToPlan w={w} onClose={() => setAdding(false)} />}
      {strength && <NextWeights w={w} />}
      {w.summary && <p className="text-sm">{w.summary}</p>}
      <div className="text-xs text-muted space-y-0.5">{w.when_to_use && <p><b className="text-ink">When:</b> {w.when_to_use}</p>}{w.equipment && <p><b className="text-ink">Kit:</b> {w.equipment}</p>}</div>
      {w.exercises.map((e, i) => (
        <Card key={e.key} title={<span><span className="text-muted mr-1.5 num">{i + 1}.</span>{e.name}</span>} sub={dose(e)}>
          <ul className="text-sm space-y-1">{e.cues.map(c => <li key={c} className="flex gap-2"><span className="text-muted">•</span>{c}</li>)}</ul>
          {e.why && <p className="text-xs text-muted mt-2">{e.why}</p>}
          <Video e={e} />
        </Card>
      ))}
    </div>
  )
}

// ---------------- guided player ----------------
interface Step { kind: 'work' | 'rest'; ex: WEx; idx: number; side?: 'Left' | 'Right'; set?: number; seconds?: number }

function steps(w: Workout): Step[] {
  const out: Step[] = []
  w.exercises.forEach((ex, idx) => {
    const sets = ex.sets ?? 1
    for (let s = 1; s <= sets; s++) {
      const sides: (('Left' | 'Right') | undefined)[] = ex.per_side ? ['Left', 'Right'] : [undefined]
      sides.forEach((side, si) => {
        out.push({ kind: 'work', ex, idx, side, set: sets > 1 ? s : undefined, seconds: ex.seconds })
        const last = s === sets && si === sides.length - 1
        if (ex.per_side && si === 0) out.push({ kind: 'rest', ex, idx, seconds: 5 })                 // switch sides
        else if (!last) out.push({ kind: 'rest', ex, idx, seconds: ex.rest_s || 20 })
      })
    }
    if (ex.rest_s && idx < w.exercises.length - 1) out.push({ kind: 'rest', ex: w.exercises[idx + 1], idx: idx + 1, seconds: ex.rest_s })
  })
  return out
}

function beep(n = 1) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)()
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.25; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.start(t); o.stop(t + 0.2)
    }
  } catch { /* no audio */ }
  try { navigator.vibrate?.(n > 1 ? [150, 80, 150] : 150) } catch { /* no vibration */ }
}

function Player({ w, onExit }: { w: Workout; onExit: () => void }) {
  const nav = useNavigate()
  const list = useMemo(() => steps(w), [w])
  const [i, setI] = useState(0); const [left, setLeft] = useState<number | null>(null); const [paused, setPaused] = useState(false)
  const [done, setDone] = useState(false); const started = useRef(Date.now())
  const st = list[i]
  // keep the screen on while the session runs
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lock: any; (navigator as any).wakeLock?.request('screen').then((l: unknown) => { lock = l }).catch(() => {})
    return () => { lock?.release?.() }
  }, [])
  useEffect(() => { setLeft(st?.seconds ?? null); setPaused(false) }, [i, st])
  useEffect(() => {
    if (left == null || paused || done) return
    if (left <= 0) { beep(st.kind === 'work' ? 2 : 1); next(); return }
    if (left <= 3) beep(1)
    const t = setTimeout(() => setLeft(l => (l == null ? l : l - 1)), 1000)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, paused, done])
  function next() { if (i + 1 >= list.length) setDone(true); else setI(i + 1) }
  function prev() { if (i > 0) setI(i - 1) }

  async function finish(markPlan: boolean) {
    const minutes = Math.max(1, Math.round((Date.now() - started.current) / 60000))
    await supabase.from('tr_workout_log').insert({ workout_id: w.id, date: today(), minutes })
    if (markPlan) {
      const { data: p } = await supabase.from('tr_planned').select('id,slot').eq('date', today()).or(`targets->>workout_id.eq.${w.id},sport.eq.mobility`).limit(1)
      const slot = p?.[0]?.slot ?? (new Date().getHours() < 12 ? 'am' : 'pm')
      await supabase.from('tr_activities').insert({ id: `m-${crypto.randomUUID()}`, source: 'manual', date: today(), slot, sport: 'mobility', name: w.name, duration_s: minutes * 60, rpe: 2, planned_id: p?.[0]?.id ?? null })
      if (p?.[0]) await supabase.from('tr_planned').update({ status: 'done' }).eq('id', p[0].id)
    }
    nav('/')
  }

  if (done) return (
    <div className="py-10 text-center space-y-4">
      <p className="display text-4xl">Done 👏</p>
      <p className="text-muted">{w.name} · {Math.max(1, Math.round((Date.now() - started.current) / 60000))} min</p>
      <button className="btn btn-primary w-full" onClick={() => void finish(true)}>Save to today's log</button>
      <button className="btn btn-ghost w-full" onClick={() => void finish(false)}>Finish without logging</button>
    </div>
  )
  const nextWork = list.slice(i + 1).find(s => s.kind === 'work')
  const pct = Math.round((i / list.length) * 100)
  return (
    <div className="py-3 space-y-4" data-busy>
      <div className="flex items-center gap-2">
        <button className="text-sm text-muted flex items-center gap-1" onClick={onExit}><Icon name="close" size={16} />End</button>
        <div className="flex-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-ember" style={{ width: `${pct}%` }} /></div>
        <span className="text-xs text-muted num">{st.idx + 1}/{w.exercises.length}</span>
      </div>

      {st.kind === 'rest' ? (
        <div className="text-center py-6">
          <p className="label">{st.ex === list[i - 1]?.ex && list[i - 1]?.side === 'Left' ? 'Switch sides' : 'Rest'}</p>
          <p className="display text-7xl num my-2">{left}</p>
          <p className="text-sm text-muted">Next: <b className="text-ink">{nextWork?.ex.name}</b>{nextWork?.side ? ` — ${nextWork.side}` : ''}</p>
        </div>
      ) : (
        <div>
          <p className="label">{st.side ? `${st.side} side` : st.set ? `Set ${st.set} of ${st.ex.sets}` : 'Now'}</p>
          <h2 className="display text-3xl leading-tight">{st.ex.name}</h2>
          {st.seconds ? <p className="display text-7xl num text-center my-3">{left}<span className="text-2xl text-muted"> s</span></p>
            : <p className="display text-5xl num text-center my-3">{st.ex.reps} <span className="text-2xl text-muted">reps</span></p>}
          <ul className="text-sm space-y-1">{st.ex.cues.map(c => <li key={c} className="flex gap-2"><span className="text-muted">•</span>{c}</li>)}</ul>
          <Video e={st.ex} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4">
        <button className="btn btn-ghost" onClick={prev} disabled={i === 0}><Icon name="left" size={18} /></button>
        {left != null ? <button className="btn btn-ghost" onClick={() => setPaused(p => !p)}>{paused ? '▶ Go' : '❚❚ Pause'}</button> : <span />}
        <button className="btn btn-primary" onClick={next}>{st.kind === 'rest' ? 'Skip' : left != null ? 'Next' : 'Done ✓'}</button>
      </div>
    </div>
  )
}
