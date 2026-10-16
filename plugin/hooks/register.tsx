import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MapItem, MapItems, MapMeta, MapTurn } from '../types'
import { boardSvg } from './board'
import { applyOps, buildPrompt, byThread, clipTurn, counts, parseOps, priorValues, SYSTEM, threads, toText } from './ledger'

const PANE = 'living-map'
const MODEL = 'haiku'
const BATCH = 3 // turns per extraction call: the ledger is re-sent on every call
const IDLE_MS = 90_000 // flush a smaller batch after this long without a new turn

const items = atom({ plugin: 'living-map', key: 'items' } as const, {} as MapItems)
const pending = atom({ plugin: 'living-map', key: 'pending' } as const, [] as MapTurn[])
const prompts = atom({ plugin: 'living-map', key: 'prompts' } as const, {} as Record<string, string>)
const meta = atom({ plugin: 'living-map', key: 'meta' } as const, {
  cwd: '', injected: false, turns: 0, updates: 0, tokensIn: 0, tokensOut: 0, lastError: '',
} as MapMeta)

const COLOR = {
  waiting: '#C2410C', open: '#B45309', decided: '#1D4ED8', done: '#15803D', parked: '#6B7280', dropped: '#9CA3AF',
} as const
const ICON = { waiting: '!', open: '?', decided: '●', done: '✓', parked: '⏸', dropped: '✕' } as const

let busy = false // module-level on purpose: a reload must not leave a stale lock
let idleTimer: { cancel: () => void } | undefined

const key = (kind: string, cwd: string) => `${kind}:${cwd}`
const ENGINE_ROW = /^<(command-|local-command|system-reminder|bash-|task-notification|user-prompt-submit-hook)/
const typed = (t: string) => t.replace(/<\/?pasted_content[^>]*>/g, '').trim()

// ---- persistence ----------------------------------------------------------

async function save($: EngineInterface) {
  const m = await read($, meta)
  await $.store.set(key('items', m.cwd), await read($, items))
  await $.store.set(key('pending', m.cwd), await read($, pending))
  await $.store.set(key('turns', m.cwd), m.turns)
}

async function statusLine($: EngineInterface) {
  const c = counts(await read($, items))
  const total = c.decided + c.done
  $.ui.status(total || c.waiting || c.open ? `map: ${c.waiting} waiting · ${c.open} open · ${total} settled` : undefined)
}

// ---- extraction -----------------------------------------------------------

async function flush($: EngineInterface, all = false, timeoutMs = 120_000): Promise<void> {
  if (busy) return
  const queued = await read($, pending)
  if (!queued.length || (!all && queued.length < BATCH)) return
  busy = true
  try {
    const batch = queued.slice(0, 12)
    const before = await read($, items)
    const r = await $.model.complete({
      model: MODEL,
      system: [{ text: SYSTEM, cache: true }],
      prompt: buildPrompt(before, batch),
      maxTokens: 4000,
      timeoutMs,
    })
    if (!r.isAnswered) {
      await update($, meta, m => ({ ...m, lastError: `extraction ${r.reason}` }))
      return
    }
    const ops = parseOps(r.text)
    if (!ops) {
      // keep the batch queued; the next trigger retries it
      await update($, meta, m => ({ ...m, lastError: 'extraction reply was not JSON; will retry' }))
      return
    }
    const { items: after, changed } = applyOps(before, ops)
    const done = new Set(batch.map(t => t.idx))
    await update($, items, () => after)
    await update($, pending, list => list.filter(t => !done.has(t.idx)))
    await update($, meta, m => ({
      ...m,
      updates: m.updates + (changed ? 1 : 0),
      tokensIn: m.tokensIn + (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0),
      tokensOut: m.tokensOut + (r.usage.output_tokens ?? 0),
      lastError: '',
    }))
    await save($)
    await statusLine($)
  } finally {
    busy = false
  }
  if (!(await read($, meta)).lastError && (await read($, pending)).length >= (all ? 1 : BATCH)) await flush($, all, timeoutMs)
}

