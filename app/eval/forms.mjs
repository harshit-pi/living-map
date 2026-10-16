// Does Learn pick a fitting, concrete diagram for the question, and how fast?
// Runs the real opening move (same prompt and flags as the server) on varied
// questions, at default effort and at low effort.
//   node eval/forms.mjs            → eval/forms-results.json and .md
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyOps, completeOps, diagramOutline, outline, startAction, systemPrompt, viewLine } from '../lib.mjs'

const HOME = path.join(os.homedir(), '.living-map')
const context = (() => { try { return fs.readFileSync(path.join(HOME, 'context.md'), 'utf8').trim() } catch { return '' } })()
const TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch'

// question → forms a careful teacher would accept
const QUESTIONS = [
  ['How does the TLS handshake set up an encrypted connection?', ['sequence']],
  ['How does photosynthesis turn light into sugar?', ['concept', 'structure', 'sequence']],
  ['How did the French Revolution unfold, 1789–1799?', ['timeline']],
  ['How does a B-tree index find a row?', ['structure']],
  ['REST vs GraphQL vs gRPC: when to use which?', ['grid']],
  ['How does compound interest grow savings over 30 years?', ['grid', 'timeline', 'concept']],
  ['What does git rebase do differently from merge?', ['structure', 'sequence']],
  ['LeetCode 200: Number of Islands', ['grid', 'structure']],
  ['How does the immune system fight a new virus?', ['sequence', 'concept', 'timeline']],
  ['How do supply and demand settle a price?', ['concept', 'grid']],
  ["Bayes' theorem: what does a positive medical test really mean?", ['grid', 'concept']],
  ['How did JavaScript module systems evolve?', ['timeline']],
]

function run(question, effort) {
  return new Promise(resolve => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--append-system-prompt', systemPrompt({ purpose: 'learn', context }),
      '--tools', TOOLS, '--allowedTools', TOOLS, '--no-session-persistence',
      '--strict-mcp-config', '--mcp-config', path.join(HOME, 'empty-mcp.json'), '--setting-sources', '']
    if (effort) args.push('--effort', effort)
    const msg = [`CANVAS (learning path):\n${outline({})}`, `TOPIC DIAGRAM:\n${diagramOutline(null, {})}`,
      `ACTION: ${startAction('learn', question)}`, viewLine('visual')].join('\n\n')
    const started = Date.now()
    const child = spawn('claude', args, { cwd: path.join(HOME, 'workspace') })
    let buf = '', first = 0, result = null
    child.stdout.on('data', c => {
      buf += c
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
        let d; try { d = JSON.parse(line) } catch { continue }
        if (!first && d.type === 'stream_event' && d.event?.delta?.text) first = Date.now() - started
        if (d.type === 'result') result = d
      }
    })
    child.on('close', () => {
      const m = { nodes: {}, diagram: null, fills: {} }
      applyOps(m, completeOps(result?.result ?? ''))
      resolve({
        question, effort: effort || 'default', ms: Date.now() - started, firstMs: first,
        out: result?.usage?.output_tokens ?? 0, cost: result?.total_cost_usd ?? 0,
        form: m.diagram?.form ?? null, title: m.diagram?.title ?? '',
        diagram: m.diagram ? diagramOutline(m.diagram, {}) : '(none)',
        steps: Object.values(m.nodes).filter(n => n.parent).map(n => n.title),
      })
    })
    child.stdin.end(msg)
  })
}

const jobs = QUESTIONS.flatMap(([q]) => [[q, ''], [q, 'low']])
const results = []
let next = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const [q, e] = jobs[next++]
    const r = await run(q, e)
    results.push(r)
    console.log(`${(r.ms / 1000).toFixed(0)}s first ${(r.firstMs / 1000).toFixed(1)}s ${r.effort} ${r.form} — ${q}`)
  }
}))
const ok = r => QUESTIONS.find(([q]) => q === r.question)[1].includes(r.form)
fs.writeFileSync(new URL('./forms-results.json', import.meta.url), JSON.stringify(results, null, 1))
const rows = QUESTIONS.map(([q, want]) => {
  const d = results.find(r => r.question === q && r.effort === 'default'), l = results.find(r => r.question === q && r.effort === 'low')
  return `| ${q} | ${want.join('/')} | ${d.form}${ok(d) ? '' : ' ✗'} · ${(d.ms / 1000).toFixed(0)}s (${(d.firstMs / 1000).toFixed(1)}s) | ${l.form}${ok(l) ? '' : ' ✗'} · ${(l.ms / 1000).toFixed(0)}s (${(l.firstMs / 1000).toFixed(1)}s) |`
})
const avg = (e, k) => (results.filter(r => r.effort === e).reduce((a, r) => a + r[k], 0) / QUESTIONS.length / 1000).toFixed(1)
fs.writeFileSync(new URL('./forms-results.md', import.meta.url), [
  '| Question | Fits | Default effort: form · time (first words) | Low effort |', '|---|---|---|---|', ...rows, '',
  `Average: default ${avg('default', 'ms')}s (first ${avg('default', 'firstMs')}s); low ${avg('low', 'ms')}s (first ${avg('low', 'firstMs')}s).`,
  `Fit: default ${results.filter(r => r.effort === 'default' && ok(r)).length}/12, low ${results.filter(r => r.effort === 'low' && ok(r)).length}/12. Cost $${results.reduce((a, r) => a + r.cost, 0).toFixed(2)}.`,
  '', ...results.sort((a, b) => a.question.localeCompare(b.question) || a.effort.localeCompare(b.effort)).map(r => `### ${r.question} (${r.effort})\nSteps: ${r.steps.join(' · ')}\n\n\`\`\`\n${r.diagram}\n\`\`\`\n`),
].join('\n'))
console.log('done')
