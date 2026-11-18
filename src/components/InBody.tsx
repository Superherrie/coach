// InBody scans: upload a screenshot/photo of the result sheet → Claude reads it → you check the numbers → saved.
import { useRef, useState } from 'react'
import Icon from './Icon'
import { Card, Empty, Sheet } from './ui'
import { shrink } from './Food'
import { callFn, myId } from '../lib/data'
import { dmy, today } from '../lib/format'
import { supabase } from '../lib/supabase'

export interface Scan {
  id: number; date: string; image_path: string | null; weight_kg: number | null; smm_kg: number | null; bfm_kg: number | null; pbf: number | null
  ffm_kg: number | null; tbw_l: number | null; ecw_ratio: number | null; visceral_level: number | null; bmr_kcal: number | null; inbody_score: number | null
  segments: { lean?: Seg | null; fat?: Seg | null } | null; model: string | null; notes: string | null
}
type Seg = { right_arm: number | null; left_arm: number | null; trunk: number | null; right_leg: number | null; left_leg: number | null }
const FIELDS = [
  ['weight_kg', 'Weight', 'kg'], ['smm_kg', 'Skeletal muscle', 'kg'], ['bfm_kg', 'Body fat mass', 'kg'], ['pbf', 'Body fat', '%'],
  ['ffm_kg', 'Fat-free mass', 'kg'], ['tbw_l', 'Body water', 'L'], ['ecw_ratio', 'ECW ratio', ''], ['visceral_level', 'Visceral fat', 'level'],
  ['bmr_kcal', 'BMR', 'kcal'], ['inbody_score', 'InBody score', ''],
] as const
type Key = typeof FIELDS[number][0]
const SEGS = [['right_arm', 'R arm'], ['left_arm', 'L arm'], ['trunk', 'Trunk'], ['right_leg', 'R leg'], ['left_leg', 'L leg']] as const

const d1 = (a: number | null, b: number | null, unit: string) => (a != null && b != null ? ` (${a - b >= 0 ? '+' : ''}${(+(a - b).toFixed(1))}${unit})` : '')

export function InBodyCard({ scans, onChanged }: { scans: Scan[]; onChanged: () => void }) {
  const [add, setAdd] = useState(false)
  const [a, b] = scans
  return (
    <Card title="InBody scans" sub={a ? `Latest ${dmy(a.date)}${b ? ` · change since ${dmy(b.date, { year: false })} in brackets` : ''}` : 'Measured at the gym. Same time of day, before training, about monthly.'}
      right={<button className="btn btn-primary !py-1.5 text-sm" onClick={() => setAdd(true)}><Icon name="plus" size={15} />Scan</button>}>
      {a ? <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([['smm_kg', 'Muscle', 'kg'], ['bfm_kg', 'Fat', 'kg'], ['pbf', 'Body fat', '%'], ['visceral_level', 'Visceral', '']] as const).map(([k, l, u]) => (
            <div key={k} className="rounded-2xl bg-surface-2 px-3 py-2.5"><p className="label">{l}</p>
              <p className="display text-2xl num">{a[k] ?? '—'}{a[k] != null && u ? <span className="text-sm text-muted"> {u}</span> : ''}</p>
              <p className="text-[11px] text-muted num">{b ? d1(a[k], b[k], u).trim() || '—' : ''}</p></div>
          ))}
        </div>
        <p className="text-xs text-muted mt-2 num">{[a.weight_kg && `${a.weight_kg} kg`, a.bmr_kcal && `BMR ${a.bmr_kcal} kcal`, a.ecw_ratio && `ECW ${a.ecw_ratio}`, a.inbody_score && `score ${a.inbody_score}`].filter(Boolean).join(' · ')}</p>
        <ul className="divide-y divide-line mt-2">
          {scans.map(x => <ScanRow key={x.id} x={x} onChanged={onChanged} />)}
        </ul>
      </> : <Empty>Take a screenshot (InBody app / LookinBody) or a straight photo of the printed sheet and add it here.</Empty>}
      {add && <ScanSheet onClose={() => setAdd(false)} onDone={() => { setAdd(false); onChanged() }} />}
    </Card>
  )
}

