// Pure logic for the Living Map server, kept apart so it can be tested
// without starting Claude or a browser.

export const KINDS = new Set(['question', 'option', 'fact'])
export const STATUS = { question: ['open', 'answered'], option: ['proposed', 'chosen', 'dropped'], fact: ['info'] }
export const FORMS = new Set(['sequence', 'concept', 'timeline', 'structure', 'grid'])

// ---- prompts ----------------------------------------------------------------

const OPS = `Changes go in ONE fenced block that starts with \`\`\`map and holds JSON {"ops":[...]}. Write ops one per line.
Map nodes:
  {"op":"add","id":"short-kebab-id","parent":"parent id, or null for the root","kind":"question|option|fact","title":"at most 6 words","summary":"at most 14 words","status":"…"}
  {"op":"update","id":"…", plus any of title, summary, status, detail}
  {"op":"remove","id":"…"}
Kinds: question (title ends with "?"), option (a possible answer or approach), fact (evidence, a constraint, a concept or a hint). Statuses: question → open | answered; option → proposed | chosen | dropped; fact → info.
Never write "detail" when adding a node: details are written only when the user opens one (EXPLAIN).
At most 5 children under any node; prefer fewer, bigger nodes. Mark unverified facts "⚠️ verify".`

const DIAGRAM = `TOPIC DIAGRAM (learning maps only). Replace it whole with {"op":"diagram","spec":{...}}. Pick the FORM that fits the topic's shape:
- "sequence": who does what in order (protocols, algorithms step by step, processes between parties).
  {"form":"sequence","title":"…","lanes":["Client","Server"],"steps":[{"id":"s1","from":"Client","to":"Server","label":"SYN"}]}
- "concept": ideas and how they relate (theories, models, formulas' inputs).
  {"form":"concept","title":"…","nodes":[{"id":"vol","label":"Volatility","note":"≤8 words"}],"links":[{"from":"vol","to":"price","label":"raises"}]}
- "timeline": events in time (history, versions, a project).
  {"form":"timeline","title":"…","events":[{"id":"e1","when":"Jun 1914","label":"Archduke shot","note":"≤10 words"}]}
- "structure": parts inside or pointing to parts (systems, data structures, anatomy, architectures).
  {"form":"structure","title":"…","boxes":[{"id":"map","label":"Hash map","rows":["key → node"]}],"arrows":[{"from":"map","to":"n1","label":"points to"}]}
- "grid": alternatives against criteria.
  {"form":"grid","title":"…","columns":["SQL","NoSQL"],"rows":[{"label":"Schema","cells":[{"id":"c1","text":"Fixed"},{"id":"c2","text":"Flexible"}]}]}
DRAW IT ON A TINY CONCRETE EXAMPLE: real values, real names, real dates, real messages (e.g. the actual input words and the groups they land in; the actual packets with their numbers). A blank is then something the learner can work out by hand: a value, a key, a pointer, a message, a cause. Never a generic pipeline of abstract stages ("Input feeds Step feeds Output").
For coding problems, prefer the data the algorithm builds (a grid of input → computed key → where it goes, or the structure's actual state) over a flowchart of the code.
BLANKS: any step, node, event, box or cell may be a blank the learner fills: give it an "id", set "blank":true and a "prompt" (≤10 words), and leave its label/text EMPTY. Never put a blank's answer anywhere in the spec.
At most 12 elements in a diagram; short labels. Arrows mean ONE thing per diagram, and every arrow has a label.
Edit in place: when you send the diagram again, keep every element and id that stays, keep filled parts filled, and change only what the move needs.
When the learner fills a blank (FILL), judge it with {"op":"judge","id":"blank id","state":"right"|"wrong","label":"the correct text, ONLY when right"}. If wrong, say what is off in the caption without giving the answer.
In anything the learner reads, refer to a blank by what it asks, never by its id.`

