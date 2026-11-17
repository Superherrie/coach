// Jack Daniels' VDOT: one number from a race or time trial gives every training pace.
// Paces from a Johannesburg result already include the altitude (~1,700 m), so they are right for training at home;
// at the coast (Comrades, Durban) the same effort runs roughly 3–5% faster.
export interface Paces { vdot: number; source: string; date: string; easy: [number, number]; marathon: number; threshold: number; interval: number; predict: Record<string, number> }

const vo2 = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v                 // ml/kg/min at v m/min
const pct = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t)   // share of VO2max held for t min
const vel = (target: number) => (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (target + 4.6))) / (2 * 0.000104)   // m/min for a VO2
const secPerKm = (vMpm: number) => Math.round(60000 / vMpm)

export function vdotFrom(meters: number, seconds: number) { const t = seconds / 60; return vo2(meters / t) / pct(t) }

/** time (s) to run `meters` at a given VDOT */
export function predict(vdot: number, meters: number) {
  let lo = 60, hi = 60 * 60 * 30
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (vdotFrom(meters, mid) > vdot) lo = mid; else hi = mid }
  return Math.round((lo + hi) / 2)
}

export function pacesFrom(meters: number, seconds: number, source: string, date: string): Paces {
  const v = vdotFrom(meters, seconds)
  const mar = predict(v, 42195)
  return {
    vdot: Math.round(v * 10) / 10, source, date,
    easy: [secPerKm(vel(v * 0.70)), secPerKm(vel(v * 0.62))],          // easy / long-run range (fast end, slow end)
    marathon: Math.round(mar / 42.195),
    threshold: secPerKm(vel(v * 0.88)),                                 // tempo: comfortably hard, ~1 h race effort
    interval: secPerKm(vel(v * 0.975)),                                 // 3–5 min reps
    predict: { '10 km': predict(v, 10000), 'Half': predict(v, 21097), 'Marathon': mar, '50 km': predict(v, 50000) },
  }
}

export const fmtPace = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—')
export const fmtTime = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}` }

/** which pace a planned run calls for, from its title and intensity */
export function paceFor(p: { title: string; intensity: string | null; sport: string }, x?: Paces | null): string | null {
  if (!x || p.sport !== 'run') return null
  const t = p.title.toLowerCase()
  if (/marathon-pace|marathon pace/.test(t)) return `${fmtPace(x.marathon - 5)}–${fmtPace(x.marathon + 5)}/km`
  if (/goal-pace|goal pace|comrades/.test(t)) return '5:50–6:00/km (Comrades goal)'
  if (/tempo|threshold/.test(t)) return `${fmtPace(x.threshold)}/km tempo`
  if (/interval|vo2/.test(t)) return `${fmtPace(x.interval)}/km reps`
  if (/hill|downhill|strides|time trial/.test(t)) return null                    // effort-based
  if (p.intensity === 'easy' || p.intensity === 'recovery' || /easy|long/.test(t)) return `${fmtPace(x.easy[0])}–${fmtPace(x.easy[1])}/km`
  return null
}
