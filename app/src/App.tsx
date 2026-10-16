import { useCallback, useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { act, store, stored, useLiveMap } from './api'
import { Canvas } from './components/Canvas'
import { Chip, Composer } from './components/Composer'
import { DiagramView } from './components/DiagramView'
import { MapRows, MapsMenu, useMaps } from './components/MapList'
import { NodePanel } from './components/NodePanel'
import { PathRail } from './components/PathRail'
import { ScenePlay } from './components/ScenePlay'
import { TextView } from './components/TextView'
import type { Action, MapDoc, Purpose, Settings, View, Working } from './types'

const DEFAULTS: Settings = { model: '', effort: '', view: 'visual' }

const EXAMPLES: Record<Purpose, string[]> = {
  decide: ['Which learning vertical should Living Map start with?', 'Postgres or DynamoDB for a new service?'],
  learn: ['How TCP opens a connection', 'What drives an option price (Black–Scholes)?', 'Why did World War I start?', 'LeetCode 146: LRU Cache'],
}

function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex rounded-lg bg-cl-panel p-0.5 text-[13px]">
      {options.map(([v, label]) => (
        <button key={v} disabled={disabled} onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 ${value === v ? 'bg-white text-cl-ink shadow-sm' : 'text-cl-mute hover:text-cl-ink'}`}>{label}</button>
      ))}
    </div>
  )
}

function Start({ error, onStart, onCancel, onOpen }: { error: string; onStart: (text: string, purpose: Purpose) => void; onCancel?: () => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const maps = useMaps(true)
  const busy = false
  const [purpose, setPurpose] = useState<Purpose>(() => stored('purpose', 'decide'))
  const go = (text: string) => { if (text.trim()) onStart(text.trim(), purpose) }
  return (
    <div className="flex h-full items-center justify-center bg-cl-bg p-6">
      <div className="w-full max-w-xl">
        <div className="mb-4 flex justify-center">
          <Segmented value={purpose} options={[['decide', 'Decide'], ['learn', 'Learn']]} onChange={p => { setPurpose(p); store('purpose', p) }} />
        </div>
        <h1 className="text-center font-serif text-3xl text-cl-ink">{purpose === 'learn' ? 'What do you want to understand?' : 'What are you deciding?'}</h1>
        <p className="mt-2 text-center text-cl-mute">
          {purpose === 'learn'
            ? 'Any subject. Claude draws it in the shape that fits and leaves the key parts blank for you to fill.'
            : 'Claude lays it out as a map. You steer by clicking and replying on the nodes.'}
        </p>
        <div className="mt-6 rounded-2xl border border-cl-line2 bg-white shadow-sm focus-within:border-cl-accent">
          <textarea value={q} onChange={e => setQ(e.target.value)} autoFocus rows={3}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(q) } }}
            placeholder={purpose === 'learn' ? 'e.g. a protocol, a theory, a period of history, a coding problem' : 'e.g. Which database for the new service?'}
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-base outline-none focus:ring-0" />
          <div className="flex justify-end px-2 pb-2">
            <button onClick={() => go(q)} disabled={busy || !q.trim()} className="flex h-8 w-8 items-center justify-center rounded-lg bg-cl-accent text-white disabled:opacity-40">↑</button>
          </div>
        </div>
        {error && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>}
        {onCancel && <div className="mt-3 text-center"><button onClick={onCancel} className="text-sm text-cl-mute hover:text-cl-ink">← Back to the current map</button></div>}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {EXAMPLES[purpose].map(e => (
            <button key={e} onClick={() => go(e)} disabled={busy} className="rounded-full border border-cl-line2 bg-white px-3 py-1 text-sm text-cl-text hover:border-cl-accent">{e}</button>
          ))}
        </div>
        {maps.length > 0 && (
          <div className="mt-8">
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-cl-faint">Pick up where you left off</div>
            <div className="overflow-hidden rounded-xl bg-white ring-1 ring-cl-line"><MapRows maps={maps} onOpen={onOpen} limit={6} /></div>
          </div>
        )}
      </div>
    </div>
  )
}

// What Claude is doing right now, in both views: a moving bar, the task, the
// seconds so far, and Stop.
function WorkingBar({ working, queued, onStop }: { working: Working | null; queued: number; onStop: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!working) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [working])
  if (!working) return <div className="h-[2px]" />
  const secs = Math.max(0, Math.round((now - working.since) / 1000))
  return (
    <div className="relative">
      <div className="working-bar" />
      <div className="absolute left-1/2 top-1.5 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white py-1 pl-3 pr-1 text-xs text-cl-text shadow-md ring-1 ring-cl-line">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cl-accent" />
        <span>Claude · {working.label}… <span className="tabular-nums text-cl-faint">{secs}s</span>{queued > 0 && <span className="text-cl-accentDk"> · {queued} waiting</span>}</span>
        <button onClick={onStop} className="rounded-full px-2 py-0.5 text-cl-mute hover:bg-cl-panel hover:text-cl-ink">Stop</button>
      </div>
    </div>
  )
}

// Claude's caption for a main-thread move: live while it writes, then a few
// seconds on screen. The full text is always in the Text view.
function useCaption(map: MapDoc | null, busy: boolean, stream: { threadId: string | null; text: string }) {
  const [shown, setShown] = useState('')
  const seen = useRef<number | null>(null)
  const len = map?.chat.length ?? 0
  useEffect(() => {
    if (!map) return
    const before = seen.current
    seen.current = len
    if (before === null || len <= before) return
    const last = map.chat[len - 1]
    if (last?.role !== 'claude' && last?.role !== 'system') return
    setShown(last.text)
    const t = setTimeout(() => setShown(''), 9000)
    return () => clearTimeout(t)
  }, [len, map])
  const live = busy && stream.threadId === null
  return { text: live ? stream.text : shown, live, clear: () => setShown('') }
}

export default function App() {
  const { map, busy, working, queued, stream, online } = useLiveMap()
  const [selection, setSelection] = useState<string[]>([])
  const [showDropped, setShowDropped] = useState(true)
  const [starting, setStarting] = useState(false)
  // a new map on its way: the map it replaces, so the loading screen shows until the new one lands
  const [launch, setLaunch] = useState<{ from: string | null } | null>(null)
  const [startError, setStartError] = useState('')
  const [lastFill, setLastFill] = useState<string | null>(null)
  const [centre, setCentre] = useState<'play' | 'topic'>('play')
  const [panelOpen, setPanelOpen] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Settings>(() => stored('settings', DEFAULTS))
  const caption = useCaption(map, busy, stream)

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings(prev => { const next = { ...prev, ...s }; store('settings', next); return next })
  }, [])
  const setView = (view: View) => updateSettings({ view })

  const run = useCallback(async (a: Action) => {
    const r = await act(a, settings)
    setError(r.error ?? '')
    return r
  }, [settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelection([]) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (launch && map && map.id !== launch.from && (Object.keys(map.nodes).length || map.diagram)) setLaunch(null)
  }, [launch, map])
  const stop = () => { void act({ type: 'stop' }, settings) }
  const openMap = async (mapId: string) => {
    setSelection([])
    const r = await act({ type: 'open', mapId }, settings)
    if (r.error) setStartError(r.error)
    else setStarting(false)
  }
  useEffect(() => { setCentre('play'); setPanelOpen(window.innerWidth >= 1200) }, [selection])
  // a node that disappears (removed by Claude) closes its panel
  useEffect(() => { if (map) setSelection(s => s.filter(id => map.nodes[id])) }, [map])

  // a map has something to show once it has a node or (Learn) the diagram, which is written first
  const empty = !map || (!Object.keys(map.nodes).length && !map.diagram)
  if (launch || (!starting && empty && busy)) {
    return (
      <div className="flex h-full flex-col bg-cl-bg">
        <WorkingBar working={working} queued={queued} onStop={stop} />
        <div className="flex flex-1 items-center justify-center text-cl-mute">
          <div className="max-w-md text-center">
            <div className="animate-pulse">{working?.label ?? 'Starting'}…</div>
            <div className="mt-3 text-sm text-cl-faint">{stream.text}</div>
          </div>
        </div>
      </div>
    )
  }
  if (starting || empty) {
    return (
      <Start error={startError} onCancel={!empty ? () => setStarting(false) : undefined} onOpen={openMap}
        onStart={async (text, purpose) => {
          setStartError('')
          setSelection([])
          setLaunch({ from: map?.id ?? null })
          setStarting(false)
          const r = await act({ type: 'new', text, purpose }, settings)
          if (r.error) { setLaunch(null); setStarting(true); setStartError(r.error) }
        }} />
    )
  }
  if (!map) return null

  // on a narrow window the panel floats over the work instead of pushing it aside
  const roomy = typeof window !== 'undefined' && window.innerWidth >= 1200
  const learn = map.purpose === 'learn'
  const view = settings.view
  const one = selection.length === 1 ? map.nodes[selection[0]] : undefined
  const select = (id: string) => setSelection(s => (s.length === 1 && s[0] === id ? [] : [id]))
  const lastClaude = [...map.chat].reverse().find(c => c.role === 'claude')?.text ?? ''

  // Learn: the step in view, its scene, and the step after it
  const step = learn && one && one.parent ? one : undefined
  const scene = step ? map.scenes?.[step.id] : undefined
  const building = step && working?.nodeId === step.id && working.label === 'Building a playable scene'
  const nextStep = (id: string) => {
    const s = map.nodes[id]
    const sibs = Object.values(map.nodes).filter(n => n.parent === s?.parent && n.kind === 'question' && !n.dropped).sort((a, b) => a.order - b.order)
    return sibs.slice(sibs.findIndex(n => n.id === id) + 1).find(n => n.status === 'open')?.id ?? sibs[sibs.findIndex(n => n.id === id) + 1]?.id
  }

  // in a narrow window the board needs the room: the panel tucks away while you play
  const tucked = !!(scene && centre === 'play' && !roomy && !panelOpen)
  const panel = one && !tucked && (
    <NodePanel map={map} node={one} busy={busy} working={working} stream={stream} settings={settings} onSettings={updateSettings}
      run={run} onSelect={id => setSelection([id])} onClose={() => (scene && !roomy ? setPanelOpen(false) : setSelection([]))} />
  )

  const floating = (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-4 pb-4" style={{ paddingRight: one && roomy ? 450 : undefined }}>
      {caption.text && (
        <div onClick={caption.clear} className="pointer-events-auto max-w-2xl cursor-pointer rounded-2xl bg-white/95 px-4 py-2.5 shadow-lg ring-1 ring-cl-line backdrop-blur">
          <div className="answer answer-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{caption.text}</ReactMarkdown></div>
        </div>
      )}
      <div className="pointer-events-auto w-full max-w-2xl">
        <Composer busy={busy} settings={settings} onSettings={updateSettings} rows={1} onStop={stop}
          placeholder={learn ? 'Ask anything about the topic, or tell Claude where you are stuck…' : selection.length ? 'Say something about the selected nodes…' : 'Message Claude about the whole map…'}
          chips={selection.length > 1 ? selection.map(id => <Chip key={id} onRemove={() => setSelection(s => s.filter(x => x !== id))}>{map.nodes[id]?.title ?? id}</Chip>) : undefined}
          onSend={text => { void run({ type: 'message', text, selection }) }} />
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-cl-bg">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-cl-line px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-cl-ink">{map.title}</div>
        </div>
        <Segmented value={view} options={[['visual', '◫ Visual'], ['text', '☰ Text']]} onChange={setView} />
        <div className="flex items-center justify-end gap-2">
          <Segmented value={map.purpose} options={[['decide', 'Decide'], ['learn', 'Learn']]} onChange={purpose => { void run({ type: 'purpose', purpose }) }} />
          {!learn && view === 'visual' && (
            <label className="flex items-center gap-1 text-xs text-cl-mute"><input type="checkbox" checked={showDropped} onChange={e => setShowDropped(e.target.checked)} /> Set aside</label>
          )}
          {!learn && <button onClick={() => { void run({ type: 'next' }) }} disabled={busy} className="rounded-lg bg-cl-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-cl-accentDk disabled:opacity-40">Next ▸</button>}
          <MapsMenu onOpen={id => { void openMap(id) }} />
          <button onClick={() => { setStartError(''); setStarting(true) }} className="rounded-lg border border-cl-line2 px-2.5 py-1.5 text-sm text-cl-text hover:bg-cl-panel disabled:opacity-40">New</button>
        </div>
      </header>
      <WorkingBar working={working} queued={queued} onStop={stop} />
      {!online && <div className="bg-amber-50 px-4 py-1.5 text-sm text-amber-900">Lost the connection to the Living Map server; reconnecting…</div>}
      {error && <div className="flex items-center bg-amber-50 px-4 py-1.5 text-sm text-amber-900"><span className="flex-1">{error}</span><button onClick={() => setError('')} className="text-amber-700">×</button></div>}

      <main className="relative min-h-0 flex-1">
        {view === 'text' ? (
          <TextView map={map} busy={busy} stream={stream} settings={settings} onSettings={updateSettings}
            onSend={text => { void run({ type: 'message', text, selection: [] }) }} onVisual={() => setView('visual')} onStop={stop} />
        ) : learn ? (
          <div className="flex h-full">
            <PathRail map={map} selected={one?.id ?? null} onSelect={select} busy={busy} workingId={working?.nodeId ?? null} onNext={() => { void run({ type: 'next' }) }} />
            <div className="relative min-w-0 flex-1">
              <div className="flex h-full flex-col transition-[padding]" style={{ paddingRight: one && roomy ? 440 : 0 }}>
                {step && (scene || building || step.kind === 'question') && (
                  <div className="relative flex items-center justify-center gap-2 pt-3">
                    {tucked && <button onClick={() => setPanelOpen(true)} className="absolute right-3 top-3 rounded-lg border border-cl-line2 bg-white px-2.5 py-1 text-xs text-cl-text hover:border-cl-accent">💬 Hints &amp; thread</button>}
                    {scene ? (
                      <div className="flex rounded-lg bg-cl-panel p-0.5 text-[13px]">
                        {([['play', '▶ Play this step'], ['topic', '◧ Topic diagram']] as const).map(([v, l]) => (
                          <button key={v} onClick={() => setCentre(v)} className={`rounded-md px-3 py-1 ${centre === v ? 'bg-white text-cl-ink shadow-sm' : 'text-cl-mute hover:text-cl-ink'}`}>{l}</button>
                        ))}
                      </div>
                    ) : building ? (
                      <div className="animate-pulse rounded-full bg-orange-50 px-4 py-1.5 text-sm text-cl-accentDk ring-1 ring-orange-200">Building a playable scene for this step…</div>
                    ) : (
                      <button onClick={() => { void run({ type: 'scene', nodeId: step.id }) }}
                        className="rounded-full bg-cl-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-cl-accentDk">▶ Play this step by hand</button>
                    )}
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  {scene && step && centre === 'play' ? (
                    <ScenePlay scene={scene} stepTitle={step.title} busy={busy} building={!!building}
                      onKey={key => act({ type: 'play', nodeId: step.id, key }, settings)}
                      onShow={() => { void run({ type: 'playshow', nodeId: step.id }) }}
                      onReplay={() => { void run({ type: 'replay', nodeId: step.id }) }}
                      onHint={() => { void run({ type: 'hint', nodeId: step.id }) }}
                      onNext={() => { const n = nextStep(step.id); if (n) setSelection([n]) }} />
                  ) : (
                    <div className="h-full" onClick={() => setSelection([])}>
                      <DiagramView diagram={map.diagram} fills={map.fills ?? {}} busy={busy} lastFill={lastFill} caption={busy ? (stream.threadId === null ? stream.text : '') : lastClaude}
                        onFill={(blankId, text) => { setLastFill(blankId); void run({ type: 'fill', blankId, text }) }} />
                    </div>
                  )}
                </div>
              </div>
              <div onClick={e => e.stopPropagation()}>{panel}{floating}</div>
            </div>
          </div>
        ) : (
          <>
            <ReactFlowProvider>
              <Canvas map={map} showDropped={showDropped} selected={selection} busy={busy} workingId={working?.nodeId ?? null} onSelect={setSelection} />
            </ReactFlowProvider>
            {panel}
            {floating}
          </>
        )}
      </main>
    </div>
  )
}
