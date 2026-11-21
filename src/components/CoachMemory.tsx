// Coach memory: lasting decisions / facts the coach saved from chat, or the athlete added. Every review and chat reads them.
import { useState } from 'react'
import Icon from './Icon'
import { Card, Empty } from './ui'
import { useLoad } from '../lib/data'
import { dmy, today } from '../lib/format'
import { supabase } from '../lib/supabase'

interface Mem { id: number; created_at: string; text: string; kind: string; expires_on: string | null; source: string; active: boolean; hard: boolean; rule: Record<string, unknown> | null }

export default function CoachMemory() {
  const { data, reload } = useLoad(async () => ((await supabase.from('tr_coach_memory').select('*').eq('active', true).order('created_at', { ascending: false })).data ?? []) as Mem[], [])
  const [edit, setEdit] = useState<{ id?: number; text: string; expires_on: string; hard: boolean }>()
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!edit?.text.trim()) return
    setBusy(true)
    const row = { text: edit.text.trim(), expires_on: edit.hard ? null : edit.expires_on || null, hard: edit.hard, updated_at: new Date().toISOString() }
    if (edit.id) await supabase.from('tr_coach_memory').update(row).eq('id', edit.id)
    else await supabase.from('tr_coach_memory').insert({ ...row, source: 'athlete', kind: 'fact' })
    setBusy(false); setEdit(undefined); void reload()
  }
  async function remove(m: Mem) {
    if (!confirm(`Remove from the coach's memory?\n\n"${m.text}"`)) return
    await supabase.from('tr_coach_memory').update({ active: false, updated_at: new Date().toISOString() }).eq('id', m.id); void reload()
  }
  const t = today()
  const list = [...(data ?? [])].sort((a, b) => Number(b.hard) - Number(a.hard))
  return (
    <Card title="Coach memory" sub="Decisions and facts the coach keeps for every review and chat. NEVER rules are also checked after every run: a plan that breaks one is corrected, or shown with a warning."
      right={!edit ? <button className="chip" onClick={() => setEdit({ text: '', expires_on: '', hard: false })}><Icon name="plus" size={13} />Add</button> : undefined}>
      {edit && (
        <div className="space-y-2 mb-3 rounded-2xl bg-surface-2 p-3">
          <textarea className="input text-sm" rows={2} autoFocus value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} placeholder="e.g. No hip mobility sessions until I ask · Away 3–7 Dec, hotel gym only" />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={edit.hard} onChange={e => setEdit({ ...edit, hard: e.target.checked })} />
            <span><b>Never rule</b> — checked after every coach review and chat; a plan that breaks it gets corrected or flagged. No end date.</span></label>
          <div className="flex items-end gap-2">
            <label className={`flex-1 ${edit.hard ? 'opacity-40 pointer-events-none' : ''}`}><span className="label">Until (optional)</span><input type="date" className="input mt-1" value={edit.expires_on} min={t} onChange={e => setEdit({ ...edit, expires_on: e.target.value })} /></label>
            <button className="btn btn-ghost" onClick={() => setEdit(undefined)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !edit.text.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
      {!data ? <p className="text-sm text-muted animate-pulse">Loading…</p> : list.length ? (
        <ul className="divide-y divide-line">
          {list.map(m => {
            const expired = !!m.expires_on && m.expires_on < t
            return (
              <li key={m.id} className={`py-2 flex gap-2 items-start ${expired ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{m.hard && <span className="chip !py-0 !px-1.5 !text-[10px] !bg-bad/12 !text-bad mr-1.5 align-middle">NEVER</span>}{m.text}</p>
                  <p className="text-[11px] text-muted">{dmy(m.created_at.slice(0, 10), { year: false })} · {m.source === 'chat' ? 'from chat' : 'added by you'}{m.hard ? ` · checked every run${m.rule ? ' (code + AI)' : ' (AI)'}` : ''}{m.expires_on ? ` · ${expired ? 'expired' : 'until'} ${dmy(m.expires_on, { year: false })}` : ''}</p>
                </div>
                <button className="p-1 text-muted" aria-label="Edit" onClick={() => setEdit({ id: m.id, text: m.text, expires_on: m.expires_on ?? '', hard: m.hard })}><Icon name="edit" size={15} /></button>
                <button className="p-1 text-bad" aria-label="Remove" onClick={() => void remove(m)}><Icon name="trash" size={15} /></button>
              </li>
            )
          })}
        </ul>
      ) : <Empty>Nothing yet. When you agree something with the coach in chat, it lands here.</Empty>}
    </Card>
  )
}
