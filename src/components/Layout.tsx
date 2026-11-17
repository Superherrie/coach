import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Icon, { Logo } from './Icon'
import { useAuth } from '../context/AuthContext'
import { callFn, useLoad } from '../lib/data'
import { stamp } from '../lib/format'
import { supabase } from '../lib/supabase'

const NAV = [
  { to: '/', label: 'Today', icon: 'today', end: true },
  { to: '/plan', label: 'Plan', icon: 'calendar' },
  { to: '/trends', label: 'Trends', icon: 'chart' },
  { to: '/coach', label: 'Coach', icon: 'chat' },
  { to: '/workouts', label: 'Workouts', icon: 'stretch' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

/** "Synced today 05:15" + a sync button. Every screen listens for the 'tr-synced' event to reload. */
function SyncButton({ dark }: { dark?: boolean }) {
  const { data: last, reload } = useLoad(async () => (await supabase.from('tr_sync_log').select('created_at,ok,detail').order('created_at', { ascending: false }).limit(1)).data?.[0], [])
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>()
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', again); return () => document.removeEventListener('visibilitychange', again)
  }, [reload])
  async function run() {
    setBusy(true); setMsg(undefined)
    try { await callFn('tr-sync', {}); window.dispatchEvent(new Event('tr-synced')) } catch (e) { setMsg((e as Error).message) }
    await reload(); setBusy(false)
  }
  const tone = dark ? 'text-white/60' : 'text-muted'
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {msg ? <span className="text-xs text-bad truncate max-w-[12rem]" title={msg}>{msg}</span>
        : last && <span className={`text-xs truncate ${last.ok ? tone : 'text-bad'}`}>{last.ok ? `Synced ${stamp(last.created_at)}` : 'Sync failed'}</span>}
      <button onClick={() => void run()} disabled={busy} aria-label="Sync Garmin data now" className={`p-1.5 rounded-full ${dark ? 'hover:bg-white/10' : 'hover:bg-surface-2'}`}>
        <Icon name="sync" size={17} className={busy ? 'animate-spin' : ''} />
      </button>
    </span>
  )
}

export default function Layout() {
  const { member, signOut } = useAuth()
  const loc = useLocation(); const nav = useNavigate()
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  const TABS = NAV.filter(n => n.to !== '/settings' && n.to !== '/workouts')

  return (
    <div className="min-h-full md:flex">
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-brand-deep text-[#eef1f3] p-5">
        <div className="flex items-center gap-3 mb-1"><Logo size={36} /><span className="display text-3xl">Coach</span></div>
        <p className="text-xs text-white/50 pl-12 mb-6">Road to Comrades 2027</p>
        <nav className="flex-1 space-y-1">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-white/12 text-white' : 'text-white/65 hover:text-white hover:bg-white/6'}`}>
              <Icon name={n.icon} />{n.label}
            </NavLink>
          ))}
        </nav>
        <button className="btn btn-ember w-full mb-2" onClick={() => nav('/?log=1')}><Icon name="plus" />Log a session</button>
        <button className="btn w-full mb-4 bg-white/10 text-white" onClick={() => nav('/?meal=1')}><Icon name="food" />Add a meal</button>
        <SyncButton dark />
        <div className="flex items-center justify-between text-xs text-white/60 mt-3">
          <span>{member?.display_name}</span>
          <button onClick={() => void signOut()} className="flex items-center gap-1 hover:text-white"><Icon name="out" size={14} />Sign out</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 md:ml-60 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-10">
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),0.6rem)] pb-2 bg-bg/90 backdrop-blur">
          <Logo size={26} /><span className="display text-xl">Coach</span>
          <span className="ml-auto flex items-center gap-1"><SyncButton />
            <button onClick={() => nav('/?meal=1')} aria-label="Add a meal" className="flex items-center gap-1 rounded-full bg-ember text-white pl-2 pr-2.5 py-1 text-xs font-semibold active:scale-95"><Icon name="food" size={15} />Meal</button>
            <NavLink to="/workouts" aria-label="Workouts" className="p-1.5 text-muted"><Icon name="stretch" size={19} /></NavLink>
            <NavLink to="/settings" aria-label="Settings" className="p-1.5 text-muted"><Icon name="settings" size={19} /></NavLink></span>
        </header>
        <div className="mx-auto max-w-5xl px-4 md:px-8 md:pt-8"><Outlet /></div>
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)] select-none">
        <div className="grid grid-cols-5 items-end">
          {[TABS[0], TABS[1], null, TABS[2], TABS[3]].map((n, i) => n ? (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-medium ${isActive ? 'text-brand' : 'text-muted'}`}>
              <Icon name={n.icon} size={23} />{n.label}
            </NavLink>
          ) : (
            <button key={i} onClick={() => nav('/?log=1')} aria-label="Log a session" className="mx-auto -mt-6 mb-1.5 grid place-items-center w-14 h-14 rounded-full bg-ember text-white shadow-lg active:scale-95 transition">
              <Icon name="plus" size={28} />
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
