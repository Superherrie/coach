import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { Card, Empty, Sheet } from '../components/ui'
import { shrink } from '../components/Food'
import { callFn, getSettings, getWellness, myId, useLoad } from '../lib/data'
import { addDays, dmy, today } from '../lib/format'
import { navyBf, split } from '../lib/body'
import { supabase } from '../lib/supabase'

interface AI { usable: boolean; bf_low: number; bf_high: number; bf_best: number; confidence: string; changes: string[]; notes: string; compared_to: string | null }
interface PhotoSet { id: number; date: string; front_path: string | null; side_path: string | null; back_path: string | null; weight_kg: number | null; waist_cm: number | null; neck_cm: number | null; navy_bf: number | null; ai: AI | null; notes: string | null }
const VIEWS = ['front', 'side', 'back'] as const

/** private signed URLs (1 hour) for a set's photos — the bucket is never public */
async function signed(paths: (string | null)[]) {
  const ps = paths.filter(Boolean) as string[]
  if (!ps.length) return {} as Record<string, string>
  const { data } = await supabase.storage.from('tr-body').createSignedUrls(ps, 3600)
  return Object.fromEntries((data ?? []).filter(d => d.signedUrl).map(d => [d.path, d.signedUrl])) as Record<string, string>
}

export default function Body() {
  const { data, reload } = useLoad(async () => {
    const [sets, well, s] = await Promise.all([
      supabase.from('tr_body_photos').select('*').order('date', { ascending: false }),
      getWellness(addDays(today(), -60), today()), getSettings(),
    ])
    const list = (sets.data ?? []) as PhotoSet[]
    const urls = await signed(list.slice(0, 6).flatMap(x => [x.front_path, x.side_path, x.back_path]))
    const last = <K extends 'weight_kg' | 'waist_cm' | 'neck_cm'>(k: K) => [...well].reverse().find(w => w[k] != null)?.[k] ?? null
    return { list, urls, height: s.height_cm, weight: last('weight_kg'), waist: last('waist_cm'), neck: last('neck_cm') }
  }, [])
  const [add, setAdd] = useState(false); const [compare, setCompare] = useState(false)
  if (!data) return <p className="text-muted py-10 text-center animate-pulse">Loading…</p>
  const tape = navyBf(data.waist, data.neck, data.height)
  const latest = data.list[0], prev = data.list[1]
  const m = split(data.weight, latest?.ai?.bf_best ?? tape)

  return (
    <div className="space-y-4 py-3">
      <Link to="/trends" className="text-sm text-muted flex items-center gap-1"><Icon name="left" size={16} />Trends</Link>
      <div className="flex items-center gap-2">
        <h1 className="display text-3xl leading-none flex-1">Body composition</h1>
        <button className="btn btn-primary !py-1.5 text-sm" onClick={() => setAdd(true)}><Icon name="camera" size={16} />New photos</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-surface-2 px-3 py-2.5"><p className="label">Tape estimate</p><p className="display text-2xl num">{tape != null ? `${tape}%` : '—'}</p><p className="text-[11px] text-muted">{tape != null ? `waist ${data.waist} · neck ${data.neck}` : 'log waist + neck'}</p></div>
        <div className="rounded-2xl bg-surface-2 px-3 py-2.5"><p className="label">Photo estimate</p><p className="display text-2xl num">{latest?.ai?.usable ? `${latest.ai.bf_low}–${latest.ai.bf_high}%` : '—'}</p><p className="text-[11px] text-muted">{latest ? dmy(latest.date, { year: false }) : 'no photos yet'}</p></div>
        <div className="rounded-2xl bg-surface-2 px-3 py-2.5"><p className="label">Fat / lean</p><p className="display text-2xl num">{m ? `${Math.round(m.fat)} / ${Math.round(m.lean)}` : '—'}</p><p className="text-[11px] text-muted">kg at {data.weight ?? '?'} kg</p></div>
      </div>

      {latest?.ai && (
        <Card title={`Latest read · ${dmy(latest.date)}`} sub={latest.ai.compared_to ? `Compared with ${dmy(latest.ai.compared_to)}` : 'First set — the next one gets compared with this'}
          right={prev ? <button className="chip !py-1.5" onClick={() => setCompare(c => !c)}>{compare ? 'Hide' : 'Side by side'}</button> : undefined}>
          {!latest.ai.usable && <p className="text-sm text-bad mb-2">The photos weren't clear enough for a reliable read.</p>}
          <p className="text-sm"><b>{latest.ai.bf_best}%</b> best estimate, range {latest.ai.bf_low}–{latest.ai.bf_high}% ({latest.ai.confidence} confidence)</p>
          {latest.ai.changes.length > 0 && <ul className="text-sm mt-2 space-y-1">{latest.ai.changes.map(c => <li key={c} className="flex gap-2"><span className="text-muted">•</span>{c}</li>)}</ul>}
          <p className="text-xs text-muted mt-2">{latest.ai.notes}</p>
          {compare && prev && <Compare a={prev} b={latest} />}
        </Card>
      )}

      <Card title="History">
        {data.list.length ? (
          <ul className="space-y-3">
            {data.list.map(x => <SetRow key={x.id} x={x} urls={data.urls} onChanged={() => void reload()} />)}
          </ul>
        ) : <Empty>Take your first set: front and side, same spot, same light, morning before eating.</Empty>}
      </Card>
      <p className="text-[11px] text-muted text-center">Photos are stored privately in your Supabase project, opened only with your login, and sent to Claude only to make the estimate. The coach sees the numbers, never the photos.</p>

      {add && <AddSheet onClose={() => setAdd(false)} onDone={() => { setAdd(false); void reload() }} m={{ weight: data.weight, waist: data.waist, neck: data.neck, navy: tape }} />}
    </div>
  )
}

function Compare({ a, b }: { a: PhotoSet; b: PhotoSet }) {
  const [u, setU] = useState<Record<string, string>>({})
  useEffect(() => { void signed([a.front_path, a.side_path, b.front_path, b.side_path]).then(setU) }, [a, b])
  return (
    <div className="mt-3 space-y-2">
      {(['front', 'side'] as const).map(v => (
        <div key={v} className="grid grid-cols-2 gap-2">
          {[a, b].map(x => { const p = x[`${v}_path`]; return (
            <figure key={x.id}>{p && u[p] ? <img src={u[p]} alt={`${v} ${x.date}`} className="w-full aspect-[3/4] object-cover rounded-xl" /> : <div className="aspect-[3/4] rounded-xl bg-surface-2" />}
              <figcaption className="text-[11px] text-muted mt-0.5">{v} · {dmy(x.date, { year: false })}</figcaption></figure>
          ) })}
        </div>
      ))}
    </div>
  )
}

function SetRow({ x, urls, onChanged }: { x: PhotoSet; urls: Record<string, string>; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  async function reread() { setBusy(true); try { await callFn('tr-body', { id: x.id }) } catch (e) { alert((e as Error).message) } setBusy(false); onChanged() }
  async function remove() {
    if (!confirm(`Delete the ${dmy(x.date)} photos? This can't be undone.`)) return
    await supabase.storage.from('tr-body').remove([x.front_path, x.side_path, x.back_path].filter(Boolean) as string[])
    await supabase.from('tr_body_photos').delete().eq('id', x.id); onChanged()
  }
  return (
    <li className="flex gap-3">
      <div className="flex gap-1 shrink-0">
        {[x.front_path, x.side_path].map((p, i) => p && urls[p] ? <img key={i} src={urls[p]} alt="" className="w-12 h-16 object-cover rounded-lg" /> : <div key={i} className="w-12 h-16 rounded-lg bg-surface-2" />)}
      </div>
      <div className="flex-1 min-w-0 text-sm">
        <p className="font-medium">{dmy(x.date)}</p>
        <p className="text-xs text-muted num">{[x.weight_kg && `${x.weight_kg} kg`, x.waist_cm && `waist ${x.waist_cm}`, x.navy_bf && `tape ${x.navy_bf}%`, x.ai?.usable && `photo ${x.ai.bf_low}–${x.ai.bf_high}%`].filter(Boolean).join(' · ')}</p>
        <div className="flex gap-3 mt-1 text-xs">
          <button className="text-brand underline" disabled={busy} onClick={() => void reread()}>{busy ? 'Reading…' : x.ai ? 'Read again' : 'Read photos'}</button>
          <button className="text-bad underline" onClick={() => void remove()}>Delete</button>
        </div>
      </div>
    </li>
  )
}

function AddSheet({ onClose, onDone, m }: { onClose: () => void; onDone: () => void; m: { weight: number | null; waist: number | null; neck: number | null; navy: number | null } }) {
  const [files, setFiles] = useState<Partial<Record<typeof VIEWS[number], { b64: string; url: string }>>>({})
  const [date, setDate] = useState(today()); const [busy, setBusy] = useState<string>(); const [err, setErr] = useState<string>()
  const refs = { front: useRef<HTMLInputElement>(null), side: useRef<HTMLInputElement>(null), back: useRef<HTMLInputElement>(null) }
  async function save() {
    setErr(undefined); setBusy('Uploading…')
    try {
      const stamp = `${await myId()}/${date}/${Date.now()}`   // each user's photos live in their own folder
      const paths: Record<string, string | null> = { front_path: null, side_path: null, back_path: null }
      for (const v of VIEWS) {
        const f = files[v]; if (!f) continue
        const bytes = Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))
        const path = `${stamp}-${v}.jpg`
        const { error } = await supabase.storage.from('tr-body').upload(path, bytes, { contentType: 'image/jpeg', upsert: false })
        if (error) throw new Error(error.message)
        paths[`${v}_path`] = path
      }
      const { data: row, error } = await supabase.from('tr_body_photos').insert({ date, ...paths, weight_kg: m.weight, waist_cm: m.waist, neck_cm: m.neck, navy_bf: m.navy }).select('id').single()
      if (error) throw new Error(error.message)
      setBusy('Claude is reading the photos…')
      await callFn('tr-body', { id: row.id })
      onDone()
    } catch (e) { setErr((e as Error).message); setBusy(undefined) }
  }
  return (
    <Sheet title="New progress photos" onClose={onClose}
      footer={<button className="btn btn-primary w-full" disabled={!!busy || (!files.front && !files.side)} onClick={() => void save()}>{busy ?? 'Save and read'}</button>}>
      <div className="space-y-3">
        <p className="text-xs text-muted">Same spot, same light, morning before eating, relaxed (not flexed). Phone at chest height, about 2 m away. Fitted shorts.</p>
        <div className="grid grid-cols-3 gap-2">
          {VIEWS.map(v => (
            <div key={v}>
              <input ref={refs[v]} type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) setFiles(x => ({ ...x, [v]: { b64: '', url: URL.createObjectURL(f) } })); if (f) { const b64 = await shrink(f); setFiles(x => ({ ...x, [v]: { b64, url: x[v]?.url ?? URL.createObjectURL(f) } })) } }} />
              <button onClick={() => refs[v].current?.click()} className="w-full aspect-[3/4] rounded-xl bg-surface-2 overflow-hidden grid place-items-center text-muted">
                {files[v] ? <img src={files[v]!.url} alt={v} className="w-full h-full object-cover" /> : <span className="text-xs flex flex-col items-center gap-1"><Icon name="camera" size={22} />{v}{v === 'back' ? ' (optional)' : ''}</span>}
              </button>
            </div>
          ))}
        </div>
        <label className="block"><span className="label">Date</span><input type="date" className="input mt-1" value={date} onChange={e => setDate(e.target.value)} /></label>
        <p className="text-xs text-muted num">Saved with: {m.weight ?? '?'} kg · waist {m.waist ?? '?'} cm · neck {m.neck ?? '?'} cm{m.navy ? ` · tape ${m.navy}%` : ''} (from your latest check-in)</p>
        {err && <p className="text-sm text-bad">{err}</p>}
      </div>
    </Sheet>
  )
}
