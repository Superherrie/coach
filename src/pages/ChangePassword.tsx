import { useState, type FormEvent } from 'react'
import { Logo } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

/** shown after signing in with a temporary password: choose your own before using the app */
export default function ChangePassword() {
  const { member, refresh, signOut } = useAuth()
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(undefined)
    if (a.length < 8) return setErr('Use at least 8 characters.')
    if (a !== b) return setErr('The two passwords are different.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: a })
    if (error) { setErr(error.message); setBusy(false); return }
    await supabase.rpc('tr_password_changed')
    await refresh(); setBusy(false)
  }
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <div className="flex items-center gap-3 mb-6"><Logo size={44} /><span className="display text-4xl">Coach</span></div>
        <p className="font-semibold">Welcome{member?.display_name ? `, ${member.display_name}` : ''}.</p>
        <p className="text-sm text-muted">You signed in with a temporary password. Choose your own to continue.</p>
        <input className="input" type="password" autoComplete="new-password" placeholder="New password" value={a} onChange={e => setA(e.target.value)} required />
        <input className="input" type="password" autoComplete="new-password" placeholder="Repeat it" value={b} onChange={e => setB(e.target.value)} required />
        {err && <p className="text-sm text-bad">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
        <button type="button" className="btn btn-ghost w-full" onClick={() => void signOut()}>Sign out</button>
      </form>
    </div>
  )
}