// The conversation before the plugin loaded, as turns: each typed prompt with
// the assistant text that followed it, minus the turns already captured live.
// Queued once per session, the first time /map opens.
async function backfill($: EngineInterface): Promise<number> {
  const m = await read($, meta)
  if (m.backfilled) return 0
  await update($, meta, x => ({ ...x, backfilled: true }))
  const rows = await $.session.messages()
  const turns: MapTurn[] = []
  for (const row of rows) {
    const text = row.text.trim()
    if (row.role === 'user') {
      if (!text || ENGINE_ROW.test(text) || row.toolResults?.length) continue
      turns.push({ idx: 0, human: typed(text), ai: '' })
    } else if (text && turns.length) {
      const t = turns[turns.length - 1]!
      t.ai = t.ai ? `${t.ai}\n\n${text}` : text
    }
  }
  const earlier = turns.slice(0, Math.max(0, turns.length - (m.live ?? 0))) // slash commands are never turns
  if (!earlier.length) return 0
  // Number them before the live turns, so later decisions keep winning.
  const base = -earlier.length
  await update($, pending, list => [...earlier.map((t, i) => clipTurn({ ...t, idx: base + i })), ...list])
  await save($)
  return earlier.length
}

// Turns that compaction removed from the conversation: read from the session's
// transcript file on disk (too big for $.fs, so a short local script extracts
// just the typed prompts and the assistant prose).
const EXTRACT = [
  'import json, sys, glob, os, re',
  'ENGINE = re.compile(r"^<(command-|local-command|system-reminder|bash-|task-notification|user-prompt-submit-hook)")',
  'paths = glob.glob(os.path.expanduser("~/.claude/projects/*/" + sys.argv[1] + ".jsonl"))',
  'if not paths: print("[]"); sys.exit()',
  'seen, turns = set(), []',
  'for line in open(paths[0], errors="ignore"):',
  '    try: d = json.loads(line)',
  '    except Exception: continue',
  '    u = d.get("uuid")',
  '    if u in seen or d.get("isSidechain"): continue',
  '    seen.add(u)',
  '    c = (d.get("message") or {}).get("content")',
  '    t = c if isinstance(c, str) else "\\n".join(x.get("text", "") for x in (c or []) if isinstance(x, dict) and x.get("type") == "text")',
  '    t = t.strip()',
  '    if d.get("type") == "user":',
  '        if d.get("isMeta") or d.get("isCompactSummary") or not t or ENGINE.match(t): continue',
  '        turns.append({"human": re.sub(r"</?pasted_content[^>]*>", "", t).strip()[:1800], "ai": ""})',
  '    elif d.get("type") == "assistant" and t and turns:',
  '        turns[-1]["ai"] = (turns[-1]["ai"] + "\\n\\n" + t)[-6000:]',
  'print(json.dumps(turns))',
].join('\n')

async function contextTurnCount($: EngineInterface): Promise<number> {
  const rows = await $.session.messages()
  return rows.filter(r => r.role === 'user' && r.text.trim() && !ENGINE_ROW.test(r.text.trim()) && !r.toolResults?.length).length
}

async function history($: EngineInterface): Promise<number> {
  const id = await $.session.id()
  const run = await $.process.run(['python3', '-I', '-c', EXTRACT, id], { timeoutMs: 60_000 })
  if (run.exitCode !== 0) return 0
  let all: { human: string; ai: string }[] = []
  try {
    all = JSON.parse(run.stdout)
  } catch {
    return 0
  }
  const lost = all.slice(0, Math.max(0, all.length - (await contextTurnCount($))))
  if (!lost.length) return 0
  const queued = await read($, pending)
  const low = Math.min(0, ...queued.map(t => t.idx))
  const base = low - lost.length
  await update($, pending, list => [...lost.map((t, i) => clipTurn({ idx: base + i, human: t.human, ai: t.ai })), ...list])
  await save($)
  return lost.length
}

