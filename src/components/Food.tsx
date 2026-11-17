import { useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { Card, Empty, Sheet } from './ui'
import { callFn, useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import { num, today } from '../lib/format'
import { kcalOut, type Body } from '../lib/calories'
import type { Activity } from '../lib/types'

export interface MealItem { name: string; portion: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export interface Meal { id: number; date: string; eaten_at: string | null; meal: string; description: string; items: MealItem[]; kcal: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null; source: string; confidence: string | null }
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] as const
const guessMeal = () => { const h = new Date().getHours(); return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : 'dinner' }

/** Today's food: in vs out, the target, and the meals with an Add button (photo or words). */
export function FoodCard({ day, acts, body, deficit }: { day: string; acts: Activity[]; body: Body; deficit: number }) {
  const { data: meals, reload } = useLoad(async () => (await supabase.from('tr_meals').select('*').eq('date', day).order('eaten_at', { nullsFirst: false }).order('created_at')).data as Meal[] ?? [], [day])
  const [add, setAdd] = useState(false); const [edit, setEdit] = useState<Meal>()
  const out = useMemo(() => kcalOut(acts, body), [acts, body])
  const inK = (meals ?? []).reduce((s, m) => s + m.kcal, 0)
  const target = out.total - deficit
  const left = target - inK
  const P = (meals ?? []).reduce((s, m) => s + (m.protein_g ?? 0), 0)
  const pct = Math.min(100, (inK / Math.max(1, out.total)) * 100), tPct = Math.min(100, (target / Math.max(1, out.total)) * 100)
  return (
    <Card title="Food" sub={`Out ${num(out.total)} kcal = resting ${num(out.base)} + training ${num(out.training)} · target ${num(target)} (${deficit} below)`}
      right={<button className="btn btn-primary !py-1.5 text-sm" onClick={() => setAdd(true)}><Icon name="plus" size={15} />Meal</button>}>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span><b className="display text-2xl num">{num(inK)}</b> <span className="text-muted">kcal in</span></span>
        <span className={left < 0 ? 'text-bad font-medium' : 'text-muted'}>{left >= 0 ? `${num(left)} left to target` : `${num(-left)} over target`}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-surface-2">
        <div className="h-2.5 rounded-full" style={{ width: `${pct}%`, background: inK > target ? 'var(--warn)' : 'var(--s3)' }} />
        <span className="absolute -top-1 w-0.5 h-4.5 bg-ink/60 rounded" style={{ left: `${tPct}%` }} title="target" />
      </div>
      <p className="text-[11px] text-muted mt-1">Protein {num(P)} g{body.weight ? ` · aim ~${Math.round(body.weight * 1.6)} g (1.6 g/kg) for strength work` : ''}</p>
      <ul className="mt-3 divide-y divide-line">
        {(meals ?? []).map(m => (
          <li key={m.id}><button className="w-full flex items-center gap-3 py-2 text-left" onClick={() => setEdit(m)}>
            <span className="label w-16 shrink-0">{m.meal}</span>
            <span className="flex-1 min-w-0 text-sm truncate">{m.description}</span>
            <span className="num text-sm font-medium">{num(m.kcal)}</span>
          </button></li>
        ))}
      </ul>
      {!meals?.length && <Empty>Snap a photo or say what you ate.</Empty>}
      {(add || edit) && <MealSheet day={day} meal={edit} onClose={() => { setAdd(false); setEdit(undefined) }} onSaved={() => { setAdd(false); setEdit(undefined); void reload() }} />}
    </Card>
  )
}

/** downscale a phone photo to ≤1280 px JPEG before sending it */
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const s = Math.min(1, 1280 / Math.max(img.width, img.height))
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82).split(',')[1]
}

