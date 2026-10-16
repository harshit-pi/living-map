import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MapItem, MapItems, MapMeta, MapTurn } from '../types'
import { boardSvg } from './board'
import {
  applyOps, buildPrompt, byThread, clip, clipTurn, counts, lookup, parseOps, priorValues, sourceOf,
  STATUS_LABEL, summaryText, SYSTEM, threads, toText,
} from './ledger'

const PANE = 'living-map'
const MODEL = 'haiku'
const TOOL = 'mcp__living-map__map_lookup'
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
const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`)

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
    const sources: Record<number, string> = {}
    for (const t of batch) sources[t.idx] = sourceOf(t)
    const { items: after, changed } = applyOps(before, ops, sources)
    const done = new Set(batch.map(t => t.idx))
    const now = await $.clock.now()
    await update($, items, () => after)
    await update($, pending, list => list.filter(t => !done.has(t.idx)))
    await update($, meta, m => ({
      ...m,
      updates: m.updates + (changed ? 1 : 0),
      extractions: (m.extractions ?? 0) + 1,
      lastExtractAt: now,
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

// ---- backfill -------------------------------------------------------------

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

// ---- steering from the board ----------------------------------------------

async function togglePin($: EngineInterface, id: string) {
  await update($, items, all => {
    const i = all[id]
    return i ? { ...all, [id]: { ...i, pinned: !i.pinned } } : all
  })
  await save($)
}

async function toggleDrop($: EngineInterface, id: string) {
  const m = await read($, meta)
  await update($, items, all => {
    const i = all[id]
    if (!i) return all
    if (i.userDropped) {
      const prev = i.history[i.history.length - 1]
      const { userDropped: _, ...rest } = i
      return { ...all, [id]: { ...rest, status: prev?.status ?? ('decided' as const), value: prev?.value ?? i.value, history: i.history.slice(0, -1) } }
    }
    return {
      ...all,
      [id]: { ...i, history: [...i.history, { value: i.value, status: i.status, turn: i.turn }], status: 'dropped' as const, userDropped: true, turn: m.turns },
    }
  })
  await save($)
  await statusLine($)
}

// ---- diagnosis --------------------------------------------------------------

const CHECK_SYS = `You audit a decision ledger built from a conversation between a user and an AI. For each item you get the ledger entry and the turn it came from. Decide whether that turn supports the entry: "supported" (the turn shows it, and the user decided or accepted it if it is marked decided), "partial" (right topic, but the value, status or who decided is off), or "unsupported" (the turn does not show it). Reply with JSON only: {"checks":[{"id":"…","verdict":"supported"|"partial"|"unsupported","reason":"at most 15 words"}]}`

async function doctor($: EngineInterface): Promise<string> {
  await flush($, true, 30_000)
  const m = await read($, meta)
  const all = await read($, items)
  const queued = await read($, pending)
  const now = await $.clock.now()
  const tools = (await $.tool.list()).map(t => t.name)
  const c = counts(all)
  const full = Math.round(toText(all).length / 4)
  const short = Math.round(summaryText(all, TOOL).length / 4)
  const storeKb = Math.round(JSON.stringify(all).length / 1024)
  const mark = (ok: boolean) => (ok ? '✓' : '✗')
  const lines = [
    '## living-map health',
    '',
    '| Check | State |',
    '|---|---|',
    `| ${mark(!m.lastError)} Capture | ${m.live ?? 0} turns seen this session, ${queued.length} waiting to be mapped${m.lastError ? `, error: ${m.lastError}` : ''} |`,
    `| ${mark(!!m.lastExtractAt)} Last extraction | ${m.lastExtractAt ? `${ago(now - m.lastExtractAt)} ago` : 'none yet'} (${m.extractions ?? 0} calls, ${Math.round((m.tokensIn + m.tokensOut) / 1000)}k tokens) |`,
    `| ${mark(tools.includes(TOOL))} map_lookup tool | ${tools.includes(TOOL) ? 'registered' : 'not registered'}; Claude called it ${m.lookups ?? 0} times |`,
    `| ✓ What Claude gets | a ~${short.toLocaleString()}-token summary (the full ledger is ~${full.toLocaleString()}) |`,
    `| ${mark(!!m.injected || !Object.keys(all).length)} First-prompt summary | ${m.injected ? 'given this session' : 'not given yet'} (${m.injections ?? 0} so far) |`,
    `| ✓ After compaction | summary put back ${m.compactions ?? 0} times |`,
    `| ${mark(storeKb < 2048)} Ledger store | ${Object.keys(all).length} items (${c.waiting} waiting, ${c.open} open, ${c.decided + c.done} settled), ${storeKb} KB of 4 MB |`,
  ]

  const sample = Object.values(all).filter(i => i.source && !i.userDropped).sort((a, b) => b.turn - a.turn).slice(0, 5)
  if (!sample.length) {
    lines.push('', 'Spot-check: no items with a recorded source yet. Items mapped from now on carry one.')
    return lines.join('\n')
  }
  const r = await $.model.complete({
    model: MODEL,
    system: CHECK_SYS,
    prompt: sample.map(i => `id: ${i.id}\nentry: [${STATUS_LABEL[i.status]}] ${i.title}: ${i.value}\nturn: ${i.source}`).join('\n\n'),
    maxTokens: 1500,
    timeoutMs: 60_000,
  })
  let checks: { id: string; verdict: string; reason: string }[] = []
  if (r.isAnswered) {
    try {
      const t = r.text
      checks = (JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) as { checks: typeof checks }).checks ?? []
    } catch {
      checks = []
    }
  }
  if (!checks.length) {
    lines.push('', `Spot-check: the checker gave no readable answer (${r.isAnswered ? 'not JSON' : r.reason}). Run /map-doctor again.`)
    return lines.join('\n')
  }
  const ok = checks.filter(x => x.verdict === 'supported').length
  lines.push('', `## Spot-check: ${ok}/${checks.length} recent items supported by the turn they came from`, '', '| Item | Verdict | Why |', '|---|---|---|')
  for (const x of checks) {
    const i = all[x.id]
    lines.push(`| ${i ? `${i.title}: ${clip(i.value, 60)}` : x.id} | ${x.verdict === 'supported' ? '✓ supported' : x.verdict === 'partial' ? '~ partial' : '✗ unsupported'} | ${x.reason} |`)
  }
  if (ok < checks.length) lines.push('', 'Drop a wrong item from the board: /map, pick it under Details, then Drop.')
  return lines.join('\n')
}

