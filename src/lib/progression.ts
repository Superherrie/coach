// Double progression for strength work: stay at a weight until every set reaches the top of the rep range,
// then add the increment. Two sessions in a row with a set below the bottom of the range → drop about 10%.
// The training phase can hold weights (recovery, ultra block, taper, race week) and sets the number of sets.
import type { GymSet } from './types'
import { addDays } from './format'

export interface StrengthEx { name: string; sets?: number; rep_min?: number; rep_max?: number; increment_kg?: number }
export interface Session { date: string; sets: { kg: number | null; reps: number | null; rir: number | null }[] }
export interface Suggestion { kg: number | null; reps: number; sets: number; why: string; dir: 'up' | 'same' | 'down' | 'new' | 'hold' | 'skip' }
export interface Mode { kind: 'build' | 'hold' | 'skip'; sets: number | null; label: string; why: string }

/** this exercise's past sessions, newest first */
export function history(all: GymSet[], name: string): Session[] {
  const by = new Map<string, Session>()
  for (const s of all.filter(s => s.exercise.toLowerCase() === name.toLowerCase())) {
    const k = `${s.date}|${s.activity_id}`
    const x = by.get(k) ?? { date: s.date, sets: [] }; x.sets.push({ kg: s.kg, reps: s.reps, rir: s.rir }); by.set(k, x)
  }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date))
}

/** where we are in the plan → how to progress today */
export function modeFor(day: string, phases: { name: string; start_date: string; end_date: string }[], events: { date: string; name: string; kind: string; distance_km: number | null }[], weekLoads?: { thisWeek: number; lastWeek: number }): Mode {
  const ph = phases.find(p => day >= p.start_date && day <= p.end_date)?.name ?? ''
  const races = events.filter(e => e.kind === 'race' && e.date > day)
  const comrades = races.find(e => /comrades/i.test(e.name))
  if (comrades && comrades.date <= addDays(day, 10)) return { kind: 'skip', sets: 0, label: 'Skip', why: `Comrades is ${comrades.date} — the plan's last leg session is about 10 days out. Rest the legs.` }
  const soon = races.find(e => e.date <= addDays(day, 5) && (e.distance_km ?? 0) >= 20)
  if (soon) return { kind: 'hold', sets: 2, label: 'Race week', why: `${soon.name} on ${soon.date}: the plan says no heavy legs within 5 days. If you do lift: hold weights, 2 easy sets, nothing near failure.` }
  if (/taper/i.test(ph)) return { kind: 'hold', sets: 2, label: 'Taper', why: 'Taper: hold weights, 2 sets, stop 2–3 reps short of failure. Keep the strength, shed the fatigue.' }
  if (/ultra/i.test(ph)) return { kind: 'hold', sets: 3, label: 'Maintenance', why: 'Ultra-specific block: maintenance — hold weights, 3 heavy sets. Running volume is the priority now.' }
  if (/race week|cancún|cancun/i.test(ph)) return { kind: 'hold', sets: 2, label: ph, why: `${ph}: light — hold weights, 2 sets.` }
  if (weekLoads && weekLoads.lastWeek > 0 && weekLoads.thisWeek < weekLoads.lastWeek * 0.75) return { kind: 'hold', sets: 3, label: 'Recovery week', why: 'Recovery week (planned load down 25%+): hold weights, 3 sets.' }
  return { kind: 'build', sets: null, label: ph || 'Build', why: `${ph || 'Build'}: progress — add weight when every set reaches the top of the range.` }
}

const roundTo = (kg: number, step: number) => Math.round(kg / step) * step
const top = (s: Session) => Math.max(...s.sets.map(x => x.kg ?? 0))

export function suggest(e: StrengthEx, past: Session[], mode?: Mode): Suggestion {
  const min = e.rep_min ?? 5, max = e.rep_max ?? min, inc = e.increment_kg ?? 2.5
  const n = mode?.sets ?? e.sets ?? 3
  if (mode?.kind === 'skip') return { kg: null, reps: 0, sets: 0, dir: 'skip', why: mode.why }
  const last = past[0]
  if (!last) return { kg: null, reps: max, sets: n, dir: 'new', why: `First time: pick a weight you could lift for ${max + 2} — two more than you'll do.` }
  const kg = top(last)
  const work = last.sets.filter(s => (s.kg ?? 0) >= kg)         // working sets at the top weight
  const lastSet = work[work.length - 1]
  const failed = lastSet?.rir === 0                               // taken to failure → don't add weight yet
  const allTop = work.length >= Math.min(n, e.sets ?? n) && work.every(s => (s.reps ?? 0) >= max)
  const below = (s: Session) => s.sets.filter(x => (x.kg ?? 0) >= top(s)).some(x => (x.reps ?? 0) < min)
  if (mode?.kind === 'hold') return { kg, reps: Math.min(max, Math.max(min, ...work.map(s => s.reps ?? 0))), sets: n, dir: 'hold', why: `${mode.label}: hold ${kg} kg — ${n} sets, leave 2 reps in reserve.` }
  if (allTop && !failed) return { kg: kg + inc, reps: min, sets: n, dir: 'up', why: `Last time ${work.length}×${max}+ at ${kg} kg — up ${inc} kg. Aim for ${min}+ reps on every set.` }
  if (allTop && failed) return { kg, reps: max, sets: n, dir: 'same', why: `All ${max}s at ${kg} kg, but the last set went to failure — repeat ${kg} kg with a rep in reserve, then add weight.` }
  if (past[1] && below(last) && below(past[1]) && kg > 0) return { kg: roundTo(kg * 0.9, inc), reps: max, sets: n, dir: 'down', why: `Two sessions below ${min} reps at ${kg} kg — drop about 10% and build back up.` }
  const best = Math.max(...work.map(s => s.reps ?? 0))
  return { kg, reps: Math.min(max, best + 1), sets: n, dir: 'same', why: `Same ${kg} kg as last time (${work.map(s => s.reps ?? '–').join('/')} reps). Beat it: one more rep where you can, up to ${max}.` }
}

/** Epley estimated one-rep max */
export const e1rm = (kg: number, reps: number) => (reps <= 1 ? kg : kg * (1 + reps / 30))
