// Calories out = resting burn × non-exercise factor + what each session burns on top.
// Resting burn: Mifflin–St Jeor (by sex) from the latest weight, height and age.
// Session burn: Garmin's figure where it exists (minus the resting burn it already includes),
// otherwise ride kJ ≈ kcal, run ≈ 1 kcal per kg per km, gym ≈ 6 kcal/min, other ≈ 4 kcal/min.
import type { Activity, Settings, Wellness } from './types'

export interface Body { weight: number; height: number; age: number; factor: number; female?: boolean; weightFrom?: 'weigh-in' | 'goal' | 'guess'; bmrFixed?: number; bmrFrom?: string }

/** measured BMR from a recent InBody scan when there is one, else Mifflin–St Jeor */
export const bmr = (b: Body) => b.bmrFixed ? Math.round(b.bmrFixed) : Math.round(10 * b.weight + 6.25 * b.height - 5 * b.age + (b.female ? -161 : 5))

/** the signed-in athlete's body for calorie maths: latest weigh-in, else their goal weight (flagged), never someone else's numbers */
export function bodyFrom(s: Settings, well: Wellness[], day: string, scans: { date: string; bmr_kcal: number | null }[] = []): Body {
  const female = s.sex === 'female'
  const kg = [...well].reverse().find(w => w.weight_kg && w.date <= day)?.weight_kg
  const goal = s.goal_weight_kg ? Number(s.goal_weight_kg) : null
  return {
    weight: Number(kg ?? goal ?? (female ? 68 : 82)), weightFrom: kg ? 'weigh-in' : goal ? 'goal' : 'guess',
    height: Number(s.height_cm ?? (female ? 168 : 178)), age: Number(day.slice(0, 4)) - (s.birth_year ?? 1985),
    factor: Number(s.activity_factor ?? 1.25), female,
    ...recentBmr(scans, day),
  }
}

/** InBody BMR counts for 120 days after the scan */
function recentBmr(scans: { date: string; bmr_kcal: number | null }[], day: string) {
  const sc = [...scans].filter(x => x.bmr_kcal && x.date <= day).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!sc || (new Date(day).getTime() - new Date(sc.date).getTime()) / 864e5 > 120) return {}
  return { bmrFixed: Number(sc.bmr_kcal), bmrFrom: sc.date.slice(8, 10) + '/' + sc.date.slice(5, 7) }
}

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
