import { useState } from 'react'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import { SPORT, dmy, minsOf } from '../lib/format'
import type { Proposal } from '../lib/types'

/** coach proposals waiting for a yes/no — each one is applied in the database in one go (tr_decide_proposal) */
export default function Proposals({ items, onDone }: { items: Proposal[]; onDone: () => void }) {
  const [busy, setBusy] = useState<number>(); const [err, setErr] = useState<string>()
  if (!items.length) return null
  async function decide(id: number, accept: boolean) {
    setBusy(id); setErr(undefined)
    const { error } = await supabase.rpc('tr_decide_proposal', { p_id: id, p_accept: accept })
    if (error) setErr(error.message)
    setBusy(undefined); onDone()
  }
  return (
    <div className="space-y-3">
      {items.map(p => (
        <div key={p.id} className="card p-4 border-ember/50">
          <p className="label text-ember flex items-center gap-1"><Icon name="spark" size={13} />Coach proposes</p>
          <p className="font-semibold mt-1">{p.title}</p>
          {p.why && <p className="text-sm text-muted mt-1 whitespace-pre-line">{p.why}</p>}
          <ul className="mt-3 space-y-2">
            {p.changes.map((c, i) => (
              <li key={i} className="text-sm rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-xs text-muted">{dmy(c.date, { weekday: true, year: false })} · {c.slot === 'am' ? 'morning' : 'afternoon'}</p>
                <p>{c.before ? <span className="line-through text-muted mr-1.5">{c.before.title}</span> : null}
                  <span className="font-medium">{c.after ? `${c.after.title}${c.after.duration_min ? ` (${minsOf(c.after.duration_min)})` : ''}` : 'Remove'}</span>
                  {c.after && <span className="chip ml-1.5" style={{ color: SPORT[c.after.sport]?.color }}>{SPORT[c.after.sport]?.label}</span>}</p>
                <p className="text-xs text-muted mt-0.5">{c.why}</p>
              </li>
            ))}
          </ul>
          {err && <p className="text-sm text-bad mt-2">{err}</p>}
          <div className="flex gap-2 mt-3">
            <button className="btn btn-primary flex-1" disabled={busy === p.id} onClick={() => void decide(p.id, true)}><Icon name="check" size={16} />Accept</button>
            <button className="btn btn-ghost" disabled={busy === p.id} onClick={() => void decide(p.id, false)}>No thanks</button>
          </div>
        </div>
      ))}
    </div>
  )
}
