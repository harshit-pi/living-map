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
- turn: the index of the LATEST turn in this batch that shows this value and status (where it was decided, built or changed), not the first turn that mentions the topic.
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

export function applyOps(items: MapItems, ops: Op[], sources: Record<number, string> = {}): { items: MapItems; changed: number } {
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
        ...(sources[op.turn] ? { source: sources[op.turn] } : {}),
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
      if (sources[op.turn]) cur.source = sources[op.turn]
      if (status !== 'dropped') delete cur.userDropped
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

// What a turn contributes as an item's source: the user's words, then the AI's.
export function sourceOf(t: MapTurn): string {
  const one = (x: string, n: number) => x.replace(/\s+/g, ' ').trim().slice(0, n)
  const ai = t.ai.replace(/\s+/g, ' ').trim()
  const aiPart = ai.length > 900 ? `${ai.slice(0, 350)} … ${ai.slice(-500)}` : ai
  return `You: "${one(t.human, 400)}"` + (aiPart ? ` · Claude: "${aiPart}"` : '')
}

const rank = (i: MapItem) => (i.pinned ? 0 : 1)

// The short form Claude gets with a first prompt and after a compaction:
// pinned items, what waits on the user, open questions, standing rules and the
// latest decisions. Everything else stays one map_lookup call away.
export function summaryText(items: MapItems, tool: string): string {
  const all = Object.values(items).filter(i => !i.userDropped)
  if (!all.length) return ''
  const line = (i: MapItem) => {
    const was = priorValues(i)
    return `- ${i.pinned ? '[pinned] ' : ''}[${STATUS_LABEL[i.status]}] ${i.title}: ${i.value}${was.length ? ` (was: ${was.slice(-2).join(' → ')})` : ''}`
  }
  const pick = (f: (i: MapItem) => boolean, n: number) =>
    all.filter(f).sort((a, b) => rank(a) - rank(b) || b.turn - a.turn).slice(0, n)
  const pinned = pick(i => !!i.pinned, 10)
  const seen = new Set(pinned.map(i => i.id))
  const fresh = (f: (i: MapItem) => boolean) => (i: MapItem) => !seen.has(i.id) && f(i)
  const groups: [string, MapItem[]][] = [
    ['Pinned', pinned],
    ['Waiting on the user', pick(fresh(i => i.status === 'waiting'), 8)],
    ['Open questions', pick(fresh(i => i.status === 'open'), 8)],
    ['Standing rules', pick(fresh(i => i.kind === 'rule' && (i.status === 'decided' || i.status === 'done')), 10)],
    ['Latest decisions', pick(fresh(i => (i.kind ?? 'decision') === 'decision' && (i.status === 'decided' || i.status === 'done')), 10)],
  ]
  const c = counts(items)
  const out = [
    `DECISION LEDGER (living-map): what is settled in this project. The user's decisions win over anything older.`,
    `${all.length} items in all (${c.waiting} waiting, ${c.open} open, ${c.decided} decided not built, ${c.done} done). ` +
      `Before re-asking the user about something they may have decided, call ${tool} with a few words of the topic.`,
  ]
  for (const [name, list] of groups) {
    if (!list.length) continue
    out.push(`\n## ${name}`)
    for (const i of list) { seen.add(i.id); out.push(line(i)) }
  }
  return out.join('\n')
}

// map_lookup: items whose words match the query, best first, with history and
// source; an empty query lists the workstreams.
export function lookup(items: MapItems, query: string): string {
  const all = Object.values(items)
  if (!all.length) return 'The ledger is empty: nothing has been settled in this project yet.'
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)
  if (!words.length) {
    return threads(items).map(th => {
      const list = byThread(items, th)
      return `## ${th} (${list.length})\n` + list.slice(0, 6).map(i => `- [${STATUS_LABEL[i.status]}] ${i.title}: ${i.value}`).join('\n')
    }).join('\n\n')
  }
  const score = (i: MapItem) => {
    const hay = `${i.title} ${i.title} ${i.value} ${i.thread} ${i.source ?? ''} ${i.history.map(h => h.value).join(' ')}`.toLowerCase()
    return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) + (i.pinned ? 0.5 : 0)
  }
  const hits = all.map(i => [score(i), i] as const).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || b[1].turn - a[1].turn).slice(0, 8)
  if (!hits.length) return `Nothing in the ledger matches "${query}". It may never have been decided: ask the user.`
  return hits.map(([, i]) => {
    const was = priorValues(i)
    return [
      `- [${STATUS_LABEL[i.status]}${i.userDropped ? ', dropped by the user' : ''}] ${i.title} (${i.thread}): ${i.value}`,
      was.length ? `  changed from: ${was.join(' → ')}` : '',
      i.source ? `  source (turn ${i.turn}): ${i.source}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n')
}