const PURPOSE = {
  decide: `You are the engine behind a visual DECISION CANVAS: the user decides by acting on a map of questions and options; you answer by changing the map.
- Go deeper on a node: add 2-4 children (sub-questions, options or facts) that make it decidable.
- Only the user chooses. Never set an option to chosen; to recommend one, start its summary with "Recommended:".
- Challenge a node: re-check it against what is known; update its summary; if it no longer holds, reopen it (answered → open) and say why.
- Use tools (web search, reading files) only when the user asks or a fact decides the question.`,
  learn: `You are the engine behind a visual LEARNING CANVAS for any subject: code, protocols, maths, finance, science, history. The learner builds the understanding; you never hand over the full answer unless they press SHOW ANSWER.
- The map is the learner's PATH: the root question is the topic; its children are 3-5 STEPS (questions, open until the learner gets them right), in the order to learn them.
- The TOPIC DIAGRAM shows the subject itself in the form that fits it, with the parts the learner must discover as BLANKS (at most 3 at a time).
- HINT on a step climbs a ladder, one rung per press: 1 = add a fact under the step titled "Hint 1" with a pointed question; 2 = add or reshape a BLANK on the diagram for that step (and a fact "Hint 2" saying where to look); 3 = a fact "Hint 3" with a fully worked tiny example. Never skip rungs.
- When the learner answers a step (USER SAYS on a step), judge it: if right, set the step answered and say what they got right; if not, say which part is off, without the fix.
- SHOW ANSWER on a step: write the full answer in that step's detail (key idea first) and fill the step's blanks on the diagram.
- Prefer tiny concrete examples written as plain text.
- Talk to the learner as "you", never "the learner".`,
}

const VIEW = {
  visual: 'VIEW FOR THIS REPLY: VISUAL. Write a caption of at most 2 short sentences (no lists or headings), then the map block. Everything else lives on the canvas.',
  thread: 'VIEW FOR THIS REPLY: SIDE THREAD on one node. Answer like a short chat reply: at most 120 words of markdown, concrete, no headings. Then the map block only if that node or what is under it should change.',
  text: 'VIEW FOR THIS REPLY: TEXT. Write a full chat answer in markdown first (paragraphs, lists, tables, code as needed), then the map block so the canvas keeps up.',
}

export function systemPrompt({ purpose = 'decide', context = '' }) {
  const parts = [PURPOSE[purpose] ?? PURPOSE.decide, OPS]
  if (purpose === 'learn') parts.push(DIAGRAM)
  parts.push('EXPLAIN on a node: write that node\'s detail with an update op (markdown, at most 180 words, the key point first); the caption is one sentence.')
  parts.push('THREADS: a message may come from a thread pinned to one node. Then stay on that node: answer from its path, and change only that node or nodes under it.')
  if (context) parts.push(`BACKGROUND THE USER HAS ALREADY ESTABLISHED. Build on it, use its facts and numbers, and do not re-ask what it settles:\n\n${context}`)
  return parts.join('\n\n')
}

export const viewLine = view => VIEW[view] ?? VIEW.visual

// ---- the opening move -----------------------------------------------------------

export function startAction(purpose, title) {
  return purpose === 'learn'
    ? `start. The learner wants to understand: "${title}". Create the root question (the topic, parent null) and 3-5 steps under it in learning order. Then build the TOPIC DIAGRAM in the form that fits this topic best: the skeleton of the subject, with the 2-3 parts the learner should discover first as blanks. No solution. In the map block write the diagram op FIRST, then the root and the steps, so the picture appears before the path.`
    : `start. The user wants to decide: "${title}". Create the root question (parent null), 3-4 options under it, and up to 2 facts that frame how to judge them.`
}

// ---- what the user typed to start ------------------------------------------------

const CHROME = /^(solved|attempted|easy|medium|hard|topics|companies|premium lock icon|hint|hints?|accepted|submissions?|acceptance rate.*|seen this question in a real interview before\?.*|\d+(\.\d+)?[km]?)$/i

