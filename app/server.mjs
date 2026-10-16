// Living Map server: keeps the canvas (map, threads, topic diagram), turns
// clicks and typing into Claude turns on your local Claude Code, applies
// Claude's changes as they stream, and pushes everything to the browser.
//
//   browser ──POST /api/action──► server ──claude -p──► your Claude Code
//      ▲                            │
//      └────── GET /api/events ◄────┘  (server-sent events: canvas, text deltas)
//
// Every Claude call is stateless: it carries the background, the canvas, and
// the history of the one thread it belongs to. Input stays flat as you go.

import express from 'express'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyOps, choose, completeOps, diagramOutline, hasMapBlock, outline, pathTo, splitStart, startAction, systemPrompt, viewLine, visiblePart,
} from './lib.mjs'

const PORT = Number(process.env.PORT ?? 4317)
const HOME = path.join(os.homedir(), '.living-map')
const MAPS = path.join(HOME, 'maps')
const CWD = process.env.LIVING_MAP_CWD ?? path.join(HOME, 'workspace')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const EMPTY_MCP = path.join(HOME, 'empty-mcp.json')
const CONTEXT = path.join(HOME, 'context.md')
const CURRENT = path.join(HOME, 'current.txt')
const TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch'
const MODELS = new Set(['', 'fable', 'opus', 'sonnet', 'haiku'])
const EFFORTS = new Set(['', 'low', 'medium', 'high', 'xhigh', 'max'])
const HISTORY = 14 // messages of a thread sent with each call
for (const d of [MAPS, CWD]) fs.mkdirSync(d, { recursive: true })
if (!fs.existsSync(EMPTY_MCP)) fs.writeFileSync(EMPTY_MCP, '{"mcpServers":{}}')

const readContext = () => { try { return fs.readFileSync(CONTEXT, 'utf8').trim() } catch { return '' } }

// ---- the store ----------------------------------------------------------------

const file = id => path.join(MAPS, `${id}.json`)

function newMap(title, purpose) {
  return {
    id: randomUUID().slice(0, 8), title, purpose, createdAt: Date.now(),
    nodes: {}, chat: [], threads: {}, diagram: null, fills: {}, notes: [], history: [],
    usage: { turns: 0, input: 0, output: 0, costUsd: 0, last: null },
  }
}

function load() {
  try {
    const m = JSON.parse(fs.readFileSync(file(fs.readFileSync(CURRENT, 'utf8').trim()), 'utf8'))
    m.purpose ??= 'decide'; m.threads ??= {}; m.fills ??= {}; m.diagram ??= null
    return m
  } catch {
    return null
  }
}

function save() {
  if (!map) return
  fs.writeFileSync(file(map.id), JSON.stringify(map, null, 1))
  fs.writeFileSync(CURRENT, map.id)
}

let map = load()
let busy = false
let working = null // what Claude is doing now, for every open tab: { label, nodeId, threadId, since }
let child = null   // the running claude process, so Stop can end it
let stopped = false

const snapshot = () => {
  map.history.push(JSON.stringify({ nodes: map.nodes, diagram: map.diagram, fills: map.fills }))
  if (map.history.length > 40) map.history.shift()
}

// ---- events -------------------------------------------------------------------

const clients = new Set()
function emit(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const res of clients) res.write(data)
}
const publicMap = () => map && { ...map, history: undefined, notes: undefined, canUndo: map.history.length > 0 }
const pushMap = () => { save(); emit({ type: 'map', map: publicMap(), busy, working }) }

// ---- threads --------------------------------------------------------------------

// The main thread is map.chat; node threads live in map.threads.
const threadOf = threadId => (threadId && map.threads[threadId] ? map.threads[threadId].messages : map.chat)

function openThread(nodeId) {
  const id = randomUUID().slice(0, 8)
  const count = Object.values(map.threads).filter(t => t.nodeId === nodeId).length
  map.threads[id] = { id, nodeId, title: count ? `Fork ${count + 1}` : 'Thread', createdAt: Date.now(), messages: [] }
  return id
}

// ---- a Claude turn ---------------------------------------------------------

