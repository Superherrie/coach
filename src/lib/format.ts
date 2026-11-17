import type { Sport } from './types'

const pad = (n: number) => String(n).padStart(2, '0')
/** local date as YYYY-MM-DD (the phone's own day, i.e. SAST for Herman) */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export const dow = (s: string) => (new Date(s + 'T12:00:00').getDay() + 6) % 7   // 0 = Monday
export const monday = (s: string) => addDays(s, -dow(s))
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 864e5)

/** 17 Nov 2026 style */
export const dmy = (s: string, opts: { weekday?: boolean; year?: boolean } = {}) =>
  new Date(s + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', ...(opts.year === false ? {} : { year: 'numeric' }), ...(opts.weekday ? { weekday: 'short' } : {}) })
export const dm = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
export const weekday = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'long' })
export const stamp = (iso: string) => {
  const d = new Date(iso), t = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return day === today() ? `today ${t}` : day === addDays(today(), -1) ? `yesterday ${t}` : `${dm(day)} ${t}`
}

export const mins = (s: number | null | undefined) => {
  if (!s) return '—'
  const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${m} min`
}
export const minsOf = (m: number | null | undefined) => (m ? mins(m * 60) : '—')
export const km = (m: number | null | undefined, dp = 1) => (m ? `${(m / 1000).toFixed(dp)} km` : '—')
export const pace = (sPerKm: number | null | undefined) => (sPerKm ? `${Math.floor(sPerKm / 60)}:${pad(Math.round(sPerKm % 60))}/km` : '—')
export const num = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toLocaleString('en-ZA', { maximumFractionDigits: dp, minimumFractionDigits: dp }))

export const SPORT: Record<Sport, { label: string; color: string; icon: string }> = {
  run: { label: 'Run', color: 'var(--s1)', icon: 'run' },
  ride: { label: 'Ride', color: 'var(--s2)', icon: 'bike' },
  gym_legs: { label: 'Legs', color: 'var(--s3)', icon: 'dumbbell' },
  gym_upper: { label: 'Upper body', color: 'var(--s7)', icon: 'dumbbell' },
  mobility: { label: 'Mobility', color: 'var(--s4)', icon: 'stretch' },
  rest: { label: 'Rest', color: 'var(--s-other)', icon: 'moon' },
  race: { label: 'Race', color: 'var(--ember)', icon: 'flag' },
  walk: { label: 'Walk', color: 'var(--s-other)', icon: 'stretch' },
  other: { label: 'Other', color: 'var(--s-other)', icon: 'stretch' },
}
