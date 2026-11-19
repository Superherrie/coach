// Training-load maths shared by the screens (the coach function uses the same formulas).
import type { Activity, Wellness } from './types'
import { addDays } from './format'

/** TSS-like load. intervals.icu's figure where it exists; otherwise duration × RPE (IF = 0.5 + 0.05·RPE).
 *  Upper-body gym counts at 30% (recovery-grade), leg gym at 70%. */
export function actLoad(a: Pick<Activity, 'load' | 'duration_s' | 'rpe' | 'sport'>) {
  if (a.load != null) return a.load
  const h = (a.duration_s ?? 0) / 3600, rpe = a.rpe ?? (a.sport.startsWith('gym') ? 5 : 4)
  const f = 0.5 + 0.05 * rpe
  const k = a.sport === 'gym_upper' ? 0.3 : a.sport === 'gym_legs' ? 0.7 : a.sport === 'mobility' ? 0.2 : 1
  return Math.round(h * 100 * f * f * k)
}

export interface PmcDay { date: string; load: number; fitness: number; fatigue: number; form: number }
/** fitness (42-day), fatigue (7-day), form = yesterday's fitness − fatigue. `until` may run past today (planned). */
/** fitness starts from zero, so every screen (and the coach) counts load from the same 365 days back — otherwise the numbers differ */
export const PMC_DAYS = 365

export function pmc(acts: Activity[], from: string, until: string, extra: Record<string, number> = {}): PmcDay[] {
  const by = new Map<string, number>()
  for (const a of acts) by.set(a.date, (by.get(a.date) ?? 0) + actLoad(a))
  for (const [d, l] of Object.entries(extra)) by.set(d, (by.get(d) ?? 0) + l)
  let ctl = 0, atl = 0; const out: PmcDay[] = []
  for (let d = from; d <= until; d = addDays(d, 1)) {
    const l = by.get(d) ?? 0, form = ctl - atl
    ctl += (l - ctl) / 42; atl += (l - atl) / 7
    out.push({ date: d, load: l, fitness: +ctl.toFixed(1), fatigue: +atl.toFixed(1), form: +form.toFixed(1) })
  }
  return out
}

/** rolling mean over the previous `n` values that exist (for 7-day weight / resting-HR baselines) */
export function rolling<T>(rows: T[], get: (r: T) => number | null | undefined, n: number) {
  const out: (number | null)[] = []; const win: number[] = []
  for (const r of rows) {
    const v = get(r); if (v != null) { win.push(v); if (win.length > n) win.shift() }
    out.push(win.length ? +(win.reduce((s, x) => s + x, 0) / win.length).toFixed(1) : null)
  }
  return out
}

/** readiness flags from the morning numbers, compared with Herman's own baseline */
export function readiness(well: Wellness[], date: string) {
  const w = well.find(x => x.date === date)
  const prior = well.filter(x => x.date < date && x.date >= addDays(date, -28))
  const avg = (f: (x: Wellness) => number | null) => { const v = prior.map(f).filter((x): x is number => x != null); return v.length >= 4 ? v.reduce((s, x) => s + x, 0) / v.length : null }
  const rhrBase = avg(x => x.resting_hr), hrvBase = avg(x => x.hrv)
  const flags: string[] = []
  if (w?.resting_hr != null && rhrBase != null && w.resting_hr - rhrBase >= 5) flags.push(`Resting HR ${w.resting_hr} is ${Math.round(w.resting_hr - rhrBase)} above your 4-week average`)
  if (w?.hrv != null && hrvBase != null && w.hrv < hrvBase * 0.85) flags.push(`HRV ${Math.round(w.hrv)} is well below your average (${Math.round(hrvBase)})`)
  if (w?.legs != null && w.legs >= 4) flags.push('Legs heavy or sore')
  if (w?.ankle_pain != null && w.ankle_pain > 3) flags.push(`Ankle ${w.ankle_pain}/10 — plan rule: back off running for a week`)
  if (w?.sleep_h != null && w.sleep_h < 6) flags.push(`Only ${w.sleep_h} h sleep`)
  return { w, rhrBase, hrvBase, flags }
}

/** Epley estimated one-rep max */
export const e1rm = (kg: number, reps: number) => (reps <= 1 ? kg : kg * (1 + reps / 30))
