import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/Icon'

export default function Login() {
  const { session, member, signOut } = useAuth()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(undefined)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message)
    setBusy(false)
  }
  return (
    <div className="min-h-full grid md:grid-cols-2">
      <div className="relative hidden md:block overflow-hidden bg-brand-deep">
        <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 w-full h-full" aria-hidden>
          <path d="M0 420 L180 300 L300 360 L470 210 L620 330 L800 260 V600 H0z" fill="#1d3a5f" />
          <path d="M0 600 C200 520 330 470 430 380 S560 250 620 210" fill="none" stroke="#e8642c" strokeWidth="10" strokeLinecap="round" />
          <path d="M0 500 L220 430 L420 480 L800 400 V600 H0z" fill="#0f1f33" opacity=".85" />
        </svg>
        <div className="relative p-12 text-[#eef1f3]">
          <p className="display text-6xl leading-none">Sub-9.<br />One day at a time.</p>
          <p className="mt-4 max-w-sm text-white/70">Two sessions a day, what you actually did, and a coach that adjusts the plan as you go.</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8"><Logo size={44} /><span className="display text-4xl">Coach</span></div>
          {session && !member ? (
            <div className="card p-6">
              <p className="font-semibold mb-1">This login doesn’t have access.</p>
              <p className="text-sm text-muted mb-4">You’re signed in as {session.user.email}. Coach is private.</p>
              <button className="btn btn-ghost w-full" onClick={() => void signOut()}>Sign out</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <input className="input" type="email" autoComplete="username" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required />
              <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
              {error && <p className="text-sm text-bad">{error}</p>}
              <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
              <p className="text-xs text-muted text-center pt-2">Same login as Kompas.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