function MealSheet({ day, meal, onClose, onSaved }: { day: string; meal?: Meal; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState(meal?.meal ?? guessMeal())
  const [text, setText] = useState(meal ? '' : '')
  const [photo, setPhoto] = useState<{ b64: string; url: string }>()
  const [items, setItems] = useState<MealItem[]>(meal?.items ?? [])
  const [title, setTitle] = useState(meal?.description ?? '')
  const [conf, setConf] = useState<string | null>(meal?.confidence ?? null)
  const [check, setCheck] = useState<string | null>(null)
  const [source, setSource] = useState(meal?.source ?? 'text')
  const [busy, setBusy] = useState<string>(); const [err, setErr] = useState<string>()
  const [listening, setListening] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

  function dictate() {
    if (!SR) return
    const r = new SR(); r.lang = 'en-ZA'; r.interimResults = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => setText(t => (t ? t + ' ' : '') + e.results[0][0].transcript)
    r.onend = () => setListening(false); r.onerror = () => setListening(false)
    setListening(true); r.start()
  }
  async function read() {
    setBusy('read'); setErr(undefined)
    try {
      const r = await callFn<{ draft: { title: string; items: MealItem[]; confidence: string; check: string | null; source: string } }>('tr-meal', { image: photo?.b64, text: text || undefined, meal: kind })
      setItems(r.draft.items); setTitle(r.draft.title); setConf(r.draft.confidence); setCheck(r.draft.check); setSource(r.draft.source)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(undefined) }
  }
  const tot = (k: keyof MealItem) => Math.round(items.reduce((s, i) => s + (Number(i[k]) || 0), 0))
  async function save() {
    setBusy('save')
    const row = { date: meal?.date ?? day, meal: kind, description: title || items.map(i => i.name).join(', '), items, kcal: tot('kcal'), protein_g: tot('protein_g'), carbs_g: tot('carbs_g'), fat_g: tot('fat_g'), source, confidence: conf,
      eaten_at: meal?.eaten_at ?? (day === today() ? new Date().toTimeString().slice(0, 5) : null) }
    const { error } = meal ? await supabase.from('tr_meals').update(row).eq('id', meal.id) : await supabase.from('tr_meals').insert(row)
    setBusy(undefined); if (error) setErr(error.message); else onSaved()
  }
  async function remove() { if (meal && confirm('Delete this meal?')) { await supabase.from('tr_meals').delete().eq('id', meal.id); onSaved() } }
  const upd = (i: number, k: keyof MealItem, v: string) => setItems(x => x.map((it, j) => j === i ? { ...it, [k]: k === 'name' || k === 'portion' ? v : Number(v) || 0 } : it))

  return (
    <Sheet title={meal ? 'Meal' : 'Add a meal'} onClose={onClose}
      footer={items.length ? <div className="flex gap-2">{meal && <button className="btn btn-ghost text-bad" onClick={() => void remove()}><Icon name="trash" size={16} /></button>}
        <button className="btn btn-primary flex-1" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : `Save · ${tot('kcal')} kcal`}</button></div> : undefined}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{MEALS.map(m => <button key={m} onClick={() => setKind(m)} className={`chip !py-1.5 !px-3 capitalize ${kind === m ? '!bg-brand !text-surface' : ''}`}>{m}</button>)}</div>
        {!meal && <>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto({ b64: await shrink(f), url: URL.createObjectURL(f) }) }} />
          {photo ? <div className="relative"><img src={photo.url} alt="Meal" className="w-full max-h-56 object-cover rounded-xl" /><button className="absolute top-2 right-2 chip !bg-black/60 !text-white" onClick={() => setPhoto(undefined)}><Icon name="close" size={12} />Remove</button></div>
            : <button className="btn btn-ghost w-full" onClick={() => fileRef.current?.click()}><Icon name="camera" size={18} />Take or choose a photo</button>}
          <div className="relative">
            <textarea className="input pr-12" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={photo ? 'Anything the photo misses? (e.g. "cooked in butter, 300 g steak")' : 'Say or type it: "2 eggs, 2 slices toast with butter, flat white"'} />
            {SR && <button type="button" onClick={dictate} aria-label="Dictate" className={`absolute right-2 top-2 p-2 rounded-full ${listening ? 'bg-ember text-white animate-pulse' : 'text-muted'}`}><Icon name="mic" size={18} /></button>}
          </div>
          {!SR && <p className="text-[11px] text-muted -mt-2">Tip: tap the microphone on your keyboard to dictate.</p>}
          <button className="btn btn-ember w-full" disabled={!!busy || (!photo && !text.trim())} onClick={() => void read()}><Icon name="spark" size={16} />{busy === 'read' ? 'Reading…' : items.length ? 'Read again' : 'Estimate calories'}</button>
        </>}
        {err && <p className="text-sm text-bad">{err}</p>}
        {items.length > 0 && <>
          <input className="input font-medium" value={title} onChange={e => setTitle(e.target.value)} />
          {check && <p className="text-xs rounded-xl bg-warn/12 text-warn px-3 py-2">{check}</p>}
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_4rem_1.5rem] gap-1.5 items-center">
                <div className="min-w-0"><input className="input !py-1 text-sm" value={it.name} onChange={e => upd(i, 'name', e.target.value)} /><input className="input !py-0.5 !text-xs text-muted mt-0.5 !border-transparent" value={it.portion} onChange={e => upd(i, 'portion', e.target.value)} /></div>
                <span className="text-[11px] text-muted num text-right">P{Math.round(it.protein_g)} C{Math.round(it.carbs_g)} F{Math.round(it.fat_g)}</span>
                <input className="input !py-1 text-sm num" inputMode="numeric" value={it.kcal} onChange={e => upd(i, 'kcal', e.target.value)} />
                <button className="text-muted" onClick={() => setItems(x => x.filter((_, j) => j !== i))} aria-label="Remove item"><Icon name="close" size={15} /></button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost !py-1.5 text-sm" onClick={() => setItems(x => [...x, { name: '', portion: '', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }])}><Icon name="plus" size={14} />Add item</button>
          <p className="text-sm num">Total <b>{tot('kcal')} kcal</b> · protein {tot('protein_g')} g · carbs {tot('carbs_g')} g · fat {tot('fat_g')} g{conf ? <span className="text-muted"> · {conf} confidence</span> : null}</p>
        </>}
        {!meal && !items.length && <button className="text-xs text-muted underline" onClick={() => setItems([{ name: 'Quick add', portion: '', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }])}>Just enter calories</button>}
      </div>
    </Sheet>
  )
}
