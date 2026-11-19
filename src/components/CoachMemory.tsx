// Coach memory: lasting decisions / facts the coach saved from chat, or the athlete added. Every review and chat reads them.
import { useState } from 'react'
import Icon from './Icon'
import { Card, Empty } from './ui'
import { useLoad } from '../lib/data'
import { dmy, today } from '../lib/format'
import { supabase } from '../lib/supabase'

interface Mem { id: number; created_at: string; text: string; kind: string; expires_on: string | null; source: string; active: boolean }

export default function CoachMemory() {
  const { data, reload } = useLoad(async () => ((await supabase.from('tr_coach_memory').select('*').eq('active', true).order('created_at', { ascending: false })).data ?? []) as Mem[], [])
  const [edit, setEdit] = useState<{ id?: number; text: string; expires_on: string }>()
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!edit?.text.trim()) return
    setBusy(true)
    const row = { text: edit.text.trim(), expires_on: edit.expires_on || null, updated_at: new Date().toISOString() }
    if (edit.id) await supabase.from('tr_coach_memory').update(row).eq('id', edit.id)
    else await supabase.from('tr_coach_memory').insert({ ...row, source: 'athlete', kind: 'fact' })
    setBusy(false); setEdit(undefined); void reload()
  }
  async function remove(m: Mem) {
    if (!confirm(`Remove from the coach's memory?\n\n"${m.text}"`)) return
    await supabase.from('tr_coach_memory').update({ active: false, updated_at: new Date().toISOString() }).eq('id', m.id); void reload()
  }
  const t = today()
  const list = data ?? []
  return (
    <Card title="Coach memory" sub="Decisions and facts the coach keeps for every review and chat. It saves them from chat; you can add, change or remove them."
      right={!edit ? <button className="chip" onClick={() => setEdit({ text: '', expires_on: '' })}><Icon name="plus" size={13} />Add</button> : undefined}>
      {edit && (
        <div className="space-y-2 mb-3 rounded-2xl bg-surface-2 p-3">
          <textarea className="input text-sm" rows={2} autoFocus value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} placeholder="e.g. No hip mobility sessions until I ask · Away 3–7 Dec, hotel gym only" />
          <div className="flex items-end gap-2">
            <label className="flex-1"><span className="label">Until (optional)</span><input type="date" className="input mt-1" value={edit.expires_on} min={t} onChange={e => setEdit({ ...edit, expires_on: e.target.value })} /></label>
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
                  <p className="text-sm">{m.text}</p>
                  <p className="text-[11px] text-muted">{dmy(m.created_at.slice(0, 10), { year: false })} · {m.source === 'chat' ? 'from chat' : 'added by you'}{m.expires_on ? ` · ${expired ? 'expired' : 'until'} ${dmy(m.expires_on, { year: false })}` : ''}</p>
                </div>
                <button className="p-1 text-muted" aria-label="Edit" onClick={() => setEdit({ id: m.id, text: m.text, expires_on: m.expires_on ?? '' })}><Icon name="edit" size={15} /></button>
                <button className="p-1 text-bad" aria-label="Remove" onClick={() => void remove(m)}><Icon name="trash" size={15} /></button>
              </li>
            )
          })}
        </ul>
      ) : <Empty>Nothing yet. When you agree something with the coach in chat, it lands here.</Empty>}
    </Card>
  )
}
