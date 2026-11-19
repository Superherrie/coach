// Per-block detail of a Garmin session (laps / work + recovery intervals from intervals.icu).
import type { Activity } from '../lib/types'

export interface Block {
  n: number; type?: string; label?: string; start_s?: number; min?: number; km?: number
  hr?: number; min_hr?: number; max_hr?: number; w?: number; np?: number; max_w?: number; cad?: number; kmh?: number
  pace_s?: number; gap_s?: number; elev_m?: number; grad?: number; resp?: number; decoupling?: number; ef?: number; zone?: number
}
const mmss = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—')
const dur = (min?: number) => (min == null ? '—' : min < 10 ? mmss(min * 60) : `${Math.round(min)}′`)
const blocksOf = (a: Activity) => ((a as Activity & { blocks?: Block[] | null }).blocks ?? []) as Block[]

/** one line under the session: the work reps side by side, e.g. "Reps 290 · 296 · 297 W — HR 139 · 142 · 144" */
export function RepLine({ a }: { a: Activity }) {
  const work = blocksOf(a).filter(b => b.type === 'WORK' && (b.min ?? 0) >= 0.75)
  if (work.length < 2) return null
  const run = a.sport === 'run'
  return (
    <span className="block text-muted num mt-0.5">
      Reps {work.map(b => (run ? mmss(b.pace_s) : b.w ?? '—')).join(' · ')}{run ? '/km' : ' W'} — HR {work.map(b => b.hr ?? '—').join(' · ')}
    </span>
  )
}

export function BlocksTable({ a }: { a: Activity }) {
  const blocks = blocksOf(a)
  if (blocks.length < 2) return null
  const run = a.sport === 'run', ride = a.sport === 'ride'
  const cols: { h: string; v: (b: Block) => string | number | undefined; hint?: string }[] = [
    { h: '', v: b => (b.type === 'WORK' ? 'Work' : b.type === 'RECOVERY' ? 'Easy' : b.label || `Lap ${b.n}`) },
    { h: 'Time', v: b => dur(b.min) },
    ...(run || (a.distance_m ?? 0) > 0 && !a.trainer ? [{ h: 'km', v: (b: Block) => b.km?.toFixed(2) }] : []),
    ...(run ? [{ h: 'Pace', v: (b: Block) => mmss(b.pace_s) }, { h: 'GAP', v: (b: Block) => mmss(b.gap_s), hint: 'grade-adjusted pace' }] : []),
    ...(ride ? [{ h: 'W', v: (b: Block) => b.w }, { h: 'NP', v: (b: Block) => b.np }] : []),
    { h: 'HR', v: b => b.hr },
    { h: 'Max', v: b => b.max_hr },
    { h: 'Cad', v: b => b.cad },
    ...(blocks.some(b => b.elev_m && b.elev_m > 3) ? [{ h: '↑m', v: (b: Block) => b.elev_m }] : []),
    { h: 'Eff', v: b => b.ef, hint: ride ? 'watts per heartbeat' : 'metres/min per heartbeat' },
  ]
  return (
    <div className="mb-3">
      <p className="label mb-1">Blocks ({blocks.length})</p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs num">
          <thead><tr className="text-muted text-left">{cols.map(c => <th key={c.h} title={c.hint} className="font-medium px-1 py-1 whitespace-nowrap">{c.h}</th>)}</tr></thead>
          <tbody>
            {blocks.map(b => (
              <tr key={b.n} className={`border-t border-line ${b.type === 'WORK' ? 'font-semibold' : 'text-muted'}`}>
                {cols.map(c => <td key={c.h} className="px-1 py-1 whitespace-nowrap">{c.v(b) ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted mt-1">From Garmin via intervals.icu. Eff = {ride ? 'watts' : 'metres a minute'} per heartbeat; higher is fitter.</p>
    </div>
  )
}