// A pasted problem page becomes a short title plus the full text as source
// material, so nothing past the first line is lost.
export function splitStart(text) {
  const raw = String(text ?? '').replace(/\r/g, '').trim()
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !CHROME.test(l))
  let title = lines[0] ?? 'Untitled'
  if (title.length > 100) title = title.slice(0, 100).replace(/\s+\S*$/, '') + '…'
  const rest = lines.join('\n')
  return { title, source: rest.length > title.length + 20 ? rest.slice(0, 6000) : '' }
}

// ---- reading Claude's reply ---------------------------------------------------

export function visiblePart(text) {
  return text.split('```map')[0]
}

export function hasMapBlock(text) {
  return text.includes('```map')
}

// The op objects complete so far in a streaming reply, in order. Scans the
// map block's JSON for balanced {...} objects inside the ops array, respecting
// strings, so a half-written op is never applied.
export function completeOps(text) {
  const at = text.indexOf('```map')
  if (at < 0) return []
  let body = text.slice(at + 6)
  const end = body.indexOf('```')
  if (end >= 0) body = body.slice(0, end)
  const arr = body.indexOf('[')
  if (arr < 0) return []
  const out = []
  let depth = 0, start = -1, inStr = false, esc = false
  for (let i = arr + 1; i < body.length; i++) {
    const ch = body[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') { if (depth === 0) start = i; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(body.slice(start, i + 1))) } catch { /* skip a malformed op */ }
        start = -1
      }
    } else if (ch === ']' && depth === 0) break
  }
  return out
}

// ---- the map ----------------------------------------------------------------

export function subtree(nodes, id) {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const n of Object.values(nodes)) if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true }
  }
  return out
}

export function pathTo(nodes, id) {
  const path = []
  for (let n = nodes[id]; n; n = n.parent ? nodes[n.parent] : null) path.unshift(n)
  return path
}

// Apply ops to a map ({nodes, diagram, fills}). `scope` (a node id) limits node
// changes to that node's subtree, which is how a thread stays on its node.
export function applyOps(map, ops, { scope = null, now = Date.now() } = {}) {
  const nodes = map.nodes
  let changed = 0
  const allowed = () => (scope && nodes[scope] ? subtree(nodes, scope) : null)
  for (const op of ops ?? []) {
    if (op?.op === 'diagram') {
      const spec = cleanSpec(op.spec)
      if (spec) { keepFilled(spec, map.fills ?? {}); map.diagram = spec; map.diagramAt = now; changed++ }
      continue
    }
    if (op?.op === 'judge') {
      const id = String(op.id ?? '')
      if (!id) continue
      map.fills ??= {}
      const fill = map.fills[id] ?? { text: '' }
      fill.state = op.state === 'right' ? 'right' : 'wrong'
      if (fill.state === 'right' && op.label) { fill.text = String(op.label); revealBlank(map.diagram, id, String(op.label)) }
      map.fills[id] = fill
      changed++
      continue
    }
    const id = String(op?.id ?? '').trim()
    if (!id) continue
    const inScope = allowed()
    if (op.op === 'remove') {
      if (nodes[id] && (!inScope || (inScope.has(id) && id !== scope))) { removeTree(nodes, id); changed++ }
      continue
    }
    const cur = nodes[id]
    if (op.op === 'add' && !cur) {
      const kind = KINDS.has(op.kind) ? op.kind : 'fact'
      let parent = op.parent && nodes[op.parent] ? op.parent : null
      if (!parent) parent = Object.values(nodes).find(x => !x.parent)?.id ?? null
      if (inScope && !inScope.has(parent)) parent = scope // a thread adds under its own node
      nodes[id] = {
        id, parent, kind,
        title: String(op.title ?? id).slice(0, 80),
        summary: String(op.summary ?? '').slice(0, 220),
        detail: typeof op.detail === 'string' ? op.detail : '',
        status: STATUS[kind].includes(op.status) ? op.status : STATUS[kind][0],
        by: 'claude', updatedAt: now, order: Object.keys(nodes).length, fresh: true,
      }
      changed++
    } else if (cur) {
      if (inScope && !inScope.has(id)) continue
      for (const k of ['title', 'summary', 'detail']) if (typeof op[k] === 'string') cur[k] = op[k]
      // only the user chooses
      if (op.status && STATUS[cur.kind].includes(op.status) && !(op.status === 'chosen' && cur.status !== 'chosen')) cur.status = op.status
      cur.updatedAt = now
      cur.fresh = true
      changed++
    }
  }
  return changed
}

