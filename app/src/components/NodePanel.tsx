import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Action, MapDoc, MapNode, NodeAction, Settings, Working } from '../types'
import { Composer, type ComposerHandle } from './Composer'
import { lookOf } from './look'

type Run = (a: Action) => Promise<{ threadId?: string }>

function Btn({ children, onClick, primary, disabled, title }: { children: string; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button disabled={disabled} onClick={onClick} title={disabled ? 'Claude is working. Wait, or press Stop.' : title}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        primary ? 'bg-cl-accent text-white hover:bg-cl-accentDk' : 'border border-cl-line2 bg-white text-cl-text hover:border-cl-accent hover:text-cl-accentDk'}`}>
      {children}
    </button>
  )
}

function pathOf(nodes: Record<string, MapNode>, id: string) {
  const out: MapNode[] = []
  for (let n: MapNode | undefined = nodes[id]; n; n = n.parent ? nodes[n.parent] : undefined) out.unshift(n)
  return out
}

// Everything about one node in one place: what it is, what you can do with it,
// what is under it, and the side threads pinned to it. Selecting a node opens
// this with the cursor in its thread, so you reply on the visual itself.
export function NodePanel({ map, node, busy, working, stream, settings, onSettings, run, onSelect, onClose }: {
  map: MapDoc
  node: MapNode
  busy: boolean
  working: Working | null
  stream: { threadId: string | null; text: string }
  settings: Settings
  onSettings: (s: Partial<Settings>) => void
  run: Run
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const learn = map.purpose === 'learn'
  const threads = useMemo(
    () => Object.values(map.threads ?? {}).filter(t => t.nodeId === node.id).sort((a, b) => a.createdAt - b.createdAt),
    [map.threads, node.id],
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = threads.find(t => t.id === activeId) ?? threads[threads.length - 1]
  const [explaining, setExplaining] = useState(false)
  const composer = useRef<ComposerHandle>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { setActiveId(null); setExplaining(false); composer.current?.focus() }, [node.id])
  useEffect(() => { if (node.detail) setExplaining(false) }, [node.detail])
  // a turn that opens a thread on this node: follow it
  useEffect(() => { if (busy && stream.threadId && threads.some(t => t.id === stream.threadId)) setActiveId(stream.threadId) }, [busy, stream.threadId, threads])
  const streamingHere = busy && !!active && stream.threadId === active.id
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [active?.messages.length, streamingHere, stream.text])

  const look = lookOf(node, map.purpose)
  const gone = !!node.dropped || node.status === 'dropped'
  const children = Object.values(map.nodes).filter(n => n.parent === node.id).sort((a, b) => a.order - b.order)
  const hints = children.filter(n => n.kind === 'fact' && /^hint\b/i.test(n.title))
  const others = children.filter(n => !hints.includes(n))
  const openStep = learn && node.kind === 'question' && node.status === 'open' && !node.revealed
  const path = pathOf(map.nodes, node.id)
  const act = (type: NodeAction) => { void run({ type, nodeId: node.id }) }

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-20 flex w-[min(420px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-cl-line">
      <div className="border-b border-cl-line px-4 pb-3 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${look.tagCls}`}>{look.tag}</div>
            <div className="mt-0.5 text-[17px] font-semibold leading-snug text-cl-ink">{node.title}</div>
          </div>
          <button onClick={onClose} title="Close (Esc)" className="text-xl leading-none text-cl-faint hover:text-cl-ink">×</button>
        </div>
        {node.summary && <div className="mt-1 text-[13.5px] leading-snug text-cl-text">{node.summary.replace(/^Recommended:\s*/, '')}</div>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {gone ? <Btn onClick={() => act('restore')}>Restore</Btn> : (
            <>
              {node.kind === 'option' && node.status !== 'chosen' && <Btn primary onClick={() => act('choose')}>{learn ? 'Try this' : 'Choose'}</Btn>}
              {openStep && <Btn primary disabled={busy || hints.length >= 3} onClick={() => act('hint')} title="Each press gives a little more">{hints.length >= 3 ? 'No more hints' : `Hint ${hints.length + 1} of 3`}</Btn>}
              <Btn disabled={busy} onClick={() => act('deeper')}>{learn ? 'Smaller steps' : 'Go deeper'}</Btn>
              {!learn && (node.kind !== 'option' || node.status === 'chosen') && <Btn disabled={busy} onClick={() => act('challenge')}>Challenge</Btn>}
              {!node.detail && <Btn disabled={busy} onClick={() => { setExplaining(true); act('explain') }}>Explain</Btn>}
              {openStep && <Btn disabled={busy} onClick={() => act('answer')} title="Shown answers are not counted as yours">Show answer</Btn>}
              <Btn onClick={() => act('drop')}>Set aside</Btn>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {working && working.nodeId === node.id && !working.threadId && (
          <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2.5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-cl-accentDk">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cl-accent" />{working.label}…
            </div>
            <div className="space-y-1.5"><div className="skeleton w-11/12" /><div className="skeleton w-9/12" /><div className="skeleton w-10/12" /></div>
            {stream.threadId === null && stream.text && <div className="mt-2 text-[12.5px] leading-snug text-cl-text">{stream.text}</div>}
          </div>
        )}
        {hints.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {hints.map(h => (
              <div key={h.id} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">{h.title}</div>
                <div className="whitespace-pre-line text-[13.5px] leading-snug text-violet-950">{h.summary}</div>
              </div>
            ))}
          </div>
        )}
        {(node.detail || (explaining && !(working && working.nodeId === node.id))) && (
          <details open className="mb-3 rounded-lg border border-cl-line bg-cl-panel px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-cl-mute">{node.revealed ? 'Answer (shown)' : 'Explanation'}</summary>
            {node.detail
              ? <div className="answer answer-sm mt-1"><ReactMarkdown remarkPlugins={[remarkGfm]}>{node.detail}</ReactMarkdown></div>
              : <div className="mt-1 animate-pulse text-sm text-cl-mute">Claude is writing it…</div>}
          </details>
        )}
        {others.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-cl-faint">Under this</div>
            <div className="flex flex-wrap gap-1.5">
              {others.map(c => (
                <button key={c.id} onClick={() => onSelect(c.id)}
                  className={`rounded-md border px-2 py-0.5 text-left text-xs hover:border-cl-accent ${c.dropped ? 'border-dashed border-cl-line2 text-cl-faint line-through' : 'border-cl-line2 text-cl-text'}`}>
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-2 flex items-center gap-1 border-b border-cl-line pb-1.5">
          {threads.map(t => (
            <button key={t.id} onClick={() => setActiveId(t.id)}
              className={`rounded-md px-2 py-0.5 text-xs ${active?.id === t.id ? 'bg-cl-panel font-medium text-cl-ink' : 'text-cl-mute hover:text-cl-ink'}`}>
              {t.title}{t.messages.length ? ` · ${t.messages.length}` : ''}
            </button>
          ))}
          {!threads.length && <span className="text-xs text-cl-mute">Side thread</span>}
          <div className="flex-1" />
          {threads.length > 0 && (
            <button disabled={busy} title="Start a fresh thread on this node; the others stay as they are"
              onClick={async () => { const r = await run({ type: 'fork', nodeId: node.id }); if (r.threadId) { setActiveId(r.threadId); composer.current?.focus() } }}
              className="rounded-md px-2 py-0.5 text-xs text-cl-accentDk hover:bg-orange-50 disabled:opacity-40">⑂ Fork</button>
          )}
        </div>
        <div className="mb-2 text-[11px] leading-snug text-cl-faint" title="What Claude is sent for this thread">
          Claude sees: your background · the map · {path.map(p => p.title).join(' → ')} · this thread only
        </div>
        <div className="space-y-3">
          {active?.messages.map((m, i) => m.role === 'you' ? (
            <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl bg-cl-user px-3 py-1.5 text-[13.5px] text-cl-ink">{m.text}</div></div>
          ) : m.role === 'claude' ? (
            <div key={i} className="answer answer-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div>
          ) : (
            <div key={i} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">{m.text}</div>
          ))}
          {streamingHere && (
            <div className="answer answer-sm">
              {stream.text ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream.text}</ReactMarkdown> : <span className="animate-pulse font-sans text-xs text-cl-mute">Claude is thinking…</span>}
            </div>
          )}
          <div ref={end} />
        </div>
      </div>

      <div className="border-t border-cl-line p-2.5">
        <Composer ref={composer} compact rows={2} busy={busy} settings={settings} onSettings={onSettings} onStop={() => { void run({ type: 'stop' }) }}
          placeholder={openStep ? 'Your answer, or a question about this step…' : `Ask about “${node.title}”…`}
          onSend={text => { void run({ type: 'thread', nodeId: node.id, threadId: active?.id, text }) }} />
      </div>
    </aside>
  )
}
