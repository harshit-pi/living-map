import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import type { Settings } from '../types'

const MODELS: [string, string][] = [['', 'Default model'], ['fable', 'Fable 5.1'], ['opus', 'Opus 5.5'], ['sonnet', 'Sonnet 5.5'], ['haiku', 'Haiku 5.5']]
const EFFORTS: [string, string][] = [['', 'Effort: auto (low)'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']]

function Picker({ value, options, onChange, title }: { value: string; options: [string, string][]; onChange: (v: string) => void; title: string }) {
  return (
    <select title={title} value={value} onChange={e => onChange(e.target.value)}
      className="cursor-pointer rounded-lg border-0 bg-transparent py-1 pl-2 pr-6 text-[12.5px] text-cl-mute hover:bg-cl-panel focus:ring-0">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

export type ComposerHandle = { focus: () => void }

// The one place text goes in, styled like Claude's: chips on top, the model and
// effort pickers below. Used full-width in Text, floating in Visual, and in a
// node's thread.
export const Composer = forwardRef<ComposerHandle, {
  busy: boolean
  settings: Settings
  onSettings: (s: Partial<Settings>) => void
  onSend: (text: string) => void
  placeholder: string
  chips?: ReactNode
  rows?: number
  compact?: boolean
  onStop?: () => void
}>(function Composer({ busy, settings, onSettings, onSend, placeholder, chips, rows = 2, compact, onStop }, ref) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])
  const send = () => {
    const t = text.trim()
    if (!t || busy) return
    onSend(t)
    setText('')
  }
  return (
    <div className="rounded-2xl border border-cl-line2 bg-white shadow-sm focus-within:border-cl-accent">
      {chips && <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">{chips}</div>}
      <textarea ref={input} value={text} rows={rows} placeholder={placeholder}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        className={`block w-full resize-none border-0 bg-transparent px-4 pt-3 text-cl-ink outline-none placeholder:text-cl-faint focus:ring-0 ${compact ? 'text-[14px]' : 'text-[15px]'}`} />
      <div className="flex items-center gap-1 px-2 pb-2">
        <div className="flex-1" />
        {!compact && <Picker title="Model" value={settings.model} options={MODELS} onChange={model => onSettings({ model })} />}
        {!compact && <Picker title="Reasoning effort" value={settings.effort} options={EFFORTS} onChange={effort => onSettings({ effort })} />}
        {busy && onStop ? (
          <button onClick={onStop} title="Stop Claude"
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-cl-ink text-white hover:bg-black"><span className="h-2.5 w-2.5 rounded-[2px] bg-white" /></button>
        ) : (
          <button onClick={send} disabled={busy || !text.trim()} title={busy ? 'Claude is working' : 'Send'}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-cl-accent text-white hover:bg-cl-accentDk disabled:opacity-40">↑</button>
        )}
      </div>
    </div>
  )
})

export function Chip({ children, onRemove, tone = 'plain' }: { children: ReactNode; onRemove?: () => void; tone?: 'plain' | 'accent' }) {
  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ${tone === 'accent' ? 'bg-orange-50 text-cl-accentDk ring-orange-200' : 'bg-cl-panel text-cl-text ring-cl-line'}`}>
      {children}
      {onRemove && <button className="ml-1 text-cl-faint hover:text-cl-ink" onClick={onRemove}>×</button>}
    </span>
  )
}
