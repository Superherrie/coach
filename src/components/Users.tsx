import { useState } from 'react'
import Icon from './Icon'
import { Card } from './ui'
import { callFn, useLoad } from '../lib/data'
import { stamp } from '../lib/format'

interface U { user_id: string; display_name: string; email: string | null; role: string; must_change_pw: boolean; last_sign_in_at: string | null }

/** Owner only: create users with a temporary password, reset passwords, remove access. Each user has their own data. */
export default function Users() {
  const { data, reload } = useLoad(async () => (await callFn<{ users: U[] }>('tr-admin-users', { action: 'list' })).users, [])
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [sex, setSex] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>()
  const [shown, setShown] = useState<{ who: string; email: string; pw: string; note?: string }>()
  const [copied, setCopied] = useState(false)

  async function create() {
    setBusy(true); setErr(undefined)
    try {
      const r = await callFn<{ temp_password: string; existing_login: boolean }>('tr-admin-users', { action: 'create', name, email, sex: sex || undefined })
      setShown({ who: name, email, pw: r.temp_password, note: r.existing_login ? 'This e-mail already had a login for your other apps — its password is now this temporary one there too.' : undefined })
      setName(''); setEmail(''); setSex(''); void reload()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function reset(u: U) {
    if (!confirm(`Give ${u.display_name} a new temporary password? Their current password stops working.`)) return
    try { const r = await callFn<{ temp_password: string }>('tr-admin-users', { action: 'reset', user_id: u.user_id }); setShown({ who: u.display_name, email: u.email ?? '', pw: r.temp_password }); void reload() }
    catch (e) { setErr((e as Error).message) }
  }
  async function remove(u: U) {
    if (!confirm(`Remove ${u.display_name}'s access to Coach? Their data stays and you can add them again later.`)) return
    try { await callFn('tr-admin-users', { action: 'remove', user_id: u.user_id }); void reload() } catch (e) { setErr((e as Error).message) }
  }
  const message = shown ? `Hi ${shown.who}, your Coach login:\nhttps://superherrie.github.io/coach/\nE-mail: ${shown.email}\nTemporary password: ${shown.pw}\nYou'll choose your own password when you first sign in.` : ''

  return (
    <Card title="Users" sub="Each user has their own plan, sessions, food, check-ins and photos. Nobody sees anyone else's data.">
      <ul className="divide-y divide-line text-sm">
        {(data ?? []).map(u => (
          <li key={u.user_id} className="py-2 flex items-center gap-2">
            <span className="flex-1 min-w-0">
              <span className="font-medium">{u.display_name}</span>{u.role === 'owner' && <span className="chip ml-1.5">owner</span>}
              <span className="block text-xs text-muted truncate">{u.email}{u.must_change_pw ? ' · temporary password not changed yet' : u.last_sign_in_at ? ` · last in ${stamp(u.last_sign_in_at)}` : ''}</span>
            </span>
            {u.role !== 'owner' && <>
              <button className="chip !py-1.5" onClick={() => void reset(u)}>Reset password</button>
              <button className="text-muted p-1" aria-label={`Remove ${u.display_name}`} onClick={() => void remove(u)}><Icon name="trash" size={15} /></button>
            </>}
          </li>
        ))}
      </ul>

      {shown && (
        <div className="mt-3 rounded-xl bg-ember/10 px-3 py-3 text-sm">
          <p className="font-semibold">Temporary password for {shown.who}</p>
          <p className="display text-2xl num tracking-wider my-1 select-all">{shown.pw}</p>
          <p className="text-xs text-muted">Shown once — pass it on now. {shown.who} has to change it at first sign-in.{shown.note ? ` ${shown.note}` : ''}</p>
          <div className="flex gap-2 mt-2">
            <button className="btn btn-primary !py-1.5 text-sm" onClick={() => { void navigator.clipboard?.writeText(message); setCopied(true) }}>{copied ? 'Copied ✓' : 'Copy message'}</button>
            <button className="btn btn-ghost !py-1.5 text-sm" onClick={() => { setShown(undefined); setCopied(false) }}>Done</button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <p className="label mb-1">Add a user</p>
        <div className="grid md:grid-cols-[1fr_1.4fr_6rem_auto] gap-2">
          <input className="input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
          <input className="input" type="email" autoComplete="off" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} />
          <select className="input" value={sex} onChange={e => setSex(e.target.value)}><option value="">Sex</option><option value="female">Female</option><option value="male">Male</option></select>
          <button className="btn btn-primary" disabled={busy || !name.trim() || !email.trim()} onClick={() => void create()}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
        {err && <p className="text-sm text-bad mt-2">{err}</p>}
      </div>
    </Card>
  )
}
