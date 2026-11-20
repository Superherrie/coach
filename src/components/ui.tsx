import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'
import Icon from './Icon'
import { InsightButton, type ChartAI } from './Insight'

// eslint-disable-next-line react-refresh/only-export-components
export const AXIS = { tick: { fill: 'var(--muted)', fontSize: 11 }, axisLine: false, tickLine: false } as const
// eslint-disable-next-line react-refresh/only-export-components
export const GRID = { stroke: 'var(--line)', strokeDasharray: '0', vertical: false } as const

/** true inside a fullscreen chart card */
const FullCtx = createContext(false)

/** a chart that fills the screen when its card is opened fullscreen */
export function FitChart({ height, children }: { height: number; children: ReactElement }) {
  const full = useContext(FullCtx)
  const [vh, setVh] = useState(() => window.innerHeight)
  useEffect(() => { if (!full) return; const f = () => setVh(window.innerHeight); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [full])
  return <ResponsiveContainer width="100%" height={full ? Math.max(height, vh - 190) : height}>{children}</ResponsiveContainer>
}

/** chart cards (those with an AI button, or expand) get a fullscreen button */
export function Card({ title, sub, right, ai, children, className = '', expand }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; ai?: ChartAI; children: ReactNode; className?: string; expand?: boolean }) {
  const [full, setFull] = useState(false)
  const inFull = useContext(FullCtx)
  const canExpand = (expand ?? !!ai) && !inFull
  const extra = right
  if (ai || canExpand) right = <span className="flex items-center gap-1.5">{extra}{ai && <InsightButton ai={ai} />}
    {canExpand && <button className="p-1.5 rounded-full text-muted hover:bg-surface-2" aria-label="Full screen" onClick={() => setFull(true)}><Icon name="expand" size={17} /></button>}</span>
  return (<>
    {full && <FullScreen onClose={() => setFull(false)} title={title} sub={sub} right={extra}>{children}</FullScreen>}
    {plain()}
  </>)
  function plain() { return (
    <section className={`card p-4 md:p-5 ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-3">
          <div className="min-w-0">{title && <h2 className="display text-xl leading-tight">{title}</h2>}{sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  ) }
}

function FullScreen({ title, sub, right, children, onClose }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-surface flex flex-col px-3 md:px-6 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-1 min-w-0">{title && <h2 className="display text-xl leading-tight">{title}</h2>}{sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}</div>
        {right}
        <button className="p-2 -m-1 text-muted" onClick={onClose} aria-label="Close full screen"><Icon name="close" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto"><FullCtx.Provider value={true}>{children}</FullCtx.Provider></div>
      <p className="text-[11px] text-muted text-center mt-1">Turn your phone sideways for a wider view.</p>
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; box?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mb-2">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.box ? <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} />
            : <span className="inline-block w-3 h-0 border-t-[3px] rounded" style={{ borderColor: i.color, borderTopStyle: i.dashed ? 'dashed' : 'solid' }} />}
          {i.label}
        </span>
      ))}
    </div>
  )
}

interface TipProps { active?: boolean; label?: string | number; payload?: { name?: string; value?: number | null; color?: string; dataKey?: string | number; unit?: string }[]; labelFormat?: (l: string) => string; fmt?: (v: number, key: string) => string }
export function Tip({ active, label, payload, labelFormat, fmt }: TipProps) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(p => p.value !== undefined && p.value !== null)
  if (!rows.length) return null
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold mb-1">{labelFormat ? labelFormat(String(label)) : label}</p>
      {rows.map(p => (
        <p key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted"><span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />{p.name}</span>
          <span className="num font-medium">{fmt ? fmt(p.value as number, String(p.dataKey)) : Math.round((p.value as number) * 10) / 10}</span>
        </p>
      ))}
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const c = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : ''
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5 min-w-0">
      <p className="label truncate">{label}</p>
      <p className={`display text-2xl num leading-tight ${c}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted truncate">{sub}</p>}
    </div>
  )
}

/** bottom sheet on the phone, centred dialog on the desktop */
export function Sheet({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 bg-black/45 flex items-end md:items-center justify-center" onClick={onClose} data-busy>
      <div className="w-full md:max-w-lg max-h-[92vh] flex flex-col bg-surface rounded-t-3xl md:rounded-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <h3 className="display text-xl flex-1 min-w-0 truncate">{title}</h3>
          <button className="p-2 -m-1 text-muted" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="overflow-y-auto px-4 pb-4 flex-1">{children}</div>
        {footer && <div className="px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-line">{footer}</div>}
      </div>
    </div>
  )
}

/** 1–5 / 0–10 tap scale */
export function Scale({ value, onChange, min, max, labels }: { value: number | null; onChange: (v: number | null) => void; min: number; max: number; labels?: [string, string] }) {
  const n = max - min + 1
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {[...Array(n)].map((_, i) => {
          const v = min + i, on = value === v
          return <button key={v} type="button" onClick={() => onChange(on ? null : v)} className={`h-9 rounded-lg text-sm font-semibold num ${on ? 'bg-brand text-surface' : 'bg-surface-2 text-ink'}`}>{v}</button>
        })}
      </div>
      {labels && <div className="flex justify-between text-[11px] text-muted mt-1"><span>{labels[0]}</span><span>{labels[1]}</span></div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted text-center py-6">{children}</p>
}

/** a textarea that grows with its text (no scrolling inside the box) */
export function AutoText({ value, onChange, className = '', minRows = 3 }: { value: string; onChange: (v: string) => void; className?: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` }, [value])
  return <textarea ref={ref} rows={minRows} className={`input resize-none overflow-hidden leading-relaxed ${className}`} value={value} onChange={e => onChange(e.target.value)} />
}
