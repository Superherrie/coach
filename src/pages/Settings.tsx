import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { Card } from '../components/ui'
import ApiSpend from '../components/ApiSpend'
import { callFn, getSettings, myId, useLoad } from '../lib/data'
import Users from '../components/Users'
import PacesCard from '../components/PacesCard'
import CoachMemory from '../components/CoachMemory'
import type { Paces } from '../lib/paces'
import { stamp } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Settings as S } from '../lib/types'

export default function Settings() {
  const { signOut, member } = useAuth()
  const { data, reload } = useLoad(async () => {
    const [s, keySet, log] = await Promise.all([getSettings(), supabase.rpc('tr_icu_key_set'), supabase.from('tr_sync_log').select('*').order('created_at', { ascending: false }).limit(5)])
    return { s, keySet: !!keySet.data, log: log.data ?? [] }
  }, [])
  const [f, setF] = useState<Partial<S>>({}); const [athlete, setAthlete] = useState(''); const [key, setKey] = useState('')
  const [msg, setMsg] = useState<string>(); const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) { setF(data.s); setAthlete(data.s.icu_athlete_id ?? '') } }, [data])
  if (!data) return <p className="text-muted py-10 text-center animate-pulse">Loading…</p>

  async function connect() {
    setBusy(true); setMsg(undefined)
    const { error } = await supabase.rpc('tr_set_icu', { p_athlete: athlete, p_key: key })
    if (error) { setMsg(error.message); setBusy(false); return }
    setKey('')
    try { const r = await callFn<{ activities: number; wellness: number; skipped_strava: number }>('tr-sync', { days: 180 }); setMsg(`Connected. Loaded ${r.activities} sessions and ${r.wellness} days of wellness${r.skipped_strava ? ` (${r.skipped_strava} Strava-only sessions skipped)` : ''}.`); window.dispatchEvent(new Event('tr-synced')) }
    catch (e) { setMsg((e as Error).message) }
    setBusy(false); void reload()
  }
  async function save() {
    setBusy(true)
    const n = (v: unknown) => (v === '' || v == null ? null : Number(v))
    const { error } = await supabase.from('tr_settings').update({ height_cm: n(f.height_cm), ftp_w: n(f.ftp_w), max_hr: n(f.max_hr), run_max_hr: n(f.run_max_hr), easy_run_hr_cap: n(f.easy_run_hr_cap), goal_weight_kg: n(f.goal_weight_kg), birth_year: n(f.birth_year), activity_factor: n(f.activity_factor), kcal_deficit: n(f.kcal_deficit), coach_auto: f.coach_auto, coach_model: f.coach_model, notes: f.notes || null, sex: f.sex || null, coach_profile: f.coach_profile || null, garmin_push: !!f.garmin_push, updated_at: new Date().toISOString() }).eq('user_id', await myId())
    setMsg(error ? error.message : 'Saved'); setBusy(false); void reload()
  }
  const num = (k: keyof S, label: string, hint?: string) => (
    <label><span className="label">{label}</span><input inputMode="decimal" className="input mt-1" value={(f[k] as number | null) ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} />{hint && <span className="text-[11px] text-muted">{hint}</span>}</label>
  )

  return (
    <div className="space-y-4 py-3">
      <h1 className="display text-3xl leading-none">Settings</h1>
      {msg && <p className="text-sm rounded-xl bg-surface-2 px-3 py-2">{msg}</p>}

      <Card title="Garmin via intervals.icu" sub={data.keySet ? `Connected${data.s.icu_connected_at ? ` ${stamp(data.s.icu_connected_at)}` : ''} · syncs every morning at 05:15` : 'Not connected yet'}>
        <ol className="text-sm text-muted list-decimal pl-5 space-y-1 mb-3">
          <li>Sign up free at intervals.icu and connect <b>Garmin Connect</b> (Settings → Connections). Tick the wellness boxes so resting HR, HRV, sleep and weight come across.</li>
          <li>In intervals.icu Settings → Developer Settings, create an API key. Your athlete id (e.g. i123456) is shown there too.</li>
          <li>Paste both here. The key is stored in the database only for the sync; the app can never read it back.</li>
        </ol>
        <div className="grid md:grid-cols-[10rem_1fr_auto] gap-2">
          <input className="input" placeholder="Athlete id" value={athlete} onChange={e => setAthlete(e.target.value)} />
          <input className="input" type="password" autoComplete="off" placeholder={data.keySet ? 'API key saved — paste to replace' : 'API key'} value={key} onChange={e => setKey(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || (!key && !data.keySet)} onClick={() => void connect()}>{busy ? 'Working…' : data.keySet && !key ? 'Re-sync 180 days' : 'Connect'}</button>
        </div>
        <p className="text-[11px] text-muted mt-2">The six months before this were loaded once from Strava through the Strava connector; when Garmin delivers the same session, the Garmin copy replaces it. The daily sync doesn't use Strava, and sessions that reach intervals.icu only from Strava are skipped.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.garmin_push} onChange={e => setF({ ...f, garmin_push: e.target.checked })} />Put planned sessions on my Garmin (next 14 days, updated 05:40 and 18:40)</label>
          <button className="btn btn-ghost !py-1.5 text-sm" disabled={busy || !data.keySet} onClick={async () => { setBusy(true); try { const r = await callFn<{ pushed: number; removed: number; unchanged: number; errors: string[] }>('tr-garmin', {}); setMsg(`Garmin: ${r.pushed} sent, ${r.removed} removed, ${r.unchanged} already up to date${r.errors.length ? ` · ${r.errors.length} with errors` : ''}. They reach the watch at its next sync.`) } catch (e) { setMsg((e as Error).message) } setBusy(false) }}>Send to Garmin now</button>
        </div>
        <p className="text-[11px] text-muted mt-1">Needs "Upload planned workouts" ticked on the Garmin connection in intervals.icu (it is on yours).</p>
        {data.log.length > 0 && <ul className="mt-3 text-xs text-muted space-y-0.5">{data.log.map(l => <li key={l.id} className={l.ok ? '' : 'text-bad'}>{stamp(l.created_at)} · {l.ok ? `${l.detail?.activities ?? 0} sessions, ${l.detail?.wellness ?? 0} wellness days` : l.detail?.error}</li>)}</ul>}
      </Card>

      <PacesCard paces={(data.s.paces as Paces | null) ?? null} onSaved={() => void reload()} />

      <Card title="You" sub="Used for zones, targets and the waist-to-height ratio">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {num('height_cm', 'Height cm')}
          {num('goal_weight_kg', 'Goal weight kg', 'mid-May checkpoint')}
          {num('ftp_w', 'FTP W')}
          {num('max_hr', 'Max HR (bike)')}
          {num('run_max_hr', 'Max HR (run)', 'once known')}
          {num('easy_run_hr_cap', 'Easy-run HR cap', 'until the 10 km TT')}
          {num('birth_year', 'Birth year', 'for resting burn')}
          {num('activity_factor', 'Non-exercise factor', '1.2 desk · 1.35 on your feet')}
          {num('kcal_deficit', 'Daily deficit kcal', 'target = out − this')}
        </div>
        <label className="block mt-3"><span className="label">Sex</span>
          <select className="input mt-1" value={f.sex ?? ''} onChange={e => setF({ ...f, sex: e.target.value })}><option value="">—</option><option value="male">Male</option><option value="female">Female</option></select></label>
        <label className="block mt-3"><span className="label">About you for the coach — goal, event and date, history, injuries, weekly availability</span>
          <span className="block text-[11px] text-muted">Your permanent profile. Change it when something fundamental changes.</span>
          <textarea className="input mt-1 text-sm" rows={6} value={f.coach_profile ?? ''} onChange={e => setF({ ...f, coach_profile: e.target.value })} placeholder="e.g. Goal: Two Oceans half marathon, 11 Apr 2027, under 2:10. Running 3×/week, 25 km. Old knee niggle on long downhills. Gym Mon/Thu evenings." /></label>
        <label className="block mt-3"><span className="label">Notes for the coach</span><span className="block text-[11px] text-muted">Short practical notes. Decisions from chat go to Coach memory below by themselves.</span><textarea className="input mt-1" rows={3} value={f.notes ?? ''} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="e.g. Away 3–7 Dec, gym closed on Sundays, prefer long runs Saturday" /></label>
      </Card>

      <CoachMemory />

      <Card title="Coach">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.coach_auto ?? true} onChange={e => setF({ ...f, coach_auto: e.target.checked })} />
          <span>Apply small changes automatically (swap or trim a session in the next 7 days). Long runs, weekly volume and phases always come to you as a proposal.</span></label>
        <label className="block mt-3"><span className="label">Model</span>
          <select className="input mt-1" value={f.coach_model ?? 'claude-opus-5-5'} onChange={e => setF({ ...f, coach_model: e.target.value })}>
            <option value="claude-opus-5-5">Claude Opus 5.5 — best judgement (default)</option>
            <option value="claude-sonnet-5-5">Claude Sonnet 5.5 — about half the cost</option>
          </select></label>
        <p className="text-[11px] text-muted mt-2">Runs once a day at 05:25 after the Garmin sync, and whenever you ask.</p>
      </Card>

      {member?.role === 'owner' && <ApiSpend />}
      {member?.role === 'owner' && <Users />}

      <div className="flex gap-2">
        <button className="btn btn-primary flex-1" disabled={busy} onClick={() => void save()}>Save settings</button>
        <button className="btn btn-ghost" onClick={() => void signOut()}><Icon name="out" size={16} />Sign out</button>
      </div>
      <p className="text-xs text-muted text-center">{member?.display_name}</p>
    </div>
  )
}
