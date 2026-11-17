// Calories out = resting burn × non-exercise factor + what each session burns on top.
// Resting burn: Mifflin–St Jeor (male) from the latest weight, height and age.
// Session burn: Garmin's figure where it exists (minus the resting burn it already includes),
// otherwise ride kJ ≈ kcal, run ≈ 1 kcal per kg per km, gym ≈ 6 kcal/min, other ≈ 4 kcal/min.
import type { Activity } from './types'

export interface Body { weight: number; height: number; age: number; factor: number }

export const bmr = (b: Body) => Math.round(10 * b.weight + 6.25 * b.height - 5 * b.age + 5)

export function sessionKcal(a: Activity, b: Body) {
  const min = (a.duration_s ?? 0) / 60
  const restingShare = (bmr(b) * b.factor / 1440) * min
  let gross: number
  if (a.calories) gross = a.calories
  else if (a.sport === 'ride' && a.avg_watts && a.duration_s) gross = (a.avg_watts * a.duration_s) / 1000   // kJ of work ≈ kcal burned (≈24% efficiency)
  else if (a.sport === 'run' && a.distance_m) gross = b.weight * (a.distance_m / 1000)
  else if (a.sport === 'gym_legs' || a.sport === 'gym_upper') gross = 6 * min
  else gross = 4 * min
  return Math.max(0, Math.round(gross - restingShare))
}

export function kcalOut(acts: Activity[], b: Body) {
  const base = Math.round(bmr(b) * b.factor)
  const training = acts.reduce((s, a) => s + sessionKcal(a, b), 0)
  return { base, training, total: base + training }
}

/** 7,700 kcal ≈ 1 kg of body fat */
export const KCAL_PER_KG = 7700