// Runs one stateless Claude call. Resolves as soon as the model's reply ends
// (message_stop without a pending tool call): the CLI's own "result" event and
// exit come seconds later, so cost and token counts arrive through `late`.
function runClaude(message, settings, onText) {
  return new Promise(resolve => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--append-system-prompt', systemPrompt({ purpose: map.purpose, context: readContext() }),
      '--tools', TOOLS, '--allowedTools', TOOLS, '--no-session-persistence',
      '--strict-mcp-config', '--mcp-config', EMPTY_MCP, '--setting-sources', '']
    if (settings.model) args.push('--model', settings.model)
    // Living Map's default is low effort: same diagrams in our eval (eval/forms.mjs), first words ~5s instead of ~13s
    args.push('--effort', settings.effort || 'low')
    const started = Date.now()
    const proc = spawn('claude', args, { cwd: CWD })
    child = proc
    let buf = '', text = '', lastText = '', result = null, firstAt = 0, stopReason = null, done = false
    let gotResult
    const late = new Promise(r => { gotResult = r })
    const finish = ended => {
      if (done) return
      done = true
      resolve({ ended, text, lastText, firstMs: firstAt, endMs: Date.now() - started, late })
    }
    proc.stdout.on('data', chunk => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
        let d
        try { d = JSON.parse(line) } catch { continue }
        if (d.type === 'stream_event') {
          const e = d.event
          if (e?.type === 'message_start') { lastText = ''; stopReason = null }
          if (e?.type === 'message_delta' && e.delta?.stop_reason) stopReason = e.delta.stop_reason
          if (e?.type === 'content_block_delta' && e.delta?.text) {
            if (!firstAt) firstAt = Date.now() - started
            text += e.delta.text
            lastText += e.delta.text
            onText(text)
          }
          if (e?.type === 'message_stop' && stopReason && stopReason !== 'tool_use') finish(true)
        }
        if (d.type === 'result') { result = d; gotResult(d) }
      }
    })
    proc.stderr.on('data', () => {})
    proc.on('close', () => {
      if (child === proc) child = null
      gotResult(result)
      finish(false)
    })
    proc.stdin.end(message)
  })
}

// Cost and tokens of a finished move, recorded when the CLI reports them.
function recordUsage(m, r, settings, firstMs, endMs) {
  if (!r) return
  const u = r.usage ?? {}
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  m.usage.turns++
  m.usage.input += input
  m.usage.output += u.output_tokens ?? 0
  m.usage.costUsd += r.total_cost_usd ?? 0
  const model = Object.entries(r.modelUsage ?? {}).sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0]?.[0] ?? settings.model
  m.usage.last = { input, output: u.output_tokens ?? 0, costUsd: r.total_cost_usd ?? 0, ms: endMs, firstMs, model, effort: settings.effort || 'low' }
  if (m === map) pushMap()
  else fs.writeFileSync(file(m.id), JSON.stringify(m, null, 1))
}

