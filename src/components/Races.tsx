// Races: results, goals, PB going in and course notes. The race report and every coach run read these,
// so a race is judged as a race (result first, course and past editions in view).
import { useState } from 'react'
import Icon from './Icon'
import { Card, Empty } from './ui'
import { useLoad } from '../lib/data'
import { dmy } from '../lib/format'
import { supabase } from '../lib/supabase'

interface Race { id: number; date: string; event: string; sport: string; distance_km: number | null; elev_m: number | null; goal_s: number | null; time_s: number | null; time_note: string | null; pb_before_s: number | null; course_notes: string | null; notes: string | null }
type Form = { id?: number; date: string; event: string; sport: string; distance_km: string; goal: string; time: string; time_note: string; pb_before: string; course_notes: string }

const hms = (s: number | null) => (s ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : '')
/** "2:49:00" / "2:49" / "9:41:58" → seconds */
function secs(t: string): number | null {
  const p = t.trim().split(':').map(Number)
  if (!t.trim() || p.some(isNaN)) return null
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2]
  if (p.length === 2) return p[0] * 3600 + p[1] * 60
  return null
}

export default function Races() {
  const { data, reload } = useLoad(async () => ((await supabase.from('tr_races').select('*').order('date', { ascending: false })).data ?? []) as Race[], [])
  const [f, setF] = useState<Form>()
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f!, [k]: e.target.value })
  async function save() {
    if (!f?.date || !f.event.trim()) return
    setBusy(true)
    const row = { date: f.date, event: f.event.trim(), sport: f.sport, distance_km: f.distance_km ? Number(f.distance_km) : null, goal_s: secs(f.goal), time_s: secs(f.time),
      time_note: f.time_note.trim() || null, pb_before_s: secs(f.pb_before), course_notes: f.course_notes.trim() || null, updated_at: new Date().toISOString() }
    if (f.id) await supabase.from('tr_races').update(row).eq('id', f.id)
    else await supabase.from('tr_races').insert(row)
    setBusy(false); setF(undefined); void reload()
  }
  const edit = (r: Race) => setF({ id: r.id, date: r.date, event: r.event, sport: r.sport, distance_km: r.distance_km?.toString() ?? '', goal: hms(r.goal_s), time: hms(r.time_s),
    time_note: r.time_note ?? '', pb_before: hms(r.pb_before_s), course_notes: r.course_notes ?? '' })
  return (
    <Card title="Races" sub="Results, goals and course notes. The race report and the coach read these, so a race is judged as a race, not as a training ride."
      right={!f ? <button className="chip" onClick={() => setF({ date: '', event: '', sport: 'ride', distance_km: '', goal: '', time: '', time_note: '', pb_before: '', course_notes: '' })}><Icon name="plus" size={13} />Add</button> : undefined}>
      {f && (
        <div className="space-y-2 mb-3 rounded-2xl bg-surface-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label><span className="label">Date</span><input type="date" className="input mt-1" value={f.date} onChange={set('date')} /></label>
            <label><span className="label">Sport</span><select className="input mt-1" value={f.sport} onChange={set('sport')}><option value="ride">Ride</option><option value="run">Run</option></select></label>
          </div>
          <label className="block"><span className="label">Event (same name every year)</span><input className="input mt-1" value={f.event} onChange={set('event')} placeholder="947 Ride Joburg" /></label>
          <div className="grid grid-cols-3 gap-2">
            <label><span className="label">Goal</span><input className="input mt-1" value={f.goal} onChange={set('goal')} placeholder="2:55:00" inputMode="numeric" /></label>
            <label><span className="label">Time</span><input className="input mt-1" value={f.time} onChange={set('time')} placeholder="2:49:00" inputMode="numeric" /></label>
            <label><span className="label">PB going in</span><input className="input mt-1" value={f.pb_before} onChange={set('pb_before')} placeholder="3:04:57" inputMode="numeric" /></label>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <label><span className="label">km</span><input className="input mt-1" value={f.distance_km} onChange={set('distance_km')} inputMode="decimal" /></label>
            <label><span className="label">Time note</span><input className="input mt-1" value={f.time_note} onChange={set('time_note')} placeholder="Official / Garmin, to confirm" /></label>
          </div>
          <label className="block"><span className="label">Course notes</span><textarea className="input mt-1 text-sm" rows={3} value={f.course_notes} onChange={set('course_notes')} placeholder="Start and finish, where the climbing sits, what changed from last year" /></label>
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setF(undefined)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !f.date || !f.event.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
      {!data ? <p className="text-sm text-muted animate-pulse">Loading…</p> : data.length ? (
        <ul className="divide-y divide-line">
          {data.map(r => (
            <li key={r.id} className="py-2 flex gap-2 items-start">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{r.event} <span className="text-muted font-normal">· {dmy(r.date)}</span></p>
                <p className="text-xs num">{r.time_s ? hms(r.time_s) : 'no time yet'}{r.goal_s ? ` · goal ${hms(r.goal_s)}` : ''}{r.pb_before_s ? ` · PB going in ${hms(r.pb_before_s)}` : ''}</p>
                {r.time_note && <p className="text-[11px] text-muted">{r.time_note}</p>}
                {r.course_notes && <p className="text-[11px] text-muted line-clamp-2">{r.course_notes}</p>}
              </div>
              <button className="p-1 text-muted" aria-label="Edit" onClick={() => edit(r)}><Icon name="edit" size={15} /></button>
            </li>
          ))}
        </ul>
      ) : <Empty>No races yet.</Empty>}
    </Card>
  )
}
