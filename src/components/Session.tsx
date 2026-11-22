import { BlocksTable, RepLine } from './Blocks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { callFn, getSettings, useLoad } from '../lib/data'
import Icon from './Icon'
import { Scale, Sheet, AutoText } from './ui'
import { supabase } from '../lib/supabase'
import { SPORT, km, mins, minsOf, pace, dmy } from '../lib/format'
import { actLoad } from '../lib/load'
import type { Activity, Exercise, GymSet, Planned, Slot, Sport } from '../lib/types'
import { paceFor, type Paces } from '../lib/paces'

const SPORTS: Sport[] = ['run', 'ride', 'gym_legs', 'gym_upper', 'mobility', 'rest', 'race']

export function SportDot({ sport, size = 36 }: { sport: Sport; size?: number }) {
  const s = SPORT[sport] ?? SPORT.other
  return <span className="grid place-items-center rounded-xl shrink-0 text-white" style={{ width: size, height: size, background: s.color }}><Icon name={s.icon} size={size * 0.55} /></span>
}

/** one line summary of what was actually done */
export function actualLine(a: Activity) {
  const bits = [mins(a.duration_s)]
  if (a.distance_m && a.sport !== 'gym_legs' && a.sport !== 'gym_upper') bits.push(km(a.distance_m))
  if (a.sport === 'run' && a.avg_pace_s) bits.push(pace(a.avg_pace_s))
  if (a.sport === 'ride' && a.avg_watts) bits.push(`${a.avg_watts} W`)
  if (a.avg_hr) bits.push(`HR ${a.avg_hr}`)
  if (a.rpe) bits.push(`RPE ${a.rpe}`)
  bits.push(`load ${actLoad(a)}`)
  return bits.join(' · ')
}

export interface Report { headline: string; verdict: string; numbers: { label: string; value: string }[]; points: string[]; next: string | null; race?: boolean }

/** the automatic analysis of a long / hard session, with a button to (re)run it */
export function ReportView({ act }: { act: Activity }) {
  const { data, reload } = useLoad(async () => (await supabase.from('tr_session_reports').select('report,created_at').eq('activity_id', act.id).maybeSingle()).data as { report: Report; created_at: string } | null, [act.id])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>()
  if (act.source !== 'icu') return null
  async function run() { setBusy(true); setErr(undefined); try { await callFn('tr-report', { activity_id: act.id }); await reload() } catch (e) { setErr((e as Error).message) } setBusy(false) }
  const r = data?.report
  return (
    <div className="rounded-2xl bg-surface-2 p-3 mb-3">
      {r ? <>
        <p className="label text-brand">{r.race ? 'Race report' : 'Session report'}{r.verdict === 'race_pb' ? ' · PB' : ''}</p>
        <p className="font-semibold text-sm mt-0.5">{r.headline}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs mt-2">{r.numbers.flatMap(n => [<dt key={n.label + 'l'} className="text-muted">{n.label}</dt>, <dd key={n.label + 'v'} className="num">{n.value}</dd>])}</dl>
        <ul className="text-sm space-y-1 mt-2">{r.points.map(x => <li key={x} className="flex gap-2"><span className="text-muted">•</span>{x}</li>)}</ul>
        {r.next && <p className="text-sm mt-2"><span className="label text-brand">Next time </span>{r.next}</p>}
        <button className="text-xs text-muted underline mt-2" disabled={busy} onClick={() => void run()}>{busy ? 'Analysing…' : 'Analyse again'}</button>
      </> : <button className="btn btn-ghost w-full !py-1.5 text-sm" disabled={busy} onClick={() => void run()}><Icon name="spark" size={14} />{busy ? 'Analysing… (about 20 s)' : 'Analyse this session'}</button>}
      {err && <p className="text-xs text-bad mt-1">{err}</p>}
    </div>
  )
}

