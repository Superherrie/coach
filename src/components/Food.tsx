import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { Card, Empty, Sheet } from './ui'
import { callFn, useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import { num, today } from '../lib/format'
import { kcalOut, type Body } from '../lib/calories'
import type { Activity, Fuel } from '../lib/types'

export interface MealItem { name: string; portion: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
interface Fav { id: number; name: string; meal: string; items: MealItem[]; kcal: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null; uses: number }
export interface Meal { id: number; date: string; eaten_at: string | null; meal: string; description: string; items: MealItem[]; kcal: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null; source: string; confidence: string | null }
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] as const
const guessMeal = () => { const h = new Date().getHours(); return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : 'dinner' }

/** Today's food: in vs out, the target, and the meals with an Add button (photo or words). */
/** one macro: eaten vs target, bar turns amber when well under late in the day isn't judged — just shown */
function MacroBar({ label, eaten, target, color }: { label: string; eaten: number; target: number; color: string }) {
  const pct = Math.min(100, (eaten / Math.max(1, target)) * 100)
  const over = eaten > target * 1.1
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="num text-muted"><b className={over ? 'text-warn' : 'text-ink'}>{Math.round(eaten)}</b> / {Math.round(target)} g</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 mt-1"><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: over ? 'var(--warn)' : color }} /></div>
      <p className="text-[10px] text-muted mt-0.5 num">{eaten < target ? `${Math.round(target - eaten)} g to go` : over ? `${Math.round(eaten - target)} g over` : 'on target'}</p>
    </div>
  )
}