export function removeTree(nodes, id) {
  for (const n of Object.values(nodes)) if (n.parent === id) removeTree(nodes, n.id)
  delete nodes[id]
}

export function outline(nodes) {
  const lines = []
  const walk = (parent, depth) => {
    for (const n of Object.values(nodes).filter(x => x.parent === parent).sort((a, b) => a.order - b.order)) {
      lines.push(`${'  '.repeat(depth)}- [${n.id}] ${n.kind} · ${n.status}${n.revealed ? ' · answer shown' : ''}${n.dropped ? ' · set aside by user' : ''}${n.by === 'you' ? ' (by user)' : ''} · ${n.title} — ${n.summary}${n.detail ? ' (has detail)' : ''}`)
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n') || '(empty)'
}

export function choose(nodes, id) {
  const node = nodes[id]
  if (!node || node.kind !== 'option') return null
  for (const s of Object.values(nodes)) {
    if (s.parent === node.parent && s.kind === 'option' && s.id !== id && s.status !== 'dropped') { s.status = 'dropped'; s.by = 'you' }
  }
  node.status = 'chosen'
  node.by = 'you'
  const q = nodes[node.parent]
  if (q && q.kind === 'question') { q.status = 'answered'; q.summary = `Chosen: ${node.title}` }
  return q
}

// ---- the topic diagram --------------------------------------------------------

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
const blankOf = (x, label) => (x?.blank ? { id: str(x.id, 40) || `b${Math.random().toString(36).slice(2, 7)}`, blank: true, prompt: str(x.prompt, 90), [label]: '' } : null)

// Keep only what each form needs, cap sizes, and strip any text from blanks so
// an answer can never reach the browser.
export function cleanSpec(spec) {
  if (!spec || !FORMS.has(spec.form)) return null
  const title = str(spec.title, 80)
  const cap = (a, n) => (Array.isArray(a) ? a.slice(0, n) : [])
  switch (spec.form) {
    case 'sequence': {
      // every party a step names gets a lane, even if Claude left it out of "lanes"
      const lanes = cap(spec.lanes, 6).map(l => str(l, 30)).filter(Boolean)
      for (const st of cap(spec.steps, 14)) for (const who of [str(st?.from, 30), str(st?.to, 30)])
        if (who && lanes.length < 6 && !lanes.some(l => l.toLowerCase() === who.toLowerCase())) lanes.push(who)
      return {
        form: 'sequence', title, lanes,
        steps: cap(spec.steps, 14).map((s, i) => blankOf(s, 'label') ? { ...blankOf(s, 'label'), from: str(s.from, 30), to: str(s.to, 30) }
          : { id: str(s.id, 40) || `s${i}`, from: str(s.from, 30), to: str(s.to, 30), label: str(s.label, 60) }),
      }
    }
    case 'concept':
      return {
        form: 'concept', title,
        nodes: cap(spec.nodes, 12).map((n, i) => blankOf(n, 'label') ?? { id: str(n.id, 40) || `n${i}`, label: str(n.label, 40), note: str(n.note, 70) }),
        links: cap(spec.links, 18).map(l => ({ from: str(l.from, 40), to: str(l.to, 40), label: str(l.label, 30) })),
      }
    case 'timeline':
      return {
        form: 'timeline', title,
        events: cap(spec.events, 12).map((e, i) => blankOf(e, 'label') ? { ...blankOf(e, 'label'), when: str(e.when, 20) }
          : { id: str(e.id, 40) || `e${i}`, when: str(e.when, 20), label: str(e.label, 50), note: str(e.note, 80) }),
      }
    case 'structure':
      return {
        form: 'structure', title,
        boxes: cap(spec.boxes, 12).map((b, i) => blankOf(b, 'label') ?? { id: str(b.id, 40) || `x${i}`, label: str(b.label, 40), rows: cap(b.rows, 5).map(r => str(r, 50)) }),
        arrows: cap(spec.arrows, 18).map(a => ({ from: str(a.from, 40), to: str(a.to, 40), label: str(a.label, 30) })),
      }
    case 'grid':
      return {
        form: 'grid', title, columns: cap(spec.columns, 5).map(c => str(c, 30)),
        rows: cap(spec.rows, 8).map(r => ({
          label: str(r.label, 40),
          cells: cap(r.cells, 5).map((c, j) => (typeof c === 'string' ? { id: '', text: str(c, 60) } : blankOf(c, 'text') ?? { id: str(c?.id, 40) || `c${j}`, text: str(c?.text, 60) })),
        })),
      }
  }
  return null
}

const elementsOf = spec => [spec.steps, spec.nodes, spec.events, spec.boxes, ...(spec.rows ?? []).map(r => r.cells)].filter(Boolean).flat().filter(Boolean)

// A redrawn diagram keeps what the learner already got right, even when Claude
// sends that part as a blank again or without its "filled" mark.
function keepFilled(spec, fills) {
  for (const el of elementsOf(spec)) {
    const f = fills[el.id]
    if (f?.state !== 'right') continue
    if (el.blank) { el.blank = false; delete el.prompt; if ('text' in el) el.text = f.text; else el.label = f.text }
    el.filled = true
  }
}

function revealBlank(spec, id, label) {
  if (!spec) return
  const lists = [spec.steps, spec.nodes, spec.events, spec.boxes, ...(spec.rows ?? []).map(r => r.cells)].filter(Boolean)
  for (const list of lists) {
    for (const el of list) {
      if (el && el.id === id && el.blank) {
        el.blank = false
        if ('text' in el) el.text = label
        else el.label = label
        el.filled = true
      }
    }
  }
}

// The diagram as Claude reads it back: blanks shown with what the learner typed.
export function diagramOutline(spec, fills = {}) {
  if (!spec) return '(no diagram yet)'
  const b = el => (el.blank ? `[BLANK ${el.id}: "${el.prompt}"${fills[el.id]?.text ? `, learner wrote "${fills[el.id].text}" (${fills[el.id].state ?? 'unjudged'})` : ''}]` : '')
  const lines = [`form: ${spec.form} · ${spec.title}`]
  if (spec.form === 'sequence') {
    lines.push(`lanes: ${spec.lanes.join(', ')}`)
    for (const s of spec.steps) lines.push(`- ${s.id}: ${s.from} → ${s.to}: ${s.blank ? b(s) : s.label}`)
  } else if (spec.form === 'concept') {
    for (const n of spec.nodes) lines.push(`- ${n.id}: ${n.blank ? b(n) : `${n.label}${n.note ? ` (${n.note})` : ''}`}`)
    for (const l of spec.links) lines.push(`  ${l.from} —${l.label}→ ${l.to}`)
  } else if (spec.form === 'timeline') {
    for (const e of spec.events) lines.push(`- ${e.id} ${e.when}: ${e.blank ? b(e) : e.label}`)
  } else if (spec.form === 'structure') {
    for (const x of spec.boxes) lines.push(`- ${x.id}: ${x.blank ? b(x) : `${x.label} ${x.rows?.length ? `[${x.rows.join('; ')}]` : ''}`}`)
    for (const a of spec.arrows) lines.push(`  ${a.from} —${a.label}→ ${a.to}`)
  } else if (spec.form === 'grid') {
    lines.push(`columns: ${spec.columns.join(' | ')}`)
    for (const r of spec.rows) lines.push(`- ${r.label}: ${r.cells.map(c => (c.blank ? b(c) : c.text)).join(' | ')}`)
  }
  return lines.join('\n')
}
