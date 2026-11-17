import { useState } from 'react'
import { Card } from './ui'
import { myId } from '../lib/data'
import { dmy, today } from '../lib/format'
import { fmtPace, fmtTime, pacesFrom, type Paces } from '../lib/paces'
import { supabase } from '../lib/supabase'

const DIST: [string, number][] = [['5 km', 5000], ['10 km', 10000], ['Half', 21097], ['Marathon', 42195], ['50 km', 50000]]
const parseTime = (s: string) => { const p = s.trim().split(':').map(Number); if (p.some(isNaN) || !p.length) return null; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60 }

/** Running paces from a race or time trial (Daniels VDOT). Updated automatically after a time trial or race; or enter one here. */
export default function PacesCard({ paces, onSaved }: { paces: Paces | null; onSaved: () => void }) {
  const [d, setD] = useState(10000); const [t, setT] = useState(''); const [err, setErr] = useState<string>()
  const preview = (() => { const s = parseTime(t); return s && s > 600 ? pacesFrom(d, s, '', today()) : null })()
  async function save() {
    const s = parseTime(t); if (!s) return setErr('Time as h:mm:ss or mm:ss')
    const label = `${DIST.find(x => x[1] === d)?.[0]} in ${fmtTime(s)}`
    const { error } = await supabase.from('tr_settings').update({ paces: pacesFrom(d, s, label, today()) }).eq('user_id', await myId())
    if (error) setErr(error.message); else { setT(''); onSaved() }
  }
  const p = preview ?? paces
  return (
    <Card title="Running paces" sub={paces ? `VDOT ${paces.vdot} from ${paces.source} (${dmy(paces.date)}). Updates itself after a time trial or race.` : 'From a recent race or time trial (Daniels VDOT).'}>
      {p && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {[['Easy / long', `${fmtPace(p.easy[0])}–${fmtPace(p.easy[1])}`], ['Marathon', fmtPace(p.marathon)], ['Tempo', fmtPace(p.threshold)], ['Intervals', fmtPace(p.interval)]].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-surface-2 px-3 py-2"><p className="label">{k}</p><p className="display text-xl num">{v}<span className="text-xs text-muted">/km</span></p></div>
          ))}
        </div>
      )}
      {p && <p className="text-xs text-muted mt-2 num">Predicted: {Object.entries(p.predict).map(([k, v]) => `${k} ${fmtTime(v)}`).join(' · ')}. Joburg results include altitude; at the coast the same effort is ~3–5% faster.</p>}
      {preview && <p className="text-xs text-brand mt-1">Preview — tap Save to use these.</p>}
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 mt-3">
        <select className="input" value={d} onChange={e => setD(+e.target.value)}>{DIST.map(([k, m]) => <option key={m} value={m}>{k}</option>)}</select>
        <input className="input num" placeholder="time, e.g. 48:30" value={t} onChange={e => setT(e.target.value)} />
        <button className="btn btn-primary" disabled={!preview} onClick={() => void save()}>Save</button>
      </div>
      {err && <p className="text-sm text-bad mt-1">{err}</p>}
    </Card>
  )
}
