import { useState } from 'react'
import Icon from './Icon'
import { Sheet } from './ui'
import { callFn, myId } from '../lib/data'
import { addDays, today } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { WEx, Workout } from '../pages/Workouts'

type Kind = 'timed' | 'reps' | 'strength'
interface ExForm { name: string; kind: Kind; sets: string; seconds: string; reps: string; rep_min: string; rep_max: string; increment_kg: string; per_side: boolean; rest_s: string; load: string; cues: string; why: string; video: string; video_id: string | null; video_title: string | null; video_channel: string | null; key: string }
const CATS = ['mobility', 'strength', 'core', 'drills', 'recovery', 'run', 'ride', 'other'] as const
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
/** a YouTube video id from a pasted link (watch, youtu.be, shorts) */
export const ytId = (u: string) => u.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/)?.[1] ?? (/^[\w-]{11}$/.test(u.trim()) ? u.trim() : null)

const toForm = (e: Partial<WEx> & { rep_min?: number; rep_max?: number; increment_kg?: number; load?: string; type?: string; kind?: Kind }): ExForm => ({
  key: e.key ?? '', name: e.name ?? '', kind: e.kind ?? (e.rep_min ? 'strength' : e.seconds ? 'timed' : 'reps'),
  sets: String(e.sets ?? (e.rep_min ? 3 : 1)), seconds: e.seconds ? String(e.seconds) : '', reps: e.reps ? String(e.reps) : '',
  rep_min: e.rep_min ? String(e.rep_min) : '', rep_max: e.rep_max ? String(e.rep_max) : '', increment_kg: e.increment_kg ? String(e.increment_kg) : '',
  per_side: !!e.per_side, rest_s: String(e.rest_s ?? 30), load: e.load ?? '', cues: (e.cues ?? []).join('\n'), why: e.why ?? '',
  video: e.video_id ? `https://youtu.be/${e.video_id}` : '', video_id: e.video_id ?? null, video_title: e.video_title ?? null, video_channel: e.video_channel ?? null,
})
const blank = (): ExForm => toForm({ name: '', cues: [] })