// One move. `thread` names where the reply goes (null = main) and, for a node
// thread, scopes Claude's changes to that node's subtree.
async function claudeTurn(action, settings, { text, selection, threadId = null, label = 'Thinking', nodeId = null } = {}) {
  if (busy) return { error: 'Claude is still working. Wait, or press Stop.' }
  busy = true
  stopped = false
  const thread = threadId ? map.threads[threadId] : null
  working = { label, nodeId: nodeId ?? thread?.nodeId ?? null, threadId, since: Date.now() }
  emit({ type: 'busy', busy: true, threadId, working })
  const scope = thread?.nodeId ?? null
  const messages = threadOf(threadId)
  const notes = map.notes.splice(0)
  const history = messages.slice(-HISTORY - 1, -1)
  const msg = [
    `CANVAS (${map.purpose === 'learn' ? 'learning path' : 'decision map'}):\n${outline(map.nodes)}`,
    map.purpose === 'learn' ? `TOPIC DIAGRAM:\n${diagramOutline(map.diagram, map.fills)}` : '',
    scope ? `THIS THREAD IS PINNED TO [${scope}]. Path from the root: ${pathTo(map.nodes, scope).map(n => `"${n.title}"`).join(' → ')}. Stay on this node.` : '',
    history.length ? `THIS THREAD SO FAR:\n${history.map(m => `${m.role === 'you' ? 'USER' : m.role === 'claude' ? 'YOU' : 'NOTE'}: ${m.text.slice(0, 1200)}`).join('\n')}` : '',
    notes.length ? `WHAT THE USER DID ON THE CANVAS SINCE YOUR LAST REPLY:\n${notes.map(n => `- ${n}`).join('\n')}` : '',
    map.source ? `THE MATERIAL THE USER PASTED AT THE START (the full problem or text):\n${map.source}` : '',
    `ACTION: ${action}`,
    selection?.length ? `SELECTED NODES: ${selection.map(id => `[${id}] ${map.nodes[id]?.title ?? id}`).join('; ')}` : '',
    text ? `USER SAYS: ${text}` : '',
    viewLine(settings.view),
  ].filter(Boolean).join('\n\n')

  for (const n of Object.values(map.nodes)) delete n.fresh
  snapshot()
  let shown = '', applied = 0, lastPush = 0
  try {
    const { ended, text: streamed, lastText, firstMs, endMs, late } = await runClaude(msg, settings, full => {
      const visible = visiblePart(full)
      if (visible.length > shown.length) { emit({ type: 'delta', text: visible.slice(shown.length), threadId }); shown = visible }
      const ops = completeOps(full)
      if (ops.length > applied) {
        applyOps(map, ops.slice(applied), { scope })
        applied = ops.length
        const now = Date.now()
        if (now - lastPush > 120) { lastPush = now; pushMap() }
      }
    })
    if (stopped) {
      messages.push({ role: 'system', text: 'Stopped.', ts: Date.now() })
      return {}
    }
    if (process.env.LM_DEBUG) console.log('[turn]', JSON.stringify({ ended, lastText: lastText.slice(0, 400), streamed: streamed.length, applied }))
    let final = lastText
    if (!ended) {
      // the process ended without a clean finish: trust only the CLI's result
      const r = await late
      if (!r || r.is_error) {
        messages.push({ role: 'system', text: `Claude did not answer (${r?.subtype ?? 'no result'}). Try again.`, ts: Date.now() })
        map.notes.unshift(...notes)
        return {}
      }
      final = r.result ?? streamed
    }
    const ops = completeOps(final)
    if (ops.length > applied) applyOps(map, ops.slice(applied), { scope })
    if (!hasMapBlock(final) && settings.view === 'visual') messages.push({ role: 'system', text: 'Claude replied without changing the canvas.', ts: Date.now() })
    messages.push({ role: 'claude', text: visiblePart(final).trim() || '(updated the canvas)', ts: Date.now(), view: settings.view })
    const m = map
    void late.then(r => recordUsage(m, r, settings, firstMs, endMs))
    return {}
  } finally {
    busy = false
    working = null
    // a check that never came back (stopped, failed) must not leave a blank stuck on "checking"
    for (const [id, f] of Object.entries(map.fills ?? {})) if (f.state === 'pending') delete map.fills[id]
    pushMap()
  }
}

// End the running turn; what streamed so far stays on the canvas.
async function stop() {
  if (!busy) return
  stopped = true
  child?.kill('SIGTERM')
  for (let i = 0; i < 50 && busy; i++) await new Promise(r => setTimeout(r, 100))
}

// ---- actions ----------------------------------------------------------------

function clean(settings = {}) {
  return {
    model: MODELS.has(settings.model) ? settings.model : '',
    effort: EFFORTS.has(settings.effort) ? settings.effort : '',
    view: settings.view === 'text' ? 'text' : 'visual',
  }
}

function local(fn) {
  snapshot()
  fn()
  pushMap()
  return {}
}

