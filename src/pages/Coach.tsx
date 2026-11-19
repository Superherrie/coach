import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { Card } from '../components/ui'
import Proposals from '../components/Proposals'
import { callFn, getPending, useLoad } from '../lib/data'
import { dmy, stamp } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { CoachRun, Planned } from '../lib/types'

const SUGGEST = ['How did last week go against the plan?', 'My ankle is sore today — what should I change?', 'I have to travel Thursday and Friday. Re-plan the week.', 'Am I on track for sub-9?']

export default function Coach() {
  const [params, setParams] = useSearchParams()
  const { data, reload } = useLoad(async () => {
    const [chat, pending, runs, changed, weekly] = await Promise.all([
      supabase.from('tr_chat').select('*').order('created_at', { ascending: false }).limit(40),
      getPending(),
      supabase.from('tr_coach_runs').select('*').eq('kind', 'daily').order('created_at', { ascending: false }).limit(7),
      supabase.from('tr_planned').select('*').eq('source', 'coach').order('updated_at', { ascending: false }).limit(10),
      supabase.from('tr_coach_runs').select('*').eq('kind', 'weekly').not('summary', 'is', null).order('created_at', { ascending: false }).limit(1),
    ])
    return { chat: (chat.data ?? []).reverse() as { id: number; role: string; content: string; created_at: string; meta: { saved?: string[]; retired?: string[] } | null }[], pending, runs: (runs.data ?? []) as CoachRun[], changed: (changed.data ?? []) as (Planned & { updated_at: string })[], weekly: (weekly.data?.[0] ?? null) as CoachRun | null }
  }, [])
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState<string>(); const [err, setErr] = useState<string>()
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { const q = params.get('q'); if (q) { setMsg(q); setParams({}, { replace: true }) } }, [params, setParams])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [data?.chat.length, busy])

  async function send(text = msg) {
    if (!text.trim()) return
    setBusy('chat'); setErr(undefined); setMsg('')
    try { await callFn('tr-coach', { mode: 'chat', message: text }) } catch (e) { setErr((e as Error).message); setMsg(text) }
    await reload(); setBusy(undefined)
  }
  async function review(mode: 'daily' | 'weekly' = 'daily') {
    setBusy(mode === 'weekly' ? 'weekly' : 'review'); setErr(undefined)
    try { await callFn('tr-sync', {}).catch(() => null); await callFn('tr-coach', { mode }) } catch (e) { setErr((e as Error).message) }
    await reload(); setBusy(undefined)
  }
  if (!data) return <p className="text-muted py-10 text-center animate-pulse">Loading…</p>
  const last = data.runs.find(r => r.summary)

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center gap-2">
        <h1 className="display text-3xl leading-none flex-1">Coach</h1>
        <button className="btn btn-ghost !py-1.5 text-sm" disabled={!!busy} onClick={() => void review('weekly')}><Icon name="calendar" size={15} className={busy === 'weekly' ? 'animate-pulse' : ''} />{busy === 'weekly' ? 'Reviewing week…' : 'Week'}</button>
        <button className="btn btn-ghost !py-1.5 text-sm" disabled={!!busy} onClick={() => void review()}><Icon name="spark" size={15} className={busy === 'review' ? 'animate-pulse' : ''} />{busy === 'review' ? 'Reviewing…' : 'Review now'}</button>
      </div>
      {data.weekly && (
        <Card title={<span className="flex items-center gap-2"><Icon name="calendar" size={18} className="text-ember" />Weekly review</span>} sub={stamp(data.weekly.created_at)}>
          {data.weekly.today_note && <p className="text-sm font-medium mb-1">{data.weekly.today_note}</p>}
          <p className="text-sm text-muted whitespace-pre-line">{data.weekly.summary}</p>
        </Card>
      )}
      {last && (
        <Card title="Latest review" sub={stamp(last.created_at)}>
          {last.today_note && <p className="text-sm font-medium mb-1">{last.today_note}</p>}
          <p className="text-sm text-muted whitespace-pre-line">{last.summary}</p>
        </Card>
      )}
      <Proposals items={data.pending} onDone={() => void reload()} />

      <Card title="Ask">
        <div className="space-y-3 max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {!data.chat.length && <div className="flex flex-wrap gap-1.5">{SUGGEST.map(s => <button key={s} className="chip !py-1.5 !text-xs text-left" onClick={() => void send(s)}>{s}</button>)}</div>}
          {data.chat.map(c => (
            <div key={c.id} className={`flex ${c.role === 'user' ? 'justify-end' : ''}`}>
              <div className="max-w-[85%]">
                <p className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line ${c.role === 'user' ? 'bg-brand text-surface rounded-br-md' : 'bg-surface-2 rounded-bl-md'}`}>{c.content}</p>
                {c.meta?.saved?.map(x => <p key={x} className="text-[11px] text-brand mt-1 flex gap-1"><Icon name="spark" size={12} className="shrink-0 mt-px" />Remembered: {x}</p>)}
                {c.meta?.retired?.map(x => <p key={x} className="text-[11px] text-muted mt-1 line-through">{x}</p>)}
              </div>
            </div>
          ))}
          {busy === 'chat' && <p className="text-sm text-muted animate-pulse">Coach is thinking…</p>}
          <div ref={end} />
        </div>
        {err && <p className="text-sm text-bad mt-2">{err}</p>}
        <form className="flex gap-2 mt-3" onSubmit={e => { e.preventDefault(); void send() }}>
          <textarea className="input flex-1" rows={2} value={msg} onChange={e => setMsg(e.target.value)} placeholder="Ask, or tell it what happened (missed a session, legs dead, travelling…)"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 768) { e.preventDefault(); void send() } }} />
          <button className="btn btn-primary self-end" disabled={!!busy || !msg.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
        </form>
        <p className="text-[11px] text-muted mt-2">Plan changes from a chat come back as a proposal for you to accept.</p>
      </Card>

      {data.changed.length > 0 && (
        <Card title="Recent coach changes" sub="Applied automatically (small, day-level) or accepted by you">
          <ul className="divide-y divide-line text-sm">
            {data.changed.map(p => (
              <li key={p.id} className="py-2"><p><span className="text-muted">{dmy(p.date, { weekday: true, year: false })} {p.slot.toUpperCase()} · </span>{p.title}</p>
                {p.change_note && <p className="text-xs text-muted">{p.change_note}</p>}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
