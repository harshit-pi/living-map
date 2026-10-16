import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MapDoc, Settings } from '../types'
import { Composer } from './Composer'

// Text: the main conversation as a full-screen Claude chat, readable without the map.
export function TextView({ map, busy, stream, settings, onSettings, onSend, onVisual, onStop }: {
  map: MapDoc; busy: boolean; stream: { threadId: string | null; text: string }
  settings: Settings; onSettings: (s: Partial<Settings>) => void; onSend: (t: string) => void; onVisual: () => void; onStop: () => void
}) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [map.chat.length, stream.text])
  const nodes = Object.values(map.nodes).filter(n => !n.dropped)
  const open = nodes.filter(n => n.kind === 'question' && n.status === 'open').length
  const threads = Object.keys(map.threads ?? {}).length
  const mainStream = busy && stream.threadId === null
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex justify-center pt-3">
          <button onClick={onVisual} className="rounded-full bg-white px-3 py-1 text-xs text-cl-mute shadow-sm ring-1 ring-cl-line hover:text-cl-accentDk hover:ring-cl-accent">
            ◫ Map: {nodes.length} nodes · {open} open{map.diagram ? ` · ${map.diagram.form} diagram` : ''}{threads ? ` · ${threads} side thread${threads > 1 ? 's' : ''}` : ''} → back to Visual
          </button>
        </div>
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
          {map.chat.map((c, i) => c.role === 'you' ? (
            <div key={i} className="flex justify-end"><div className="max-w-[80%] rounded-2xl bg-cl-user px-4 py-2 text-[15px] text-cl-ink">{c.text}</div></div>
          ) : c.role === 'claude' ? (
            <div key={i} className="answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{c.text}</ReactMarkdown></div>
          ) : (
            <div key={i} className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-900">{c.text}</div>
          ))}
          {mainStream && (
            <div className="answer">{stream.text ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream.text}</ReactMarkdown> : <span className="animate-pulse font-sans text-sm text-cl-mute">Claude is thinking…</span>}</div>
          )}
          {busy && !mainStream && <div className="text-sm text-cl-mute">Claude is answering in a side thread…</div>}
          <div ref={end} />
        </div>
      </div>
      <div className="px-4 pb-4">
        <div className="mx-auto max-w-3xl">
          <Composer busy={busy} settings={settings} onSettings={onSettings} onSend={onSend} onStop={onStop} placeholder="Reply to Claude…" rows={3} />
        </div>
      </div>
    </div>
  )
}
