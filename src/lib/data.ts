import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Activity, CoachRun, Event, GymSet, Phase, Planned, Proposal, Settings, Wellness } from './types'

/** PostgREST caps a response at 1000 rows — page until it runs dry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data as T[]))
    if (!data || data.length < 1000) return out
  }
}

export const getPlanned = (from: string, to: string) => fetchAll<Planned>(() => supabase.from('tr_planned').select('*').gte('date', from).lte('date', to).order('date').order('slot'))
export const getActs = (from: string, to: string) => fetchAll<Activity>(() => supabase.from('tr_activities').select('id,source,date,start_local,slot,sport,name,trainer,duration_s,distance_m,elev_m,avg_hr,max_hr,avg_watts,np_watts,ftp,avg_pace_s,gap_pace_s,load,intensity,ef,decoupling,calories,rpe,feel,hr_zone_s,notes,planned_id').gte('date', from).lte('date', to).order('date').order('start_local'))
export const getWellness = (from: string, to: string) => fetchAll<Wellness>(() => supabase.from('tr_wellness').select('*').gte('date', from).lte('date', to).order('date'))
export const getSets = (from: string) => fetchAll<GymSet>(() => supabase.from('tr_gym_sets').select('*').gte('date', from).order('date').order('set_no'))
/** the signed-in user's id (RLS already limits every table to their own rows; writes that need a filter use this) */
export async function myId() { const { data } = await supabase.auth.getSession(); return data.session!.user.id }
export async function getSettings() {
  const uid = await myId()
  const { data, error } = await supabase.from('tr_settings').select('*').eq('user_id', uid).maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return data as Settings
  // first visit of a new user: create their settings row
  const { data: made, error: e2 } = await supabase.from('tr_settings').insert({ user_id: uid }).select('*').single()
  if (e2) throw new Error(e2.message)
  return made as Settings
}
export async function getPhases() { const { data } = await supabase.from('tr_phases').select('*').order('start_date'); return (data ?? []) as Phase[] }
export async function getEvents() { const { data } = await supabase.from('tr_events').select('*').order('date'); return (data ?? []) as Event[] }
export async function getPending() { const { data } = await supabase.from('tr_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: false }); return (data ?? []) as Proposal[] }
export async function getLastRun(kind = 'daily') { const { data } = await supabase.from('tr_coach_runs').select('*').eq('kind', kind).is('error', null).not('summary', 'is', null).order('created_at', { ascending: false }).limit(1); return (data?.[0] ?? null) as CoachRun | null }

/** call an edge function as the signed-in user; throws the function's own error text */
export async function callFn<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (error as any).context as Response | undefined
    let msg = error.message
    try { const j = await ctx?.json(); if (j?.error) msg = j.error } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return data as T
}

/** tiny async-state hook: data, error, loading and a reload() */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>(); const [error, setError] = useState<string>(); const [loading, setLoading] = useState(true)
  const latest = useRef(fn)
  useEffect(() => { latest.current = fn })
  const key = JSON.stringify(deps)
  const reload = useCallback(() => {
    setLoading(true)
    return latest.current().then(d => { setData(d); setError(undefined) }).catch(e => setError(String(e.message ?? e))).finally(() => setLoading(false))
  }, [])
  useEffect(() => { void reload() }, [reload, key])
  return { data, error, loading, reload }
}
