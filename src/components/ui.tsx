import { useEffect, type ReactNode } from 'react'
import Icon from './Icon'

// eslint-disable-next-line react-refresh/only-export-components
export const AXIS = { tick: { fill: 'var(--muted)', fontSize: 11 }, axisLine: false, tickLine: false } as const
// eslint-disable-next-line react-refresh/only-export-components
export const GRID = { stroke: 'var(--line)', strokeDasharray: '0', vertical: false } as const

export function Card({ title, sub, right, children, className = '' }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 md:p-5 ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-3">
          <div className="min-w-0">{title && <h2 className="display text-xl leading-tight">{title}</h2>}{sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}</div>
          {right}
        </div>
      )}
      {children}
    </section>
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