export function SessionCard({ slot, p, acts, onLog, onEdit, onOpenAct, paces, reports }: { slot: Slot; p?: Planned; acts: Activity[]; onLog: () => void; onEdit: () => void; onOpenAct: (a: Activity) => void; paces?: Paces | null; reports?: Record<string, Report> }) {
  const [open, setOpen] = useState(false)
  const sport = (p?.sport ?? acts[0]?.sport ?? 'rest') as Sport
  const isRest = sport === 'rest' && !acts.length
  const t = p?.targets ?? {}
  const chips = [p?.duration_min ? minsOf(p.duration_min) : null, p?.distance_km ? `${p.distance_km} km` : null, t.pace ?? (p ? paceFor(p, paces) : null), t.watts, t.hr_max ? `HR < ${t.hr_max}` : null].filter(Boolean) as string[]
  const status = acts.length ? 'done' : p?.status
  return (
    <div className={`card p-4 ${isRest ? 'opacity-80' : ''}`}>
      <div className="flex items-start gap-3">
        <SportDot sport={sport} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="label">{slot === 'am' ? 'Morning' : 'Afternoon'}</span>
            {status === 'done' && <span className="chip !bg-good/15 !text-good"><Icon name="check" size={12} />Done</span>}
            {status === 'skipped' && <span className="chip !bg-bad/12 !text-bad">Missed</span>}
            {p?.locked && <Icon name="lock" size={13} className="text-muted" />}
          </div>
          <button className="text-left w-full" onClick={() => setOpen(o => !o)}>
            <p className="font-semibold leading-snug mt-0.5">{p?.title ?? (acts[0]?.name || SPORT[sport].label)}</p>
          </button>
          {chips.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{chips.map(c => <span key={c} className="chip num">{c}</span>)}</div>}
          {p?.change_note && <p className="text-xs mt-2 flex gap-1.5 text-brand"><Icon name="spark" size={14} className="shrink-0 mt-px" /><span>{p.change_note}</span></p>}
          {open && p?.description && <p className="text-sm text-muted mt-2 whitespace-pre-line">{p.description}</p>}
          {open && t.exercises && t.exercises.length > 0 && (
            <ul className="text-sm mt-2 space-y-0.5">{t.exercises.map(e => <li key={e.name} className="flex justify-between gap-2"><span>{e.name}</span><span className="num text-muted">{e.sets} × {e.reps}{e.kg ? ` @ ${e.kg} kg` : ''}</span></li>)}</ul>
          )}
          {acts.map(a => (
            <button key={a.id} onClick={() => onOpenAct(a)} className="mt-2 w-full text-left rounded-xl bg-surface-2 px-3 py-2 text-xs">
              <span className="font-medium text-ink">{a.source === 'manual' ? 'Logged' : a.source === 'strava' ? 'Strava' : 'Garmin'}{a.name && a.source !== 'manual' ? ` · ${a.name}` : ''}</span>
              <span className="block text-muted num mt-0.5">{actualLine(a)}</span>
              <RepLine a={a} />
              {reports?.[a.id] && <span className="block mt-1.5 text-ink"><span className="text-brand">📊 </span>{reports[a.id].headline}</span>}
            </button>
          ))}
        </div>
      </div>
      {!isRest && (p?.targets as { workout_id?: string } | undefined)?.workout_id && !acts.length && (
        <Link to={`/workouts/${(p!.targets as { workout_id: string }).workout_id}`} className="btn btn-ember w-full mt-3 !py-2">▶ Start guided session</Link>
      )}
      {!isRest && (
        <div className="flex gap-2 mt-3">
          {!acts.length && <button className="btn btn-primary flex-1 !py-2" onClick={onLog}><Icon name="plus" size={16} />Log it</button>}
          {p && <button className="btn btn-ghost !py-2" onClick={onEdit}><Icon name="edit" size={16} />{acts.length ? 'Plan' : 'Change'}</button>}
        </div>
      )}
      {isRest && p && <div className="flex justify-end mt-1"><button className="text-xs text-muted underline" onClick={onLog}>Did something anyway? Log it</button></div>}
    </div>
  )
}

// ---------------- log a session (new manual entry, or RPE / gym sets on a Garmin one) ----------------
interface SetRow { exercise: string; reps: string; kg: string }
const setsFrom = (ex: Exercise[] | null | undefined): SetRow[] => (ex ?? []).flatMap(e => [...Array(Math.max(1, e.sets))].map(() => ({ exercise: e.name, reps: String(e.reps ?? ''), kg: e.kg ? String(e.kg) : '' })))