function ScanRow({ x, onChanged }: { x: Scan; onChanged: () => void }) {
  async function view() {
    if (!x.image_path) return
    const { data } = await supabase.storage.from('tr-body').createSignedUrl(x.image_path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  async function remove() {
    if (!confirm(`Delete the ${dmy(x.date)} InBody scan? This can't be undone.`)) return
    if (x.image_path) await supabase.storage.from('tr-body').remove([x.image_path])
    await supabase.from('tr_inbody').delete().eq('id', x.id); onChanged()
  }
  return (
    <li className="py-2 text-sm flex gap-3 items-baseline">
      <span className="num text-muted w-20 shrink-0">{dmy(x.date, { year: false })}</span>
      <span className="flex-1 min-w-0 num text-xs">{[x.weight_kg && `${x.weight_kg} kg`, x.smm_kg && `muscle ${x.smm_kg}`, x.pbf != null && `fat ${x.pbf}%`, x.visceral_level != null && `visc ${x.visceral_level}`].filter(Boolean).join(' · ')}</span>
      {x.image_path && <button className="text-xs text-brand underline" onClick={() => void view()}>Sheet</button>}
      <button className="text-xs text-bad underline" onClick={() => void remove()}>Delete</button>
    </li>
  )
}

type Form = Record<Key, string> & { date: string; model: string; lean: Record<string, string>; fat: Record<string, string> }
const blank = (): Form => ({ ...Object.fromEntries(FIELDS.map(([k]) => [k, ''])) as Record<Key, string>, date: today(), model: '', lean: {}, fat: {} })
const s = (v: number | null | undefined) => (v == null ? '' : String(v))

function ScanSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [img, setImg] = useState<string>(); const [path, setPath] = useState<string>()
  const [f, setF] = useState<Form>(); const [unclear, setUnclear] = useState<string[]>([])
  const [busy, setBusy] = useState<string>(); const [err, setErr] = useState<string>()

  async function pick(file: File) {
    setErr(undefined); setImg(URL.createObjectURL(file)); setBusy('Uploading…')
    try {
      const b64 = await shrink(file, 2000)
      const p = `${await myId()}/inbody/${Date.now()}.jpg`
      const { error } = await supabase.storage.from('tr-body').upload(p, Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { contentType: 'image/jpeg' })
      if (error) throw new Error(error.message)
      setPath(p); setBusy('Claude is reading the sheet…')
      const { read: r } = await callFn<{ read: Record<string, unknown> & { is_inbody: boolean; unclear: string[]; date: string | null; device: string | null; segment_lean_kg: Seg | null; segment_fat_kg: Seg | null } }>('tr-inbody', { path: p })
      if (!r.is_inbody) setErr("That doesn't look like an InBody result sheet — check the numbers below or try another picture.")
      const nf = blank()
      for (const [k] of FIELDS) nf[k] = s(r[k] as number | null)
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) nf.date = r.date
      nf.model = r.device ?? ''
      for (const [k] of SEGS) { nf.lean[k] = s(r.segment_lean_kg?.[k]); nf.fat[k] = s(r.segment_fat_kg?.[k]) }
      setF(nf); setUnclear(r.unclear ?? [])
    } catch (e) { setErr((e as Error).message); setF(f => f ?? blank()) }
    setBusy(undefined)
  }

  async function save() {
    if (!f) return
    setBusy('Saving…')
    const num = (v: string) => (v.trim() === '' ? null : +v.replace(',', '.'))
    const seg = (o: Record<string, string>) => { const r = Object.fromEntries(SEGS.map(([k]) => [k, num(o[k] ?? '')])); return Object.values(r).some(v => v != null) ? r : null }
    const row = { date: f.date, image_path: path ?? null, model: f.model || null, ...Object.fromEntries(FIELDS.map(([k]) => [k, num(f[k])])), segments: { lean: seg(f.lean), fat: seg(f.fat) } }
    const { error } = await supabase.from('tr_inbody').insert(row)
    if (error) { setErr(error.message); setBusy(undefined); return }
    // the scan's weight counts as that day's weigh-in when there isn't one yet (feeds the calorie target and weight chart)
    const kg = num(f.weight_kg)
    if (kg) {
      const uid = await myId()
      const { data: w } = await supabase.from('tr_wellness').select('weight_kg,manual').eq('date', f.date).maybeSingle()
      if (!w?.weight_kg) await supabase.from('tr_wellness').upsert({ user_id: uid, date: f.date, weight_kg: kg, manual: { ...(w?.manual ?? {}), weight_kg: true } }, { onConflict: 'user_id,date' })
    }
    onDone()
  }

  return (
    <Sheet title="Add InBody scan" onClose={onClose}
      footer={f ? <button className="btn btn-primary w-full" disabled={!!busy} onClick={() => void save()}>{busy ?? 'Save scan'}</button>
        : <button className="btn btn-primary w-full" disabled={!!busy} onClick={() => ref.current?.click()}><Icon name="camera" size={16} />{busy ?? 'Choose screenshot or photo'}</button>}>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={e => { const x = e.target.files?.[0]; if (x) void pick(x) }} />
      <div className="space-y-3">
        {img ? <img src={img} alt="InBody sheet" className="w-full max-h-56 object-contain rounded-xl bg-surface-2" />
          : <p className="text-xs text-muted">A screenshot from the InBody / LookinBody app, or a straight, sharp photo of the printed sheet (whole page, no glare). Claude copies the numbers; you check them before saving.</p>}
        {busy && !f && <p className="text-sm text-muted animate-pulse">{busy}</p>}
        {err && <p className="text-sm text-bad">{err}</p>}
        {f && <>
          {unclear.length > 0 && <p className="text-xs text-warn">Check these — hard to read: {unclear.join(', ')}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label><span className="label">Date</span><input type="date" className="input mt-1" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
            <label><span className="label">Device</span><input className="input mt-1" placeholder="InBody 570" value={f.model} onChange={e => setF({ ...f, model: e.target.value })} /></label>
            {FIELDS.map(([k, l, u]) => (
              <label key={k}><span className="label">{l}{u ? ` (${u})` : ''}</span>
                <input className="input mt-1 num" inputMode="decimal" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>
            ))}
          </div>
          {(['lean', 'fat'] as const).map(g => (
            <div key={g}>
              <p className="label mb-1">{g === 'lean' ? 'Segmental lean (kg)' : 'Segmental fat (kg)'}</p>
              <div className="grid grid-cols-5 gap-1.5">
                {SEGS.map(([k, l]) => <label key={k}><span className="text-[10px] text-muted">{l}</span>
                  <input className="input !px-2 num text-sm" inputMode="decimal" value={f[g][k] ?? ''} onChange={e => setF({ ...f, [g]: { ...f[g], [k]: e.target.value } })} /></label>)}
              </div>
            </div>
          ))}
        </>}
      </div>
    </Sheet>
  )
}