async function act({ type, nodeId, threadId, blankId, mapId, text, selection, settings: raw, purpose }) {
  const settings = clean(raw)
  if (type === 'stop') { await stop(); return {} }
  if (type === 'open') {
    // reopen an earlier map; a move still running on the current one is stopped first
    const id = String(mapId ?? '')
    if (!/^[\w-]+$/.test(id) || !fs.existsSync(file(id))) return { error: 'That map is gone.' }
    await stop()
    try { map = JSON.parse(fs.readFileSync(file(id), 'utf8')) } catch { return { error: 'That map could not be read.' } }
    map.purpose ??= 'decide'; map.threads ??= {}; map.fills ??= {}; map.diagram ??= null; map.notes ??= []; map.history ??= []
    pushMap()
    return {}
  }
  if (type === 'new') {
    await stop() // a new map always starts, even if Claude was mid-move on the old one
    const p = purpose === 'learn' ? 'learn' : 'decide'
    const { title, source } = splitStart(text)
    map = newMap(title, p)
    map.source = source
    map.chat.push({ role: 'you', text: source || title, ts: Date.now() })
    pushMap()
    return claudeTurn(startAction(p, map.title),
    settings, { label: p === 'learn' ? 'Drawing the topic and your path' : 'Laying out the options' })
  }
  if (!map) return { error: 'Start first.' }
  const node = map.nodes[nodeId]
  const named = node ? `[${nodeId}] "${node.title}"` : ''
  const say = (t, tid = null) => { threadOf(tid).push({ role: 'you', text: t, ts: Date.now() }); pushMap() }

  switch (type) {
    case 'purpose':
      map.purpose = purpose === 'learn' ? 'learn' : 'decide'
      map.notes.push(`Switched the canvas to ${map.purpose} mode.`)
      pushMap()
      if (map.purpose === 'learn' && !map.diagram && !busy)
        return claudeTurn('the canvas was switched to LEARN mode. Keep the root; under it make 3-5 step questions in learning order (keep useful existing nodes, set the rest aside by removing them only if they are options), and build the TOPIC DIAGRAM with 2-3 blanks. Write the diagram op first.', settings, { label: 'Turning this into a learning path' })
      return {}
    case 'choose': {
      if (!node || node.kind !== 'option') return { error: 'Only an option can be chosen.' }
      return local(() => {
        const q = choose(map.nodes, nodeId)
        map.notes.push(`Chose "${node.title}"${q ? ` for "${q.title}"` : ''}; the other options under it are set aside.`)
        map.chat.push({ role: 'you', text: `Chose ${node.title}`, ts: Date.now() })
      })
    }
    case 'drop':
      if (!node) return { error: 'No such node.' }
      return local(() => {
        if (node.kind === 'option') node.status = 'dropped'
        node.dropped = true; node.by = 'you'
        map.notes.push(`Set aside "${node.title}"; do not raise it again unless asked.`)
      })
    case 'restore':
      if (!node) return { error: 'No such node.' }
      return local(() => {
        delete node.dropped
        if (node.kind === 'option') node.status = 'proposed'
        if (node.kind === 'question' && !node.revealed) node.status = 'open'
        map.notes.push(`Restored "${node.title}".`)
      })
    case 'undo': {
      if (!map.history.length) return {}
      const prev = JSON.parse(map.history.pop())
      map.nodes = prev.nodes; map.diagram = prev.diagram; map.fills = prev.fills
      map.notes.push('Undid the last change to the canvas.')
      pushMap()
      return {}
    }
    case 'fork': {
      if (!node) return { error: 'No such node.' }
      const id = openThread(nodeId)
      pushMap()
      return { threadId: id }
    }
    case 'thread': {
      // a message in a thread pinned to a node (opens one if needed)
      if (!node) return { error: 'No such node.' }
      const tid = threadId && map.threads[threadId] ? threadId : openThread(nodeId)
      say(String(text ?? ''), tid)
      const r = await claudeTurn(
        map.purpose === 'learn' && node.kind === 'question'
          ? `the learner wrote in the thread on step ${named}. If it is an answer to the step, judge it; otherwise answer their question about this step.`
          : `the user wrote in the thread on ${named}.`,
        { ...settings, view: 'thread' }, { text, threadId: tid, label: 'Replying in the thread' })
      return { ...r, threadId: tid }
    }
    case 'fill': {
      if (!blankId) return { error: 'No blank.' }
      map.fills[blankId] = { text: String(text ?? '').slice(0, 200), state: 'pending' }
      map.chat.push({ role: 'you', text: `Filled a blank: ${text}`, ts: Date.now() })
      pushMap()
      return claudeTurn(`FILL: the learner wrote "${text}" in blank ${blankId} on the topic diagram. Judge it with a judge op.`, settings, { label: 'Checking your answer' })
    }
    case 'explain':
      if (!node) return { error: 'No such node.' }
      return claudeTurn(`EXPLAIN ${named}: write its detail. Required: an update op on "${nodeId}" with a "detail" field.`, settings, { label: 'Writing the explanation', nodeId })
    case 'deeper':
      say(`Go deeper: ${node?.title}`)
      return claudeTurn(`go deeper on ${named}.`, settings, { label: map.purpose === 'learn' ? 'Breaking it into smaller steps' : 'Going deeper', nodeId })
    case 'challenge':
      say(`Challenge: ${node?.title}`)
      return claudeTurn(`challenge ${named}: does it still hold?`, settings, { label: 'Re-checking it', nodeId })
    case 'hint':
      say(`Hint: ${node?.title}`)
      return claudeTurn(`HINT on step ${named}: the next rung of the ladder (it has ${Object.values(map.nodes).filter(n => n.parent === nodeId && /^hint\b/i.test(n.title)).length} hint(s) so far).`, settings, { label: 'Finding the next hint', nodeId })
    case 'answer': {
      say(`Show answer: ${node?.title}`)
      const r = await claudeTurn(`SHOW ANSWER on step ${named}. Required: an update op on "${nodeId}" with the full answer in its "detail" field; fill this step's blanks with judge ops (state right, with the label).`, settings, { label: 'Writing the answer', nodeId })
      // a shown answer is not one the learner earned: never credit it as solved
      if (map.nodes[nodeId]) { map.nodes[nodeId].revealed = true; pushMap() }
      return r
    }
    case 'next':
      say('Next')
      return claudeTurn(map.purpose === 'learn'
        ? 'next: point the learner at the next open step and make its first move clear, without solving it.'
        : 'next: take the most important open question and make it decidable, or if nothing is open, say what is decided and what remains.', settings, { label: 'Working out the next step' })
    case 'message':
      say(String(text ?? ''))
      return claudeTurn('the user typed in the main conversation (selected nodes, if any, are its context).', settings, { text, selection, label: 'Answering' })
    default:
      return { error: `Unknown action ${type}` }
  }
}

