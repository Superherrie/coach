import { useState } from 'react'
import Icon from './Icon'
import { Sheet } from './ui'
import { callFn } from '../lib/data'
import { stamp, today } from '../lib/format'
import { supabase } from '../lib/supabase'

export interface ChartAI { key: string; title: string; about: string; range: string; data: unknown }
interface InsightOut { headline: string; points: string[]; on_track: 'on_track' | 'watch' | 'concern' | 'too_little_data'; action: string | null }

const TONE = {
  on_track: { label: 'On track', cls: 'bg-good/15 text-good' },
  watch: { label: 'Watch', cls: 'bg-warn/15 text-warn' },
  concern: { label: 'Concern', cls: 'bg-bad/12 text-bad' },
  too_little_data: { label: 'Too little data', cls: 'bg-surface-2 text-muted' },
}

/** small ✦ AI button on a chart card: Claude reads what the chart plots plus the plan, sessions and wellness.
 *  The answer is kept for the day (same chart + range) so reopening it costs nothing. */
export function InsightButton({ ai }: { ai: ChartAI }) {
  const [open, setOpen] = useState(false)
  const [res, setRes] = useState<{ insight: InsightOut; at: string }>()
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>()
  const chart = `${ai.key}:${ai.range}`

  async function run(fresh: boolean) {
    setBusy(true); setErr(undefined)
    try {
      if (!fresh) {
        const { data } = await supabase.from('tr_coach_runs').select('summary,created_at').eq('kind', `insight:${chart}`).is('error', null).not('summary', 'is', null)
          .gte('created_at', today() + 'T00:00:00+02:00').order('created_at', { ascending: false }).limit(1)
        if (data?.[0]) { setRes({ insight: JSON.parse(data[0].summary), at: data[0].created_at }); return }
      }
      const r = await callFn<{ insight: InsightOut; created_at: string }>('tr-coach', { mode: 'insight', chart, title: ai.title, about: ai.about, range: ai.range, data: ai.data as Record<string, unknown> })
      setRes({ insight: r.insight, at: r.created_at })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      <button className="chip !py-1 !px-2.5 !text-brand hover:!bg-brand/10" onClick={() => { setOpen(true); if (!res) void run(false) }} aria-label={`AI insight on ${ai.title}`}>
        <Icon name="spark" size={13} />AI
      </button>
      {open && (
        <Sheet title={<span className="flex items-center gap-2"><Icon name="spark" size={18} className="text-ember" />{ai.title}</span>} onClose={() => setOpen(false)}
          footer={<button className="btn btn-ghost w-full" disabled={busy} onClick={() => void run(true)}><Icon name="sync" size={15} className={busy ? 'animate-spin' : ''} />{busy ? 'Analysing…' : 'Analyse again'}</button>}>
          {busy && !res && <p className="text-sm text-muted animate-pulse py-6 text-center">Reading the chart, your plan and your recent sessions…</p>}
          {err && <p className="text-sm text-bad">{err}</p>}
          {res && (
            <div className={`space-y-3 ${busy ? 'opacity-50' : ''}`}>
              <span className={`chip ${TONE[res.insight.on_track].cls}`}>{TONE[res.insight.on_track].label}</span>
              <p className="font-semibold leading-snug">{res.insight.headline}</p>
              <ul className="space-y-1.5 text-sm">{res.insight.points.map((p, i) => <li key={i} className="flex gap-2"><span className="text-muted">•</span><span>{p}</span></li>)}</ul>
              {res.insight.action && <div className="rounded-xl bg-brand/10 px-3 py-2 text-sm"><span className="label text-brand">Do this</span><p className="mt-0.5">{res.insight.action}</p></div>}
              <p className="text-[11px] text-muted">{ai.range} · {stamp(res.at)}</p>
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}
