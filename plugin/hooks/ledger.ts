// The decision ledger, ported from ~/workspace/living-map/lm/ledger.py.
// Prompt = v5: v1's specific values (best capture on 122 probes), v3's "only
// the user changes a user decision", v4's kinds (lets the board list every
// decision and rule and count tasks), and at most 6 threads.
import type { MapItem, MapItems, MapStatus, MapTurn } from '../types'

export const STATUSES: MapStatus[] = ['waiting', 'open', 'decided', 'done', 'parked', 'dropped']
export const STATUS_LABEL: Record<MapStatus, string> = {
  waiting: 'waiting on you', open: 'open', decided: 'decided, not built',
  done: 'done', parked: 'parked', dropped: 'dropped',
}

export const SYSTEM = `You keep a DECISION LEDGER for a long working session between a user and an AI agent (coding, design, product work). The ledger is how the user and the AI recover what is settled after the chat history is gone, so it must hold the specific answer, not a vague topic.

Record only what someone would need later:
- decisions and choices: tool, model, architecture, datastore, scope, numbers, names, time windows
- standing rules and preferences the user states ("always merge yourself", "use my open Chrome", "devo is free to test")
- open questions that block work
- deferrals ("later", "not in v1") -> parked
- work the AI reports as built, merged or deployed -> done; decided but not yet built -> decided
- options rejected or removed -> dropped
- things waiting on the user (approve, run, provide) -> waiting
Never record chit-chat, debugging steps, transient errors, explanations, or file-level edits.

The user decides. An AI proposal stays "open" until the user accepts it. Only the USER's words can change an item the user decided, parked or dropped: if the AI's plan or summary contradicts a user decision, keep the user's value (the AI drifted). A user correcting or complaining ("I thought we decided…", "why are you waiting on me to…", "I meant…") restates a decision or a standing rule: record it as decided, in "Working rules" if it is a rule.

Each op:
- id: a short kebab-case slug naming the TOPIC, never the value ("extraction-model", not "use-qwen"). If the topic is already in the ledger, use op "update" with the SAME id: that is how a change of mind is tracked.
- thread: one of AT MOST 6 workstreams for the whole session, 2-3 words each. Always reuse an existing thread name if it is close. Standing rules go in "Working rules".
- title: the topic in 2-6 words ("Extraction model").
- value: the current answer, specific, at most 15 words, with names and numbers ("Qwen3 locally; Claude too costly").
- status: open | decided | done | parked | dropped | waiting
- turn: the turn index where it happened.
- kind: decision (a choice between options) | rule (a standing instruction going forward) | task (work to build, fix or ship) | question (an open question). A built feature is a task; the choice of HOW it is built is a decision.

Be economical: usually 0-6 ops per batch. Update existing items rather than adding near-duplicates.

Reply with JSON only, no prose: {"ops":[{"op":"add"|"update","id":"…","thread":"…","title":"…","value":"…","status":"…","turn":0,"kind":"…"}]}`

export function clip(text: string, head: number, tail = 0): string {
  if (text.length <= head + tail) return text
  return text.slice(0, head) + '\n[…]' + (tail ? '\n' + text.slice(-tail) : '')
}

export function renderTurns(turns: MapTurn[]): string {
  return turns
    .map(t => `### Turn ${t.idx}\nUSER: ${clip(t.human, 1800)}` + (t.ai ? `\nAI: ${clip(t.ai, 700, 1800)}` : ''))
    .join('\n\n')
}

export function toPrompt(items: MapItems): string {
  const all = Object.values(items)
  if (!all.length) return '(empty)'
  return all.map(i => `${i.id} | ${i.thread} | ${i.title} | ${i.value} | ${i.status} | t${i.turn}`).join('\n')
}

export function buildPrompt(items: MapItems, turns: MapTurn[]): string {
  return `CURRENT LEDGER (id | thread | title | value | status | last turn):\n${toPrompt(items)}\n\n` +
    `NEW TURNS:\n${renderTurns(turns)}\n\nReturn ops for the new turns only.`
}

type Op = { op?: string; id?: string; thread?: string; title?: string; value?: string; status?: string; turn?: number; kind?: string }

// The ops in a model reply; null when the reply holds no readable JSON, so a
// bad reply is retried instead of being taken as "nothing to record".
export function parseOps(text: string): Op[] | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { ops?: Op[] }
    return Array.isArray(parsed.ops) ? parsed.ops : null
  } catch {
    return null
  }
}

// What a queued turn keeps: the same cut extraction reads, so the store stays
// small however long the replies are.
export function clipTurn(t: MapTurn): MapTurn {
  return { idx: t.idx, human: clip(t.human, 1800), ai: clip(t.ai, 700, 1800) }
}

const KINDS = ['decision', 'rule', 'task', 'question']

export function applyOps(items: MapItems, ops: Op[]): { items: MapItems; changed: number } {
  const next: MapItems = JSON.parse(JSON.stringify(items))
  let changed = 0
  for (const op of ops) {
    const id = (op.id ?? '').trim().toLowerCase()
    const status = op.status as MapStatus
    if (!id || !STATUSES.includes(status) || typeof op.turn !== 'number') continue
    const kind = op.kind && KINDS.includes(op.kind) ? (op.kind as MapItem['kind']) : undefined
    const cur = next[id]
    if (!cur) {
      if (!op.title || !op.value) continue
      next[id] = {
        id, thread: op.thread || 'General', title: op.title, value: op.value, status,
        turn: op.turn, first_turn: op.turn, history: [], ...(kind ? { kind } : {}),
      }
      changed++
      continue
    }
    const value = op.value || cur.value
    if (value !== cur.value || status !== cur.status) {
      cur.history.push({ value: cur.value, status: cur.status, turn: cur.turn })
      cur.value = value
      cur.status = status
      cur.turn = op.turn
      changed++
    }
    if (op.thread) cur.thread = op.thread
    if (op.title) cur.title = op.title
    if (kind) cur.kind = kind
  }
  return { items: next, changed }
}

export function threads(items: MapItems): string[] {
  const last: Record<string, number> = {}
  for (const i of Object.values(items)) last[i.thread] = Math.max(last[i.thread] ?? -1, i.turn)
  return Object.keys(last).sort((a, b) => (last[b] ?? 0) - (last[a] ?? 0))
}

export function byThread(items: MapItems, thread: string): MapItem[] {
  return Object.values(items)
    .filter(i => i.thread === thread)
    .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || b.turn - a.turn)
}

export function priorValues(item: MapItem): string[] {
  const vals: string[] = []
  for (const h of item.history) {
    if (h.value !== item.value && vals[vals.length - 1] !== h.value) vals.push(h.value)
  }
  return vals
}

export function toText(items: MapItems): string {
  if (!Object.keys(items).length) return ''
  const lines = ['DECISION LEDGER (living-map) — what is settled in this project. The user\'s decisions win over anything older; check here before re-asking.']
  for (const th of threads(items)) {
    lines.push(`\n## ${th}`)
    for (const i of byThread(items, th)) {
      const was = priorValues(i)
      lines.push(`- [${STATUS_LABEL[i.status]}] ${i.title}: ${i.value}${was.length ? ` (was: ${was.join(' → ')})` : ''} [t${i.turn}]`)
    }
  }
  return lines.join('\n')
}

export function counts(items: MapItems): Record<MapStatus, number> {
  const c = { waiting: 0, open: 0, decided: 0, done: 0, parked: 0, dropped: 0 }
  for (const i of Object.values(items)) c[i.status]++
  return c
}
