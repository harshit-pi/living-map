import { useEffect, useState } from 'react'

// The background Claude gets with every turn: what is already established.
export function ContextPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/context').then(r => r.json()).then(d => { setText(d.text); setSaved(d.text); setLoading(false) })
  }, [])
  const save = async () => {
    await fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    setSaved(text)
  }
  return (
    <div className="absolute inset-y-4 right-4 z-20 flex w-[460px] flex-col rounded-2xl bg-white p-4 shadow-xl ring-1 ring-cl-line">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold text-cl-ink">Context</div>
          <div className="text-xs text-cl-mute">Sent with every Claude move, so it starts from what you already know. Markdown.</div>
        </div>
        <button onClick={onClose} className="text-xl leading-none text-cl-faint hover:text-cl-ink">×</button>
      </div>
      <textarea
        value={loading ? 'Loading…' : text}
        onChange={e => setText(e.target.value)}
        className="mt-3 flex-1 resize-none rounded-xl border border-cl-line2 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-cl-accent"
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-cl-mute">~{Math.round(text.length / 4).toLocaleString()} tokens per move</span>
        <button onClick={save} disabled={text === saved} className="rounded-lg bg-cl-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {text === saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