// ---- http -------------------------------------------------------------------

const app = express()
app.use(express.json({ limit: '1mb' }))
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders()
  clients.add(res)
  res.write(`data: ${JSON.stringify({ type: 'map', map: publicMap(), busy, working })}\n\n`)
  req.on('close', () => clients.delete(res))
})
app.post('/api/action', async (req, res) => res.json(await act(req.body ?? {})))
// Every saved map, newest first, for the list in the header and on the start screen.
app.get('/api/maps', (_, res) => {
  const out = []
  for (const f of fs.readdirSync(MAPS)) {
    if (!f.endsWith('.json')) continue
    try {
      const m = JSON.parse(fs.readFileSync(path.join(MAPS, f), 'utf8'))
      const nodes = Object.values(m.nodes ?? {})
      if (!nodes.length && !m.diagram) continue
      const steps = nodes.filter(n => n.kind === 'question' && n.parent)
      out.push({
        id: m.id, title: m.title, purpose: m.purpose ?? 'decide', updatedAt: fs.statSync(path.join(MAPS, f)).mtimeMs,
        nodes: nodes.length, open: steps.filter(n => n.status === 'open').length, done: steps.filter(n => n.status === 'answered').length,
        form: m.diagram?.form ?? null, current: m.id === map?.id,
      })
    } catch { /* skip a broken file */ }
  }
  res.json(out.sort((a, b) => b.updatedAt - a.updatedAt))
})
app.get('/api/context', (_, res) => res.json({ text: readContext() }))
app.post('/api/context', (req, res) => {
  fs.writeFileSync(CONTEXT, String(req.body?.text ?? ''))
  res.json({ ok: true })
})
app.use(express.static(path.join(HERE, 'dist')))
app.get('*', (_, res) => res.sendFile(path.join(HERE, 'dist', 'index.html')))
app.listen(PORT, '127.0.0.1', () => console.log(`Living Map on http://localhost:${PORT}  (Claude works in ${CWD})`))