export function LogSheet({ date, slot, planned, act, existingSets, lastKg, onClose, onSaved }: {
  date: string; slot: Slot; planned?: Planned; act?: Activity; existingSets?: GymSet[]; lastKg?: Record<string, number>
  onClose: () => void; onSaved: () => void
}) {
  const manual = !act || act.source === 'manual'
  const [sport, setSport] = useState<Sport>((act?.sport ?? (planned?.sport === 'rest' ? 'run' : planned?.sport) ?? 'run') as Sport)
  const [d, setD] = useState(act?.date ?? date); const [sl, setSl] = useState<Slot>(act?.slot ?? slot)
  const [dur, setDur] = useState(act?.duration_s ? String(Math.round(act.duration_s / 60)) : planned?.duration_min ? String(planned.duration_min) : '')
  const [dist, setDist] = useState(act?.distance_m ? String(+(act.distance_m / 1000).toFixed(2)) : planned?.distance_km ? String(planned.distance_km) : '')
  const [hr, setHr] = useState(act?.avg_hr ? String(act.avg_hr) : '')
  const [rpe, setRpe] = useState<number | null>(act?.rpe ?? null)
  const [notes, setNotes] = useState(act?.notes ?? '')
  const [sets, setSets] = useState<SetRow[]>(() => existingSets?.length
    ? existingSets.map(s => ({ exercise: s.exercise, reps: String(s.reps ?? ''), kg: s.kg != null ? String(s.kg) : '' }))
    : setsFrom(planned?.targets?.exercises).map(s => ({ ...s, kg: s.kg || (lastKg?.[s.exercise] ? String(lastKg[s.exercise]) : '') })))
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>()
  const gym = sport === 'gym_legs' || sport === 'gym_upper'

  async function save() {
    setBusy(true); setErr(undefined)
    try {
      const id = act?.id ?? `m-${crypto.randomUUID()}`
      const row: Record<string, unknown> = manual
        ? { id, source: 'manual', date: d, slot: sl, sport, name: planned?.title ?? SPORT[sport].label, duration_s: dur ? Math.round(+dur * 60) : null,
            distance_m: dist && !gym ? Math.round(+dist * 1000) : null, avg_hr: hr ? +hr : null, rpe, notes: notes || null,
            avg_pace_s: sport === 'run' && dur && dist ? Math.round((+dur * 60) / +dist) : null, planned_id: planned?.id ?? act?.planned_id ?? null, updated_at: new Date().toISOString() }
        : { id, sport, slot: sl, rpe, notes: notes || null, planned_id: act!.planned_id ?? planned?.id ?? null, updated_at: new Date().toISOString() }
      const r = manual ? await supabase.from('tr_activities').upsert(row) : await supabase.from('tr_activities').update(row).eq('id', id)
      if (r.error) throw new Error(r.error.message)
      if (gym) {
        await supabase.from('tr_gym_sets').delete().eq('activity_id', id)
        const n: Record<string, number> = {}
        const rows = sets.filter(s => s.exercise.trim() && (s.reps || s.kg)).map(s => ({ activity_id: id, date: d, exercise: s.exercise.trim(), set_no: (n[s.exercise] = (n[s.exercise] ?? 0) + 1), reps: s.reps ? +s.reps : null, kg: s.kg ? +s.kg : null }))
        if (rows.length) { const g = await supabase.from('tr_gym_sets').insert(rows); if (g.error) throw new Error(g.error.message) }
      }
      const pid = (row as { planned_id: number | null }).planned_id
      if (pid) await supabase.from('tr_planned').update({ status: 'done' }).eq('id', pid)
      onSaved()
    } catch (e) { setErr(String((e as Error).message)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!act || act.source !== 'manual' || !confirm('Delete this logged session?')) return
    await supabase.from('tr_activities').delete().eq('id', act.id)
    if (act.planned_id) await supabase.from('tr_planned').update({ status: 'planned' }).eq('id', act.planned_id)
    onSaved()
  }
  const upd = (i: number, k: keyof SetRow, v: string) => setSets(s => s.map((r, j) => j === i ? { ...r, [k]: v } : r))

  return (
    <Sheet title={act ? (manual ? 'Logged session' : act.name || 'Garmin session') : 'Log a session'} onClose={onClose}
      footer={<div className="flex gap-2">{act?.source === 'manual' && <button className="btn btn-ghost text-bad" onClick={() => void remove()}><Icon name="trash" size={16} /></button>}<button className="btn btn-primary flex-1" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></div>}>
      {act && <ReportView act={act} />}
      {act && <BlocksTable a={act} />}
      {planned && <p className="text-xs text-muted mb-3">Planned: {planned.title}</p>}
      {!manual && <p className="text-xs text-muted mb-3 num">{dmy(act!.date)} · {actualLine(act!)}. Times, distance and HR come from {act!.source === 'strava' ? 'Strava' : 'Garmin'} — add how it felt, and the kg for a gym session.</p>}
      <div className="space-y-3">
        <div>
          <p className="label mb-1">Type</p>
          <div className="flex flex-wrap gap-1.5">{SPORTS.filter(s => s !== 'rest' && (manual || ['gym_legs', 'gym_upper', act?.sport].includes(s))).map(s => (
            <button key={s} type="button" onClick={() => setSport(s)} className={`chip !text-xs !py-1.5 !px-3 ${sport === s ? '!bg-brand !text-surface' : ''}`}>{SPORT[s].label}</button>))}</div>
        </div>
        {manual && (
          <div className="grid grid-cols-2 gap-2">
            <label><span className="label">Date</span><input type="date" className="input mt-1" value={d} onChange={e => setD(e.target.value)} /></label>
            <label><span className="label">Slot</span><select className="input mt-1" value={sl} onChange={e => setSl(e.target.value as Slot)}><option value="am">Morning</option><option value="pm">Afternoon</option></select></label>
            <label><span className="label">Minutes</span><input inputMode="numeric" className="input mt-1" value={dur} onChange={e => setDur(e.target.value)} /></label>
            {!gym && <label><span className="label">Distance km</span><input inputMode="decimal" className="input mt-1" value={dist} onChange={e => setDist(e.target.value)} /></label>}
            {!gym && <label><span className="label">Avg HR</span><input inputMode="numeric" className="input mt-1" value={hr} onChange={e => setHr(e.target.value)} /></label>}
          </div>
        )}
        {!manual && <label className="block"><span className="label">Slot</span><select className="input mt-1" value={sl} onChange={e => setSl(e.target.value as Slot)}><option value="am">Morning</option><option value="pm">Afternoon</option></select></label>}
        <div><p className="label mb-1">Effort (RPE)</p><Scale value={rpe} onChange={setRpe} min={1} max={10} labels={['very easy', 'max']} /></div>
        {gym && (
          <div>
            <p className="label mb-1">Sets</p>
            <div className="space-y-1.5">
              {sets.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_4rem_4.5rem_2rem] gap-1.5 items-center">
                  <input className="input !py-1.5 text-sm" value={s.exercise} onChange={e => upd(i, 'exercise', e.target.value)} placeholder="Exercise" />
                  <input className="input !py-1.5 text-sm num" inputMode="numeric" value={s.reps} onChange={e => upd(i, 'reps', e.target.value)} placeholder="reps" />
                  <input className="input !py-1.5 text-sm num" inputMode="decimal" value={s.kg} onChange={e => upd(i, 'kg', e.target.value)} placeholder="kg" />
                  <button type="button" className="text-muted" onClick={() => setSets(x => x.filter((_, j) => j !== i))} aria-label="Remove set"><Icon name="close" size={16} /></button>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-ghost !py-1.5 mt-2 text-sm" onClick={() => setSets(x => [...x, { exercise: x[x.length - 1]?.exercise ?? '', reps: x[x.length - 1]?.reps ?? '', kg: x[x.length - 1]?.kg ?? '' }])}><Icon name="plus" size={14} />Add set</button>
          </div>
        )}
        <label className="block"><span className="label">Notes</span><textarea className="input mt-1" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="How it felt, ankle, anything odd…" /></label>
        {err && <p className="text-sm text-bad">{err}</p>}
      </div>
    </Sheet>
  )
}

// ---------------- change a planned session by hand ----------------
export function PlanSheet({ p, onClose, onSaved, onAskCoach }: { p: Planned; onClose: () => void; onSaved: () => void; onAskCoach: (msg: string) => void }) {
  const [f, setF] = useState({ sport: p.sport, title: p.title, duration_min: p.duration_min ? String(p.duration_min) : '', distance_km: p.distance_km ? String(p.distance_km) : '', description: p.description ?? '', locked: p.locked,
    pace: p.targets?.pace ?? '', hr_max: p.targets?.hr_max ? String(p.targets.hr_max) : '' })
  const [busy, setBusy] = useState(false)
  const { data: st } = useLoad(() => getSettings(), [])
  const paces = (st?.paces ?? null) as Paces | null
  const planPace = paceFor({ title: f.title, intensity: p.intensity, sport: f.sport }, paces)
  // fill the pace from the plan the first time the paces load (if the session has none of its own)
  useEffect(() => { if (!f.pace && planPace) setF(x => ({ ...x, pace: planPace })) }, [planPace]) // eslint-disable-line react-hooks/exhaustive-deps
  const secs = (f.pace.match(/\d{1,2}:\d{2}/g) ?? []).map(m => +m.split(':')[0] * 60 + +m.split(':')[1])
  const est = f.distance_km && secs.length ? secs.map(x => Math.round((+f.distance_km * x) / 60)) : []
  async function save(extra: Partial<Planned> = {}) {
    setBusy(true)
    await supabase.from('tr_planned').update({
      sport: f.sport, title: f.title, duration_min: f.duration_min ? +f.duration_min : null, distance_km: f.distance_km ? +f.distance_km : null,
      description: f.description, locked: f.locked, source: 'manual', change_note: 'Changed by you', updated_at: new Date().toISOString(),
      targets: { ...(p.targets ?? {}), pace: f.sport === 'run' || f.sport === 'race' ? (f.pace.trim() || null) : (p.targets?.pace ?? null), hr_max: f.hr_max ? +f.hr_max : null }, ...extra,
    }).eq('id', p.id)
    setBusy(false); onSaved()
  }
  return (
    <Sheet title={`${dmy(p.date, { weekday: true, year: false })} · ${p.slot === 'am' ? 'Morning' : 'Afternoon'}`} onClose={onClose}
      footer={<div className="flex gap-2"><button className="btn btn-primary flex-1" disabled={busy} onClick={() => void save()}>Save</button></div>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{SPORTS.map(s => <button key={s} type="button" onClick={() => setF({ ...f, sport: s, title: s === 'rest' ? 'Rest' : f.title })} className={`chip !text-xs !py-1.5 !px-3 ${f.sport === s ? '!bg-brand !text-surface' : ''}`}>{SPORT[s].label}</button>)}</div>
        <label className="block"><span className="label">Title</span><input className="input mt-1" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label><span className="label">Minutes</span><input inputMode="numeric" className="input mt-1" value={f.duration_min} onChange={e => setF({ ...f, duration_min: e.target.value })} /></label>
          <label><span className="label">Distance km</span><input inputMode="decimal" className="input mt-1" value={f.distance_km} onChange={e => setF({ ...f, distance_km: e.target.value })} /></label>
        </div>
        {(f.sport === 'run' || f.sport === 'race') && <>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <label><span className="label">Pace</span><input className="input mt-1 num" placeholder="e.g. 6:20–6:50/km" value={f.pace} onChange={e => setF({ ...f, pace: e.target.value })} /></label>
            <label><span className="label">HR max</span><input className="input mt-1 num" inputMode="numeric" placeholder={st?.easy_run_hr_cap ? String(st.easy_run_hr_cap) : '—'} value={f.hr_max} onChange={e => setF({ ...f, hr_max: e.target.value })} /></label>
          </div>
          <p className="text-xs text-muted -mt-1">
            {est.length ? `${f.distance_km} km at this pace ≈ ${est.join('–')} min${f.duration_min && (+f.duration_min < Math.min(...est) - 3 || +f.duration_min > Math.max(...est) + 3) ? ' — doesn’t match the minutes above' : ''}. ` : ''}
            {planPace && f.pace !== planPace ? <button type="button" className="text-brand underline" onClick={() => setF({ ...f, pace: planPace })}>Use plan pace ({planPace})</button> : paces ? `From your paces (VDOT ${paces.vdot}).` : 'Set your paces in Settings to fill this in.'}
            {est.length > 0 && f.duration_min && (+f.duration_min < Math.min(...est) - 3 || +f.duration_min > Math.max(...est) + 3) && <> <button type="button" className="text-brand underline" onClick={() => setF({ ...f, duration_min: String(Math.round((est[0] + est[est.length - 1]) / 2)) })}>Set minutes to {Math.round((est[0] + est[est.length - 1]) / 2)}</button></>}
          </p>
        </>}
        <label className="block"><span className="label">Workout</span><AutoText className="mt-1 text-[15px]" value={f.description} onChange={v => setF({ ...f, description: v })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.locked} onChange={e => setF({ ...f, locked: e.target.checked })} />Lock — the coach may not change this session</label>
        <div className="flex flex-wrap gap-2 pt-1">
          {p.status !== 'skipped' ? <button className="btn btn-ghost !py-1.5 text-sm" onClick={() => void save({ status: 'skipped' })}>Mark as missed</button>
            : <button className="btn btn-ghost !py-1.5 text-sm" onClick={() => void save({ status: 'planned' })}>Not missed</button>}
          <button className="btn btn-ghost !py-1.5 text-sm" onClick={() => onAskCoach(`Can you change my ${p.slot === 'am' ? 'morning' : 'afternoon'} session on ${dmy(p.date)} (${p.title})? `)}><Icon name="chat" size={14} />Ask the coach</button>
        </div>
      </div>
    </Sheet>
  )
}