export const register: Register = on => {
  // ---- session --------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    const cwd = e.cwd
    const stored = ((await $.store.get(key('items', cwd))) ?? {}) as MapItems
    const queued = ((await $.store.get(key('pending', cwd))) ?? []) as MapTurn[]
    const turns = Number((await $.store.get(key('turns', cwd))) ?? 0)
    await update($, items, () => stored)
    await update($, pending, () => queued)
    await update($, meta, m => ({ ...m, cwd, turns, live: m.live ?? 0 }))
    await $.command.register({ name: 'map', description: 'Open the living map: what is settled, open and waiting on you' })
    await $.command.register({ name: 'map-ledger', description: 'Print the decision ledger the AI re-reads after compaction' })
    await $.command.register({ name: 'map-reset', description: "Forget this project's decision ledger" })
    await $.command.register({ name: 'map-history', description: 'Map the earlier part of this conversation that compaction removed' })
    await statusLine($)
    if (queued.length) $.clock.after(1000, () => void flush($, true))
    return next(e)
  })

  // A fresh session (or after /clear) starts knowing what is settled.
  on('prompt.submit', async ($, e, next) => {
    const m = await read($, meta)
    const text = toText(await read($, items))
    if (m.injected || !text || e.command || e.isMeta) return next(e)
    await update($, meta, x => ({ ...x, injected: true }))
    return next({ ...e, context: [...(e.context ?? []), text] })
  }).catch(($, e, next) => next(e)) // the map never blocks a prompt

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, meta, m => ({ ...m, injected: false }))
    return next(e)
  })

  // ---- capture each main-loop turn -------------------------------------------

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text) {
      await update($, prompts, p => ({ ...p, [e.turnId]: e.text }))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    const human = (await read($, prompts))[e.turnId] ?? ''
    await update($, prompts, p => {
      const { [e.turnId]: _, ...rest } = p
      return rest
    })
    if (e.reason === 'error' || e.reason === 'refusal' || (!human && !r.text)) return r
    const m = await read($, meta)
    await update($, pending, list => [...list, clipTurn({ idx: m.turns, human, ai: r.text ?? '' })])
    await update($, meta, x => ({ ...x, turns: x.turns + 1, live: (x.live ?? 0) + 1 }))
    await save($)
    idleTimer?.cancel()
    idleTimer = $.clock.after(IDLE_MS, () => void flush($, true))
    $.clock.after(10, () => void flush($))
    return r
  })

  // ---- compaction: settle the ledger first, then put it back -----------------

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    await flush($, true, 30_000) // never hold a compaction for long; the rest maps after
    const r = await next(e)
    const text = toText(await read($, items))
    if (!r.messages || !text) return r
    return { ...r, messages: [...r.messages, { role: 'user' as const, text, toolUses: [] }] }
  }).catch(($, e, next) => next(e)) // nor a compaction: replays what next settled to

  // ---- commands -------------------------------------------------------------

  on('command.run', { command: 'map' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Living map' })
    await update($, meta, m => ({ ...m, lastError: '' }))
    const first = !(await read($, meta)).backfilled
    const backfilled = (await backfill($)) + (first ? await history($) : 0)
    $.clock.after(10, () => void flush($, true))
    return {
      text: backfilled
        ? `Living map opened. Mapping the ${backfilled} turns of this conversation so far; the board fills in over the next minute or two.`
        : 'Living map opened.',
    }
  })

  on('command.run', { command: 'map-history' }, async $ => {
    const n = await history($)
    $.clock.after(10, () => void flush($, true))
    return { text: n ? `Mapping ${n} earlier turns that compaction had removed; open /map to watch them land.` : 'Nothing earlier to map: the whole conversation is already in view.' }
  })

  on('command.run', { command: 'map-ledger' }, async $ => {
    await flush($, true)
    const text = toText(await read($, items))
    return { text: text || 'The ledger is empty: nothing has been settled in this project yet.' }
  })

  on('command.run', { command: 'map-reset' }, async $ => {
    const m = await read($, meta)
    await update($, items, () => ({}))
    await update($, pending, () => [])
    await update($, meta, x => ({ ...x, backfilled: false, live: 0 }))
    await $.store.delete(key('items', m.cwd))
    await $.store.delete(key('pending', m.cwd))
    await statusLine($)
    return { text: "This project's decision ledger was cleared. Run /map to rebuild it from this conversation." }
  })

  // ---- the board ------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const all = await read($, items)
    const m = await read($, meta)
    const queued = await read($, pending)
    const c = counts(all)
    const width = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const footer =
      (queued.length ? `${queued.length} turn(s) waiting to be mapped · ` : '') +
      `${m.turns} turns seen · ~${Math.round(toText(all).length / 4).toLocaleString()} ledger tokens · ` +
      `extraction so far ${Math.round((m.tokensIn + m.tokensOut) / 1000)}k tokens` + (m.lastError ? ` · ${m.lastError}` : '')

    // Desktop draws the card board as one SVG; every other surface gets text.
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const px = Math.max(320, Math.round(width * 8))
      const board = boardSvg(all, px, footer, m.turns - 3)
      return <Svg source={board.source} alt={board.alt} width={px} height={board.height} />
    }

    const { Box, Text } = $.ui.resolve(e)
    const ths = threads(all).slice(0, 8)

    const section = (th: string) => {
      const list = byThread(all, th)
      const kind = (i: MapItem) => i.kind ?? 'decision'
      const attention = list.filter(i => i.status === 'waiting' || i.status === 'open')
      const settled = list
        .filter(i => (kind(i) === 'decision' || kind(i) === 'rule') && (i.status === 'decided' || i.status === 'done'))
        .sort((a, b) => Number(kind(a) !== 'rule') - Number(kind(b) !== 'rule') || b.turn - a.turn)
      const tasks = list.filter(i => kind(i) === 'task' && (i.status === 'decided' || i.status === 'done'))
      const parked = list.filter(i => i.status === 'parked')
      const dropped = list.filter(i => i.status === 'dropped')
      const tasksDone = tasks.filter(i => i.status === 'done').length
      return (
        <Box key={th} flexDirection="column" marginTop={1}>
          <Text bold>{th}</Text>
          {attention.slice(0, 5).map(i => (
            <Text key={i.id}>
              <Text color={COLOR[i.status]} bold>{ICON[i.status]} {i.status === 'waiting' ? 'waiting on you' : 'open'}  </Text>
              <Text bold>{i.title}</Text> — {i.value}
            </Text>
          ))}
          {attention.length > 5 && <Text dimColor>+{attention.length - 5} more open</Text>}
          {settled.slice(0, 10).map(i => {
            const was = priorValues(i)
            return (
              <Text key={i.id}>
                <Text color={i.status === 'done' ? COLOR.done : COLOR.decided}>{kind(i) === 'rule' ? '★' : ICON[i.status]} {i.title}</Text>
                {' — '}{i.value}
                {was.length > 0 && <Text dimColor>{`  ↺ was ${was[was.length - 1]}`}</Text>}
              </Text>
            )
          })}
          {settled.length > 10 && <Text dimColor>+{settled.length - 10} more settled</Text>}
          {tasks.length > 0 && <Text dimColor>Tasks: {tasksDone} done, {tasks.length - tasksDone} to build</Text>}
          {parked.length > 0 && <Text dimColor>⏸ parked: {parked.map(i => i.title).join(', ')}</Text>}
          {dropped.length > 0 && <Text dimColor>✕ dropped: {dropped.map(i => i.title).join(', ')}</Text>}
        </Box>
      )
    }

    const twoCols = width >= 110 && ths.length > 1
    const half = Math.ceil(ths.length / 2)
    return (
      <Box flexDirection="column">
        <Text bold>Where things stand</Text>
        <Text dimColor>
          {c.waiting} waiting on you · {c.open} open · {c.decided} decided, not built · {c.done} done
        </Text>
        {ths.length === 0 && (
          <Text dimColor>Nothing settled yet. The map fills in as you work: it updates every {BATCH} turns, before a compaction, and when you open it.</Text>
        )}
        {twoCols ? (
          <Box flexDirection="row">
            <Box flexDirection="column" width={Math.floor(width / 2) - 1} marginRight={2}>{ths.slice(0, half).map(section)}</Box>
            <Box flexDirection="column" width={Math.floor(width / 2) - 1}>{ths.slice(half).map(section)}</Box>
          </Box>
        ) : (
          ths.map(section)
        )}
        <Box marginTop={1}>
          <Text dimColor>
            {queued.length ? `${queued.length} turn(s) waiting to be mapped · ` : ''}
            {m.turns} turns seen · ~{Math.round(toText(all).length / 4).toLocaleString()} ledger tokens · extraction so far {Math.round((m.tokensIn + m.tokensOut) / 1000)}k tokens
            {m.lastError ? ` · ${m.lastError}` : ''}
          </Text>
        </Box>
      </Box>
    )
  })
}
