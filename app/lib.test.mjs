import test from 'node:test'
import assert from 'node:assert/strict'
import { applyOps, choose, cleanSpec, completeOps, diagramOutline, outline, pathTo, splitStart, systemPrompt, visiblePart } from './lib.mjs'

const FULL = 'Added two options.\n```map\n{"ops":[\n{"op":"add","id":"q","parent":null,"kind":"question","title":"Which DB?","summary":"Pick one","status":"open"},\n{"op":"add","id":"pg","parent":"q","kind":"option","title":"Postgres","summary":"Relational, {braces} in \\"quotes\\"","status":"proposed"}\n]}\n```'
const fresh = () => ({ nodes: {}, diagram: null, fills: {} })

test('streaming: only complete ops are returned, at every cut point', () => {
  let last = 0
  for (let i = 0; i <= FULL.length; i++) {
    const ops = completeOps(FULL.slice(0, i))
    assert.ok(ops.length >= last)
    for (const op of ops) assert.ok(op.id)
    last = ops.length
  }
  assert.equal(last, 2)
  assert.equal(completeOps(FULL)[1].summary, 'Relational, {braces} in "quotes"')
  assert.equal(visiblePart(FULL).trim(), 'Added two options.')
})

test('ops build the tree; details stay lazy; Claude cannot choose', () => {
  const m = fresh()
  applyOps(m, completeOps(FULL))
  applyOps(m, [{ op: 'add', id: 'x', parent: 'nope', kind: 'fact', title: 'Stray' }, { op: 'update', id: 'pg', status: 'chosen' }])
  assert.equal(m.nodes.x.parent, 'q')
  assert.equal(m.nodes.pg.detail, '')
  assert.equal(m.nodes.pg.status, 'proposed')
  choose(m.nodes, 'pg')
  assert.equal(m.nodes.pg.status, 'chosen')
  assert.equal(m.nodes.q.status, 'answered')
})

test('a thread only changes its own node and what is under it', () => {
  const m = fresh()
  applyOps(m, completeOps(FULL))
  applyOps(m, [{ op: 'add', id: 'my', parent: 'q', kind: 'option', title: 'MySQL' }])
  // thread pinned to pg: may update pg, may add under pg, may not touch q or my
  applyOps(m, [
    { op: 'update', id: 'pg', summary: 'changed' },
    { op: 'update', id: 'my', summary: 'should not change' },
    { op: 'add', id: 'ext', parent: 'q', kind: 'fact', title: 'Extensions' },
    { op: 'remove', id: 'my' },
  ], { scope: 'pg' })
  assert.equal(m.nodes.pg.summary, 'changed')
  assert.notEqual(m.nodes.my.summary, 'should not change')
  assert.equal(m.nodes.ext.parent, 'pg', 'additions land under the thread node')
  assert.ok(m.nodes.my, 'cannot remove outside its node')
  assert.deepEqual(pathTo(m.nodes, 'ext').map(n => n.id), ['q', 'pg', 'ext'])
})

test('a blank never carries its answer to the browser', () => {
  const spec = cleanSpec({
    form: 'sequence', title: 'TCP', lanes: ['Client', 'Server'],
    steps: [{ id: 's1', from: 'Client', to: 'Server', label: 'SYN' }, { id: 'b1', from: 'Server', to: 'Client', label: 'SYN-ACK', blank: true, prompt: 'What comes back?' }],
  })
  assert.equal(spec.steps[1].label, '', 'answer stripped')
  assert.equal(spec.steps[1].blank, true)
  assert.equal(cleanSpec({ form: 'pie' }), null, 'unknown forms are refused')
})

test('judging right fills the blank; wrong leaves it blank', () => {
  const m = fresh()
  applyOps(m, [{ op: 'diagram', spec: { form: 'grid', title: 'DBs', columns: ['SQL', 'NoSQL'], rows: [{ label: 'Schema', cells: [{ id: 'c1', text: 'Fixed' }, { id: 'c2', blank: true, prompt: 'NoSQL schema?' }] }] } }])
  m.fills.c2 = { text: 'rigid', state: 'pending' }
  applyOps(m, [{ op: 'judge', id: 'c2', state: 'wrong' }])
  assert.equal(m.fills.c2.state, 'wrong')
  assert.equal(m.diagram.rows[0].cells[1].blank, true)
  applyOps(m, [{ op: 'judge', id: 'c2', state: 'right', label: 'Flexible' }])
  assert.equal(m.diagram.rows[0].cells[1].text, 'Flexible')
  assert.equal(m.diagram.rows[0].cells[1].blank, false)
  assert.match(diagramOutline(m.diagram, m.fills), /Schema: Fixed \| Flexible/)
  // Claude redraws the grid and sends the solved cell as a blank again: it stays solved
  applyOps(m, [{ op: 'diagram', spec: { form: 'grid', title: 'DBs', columns: ['SQL', 'NoSQL'], rows: [{ label: 'Schema', cells: [{ id: 'c1', text: 'Fixed' }, { id: 'c2', blank: true, prompt: '?' }] }] } }])
  assert.equal(m.diagram.rows[0].cells[1].text, 'Flexible')
  assert.equal(m.diagram.rows[0].cells[1].filled, true)
})

test('every diagram form survives cleaning', () => {
  const forms = [
    { form: 'concept', nodes: [{ id: 'a', label: 'A' }, { id: 'b', blank: true, prompt: '?' }], links: [{ from: 'a', to: 'b', label: 'causes' }] },
    { form: 'timeline', events: [{ id: 'e1', when: '1914', label: 'War' }] },
    { form: 'structure', boxes: [{ id: 'm', label: 'Map', rows: ['k → n'] }], arrows: [{ from: 'm', to: 'n', label: 'to' }] },
  ]
  for (const f of forms) assert.ok(cleanSpec(f), f.form)
})

test('outline and prompts', () => {
  const m = fresh()
  applyOps(m, completeOps(FULL))
  assert.match(outline(m.nodes), /- \[q\] question · open/)
  const learn = systemPrompt({ purpose: 'learn', context: 'CTX' })
  assert.match(learn, /TOPIC DIAGRAM/)
  assert.match(learn, /CTX/)
  assert.doesNotMatch(systemPrompt({}), /TOPIC DIAGRAM/)
})

test('a pasted problem page keeps its full text; the title drops the page chrome', () => {
  const page = '49. Group Anagrams\nSolved\nMedium\nTopics\npremium lock icon\nCompanies\nGiven an array of strings strs, group the anagrams together. You can return the answer in any order.\nExample 1:'
  const { title, source } = splitStart(page)
  assert.equal(title, '49. Group Anagrams')
  assert.match(source, /in any order\.\nExample 1:/)
  assert.doesNotMatch(source, /premium lock icon|Solved/)
  assert.deepEqual(splitStart('Why did WW1 start?'), { title: 'Why did WW1 start?', source: '' })
})

test('a sequence step naming a party outside the lanes gets its own lane', () => {
  const spec = cleanSpec({ form: 'sequence', lanes: ['Virus', 'Cell'], steps: [{ id: 's1', from: 'Virus', to: 'Cell', label: 'enters' }, { id: 's2', from: 'T cell', to: 'cell', label: 'kills' }] })
  assert.deepEqual(spec.lanes, ['Virus', 'Cell', 'T cell'])
})