export function FoodCard({ day, acts, body, deficit, fuel, openReq = 0 }: { day: string; acts: Activity[]; body: Body; deficit: number; fuel?: Fuel | null; openReq?: number }) {
  const { data: meals, reload } = useLoad(async () => (await supabase.from('tr_meals').select('*').eq('date', day).order('eaten_at', { nullsFirst: false }).order('created_at')).data as Meal[] ?? [], [day])
  const [add, setAdd] = useState(false); const [edit, setEdit] = useState<Meal>()
  useEffect(() => { if (openReq > 0) setAdd(true) }, [openReq])   // top-bar "Meal" shortcut
  const out = useMemo(() => kcalOut(acts, body), [acts, body])
  const inK = (meals ?? []).reduce((s, m) => s + m.kcal, 0)
  const target = fuel?.kcal ?? out.total - deficit
  const left = target - inK
  const P = (meals ?? []).reduce((s, m) => s + (m.protein_g ?? 0), 0)
  const C = (meals ?? []).reduce((s, m) => s + (m.carbs_g ?? 0), 0)
  const F = (meals ?? []).reduce((s, m) => s + (m.fat_g ?? 0), 0)
  // macro targets: the coach's for today, else protein 1.6 g/kg, fat 0.9 g/kg, carbs = the rest of the kcal (at least 2 g/kg)
  const mt = fuel ? { p: fuel.protein_g, c: fuel.carbs_g, f: fuel.fat_g }
    : (() => { const p = body.weight * 1.6, f = body.weight * 0.9; return { p, f, c: Math.max(body.weight * 2, (target - p * 4 - f * 9) / 4) } })()
  const pct = Math.min(100, (inK / Math.max(1, out.total)) * 100), tPct = Math.min(100, (target / Math.max(1, out.total)) * 100)
  return (
    <Card title="Food" sub={`Out ${num(out.total)} kcal = resting ${num(out.base)}${body.bmrFrom ? ` (InBody ${body.bmrFrom})` : ''} + training ${num(out.training)} · target ${num(target)}${fuel ? ' (coach)' : ` (${deficit} below)`}`}
      right={<button className="btn btn-primary !py-1.5 text-sm" onClick={() => setAdd(true)}><Icon name="plus" size={15} />Meal</button>}>
      {body.weightFrom !== 'weigh-in' && <p className="text-xs text-warn mb-2">Using {body.weightFrom === 'goal' ? `your goal weight (${body.weight} kg)` : `a guess of ${body.weight} kg`} — log today’s weight in the check-in above for a correct target.</p>}
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span><b className="display text-2xl num">{num(inK)}</b> <span className="text-muted">kcal in</span></span>
        <span className={left < 0 ? 'text-bad font-medium' : 'text-muted'}>{left >= 0 ? `${num(left)} left to target` : `${num(-left)} over target`}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-surface-2">
        <div className="h-2.5 rounded-full" style={{ width: `${pct}%`, background: inK > target ? 'var(--warn)' : 'var(--s3)' }} />
        <span className="absolute -top-1 w-0.5 h-4.5 bg-ink/60 rounded" style={{ left: `${tPct}%` }} title="target" />
      </div>
      <div className="grid grid-cols-3 gap-3 mt-3">
        <MacroBar label="Protein" eaten={P} target={mt.p} color="var(--s1)" />
        <MacroBar label="Carbs" eaten={C} target={mt.c} color="var(--s4)" />
        <MacroBar label="Fat" eaten={F} target={mt.f} color="var(--s7)" />
      </div>
      <p className="text-[11px] text-muted mt-1.5">{fuel ? <><span className="text-brand">Coach: </span>{fuel.why}</> : `Default split: protein 1.6 g/kg, fat 0.9 g/kg, carbs the rest. The coach sets day-specific targets in its morning review.`}</p>
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
// eslint-disable-next-line react-refresh/only-export-components
export async function shrink(file: File, max = 1280): Promise<string> {
  const img = await createImageBitmap(file)
  const s = Math.min(1, max / Math.max(img.width, img.height))
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
  // quick pick: favourites (starred) and recent meals; a picked dish can be scaled ×½…×2
  const { data: pick, reload: reloadPick } = useLoad(async () => {
    const [f, r] = await Promise.all([
      supabase.from('tr_meal_favs').select('*').order('uses', { ascending: false }).order('name'),
      supabase.from('tr_meals').select('id,meal,description,items,kcal,protein_g,carbs_g,fat_g,created_at').order('created_at', { ascending: false }).limit(150),
    ])
    const seen = new Set<string>(); const recent: Fav[] = []
    for (const m of (r.data ?? []) as (Meal & { created_at: string })[]) {
      const k = m.description.trim().toLowerCase(); if (seen.has(k)) continue; seen.add(k)
      recent.push({ id: -m.id, name: m.description, meal: m.meal, items: m.items, kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, uses: 0 })
      if (recent.length >= 40) break
    }
    return { favs: (f.data ?? []) as Fav[], recent }
  }, [])
  const [tab, setTab] = useState<'fav' | 'recent'>('fav'); const [q, setQ] = useState('')
  // base = one serving as read or picked; qty = how many (e.g. 5 coffees); size = portion of each (×½ … ×2)
  const [base, setBase] = useState<MealItem[]>(); const [qty, setQty] = useState(1); const [size, setSize] = useState(1); const [favId, setFavId] = useState<number>()
  const scale = qty * size
  function apply(b: MealItem[], q: number, s: number) {
    const m = q * s
    setItems(b.map(i => ({ ...i, portion: m === 1 ? i.portion : `${q > 1 ? `${q} × ` : ''}${s !== 1 ? `${s === 0.5 ? '½' : s} × ` : ''}${i.portion}`, kcal: Math.round(i.kcal * m), protein_g: +(i.protein_g * m).toFixed(1), carbs_g: +(i.carbs_g * m).toFixed(1), fat_g: +(i.fat_g * m).toFixed(1) })))
  }
  function choose(f: Fav) {
    setBase(f.items); setQty(1); setSize(1); setItems(f.items); setTitle(f.name); setKind(f.meal); setSource('manual'); setConf(null); setCheck(null)
    setFavId(f.id > 0 ? f.id : undefined)
  }
  const setQ1 = (q: number) => { const v = Math.max(1, Math.min(20, q)); setQty(v); if (base) apply(base, v, size) }
  const setS1 = (s: number) => { setSize(s); if (base) apply(base, qty, s) }
  // editing an item by hand makes the edited list the new single serving
  const editItems = (f: (x: MealItem[]) => MealItem[]) => setItems(x => { const n = f(x); if (base) setBase(n.map(i => ({ ...i, kcal: i.kcal / scale, protein_g: i.protein_g / scale, carbs_g: i.carbs_g / scale, fat_g: i.fat_g / scale }))); return n })
  const favNames = new Set((pick?.favs ?? []).map(f => f.name.trim().toLowerCase()))
  const isFav = !!favId || favNames.has(title.trim().toLowerCase())
  async function star() {
    if (isFav || !items.length) return
    // a favourite is always ONE serving, whatever quantity is being logged now
    const one = (base ?? items).map(i => ({ ...i, kcal: Math.round(i.kcal), protein_g: +i.protein_g.toFixed(1), carbs_g: +i.carbs_g.toFixed(1), fat_g: +i.fat_g.toFixed(1) }))
    const t = (k: keyof MealItem) => Math.round(one.reduce((s, i) => s + (Number(i[k]) || 0), 0))
    await supabase.from('tr_meal_favs').insert({ name: title || items.map(i => i.name).join(', '), meal: kind, items: one,
      kcal: t('kcal'), protein_g: t('protein_g'), carbs_g: t('carbs_g'), fat_g: t('fat_g') })
    void reloadPick()
  }
  async function unstar(f: Fav) { if (confirm(`Remove "${f.name}" from favourites?`)) { await supabase.from('tr_meal_favs').delete().eq('id', f.id); void reloadPick() } }
  const list = (tab === 'fav' ? pick?.favs : pick?.recent)?.filter(f => !q || f.name.toLowerCase().includes(q.toLowerCase())) ?? []
  const fileRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

  // iPhone home-screen apps have no working browser speech recognition, so there (and whenever it fails) the mic button
  // opens the keyboard instead: its own mic key does the dictation. In Safari/Chrome tabs the browser recogniser is tried first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const standalone = (navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [hint, setHint] = useState<string>()
  const keyboard = (why?: string) => {
    textRef.current?.focus()
    setHint(why ?? (isIOS ? 'Tap the 🎤 on the keyboard and speak. (No mic key? Settings → General → Keyboard → Enable Dictation.)' : 'Use the microphone on your keyboard to dictate.'))
  }
  function dictate() {
    if (!SR || (isIOS && standalone)) return keyboard()
    try {
      const r = new SR(); r.lang = 'en-ZA'; r.interimResults = false; r.continuous = false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.onresult = (e: any) => { setText(t => (t ? t + ' ' : '') + e.results[0][0].transcript); setHint(undefined) }
      r.onend = () => setListening(false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.onerror = (e: any) => { setListening(false); keyboard(e?.error === 'not-allowed' || e?.error === 'service-not-allowed' ? 'Microphone access is blocked for this page — use the mic on your keyboard instead.' : undefined) }
      setListening(true); setHint('Listening… speak now'); r.start()
    } catch { setListening(false); keyboard() }
  }
  async function read() {
    setBusy('read'); setErr(undefined)
    try {
      const r = await callFn<{ draft: { title: string; items: MealItem[]; confidence: string; check: string | null; source: string } }>('tr-meal', { image: photo?.b64, text: text || undefined, meal: kind })
      setBase(r.draft.items); setQty(1); setSize(1)
      setItems(r.draft.items); setTitle(r.draft.title); setConf(r.draft.confidence); setCheck(r.draft.check); setSource(r.draft.source)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(undefined) }
  }
  const tot = (k: keyof MealItem) => Math.round(items.reduce((s, i) => s + (Number(i[k]) || 0), 0))
  async function save() {
    setBusy('save')
    const name = title || items.map(i => i.name).join(', ')
    const row = { date: meal?.date ?? day, meal: kind, description: qty > 1 && !/^\d+\s*×/.test(name) ? `${qty} × ${name}` : name, items, kcal: tot('kcal'), protein_g: tot('protein_g'), carbs_g: tot('carbs_g'), fat_g: tot('fat_g'), source, confidence: conf,
      eaten_at: meal?.eaten_at ?? (day === today() ? new Date().toTimeString().slice(0, 5) : null) }
    const { error } = meal ? await supabase.from('tr_meals').update(row).eq('id', meal.id) : await supabase.from('tr_meals').insert(row)
    if (!error && favId) { const f = pick?.favs.find(x => x.id === favId); await supabase.from('tr_meal_favs').update({ uses: (f?.uses ?? 0) + 1, last_used: new Date().toISOString() }).eq('id', favId) }
    setBusy(undefined); if (error) setErr(error.message); else onSaved()
  }
  async function remove() { if (meal && confirm('Delete this meal?')) { await supabase.from('tr_meals').delete().eq('id', meal.id); onSaved() } }
  const upd = (i: number, k: keyof MealItem, v: string) => editItems(x => x.map((it, j) => j === i ? { ...it, [k]: k === 'name' || k === 'portion' ? v : Number(v) || 0 } : it))

  return (
    <Sheet title={meal ? 'Meal' : 'Add a meal'} onClose={onClose}
      footer={items.length ? <div className="flex gap-2">{meal && <button className="btn btn-ghost text-bad" onClick={() => void remove()}><Icon name="trash" size={16} /></button>}
        <button className="btn btn-primary flex-1" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : `Save · ${tot('kcal')} kcal`}</button></div> : undefined}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{MEALS.map(m => <button key={m} onClick={() => setKind(m)} className={`chip !py-1.5 !px-3 capitalize ${kind === m ? '!bg-brand !text-surface' : ''}`}>{m}</button>)}</div>
        {!meal && !items.length && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <div className="flex items-center gap-2 mb-2">
              {(['fav', 'recent'] as const).map(k => <button key={k} onClick={() => setTab(k)} className={`chip !py-1.5 !px-3 ${tab === k ? '!bg-brand !text-surface' : '!bg-surface'}`}>{k === 'fav' ? `★ Favourites${pick?.favs.length ? ` (${pick.favs.length})` : ''}` : 'Recent'}</button>)}
              <input className="input !py-1 text-sm flex-1 min-w-0" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" />
            </div>
            <ul className="max-h-52 overflow-y-auto divide-y divide-line">
              {list.map(f => (
                <li key={f.id} className="flex items-center gap-2">
                  <button className="flex-1 min-w-0 flex items-center gap-2 py-2 text-left" onClick={() => choose(f)}>
                    <span className="flex-1 min-w-0 text-sm truncate">{f.name}</span>
                    <span className="num text-sm text-muted">{num(f.kcal)}</span>
                  </button>
                  {tab === 'fav' && <button className="text-ember px-1" aria-label="Remove favourite" onClick={() => void unstar(f)}>★</button>}
                </li>
              ))}
            </ul>
            {!list.length && <p className="text-xs text-muted py-2">{tab === 'fav' ? 'No favourites yet — after reading a meal, tap ☆ to keep it here.' : 'Meals you log show up here.'}</p>}
          </div>
        )}
        {!meal && !base && <>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto({ b64: await shrink(f), url: URL.createObjectURL(f) }) }} />
          {photo ? <div className="relative"><img src={photo.url} alt="Meal" className="w-full max-h-56 object-cover rounded-xl" /><button className="absolute top-2 right-2 chip !bg-black/60 !text-white" onClick={() => setPhoto(undefined)}><Icon name="close" size={12} />Remove</button></div>
            : <button className="btn btn-ghost w-full" onClick={() => fileRef.current?.click()}><Icon name="camera" size={18} />Take or choose a photo</button>}
          <div className="relative">
            <textarea ref={textRef} className="input pr-12" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={photo ? 'Anything the photo misses? (e.g. "cooked in butter, 300 g steak")' : 'Say or type it: "2 eggs, 2 slices toast with butter, flat white"'} />
            <button type="button" onClick={dictate} aria-label="Dictate" className={`absolute right-2 top-2 p-2 rounded-full ${listening ? 'bg-ember text-white animate-pulse' : 'text-muted'}`}><Icon name="mic" size={18} /></button>
          </div>
          {hint && <p className="text-xs text-brand -mt-2">{hint}</p>}
          <button className="btn btn-ember w-full" disabled={!!busy || (!photo && !text.trim())} onClick={() => void read()}><Icon name="spark" size={16} />{busy === 'read' ? 'Reading…' : items.length ? 'Read again' : 'Estimate calories'}</button>
        </>}
        {err && <p className="text-sm text-bad">{err}</p>}
        {items.length > 0 && <>
          <div className="flex gap-2">
            <input className="input font-medium flex-1 min-w-0" value={title} onChange={e => setTitle(e.target.value)} />
            <button className={`btn btn-ghost !px-3 ${isFav ? 'text-ember' : ''}`} onClick={() => void star()} aria-label={isFav ? 'Favourite' : 'Save as favourite'} title={isFav ? 'In favourites' : 'Save as favourite'}>{isFav ? '★' : '☆'}</button>
          </div>
          {base && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="label w-16">How many</span>
                <button className="btn btn-ghost !px-3 !py-1" onClick={() => setQ1(qty - 1)} disabled={qty <= 1} aria-label="One less">−</button>
                <span className="display text-2xl num w-8 text-center">{qty}</span>
                <button className="btn btn-ghost !px-3 !py-1" onClick={() => setQ1(qty + 1)} aria-label="One more">+</button>
                <div className="flex gap-1 ml-1">{[2, 3, 5].map(n => <button key={n} onClick={() => setQ1(n)} className={`chip !py-1 !px-2.5 ${qty === n ? '!bg-brand !text-surface' : ''}`}>{n}</button>)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="label w-16">Size</span>
                {[0.5, 1, 1.5, 2].map(s => <button key={s} onClick={() => setS1(s)} className={`chip !py-1.5 !px-3 ${size === s ? '!bg-brand !text-surface' : ''}`}>×{s === 0.5 ? '½' : s === 1.5 ? '1½' : s}</button>)}
                {!meal && <button className="ml-auto text-xs text-muted underline" onClick={() => { setBase(undefined); setItems([]); setTitle(''); setFavId(undefined); setQty(1); setSize(1) }}>Pick another</button>}
              </div>
            </div>
          )}
          {check && <p className="text-xs rounded-xl bg-warn/12 text-warn px-3 py-2">{check}</p>}
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_4rem_1.5rem] gap-1.5 items-center">
                <div className="min-w-0"><input className="input !py-1 text-sm" value={it.name} onChange={e => upd(i, 'name', e.target.value)} /><input className="input !py-0.5 !text-xs text-muted mt-0.5 !border-transparent" value={it.portion} onChange={e => upd(i, 'portion', e.target.value)} /></div>
                <span className="text-[11px] text-muted num text-right">P{Math.round(it.protein_g)} C{Math.round(it.carbs_g)} F{Math.round(it.fat_g)}</span>
                <input className="input !py-1 text-sm num" inputMode="numeric" value={it.kcal} onChange={e => upd(i, 'kcal', e.target.value)} />
                <button className="text-muted" onClick={() => editItems(x => x.filter((_, j) => j !== i))} aria-label="Remove item"><Icon name="close" size={15} /></button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost !py-1.5 text-sm" onClick={() => editItems(x => [...x, { name: '', portion: '', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }])}><Icon name="plus" size={14} />Add item</button>
          <p className="text-sm num">Total <b>{tot('kcal')} kcal</b> · protein {tot('protein_g')} g · carbs {tot('carbs_g')} g · fat {tot('fat_g')} g{conf ? <span className="text-muted"> · {conf} confidence</span> : null}</p>
        </>}
        {!meal && !items.length && <button className="text-xs text-muted underline" onClick={() => setItems([{ name: 'Quick add', portion: '', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }])}>Just enter calories</button>}
      </div>
    </Sheet>
  )
}
