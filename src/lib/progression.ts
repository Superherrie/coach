// Double progression for strength work: stay at a weight until every set reaches the top of the rep range,
// then add the increment. Two sessions in a row with a set below the bottom of the range → drop about 10%.
import type { GymSet } from './types'

export interface StrengthEx { name: string; sets?: number; rep_min?: number; rep_max?: number; increment_kg?: number }
export interface Session { date: string; sets: { kg: number | null; reps: number | null }[] }
export interface Suggestion { kg: number | null; reps: number; why: string; dir: 'up' | 'same' | 'down' | 'new' }

/** this exercise's past sessions, newest first */
export function history(all: GymSet[], name: string): Session[] {
  const by = new Map<string, Session>()
  for (const s of all.filter(s => s.exercise.toLowerCase() === name.toLowerCase())) {
    const k = `${s.date}|${s.activity_id}`
    const x = by.get(k) ?? { date: s.date, sets: [] }; x.sets.push({ kg: s.kg, reps: s.reps }); by.set(k, x)
  }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date))
}

const roundTo = (kg: number, step: number) => Math.round(kg / step) * step
const top = (s: Session) => Math.max(...s.sets.map(x => x.kg ?? 0))

export function suggest(e: StrengthEx, past: Session[]): Suggestion {
  const min = e.rep_min ?? 5, max = e.rep_max ?? min, inc = e.increment_kg ?? 2.5, n = e.sets ?? 3
  const last = past[0]
  if (!last) return { kg: null, reps: max, dir: 'new', why: `First time: pick a weight you could lift for ${max + 2} — two more than you'll do.` }
  const kg = top(last)
  const work = last.sets.filter(s => (s.kg ?? 0) >= kg)         // working sets at the top weight
  const allTop = work.length >= n && work.every(s => (s.reps ?? 0) >= max)
  const below = (s: Session) => s.sets.filter(x => (x.kg ?? 0) >= top(s)).some(x => (x.reps ?? 0) < min)
  if (allTop) return { kg: kg + inc, reps: min, dir: 'up', why: `Last time ${work.length}×${max}+ at ${kg} kg — up ${inc} kg. Aim for ${min}+ reps on every set.` }
  if (past[1] && below(last) && below(past[1]) && kg > 0) return { kg: roundTo(kg * 0.9, inc), reps: max, dir: 'down', why: `Two sessions below ${min} reps at ${kg} kg — drop about 10% and build back up.` }
  const best = Math.max(...work.map(s => s.reps ?? 0))
  return { kg, reps: Math.min(max, best + 1), dir: 'same', why: `Same ${kg} kg as last time (${work.map(s => s.reps ?? '–').join('/')} reps). Beat it: one more rep where you can, up to ${max}.` }
}
