export type Sport = 'run' | 'ride' | 'gym_legs' | 'gym_upper' | 'mobility' | 'rest' | 'race' | 'walk' | 'other'
export type Slot = 'am' | 'pm'

export interface Exercise { name: string; sets: number; reps: number; kg: number | null }
export interface Targets { hr_max?: number | null; pace?: string | null; watts?: string | null; exercises?: Exercise[] | null }

export interface Planned {
  id: number; date: string; slot: Slot; sport: Sport; title: string; description: string | null
  duration_min: number | null; distance_km: number | null; intensity: string | null; targets: Targets
  planned_load: number | null; source: 'seed' | 'coach' | 'manual'; change_note: string | null; locked: boolean
  status: 'planned' | 'done' | 'skipped'
}

export interface Activity {
  id: string; source: 'icu' | 'manual'; date: string; start_local: string | null; slot: Slot | null; sport: Sport
  name: string | null; trainer: boolean | null; duration_s: number | null; distance_m: number | null; elev_m: number | null
  avg_hr: number | null; max_hr: number | null; avg_watts: number | null; np_watts: number | null; ftp: number | null
  avg_pace_s: number | null; gap_pace_s: number | null; load: number | null; intensity: number | null; ef: number | null
  decoupling: number | null; rpe: number | null; feel: number | null; hr_zone_s: number[] | null; notes: string | null
  planned_id: number | null
}

export interface GymSet { id: number; activity_id: string; date: string; exercise: string; set_no: number; reps: number | null; kg: number | null; rir: number | null }

export interface Wellness {
  date: string; resting_hr: number | null; hrv: number | null; sleep_h: number | null; sleep_score: number | null
  weight_kg: number | null; waist_cm: number | null; body_fat: number | null; icu_ctl: number | null; icu_atl: number | null; icu_ramp: number | null
  legs: number | null; energy: number | null; ankle_pain: number | null; motivation: number | null; notes: string | null
  manual: Record<string, boolean>
}

export interface Settings {
  id: 1; icu_athlete_id: string | null; icu_connected_at: string | null; height_cm: number | null; ftp_w: number | null; max_hr: number | null
  run_max_hr: number | null; easy_run_hr_cap: number | null; goal_weight_kg: number | null; coach_auto: boolean; coach_model: string; notes: string | null
}

export interface Phase { id: number; name: string; start_date: string; end_date: string; focus: string | null; run_km_from: number | null; run_km_to: number | null; long_run_from: number | null; long_run_to: number | null; leg_sessions: string | null; key_sessions: string | null; strength_emphasis: string | null }
export interface Event { id: number; date: string; name: string; kind: string; distance_km: number | null; purpose: string | null; target: string | null; on_track: string | null; borderline: string | null; rethink: string | null; result: string | null; entry_status: string | null }

export interface ProposalChange { date: string; slot: Slot; why: string; before: { sport: Sport; title: string; duration_min: number | null; distance_km: number | null; planned_load: number | null } | null; after: (Omit<Planned, 'id' | 'date' | 'slot' | 'source' | 'locked' | 'status'>) | null }
export interface Proposal { id: number; created_at: string; title: string; why: string | null; changes: ProposalChange[]; status: string }
export interface CoachRun { id: number; created_at: string; kind: string; summary: string | null; today_note: string | null; model: string | null; error: string | null; usage: Record<string, number> | null }
