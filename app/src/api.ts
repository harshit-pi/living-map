import { useEffect, useState } from 'react'
import type { Action, MapDoc, Settings, Working } from './types'

// One live connection: the server pushes the canvas after every change, what
// Claude is working on, and the readable text while Claude writes it, tagged
// with the thread it belongs to. Reconnects by itself if the server restarts.
export function useLiveMap() {
  const [map, setMap] = useState<MapDoc | null>(null)
  const [busy, setBusy] = useState(false)
  const [working, setWorking] = useState<Working | null>(null)
  const [queued, setQueued] = useState(0)
  const [waiting, setWaiting] = useState<{ label: string; nodeId: string | null }[]>([])
  const [stream, setStream] = useState<{ threadId: string | null; text: string }>({ threadId: null, text: '' })
  const [online, setOnline] = useState(true)
  useEffect(() => {
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let closed = false
    let heard = Date.now()
    const connect = () => {
      heard = Date.now()
      es = new EventSource('/api/events')
      es.onopen = () => setOnline(true)
      es.onerror = () => {
        setOnline(false)
        // the browser retries on its own unless the stream is closed for good
        if (es?.readyState === EventSource.CLOSED && !closed) { es.close(); retry = setTimeout(connect, 1500) }
      }
      es.onmessage = m => {
        heard = Date.now()
        setOnline(true)
        const ev = JSON.parse(m.data)
        if (ev.type === 'map') {
          setMap(ev.map)
          setBusy(ev.busy)
          setWorking(ev.working ?? null)
          setQueued(ev.queued ?? 0)
          setWaiting(ev.waiting ?? [])
          if (!ev.busy) setStream({ threadId: null, text: '' })
        } else if (ev.type === 'delta') setStream(s => ({ threadId: ev.threadId ?? null, text: s.text + ev.text }))
        else if (ev.type === 'busy') {
          setBusy(ev.busy)
          setWorking(ev.working ?? null)
          if (ev.busy) setStream({ threadId: ev.threadId ?? null, text: '' })
        }
      }
    }
    connect()
    // the server pings every 10s; silence means the connection is dead even if
    // the browser has not noticed, so start a fresh one (it brings the live state)
    const watch = setInterval(() => {
      if (Date.now() - heard > 25000) { setOnline(false); es?.close(); connect() }
    }, 5000)
    return () => { closed = true; clearTimeout(retry); clearInterval(watch); es?.close() }
  }, [])
  return { map, busy, working, queued, waiting, stream, online }
}

export async function act(action: Action, settings: Settings): Promise<{ error?: string; threadId?: string; ok?: boolean; nodeId?: string }> {
  try {
    const r = await fetch('/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...action, settings }),
    })
    return await r.json()
  } catch {
    return { error: 'Could not reach the Living Map server. Is it running?' }
  }
}

// Small per-browser preferences; the page works without storage.
export function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`lm.${key}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
export function store(key: string, value: unknown) {
  try { localStorage.setItem(`lm.${key}`, JSON.stringify(value)) } catch { /* private window */ }
}
