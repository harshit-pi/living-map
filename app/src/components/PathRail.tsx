import type { MapDoc, MapNode } from '../types'

const hintsOf = (map: MapDoc, id: string) => Object.values(map.nodes).filter(n => n.parent === id && n.kind === 'fact' && /^hint\b/i.test(n.title)).length

function stateOf(map: MapDoc, n: MapNode) {
  if (n.dropped) return { mark: '–', cls: 'border-cl-line2 text-cl-faint', word: 'set aside' }
  if (n.revealed) return { mark: '◉', cls: 'border-violet-400 bg-violet-50 text-violet-700', word: 'answer shown' }
  if (n.kind === 'question' && n.status === 'answered') return { mark: '✓', cls: 'border-teal-600 bg-teal-600 text-white', word: 'got it' }
  const sc = map.scenes?.[n.id]
  if (sc && !sc.done && sc.at > 0) return { mark: '▶', cls: 'border-cl-accent bg-orange-50 text-cl-accentDk', word: `playing · ${sc.at} of ${sc.total}` }
  const h = hintsOf(map, n.id)
  if (h) return { mark: String(h), cls: 'border-amber-500 bg-amber-50 text-amber-800', word: `${h} hint${h > 1 ? 's' : ''} used` }
  return { mark: '', cls: 'border-amber-500 bg-white text-amber-700', word: 'to do' }
}

// The path to understanding: the steps in order, each with where you are on it.
export function PathRail({ map, selected, onSelect, busy, workingId, onNext }: {
  map: MapDoc; selected: string | null; onSelect: (id: string) => void; busy: boolean; workingId: string | null; onNext: () => void
}) {
  const root = Object.values(map.nodes).find(n => !n.parent)
  const kids = root ? Object.values(map.nodes).filter(n => n.parent === root.id).sort((a, b) => a.order - b.order) : []
  const steps = kids.filter(n => n.kind === 'question')
  const notes = kids.filter(n => n.kind !== 'question')
  const got = steps.filter(s => s.status === 'answered' && !s.revealed).length
  return (
    <nav className="flex h-full w-[220px] shrink-0 xl:w-[270px] flex-col border-r border-cl-line bg-cl-bg">
      <div className="px-4 pb-2 pt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-cl-faint">Your path</div>
        {root && <button onClick={() => onSelect(root.id)} className="mt-0.5 text-left text-[15px] font-semibold leading-snug text-cl-ink hover:text-cl-accentDk">{root.title}</button>}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cl-line">
          <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${steps.length ? (got / steps.length) * 100 : 0}%` }} />
        </div>
        <div className="mt-1 text-xs text-cl-mute">{got} of {steps.length} worked out by you</div>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {steps.map((s, i) => {
          const st = stateOf(map, s)
          const on = selected === s.id
          return (
            <li key={s.id}>
              <button onClick={() => onSelect(s.id)}
                className={`group flex w-full gap-2.5 rounded-xl px-2 py-2 text-left ${on ? 'bg-white shadow-sm ring-1 ring-cl-accent' : 'hover:bg-cl-panel'} ${s.fresh ? 'fresh' : ''}`}>
                <span className="flex flex-col items-center">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold ${st.cls} ${workingId === s.id ? 'is-working' : ''}`}>{st.mark || i + 1}</span>
                  {i < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-cl-line2" />}
                </span>
                <span className="min-w-0 pb-1">
                  <span className={`block text-[13.5px] font-medium leading-snug ${s.dropped ? 'text-cl-faint line-through' : 'text-cl-ink'}`}>{s.title}</span>
                  <span className="block text-[11px] text-cl-mute">{st.word}</span>
                </span>
              </button>
            </li>
          )
        })}
        {notes.length > 0 && <li className="mt-3 px-3 text-[10px] font-semibold uppercase tracking-wide text-cl-faint">You looked into</li>}
        {notes.map(n => (
          <li key={n.id}>
            <button onClick={() => onSelect(n.id)} className={`mt-1 w-full rounded-lg px-3 py-1.5 text-left text-xs ${selected === n.id ? 'bg-white ring-1 ring-cl-accent' : 'text-cl-mute hover:bg-cl-panel'}`}>
              {n.kind === 'option' ? '◇ ' : '· '}{n.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="border-t border-cl-line p-3">
        <button onClick={onNext} disabled={busy} className="w-full rounded-lg bg-cl-accent py-1.5 text-sm font-medium text-white hover:bg-cl-accentDk disabled:opacity-40">Next step ▸</button>
      </div>
    </nav>
  )
}