/** create or edit a library workout; "Draft with AI" fills the form from a description */
export function WorkoutEditor({ w, onClose, onSaved }: { w?: Workout; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ name: w?.name ?? '', category: w?.category ?? 'mobility', summary: w?.summary ?? '', duration_min: String(w?.duration_min ?? 20), equipment: w?.equipment ?? '', when_to_use: w?.when_to_use ?? '' })
  const [ex, setEx] = useState<ExForm[]>(w ? w.exercises.map(e => toForm(e)) : [blank()])
  const [prompt, setPrompt] = useState(''); const [busy, setBusy] = useState<string>(); const [err, setErr] = useState<string>()
  const up = (i: number, p: Partial<ExForm>) => setEx(x => x.map((e, j) => (j === i ? { ...e, ...p } : e)))

  async function draft() {
    setBusy('draft'); setErr(undefined)
    try {
      const r = await callFn<{ draft: { name: string; category: string; summary: string; duration_min: number; equipment: string; when_to_use: string; exercises: (WEx & { kind: Kind; rep_min?: number; rep_max?: number; increment_kg?: number; load?: string })[] } }>('tr-workout-draft', { prompt })
      const d = r.draft
      setF({ name: d.name, category: d.category, summary: d.summary, duration_min: String(d.duration_min), equipment: d.equipment, when_to_use: d.when_to_use })
      setEx(d.exercises.map(e => toForm({ ...e, seconds: e.kind === 'timed' ? e.seconds ?? undefined : undefined, reps: e.kind === 'reps' ? e.reps ?? undefined : undefined })))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(undefined) }
  }
  async function save() {
    setErr(undefined)
    if (!f.name.trim() || !ex.some(e => e.name.trim())) return setErr('A name and at least one exercise are needed.')
    setBusy('save')
    const exercises = ex.filter(e => e.name.trim()).map(e => {
      const vid = ytId(e.video)
      const base = { key: e.key || slug(e.name), name: e.name.trim(), sets: +e.sets || 1, per_side: e.per_side, rest_s: +e.rest_s || 0, cues: e.cues.split('\n').map(c => c.trim()).filter(Boolean), why: e.why || undefined,
        video_id: vid, video_title: vid && vid === e.video_id ? e.video_title : vid ? `${e.name.trim()} demo` : null, video_channel: vid && vid === e.video_id ? e.video_channel : null }
      return e.kind === 'strength' ? { ...base, type: 'strength', rep_min: +e.rep_min || 5, rep_max: +e.rep_max || +e.rep_min || 8, increment_kg: +e.increment_kg || 2.5, load: e.load || undefined }
        : e.kind === 'timed' ? { ...base, seconds: +e.seconds || 30 } : { ...base, reps: +e.reps || 10 }
    })
    const row = { name: f.name.trim(), category: f.category, summary: f.summary || null, duration_min: +f.duration_min || null, equipment: f.equipment || null, when_to_use: f.when_to_use || null, exercises, updated_at: new Date().toISOString() }
    let id = w?.id
    const r = w ? await supabase.from('tr_workouts').update(row).eq('id', w.id)
      : await supabase.from('tr_workouts').insert({ ...row, id: (id = `${slug(f.name)}-${Math.random().toString(36).slice(2, 6)}`), created_by: await myId() })
    setBusy(undefined)
    if (r.error) setErr(r.error.message); else onSaved(id!)
  }
  async function remove() {
    if (!w || !confirm(`Delete "${w.name}" from the library for everyone? Logged sessions stay.`)) return
    const { error } = await supabase.from('tr_workouts').delete().eq('id', w.id)
    if (error) setErr(error.message); else onSaved('')
  }

  return (
    <Sheet title={w ? 'Edit workout' : 'New workout'} onClose={onClose}
      footer={<div className="flex gap-2">{w && <button className="btn btn-ghost text-bad" onClick={() => void remove()}><Icon name="trash" size={16} /></button>}<button className="btn btn-primary flex-1" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save to library'}</button></div>}>
      <div className="space-y-3">
        {!w && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="label mb-1">Draft with AI</p>
            <textarea className="input text-sm" rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. 15 min core for runners, no equipment · ankle and calf rehab · running drills before a session" />
            <button className="btn btn-ember w-full mt-2 !py-2" disabled={!!busy || !prompt.trim()} onClick={() => void draft()}><Icon name="spark" size={15} />{busy === 'draft' ? 'Drafting… (about 20 s)' : 'Draft it'}</button>
            <p className="text-[11px] text-muted mt-1">You review and edit before saving. Saved workouts are shared with every Coach user.</p>
          </div>
        )}
        <input className="input font-medium" placeholder="Workout name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <select className="input capitalize" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{CATS.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <label className="flex items-center gap-2"><input className="input num" inputMode="numeric" value={f.duration_min} onChange={e => setF({ ...f, duration_min: e.target.value })} /><span className="text-sm text-muted">min</span></label>
        </div>
        <textarea className="input text-sm" rows={2} placeholder="What it's for" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} />
        <input className="input text-sm" placeholder="When to use it" value={f.when_to_use} onChange={e => setF({ ...f, when_to_use: e.target.value })} />
        <input className="input text-sm" placeholder="Equipment" value={f.equipment} onChange={e => setF({ ...f, equipment: e.target.value })} />

        <p className="label pt-1">Exercises</p>
        {ex.map((e, i) => (
          <div key={i} className="rounded-2xl border border-line p-3 space-y-2">
            <div className="flex gap-2"><span className="num text-muted pt-2">{i + 1}.</span><input className="input flex-1" placeholder="Exercise name" value={e.name} onChange={v => up(i, { name: v.target.value })} />
              <button className="text-muted" aria-label="Remove exercise" onClick={() => setEx(x => x.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button></div>
            <div className="flex flex-wrap gap-1.5">{(['reps', 'timed', 'strength'] as Kind[]).map(k => <button key={k} onClick={() => up(i, { kind: k })} className={`chip !py-1 ${e.kind === k ? '!bg-brand !text-surface' : ''}`}>{k === 'reps' ? 'Reps' : k === 'timed' ? 'Timed hold' : 'Strength (kg, progresses)'}</button>)}</div>
            <div className="grid grid-cols-4 gap-1.5 text-sm">
              <label><span className="text-[11px] text-muted">Sets</span><input className="input !py-1 num" inputMode="numeric" value={e.sets} onChange={v => up(i, { sets: v.target.value })} /></label>
              {e.kind === 'timed' && <label><span className="text-[11px] text-muted">Seconds</span><input className="input !py-1 num" inputMode="numeric" value={e.seconds} onChange={v => up(i, { seconds: v.target.value })} /></label>}
              {e.kind === 'reps' && <label><span className="text-[11px] text-muted">Reps</span><input className="input !py-1 num" inputMode="numeric" value={e.reps} onChange={v => up(i, { reps: v.target.value })} /></label>}
              {e.kind === 'strength' && <>
                <label><span className="text-[11px] text-muted">Reps from</span><input className="input !py-1 num" inputMode="numeric" value={e.rep_min} onChange={v => up(i, { rep_min: v.target.value })} /></label>
                <label><span className="text-[11px] text-muted">to</span><input className="input !py-1 num" inputMode="numeric" value={e.rep_max} onChange={v => up(i, { rep_max: v.target.value })} /></label>
              </>}
              <label><span className="text-[11px] text-muted">Rest s</span><input className="input !py-1 num" inputMode="numeric" value={e.rest_s} onChange={v => up(i, { rest_s: v.target.value })} /></label>
              {e.kind === 'strength' && <label><span className="text-[11px] text-muted">+kg step</span><input className="input !py-1 num" inputMode="decimal" value={e.increment_kg} onChange={v => up(i, { increment_kg: v.target.value })} /></label>}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={e.per_side} onChange={v => up(i, { per_side: v.target.checked })} />Each side / leg</label>
            {e.kind === 'strength' && <input className="input !py-1 text-sm" placeholder="Load, e.g. barbell, dumbbells (kg each)" value={e.load} onChange={v => up(i, { load: v.target.value })} />}
            <textarea className="input text-sm" rows={2} placeholder="Form cues, one per line" value={e.cues} onChange={v => up(i, { cues: v.target.value })} />
            <input className="input !py-1 text-sm" placeholder="Why (optional)" value={e.why} onChange={v => up(i, { why: v.target.value })} />
            <input className="input !py-1 text-sm" placeholder="YouTube demo link (optional)" value={e.video} onChange={v => up(i, { video: v.target.value })} />
            {e.video && !ytId(e.video) && <p className="text-[11px] text-bad">That doesn't look like a YouTube link.</p>}
          </div>
        ))}
        <button className="btn btn-ghost w-full !py-1.5 text-sm" onClick={() => setEx(x => [...x, blank()])}><Icon name="plus" size={14} />Add exercise</button>
        {err && <p className="text-sm text-bad">{err}</p>}
      </div>
    </Sheet>
  )
}

/** put a library workout into the signed-in user's own plan on a chosen day */
export function AddToPlan({ w, onClose }: { w: Workout; onClose: () => void }) {
  const [date, setDate] = useState(addDays(today(), 1)); const [slot, setSlot] = useState<'am' | 'pm'>('pm')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>()
  const legs = /squat|deadlift|lunge|calf|leg|step|hip thrust|bridge/i.test(w.exercises.map(e => e.name).join(' '))
  const sport = w.category === 'run' ? 'run' : w.category === 'ride' ? 'ride' : w.category === 'strength' ? (legs ? 'gym_legs' : 'gym_upper') : 'mobility'
  const mins = w.duration_min ?? 20
  const load = sport === 'gym_legs' ? Math.round(mins * 0.65) : sport === 'gym_upper' ? Math.round(mins * 0.2) : sport === 'mobility' ? Math.round(mins * 0.15) : Math.round(mins * 0.8)
  async function add() {
    setBusy(true); setMsg(undefined)
    const uid = await myId()
    const { data: cur } = await supabase.from('tr_planned').select('sport,title,locked').eq('date', date).eq('slot', slot).maybeSingle()
    if (cur?.locked) { setMsg(`That slot holds a locked session (${cur.title}).`); setBusy(false); return }
    if (cur && cur.sport !== 'rest' && !confirm(`Replace "${cur.title}" on that ${slot === 'am' ? 'morning' : 'afternoon'}?`)) { setBusy(false); return }
    const { error } = await supabase.from('tr_planned').upsert({
      user_id: uid, date, slot, sport, title: w.name, description: w.summary, duration_min: mins, intensity: sport === 'gym_legs' ? 'moderate' : 'easy',
      targets: { workout_id: w.id }, planned_load: load, source: 'manual', change_note: 'Added from the workout library', status: 'planned', updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date,slot' })
    setBusy(false)
    if (error) setMsg(error.message); else onClose()
  }
  return (
    <Sheet title={`Add "${w.name}" to my plan`} onClose={onClose} footer={<button className="btn btn-primary w-full" disabled={busy} onClick={() => void add()}>{busy ? 'Adding…' : 'Add to plan'}</button>}>
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Day</span><input type="date" className="input mt-1" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label><span className="label">Slot</span><select className="input mt-1" value={slot} onChange={e => setSlot(e.target.value as 'am' | 'pm')}><option value="am">Morning</option><option value="pm">Afternoon</option></select></label>
      </div>
      <p className="text-xs text-muted mt-2">Goes in as a {sport.replace('_', ' ')} session ({mins} min) with a Start button on that day. The coach sees it, and it goes to your Garmin if that's switched on.</p>
      {msg && <p className="text-sm text-bad mt-2">{msg}</p>}
    </Sheet>
  )
}