// ---- the details picker (desktop and terminal) ------------------------------

type Els = { Box: any; Text: any; Button: any; Select: any }

function details($: EngineInterface, els: Els, all: MapItems, m: MapMeta) {
  const { Box, Text, Button, Select } = els
  const order = (i: MapItem) => (i.pinned ? 0 : i.status === 'waiting' ? 1 : i.status === 'open' ? 2 : 3)
  const list = Object.values(all).sort((a, b) => order(a) - order(b) || b.turn - a.turn).slice(0, 60)
  if (!list.length) return null
  const i = m.focus ? all[m.focus] : undefined
  const was = i ? priorValues(i) : []
  return (
    <Box flexDirection="column" marginTop={1}>
      <Select
        key="focus"
        label="Details"
        value={i?.id}
        options={list.map(x => ({ value: x.id, label: `${x.pinned ? '◆ ' : ''}${ICON[x.status]} ${x.title}` }))}
        onSelect={(v: string) => update($, meta, x => ({ ...x, focus: v }))}
      />
      {i && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{i.pinned ? '◆ ' : ''}{i.title}</Text>
          <Text>
            <Text color={COLOR[i.status]} bold>{ICON[i.status]} {STATUS_LABEL[i.status]}{i.userDropped ? ' (by you)' : ''}</Text> · {i.thread} · turn {i.turn}
          </Text>
          <Text>{i.value}</Text>
          {was.length > 0 && <Text dimColor>↺ changed from: {was.join(' → ')}</Text>}
          <Text dimColor>{i.source ? `Where: ${i.source}` : 'Where: no source recorded (mapped before sources were kept)'}</Text>
          <Box flexDirection="row" marginTop={1}>
            <Button key="pin" label={i.pinned ? 'Unpin' : 'Pin'} onPress={() => togglePin($, i.id)} />
            <Text> </Text>
            <Button key="drop" label={i.userDropped ? 'Restore' : 'Drop'} onPress={() => toggleDrop($, i.id)} />
          </Box>
        </Box>
      )}
    </Box>
  )
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
    await $.tool.register({
      name: 'map_lookup',
      description:
        'Look up what was settled earlier in this project: decisions, standing rules, open questions, deferrals and what is waiting on the user, from the living-map decision ledger. ' +
        'Call it before re-asking the user something they may already have decided, after a compaction, or when unsure whether an earlier choice still holds. ' +
        'Pass a few words of the topic ("datastore", "merge PRs", "extraction model"); an empty query lists every workstream.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words of the topic to look up' } } },
      isDeferred: false,
    })
    await $.command.register({ name: 'map', description: 'Open the living map: what is settled, open and waiting on you' })
    await $.command.register({ name: 'map-doctor', description: 'Check the living map is working, and spot-check recent items against the turns they came from' })
    await $.command.register({ name: 'map-ledger', description: 'Print the summary Claude gets, and the full ledger' })
    await $.command.register({ name: 'map-reset', description: "Forget this project's decision ledger" })
    await $.command.register({ name: 'map-history', description: 'Map the earlier part of this conversation that compaction removed' })
    await statusLine($)
    if (queued.length) $.clock.after(1000, () => void flush($, true))
    return next(e)
  })

  // A fresh session (or after /clear) starts knowing what is settled: the
  // short summary, the rest one map_lookup away.
  on('prompt.submit', async ($, e, next) => {
    const m = await read($, meta)
    const text = summaryText(await read($, items), TOOL)
    if (m.injected || !text || e.command || e.isMeta) return next(e)
    await update($, meta, x => ({ ...x, injected: true, injections: (x.injections ?? 0) + 1 }))
    return next({ ...e, context: [...(e.context ?? []), text] })
  }).catch(($, e, next) => next(e)) // the map never blocks a prompt

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, meta, m => ({ ...m, injected: false }))
    return next(e)
  })

  // ---- Claude asks the ledger -------------------------------------------------

  on('tool.call', { tool: TOOL }, async ($, e) => {
    await flush($, true, 20_000)
    await update($, meta, m => ({ ...m, lookups: (m.lookups ?? 0) + 1 }))
    const q = e.query
    return { result: lookup(await read($, items), typeof q === 'string' ? q : '') }
  }).catch(() => ({ result: 'The living-map ledger could not be read just now; continue without it.' }))

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

  // ---- compaction: settle the ledger first, then put the summary back --------

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    await flush($, true, 30_000) // never hold a compaction for long; the rest maps after
    const r = await next(e)
    const text = summaryText(await read($, items), TOOL)
    if (!r.messages || !text) return r
    await update($, meta, m => ({ ...m, compactions: (m.compactions ?? 0) + 1 }))
    return { ...r, messages: [...r.messages, { role: 'user' as const, text, toolUses: [] }] }
  }).catch(($, e, next) => next(e)) // nor a compaction: replays what next settled to

  // ---- commands -------------------------------------------------------------

  on('command.run', { command: 'map' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Living map' })
    await update($, meta, m => ({ ...m, lastError: '', bandHidden: false }))
    const first = !(await read($, meta)).backfilled
    const backfilled = (await backfill($)) + (first ? await history($) : 0)
    $.clock.after(10, () => void flush($, true))
    return {
      text: backfilled
        ? `Living map opened. Mapping the ${backfilled} turns of this conversation so far; the board fills in over the next minute or two.`
        : 'Living map opened.',
    }
  })

  on('command.run', { command: 'map-doctor' }, async $ => ({ text: await doctor($) }))

  on('command.run', { command: 'map-history' }, async $ => {
    const n = await history($)
    $.clock.after(10, () => void flush($, true))
    return { text: n ? `Mapping ${n} earlier turns that compaction had removed; open /map to watch them land.` : 'Nothing earlier to map: the whole conversation is already in view.' }
  })

  on('command.run', { command: 'map-ledger' }, async $ => {
    await flush($, true)
    const all = await read($, items)
    const text = toText(all)
    if (!text) return { text: 'The ledger is empty: nothing has been settled in this project yet.' }
    return { text: `What Claude gets:\n\n${summaryText(all, TOOL)}\n\n---\n\nThe full ledger (via ${TOOL}):\n\n${text}` }
  })

  on('command.run', { command: 'map-reset' }, async $ => {
    const m = await read($, meta)
    await update($, items, () => ({}))
    await update($, pending, () => [])
    await update($, meta, x => ({ ...x, backfilled: false, live: 0, focus: '' }))
    await $.store.delete(key('items', m.cwd))
    await $.store.delete(key('pending', m.cwd))
    await statusLine($)
    return { text: "This project's decision ledger was cleared. Run /map to rebuild it from this conversation." }
  })

  // ---- the band above the prompt -----------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, items)
    const m = await read($, meta)
    const waiting = Object.values(all).filter(i => i.status === 'waiting' && !i.userDropped)
    if (e.props.hasSurvey || m.bandHidden || (!waiting.length && !m.lastError)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const names = waiting.slice(0, 3).map(i => i.title).join(' · ')
    return (
      <Box>
        <Text>
          <Text color={m.lastError ? COLOR.open : COLOR.waiting} bold>map </Text>
          {m.lastError
            ? <Text dimColor>{m.lastError} </Text>
            : <Text>{waiting.length} waiting on you: {names}{waiting.length > 3 ? ` +${waiting.length - 3}` : ''} </Text>}
        </Text>
        <Button key="open" label="Open map" onPress={() => $.ui.open({ id: PANE, title: 'Living map' })} />
        <Text> </Text>
        <Button key="hide" label="Hide" onPress={() => update($, meta, x => ({ ...x, bandHidden: true }))} />
      </Box>
    )
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
      `${m.turns} turns seen · Claude gets a ~${Math.round(summaryText(all, TOOL).length / 4).toLocaleString()}-token summary · ` +
      `extraction so far ${Math.round((m.tokensIn + m.tokensOut) / 1000)}k tokens` + (m.lastError ? ` · ${m.lastError}` : '')

    // Desktop draws the card board as one SVG, with the details picker below.
    if (e.surface === 'desktop') {
      const { Box, Text, Button, Select, Svg } = $.ui.resolve(e)
      const px = Math.max(320, Math.round(width * 8))
      const board = boardSvg(all, px, footer, m.turns - 3)
      return (
        <Box flexDirection="column">
          <Svg source={board.source} alt={board.alt} width={px} height={board.height} />
          {details($, { Box, Text, Button, Select }, all, m)}
        </Box>
      )
    }
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>{toText(all) || 'Nothing settled yet.'}</Text>
    }

    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const ths = threads(all).slice(0, 8)

    const section = (th: string) => {
      const list = byThread(all, th)
      const kind = (i: MapItem) => i.kind ?? 'decision'
      const attention = list.filter(i => i.status === 'waiting' || i.status === 'open')
      const settled = list
        .filter(i => (kind(i) === 'decision' || kind(i) === 'rule') && (i.status === 'decided' || i.status === 'done'))
        .sort((a, b) => Number(!a.pinned) - Number(!b.pinned) || Number(kind(a) !== 'rule') - Number(kind(b) !== 'rule') || b.turn - a.turn)
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
              <Text bold>{i.pinned ? '◆ ' : ''}{i.title}</Text> — {i.value}
            </Text>
          ))}
          {attention.length > 5 && <Text dimColor>+{attention.length - 5} more open</Text>}
          {settled.slice(0, 10).map(i => {
            const was = priorValues(i)
            return (
              <Text key={i.id}>
                <Text color={i.status === 'done' ? COLOR.done : COLOR.decided}>{i.pinned ? '◆ ' : ''}{kind(i) === 'rule' ? '★' : ICON[i.status]} {i.title}</Text>
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

    return (
      <Box flexDirection="column">
        <Text bold>Where things stand</Text>
        <Text dimColor>
          {c.waiting} waiting on you · {c.open} open · {c.decided} decided, not built · {c.done} done
        </Text>
        {ths.length === 0 && (
          <Text dimColor>Nothing settled yet. The map fills in as you work: it updates every {BATCH} turns, before a compaction, and when you open it.</Text>
        )}
        {ths.map(section)}
        {details($, { Box, Text, Button, Select }, all, m)}
        <Box marginTop={1}>
          <Text dimColor>{footer}</Text>
        </Box>
      </Box>
    )
  })
}
