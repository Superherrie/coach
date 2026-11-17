import { useEffect, useMemo, useState } from 'react'
import { Card, Stat } from './ui'
import { fetchAll, useLoad } from '../lib/data'
import { dmy, today } from '../lib/format'
import { supabase } from '../lib/supabase'

// List prices, US$ per million tokens (Claude API, Nov 2026). Thinking tokens are billed as output.
// Cache writes: 1-hour TTL = 2 × input, 5-minute = 1.25 × input. Unknown models are priced as Opus (the safe side).
const PRICE: Record<string, { in: number; out: number; read: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.1 },
}
interface Usage { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } }
interface Run { created_at: string; kind: string; model: string | null; usage: Usage | null }

export function costUsd(model: string | null, u: Usage | null) {
  if (!u) return 0
  const p = PRICE[model ?? ''] ?? PRICE['claude-opus-5-5']
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h)
  return ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.read + w1h * p.in * 2 + w5m * p.in * 1.25) / 1e6
}
const kindLabel = (k: string) => (k === 'daily' ? 'Daily reviews' : k === 'chat' ? 'Coach chat' : k.startsWith('insight') ? 'Chart insights' : k)

export default function ApiSpend() {
  const { data, reload } = useLoad(async () => {
    const [runs, s] = await Promise.all([
      fetchAll<Run>(() => supabase.from('tr_coach_runs').select('created_at,kind,model,usage').not('usage', 'is', null).order('created_at')),
      supabase.from('tr_settings').select('api_credit_usd,api_credit_at,usd_zar').eq('id', 1).single(),
    ])
    return { runs, s: s.data as { api_credit_usd: number | null; api_credit_at: string | null; usd_zar: number | null } }
  }, [])
  const [bal, setBal] = useState(''); const [fx, setFx] = useState(''); const [msg, setMsg] = useState<string>()
  useEffect(() => { if (data) { setBal(data.s.api_credit_usd != null ? String(data.s.api_credit_usd) : ''); setFx(String(data.s.usd_zar ?? 16.7)) } }, [data])

  const v = useMemo(() => {
    if (!data) return null
    const rate = +(data.s.usd_zar ?? 16.7)
    const rows = data.runs.map(r => ({ ...r, usd: costUsd(r.model, r.usage) }))
    const t = today(), month = t.slice(0, 7), d30 = new Date(Date.now() - 30 * 864e5).toISOString()
    const sum = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).reduce((s, r) => s + r.usd, 0)
    const since = data.s.api_credit_at
    const spentSince = since ? sum(r => r.created_at > since) : 0
    const byKind = new Map<string, { n: number; usd: number }>()
    for (const r of rows.filter(r => r.created_at >= d30)) { const k = kindLabel(r.kind); const x = byKind.get(k) ?? { n: 0, usd: 0 }; x.n++; x.usd += r.usd; byKind.set(k, x) }
    const last30 = sum(r => r.created_at >= d30)
    const left = data.s.api_credit_usd != null ? data.s.api_credit_usd - spentSince : null
    return { rate, today: sum(r => r.created_at.slice(0, 10) === t), month: sum(r => r.created_at.slice(0, 7) === month), last30, all: sum(() => true), n: rows.length, byKind: [...byKind.entries()].sort((a, b) => b[1].usd - a[1].usd), spentSince, left, daysLeft: left != null && last30 > 0 ? Math.floor(left / (last30 / 30)) : null }
  }, [data])

  async function save() {
    const { error } = await supabase.from('tr_settings').update({ api_credit_usd: bal ? +bal : null, api_credit_at: bal ? new Date().toISOString() : null, usd_zar: fx ? +fx : 16.7 }).eq('id', 1)
    setMsg(error ? error.message : 'Saved'); void reload()
  }
  if (!v || !data) return null
  const R = (usd: number) => `R${(usd * v.rate).toLocaleString('en-ZA', { maximumFractionDigits: usd * v.rate < 10 ? 2 : 0, minimumFractionDigits: usd * v.rate < 10 ? 2 : 0 })}`

  return (
    <Card title="Claude API spend" sub="Coach's own calls, worked out from their tokens at list price. The credit is shared with Kompas (slip scans) and Relay, which are not counted here, so the true balance is lower than shown.">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Credit left (at most)" value={v.left != null ? R(v.left) : '—'} sub={v.left != null ? `$${v.left.toFixed(2)} less other apps' use${v.daysLeft != null ? ` · Coach alone ~${v.daysLeft} days` : ''}` : 'enter your balance below'} tone={v.left != null && v.left < 5 ? 'bad' : v.left != null && v.left < 15 ? 'warn' : undefined} />
        <Stat label="This month" value={R(v.month)} sub={`$${v.month.toFixed(2)}`} />
        <Stat label="Last 30 days" value={R(v.last30)} sub={`$${v.last30.toFixed(2)}`} />
        <Stat label="Today" value={R(v.today)} sub={`${v.n} calls in total`} />
      </div>
      {v.byKind.length > 0 && (
        <ul className="mt-3 text-sm divide-y divide-line">
          {v.byKind.map(([k, x]) => <li key={k} className="flex justify-between py-1.5"><span>{k} <span className="text-muted">· {x.n}×</span></span><span className="num">{R(x.usd)} <span className="text-muted text-xs">(~{R(x.usd / x.n)} each)</span></span></li>)}
        </ul>
      )}
      <div className="grid grid-cols-[1fr_6rem_auto] gap-2 mt-4 items-end">
        <label><span className="label">Credit balance in US$ (from Console → Billing)</span><input inputMode="decimal" className="input mt-1" value={bal} onChange={e => setBal(e.target.value)} placeholder="e.g. 18.40" /></label>
        <label><span className="label">R per $</span><input inputMode="decimal" className="input mt-1" value={fx} onChange={e => setFx(e.target.value)} /></label>
        <button className="btn btn-primary" onClick={() => void save()}>Save</button>
      </div>
      <p className="text-[11px] text-muted mt-2">
        {data.s.api_credit_at ? `Balance entered ${dmy(data.s.api_credit_at.slice(0, 10))}; ${R(v.spentSince)} spent since. ` : ''}
        Re-enter it whenever you top up or check the Console — Anthropic doesn't let apps read the balance. {msg}
      </p>
    </Card>
  )
}
