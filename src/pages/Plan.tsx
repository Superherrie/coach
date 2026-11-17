import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { Card, Stat } from '../components/ui'
import { LogSheet, PlanSheet, SportDot } from '../components/Session'
import { getActs, getEvents, getPhases, getPlanned, getSets, getSettings, useLoad } from '../lib/data'
import { paceFor, type Paces } from '../lib/paces'
import { addDays, dm, dmy, monday, num, today } from '../lib/format'
import { actLoad } from '../lib/load'
import type { Activity, Planned, Slot } from '../lib/types'
import { useSynced } from './Today'

export default function Plan() {
  const nav = useNavigate()
  const [wk, setWk] = useState(monday(today()))
  const end = addDays(wk, 6)
  const { data, reload } = useLoad(async () => {
    const [planned, acts, phases, events, sets, settings] = await Promise.all([getPlanned(wk, end), getActs(wk, end), getPhases(), getEvents(), getSets(addDays(wk, -90)), getSettings()])
    return { planned, acts, phases, events, sets, paces: (settings.paces ?? null) as Paces | null }
  }, [wk])
  useSynced(reload)
  const [log, setLog] = useState<{ date: string; slot: Slot; planned?: Planned; act?: Activity }>()
  const [edit, setEdit] = useState<Planned>()

  const totals = useMemo(() => {
    if (!data) return null
    const runKmPlan = data.planned.filter(p => p.sport === 'run' || (p.sport === 'race' && p.date > '2026-11-22')).reduce((s, p) => s + (p.distance_km ?? 0), 0)
    const runKm = data.acts.filter(a => a.sport === 'run').reduce((s, a) => s + (a.distance_m ?? 0) / 1000, 0)
    const loadPlan = data.planned.reduce((s, p) => s + (p.planned_load ?? 0), 0)
    const load = data.acts.reduce((s, a) => s + actLoad(a), 0)
    const key = data.planned.filter(p => p.sport !== 'rest')
    const due = key.filter(p => p.date < today() || p.status === 'done')
    const done = due.filter(p => p.status === 'done').length
    return { runKmPlan, runKm, loadPlan, load, done, due: due.length, legs: data.acts.filter(a => a.sport === 'gym_legs').length, legsPlan: key.filter(p => p.sport === 'gym_legs').length }
  }, [data])

  if (!data || !totals) return <p className="text-muted py-10 text-center animate-pulse">Loading…</p>
  const phase = data.phases.find(p => wk >= p.start_date && wk <= p.end_date) ?? data.phases.find(p => end >= p.start_date && end <= p.end_date)
  const upcoming = data.events.filter(e => e.date >= today()).slice(0, 6)
  const lastKg: Record<string, number> = {}; for (const s of data.sets) if (s.kg) lastKg[s.exercise] = s.kg

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center gap-2">
        <button className="p-2 -ml-2 text-muted" onClick={() => setWk(addDays(wk, -7))} aria-label="Previous week"><Icon name="left" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="display text-3xl leading-none">Week of {dm(wk)}</h1>
          <p className="text-xs text-muted mt-1">{phase ? `${phase.name} — ${phase.focus}` : ''}</p>
        </div>
        {wk !== monday(today()) && <button className="chip" onClick={() => setWk(monday(today()))}>This week</button>}
        <button className="p-2 -mr-2 text-muted" onClick={() => setWk(addDays(wk, 7))} aria-label="Next week"><Icon name="right" /></button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Run km" value={`${num(totals.runKm)}`} sub={`of ${num(totals.runKmPlan)} planned`} />
        <Stat label="Load" value={num(totals.load)} sub={`of ${num(totals.loadPlan)} planned`} />
        <Stat label="Sessions done" value={totals.due ? `${totals.done}/${totals.due}` : '—'} sub="of those due so far" tone={totals.due && totals.done / totals.due < 0.7 ? 'warn' : undefined} />
        <Stat label="Leg gym" value={`${totals.legs}/${totals.legsPlan}`} sub="done / planned" />
      </div>

      <div className="space-y-2">
        {[...Array(7)].map((_, i) => {
          const d = addDays(wk, i)
          const ev = data.events.find(e => e.date === d)
          return (
            <div key={d} className={`card p-3 ${d === today() ? 'ring-2 ring-brand/40' : ''}`}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <p className="font-semibold">{dmy(d, { weekday: true, year: false })}</p>
                {ev && <span className="chip !bg-ember/15 !text-ember">{ev.name}</span>}
              </div>
              {(['am', 'pm'] as Slot[]).map(s => {
                const p = data.planned.find(x => x.date === d && x.slot === s)
                const acts = data.acts.filter(a => a.date === d && ((p && a.planned_id === p.id) || (!a.planned_id && (a.slot ?? 'am') === s)))
                const sport = p?.sport ?? acts[0]?.sport ?? 'rest'
                if (sport === 'rest' && !acts.length) return <p key={s} className="text-xs text-muted pl-11 py-0.5">{s === 'am' ? 'AM' : 'PM'} · Rest</p>
                return (
                  <button key={s} className="w-full flex items-center gap-3 py-1.5 text-left" onClick={() => p && !acts.length && d >= today() ? setEdit(p) : setLog({ date: d, slot: s, planned: p, act: acts[0] })}>
                    <SportDot sport={sport} size={32} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{p?.title ?? acts[0]?.name}</span>
                      <span className="block text-xs text-muted truncate">
                        {s === 'am' ? 'AM' : 'PM'}{p && (p.targets?.pace ?? paceFor(p, data.paces)) ? ` · ${p.targets?.pace ?? paceFor(p, data.paces)}` : ''}{p?.planned_load ? ` · load ${p.planned_load}` : ''}{p?.change_note ? ` · ${p.change_note}` : ''}
                      </span>
                    </span>
                    {acts.length ? <span className="chip !bg-good/15 !text-good"><Icon name="check" size={12} />{num(acts.reduce((x, a) => x + actLoad(a), 0))}</span>
                      : p?.status === 'skipped' ? <span className="chip !bg-bad/12 !text-bad">Missed</span>
                      : p?.source === 'coach' ? <Icon name="spark" size={15} className="text-brand" /> : null}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <Card title="Coming up" sub="Races and checkpoints from the Comrades plan">
        <ul className="divide-y divide-line">
          {upcoming.map(e => (
            <li key={e.id} className="py-2 text-sm flex gap-3">
              <span className="num text-muted w-20 shrink-0">{dmy(e.date, { year: false })}</span>
              <span className="flex-1 min-w-0"><span className="font-medium">{e.name}</span>
                <span className="block text-xs text-muted">{[e.purpose, e.target, e.on_track && `on track ${e.on_track}`].filter(Boolean).join(' · ')}</span></span>
            </li>
          ))}
        </ul>
      </Card>

      {phase && (
        <Card title={phase.name} sub={`${dmy(phase.start_date)} – ${dmy(phase.end_date)}`}>
          <dl className="text-sm grid grid-cols-[7rem_1fr] gap-y-1">
            <dt className="text-muted">Run km/week</dt><dd>{phase.run_km_from} → {phase.run_km_to} (ceilings)</dd>
            {phase.long_run_from && <><dt className="text-muted">Long run</dt><dd>{phase.long_run_from} → {phase.long_run_to} km</dd></>}
            <dt className="text-muted">Key sessions</dt><dd>{phase.key_sessions}</dd>
            <dt className="text-muted">Strength</dt><dd>{phase.strength_emphasis}</dd>
          </dl>
        </Card>
      )}

      {log && <LogSheet date={log.date} slot={log.slot} planned={log.planned} act={log.act} lastKg={lastKg}
        existingSets={log.act ? data.sets.filter(x => x.activity_id === log.act!.id) : undefined}
        onClose={() => setLog(undefined)} onSaved={() => { setLog(undefined); void reload() }} />}
      {edit && <PlanSheet p={edit} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); void reload() }} onAskCoach={m => nav(`/coach?q=${encodeURIComponent(m)}`)} />}
    </div>
  )
}
