// The card board as one SVG, laid out the way the scored PNG boards were:
// a block per workstream, what needs you as cards (colour bar + icon + word,
// never colour alone), every settled decision and rule as a row, tasks as a
// count. Text is wrapped by hand: SVG has no line wrapping.
import type { MapItem, MapItems } from '../types'
import { byThread, counts, priorValues, STATUS_LABEL, threads } from './ledger'

const COLOR = {
  waiting: '#C2410C', open: '#B45309', decided: '#1D4ED8', done: '#15803D', parked: '#6B7280', dropped: '#9CA3AF',
} as const
const ICON = { waiting: '!', open: '?', decided: '●', done: '✓', parked: '⏸', dropped: '✕' } as const

const PAD = 16
const GAP = 14
const MIN_COL = 250
const MAX_COLS = 4
const MAX_CARDS = 5
const MAX_SETTLED = 10

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Greedy word wrap by an average glyph width; long words are cut.
function wrap(text: string, width: number, px: number, maxLines: number): string[] {
  const per = Math.max(8, Math.floor(width / px))
  const lines: string[] = []
  let cur = ''
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > per) {
      if (cur) { lines.push(cur); cur = '' }
      lines.push(word.slice(0, per - 1) + '-')
      word = word.slice(per - 1)
    }
    if (!cur) cur = word
    else if ((cur + ' ' + word).length <= per) cur += ' ' + word
    else { lines.push(cur); cur = word }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = kept[maxLines - 1]!.replace(/.{0,2}$/, '') + '…'
    return kept
  }
  return lines
}

type Block = { svg: string[]; height: number }

function threadBlock(all: MapItems, th: string, x: number, y0: number, w: number, recentFrom: number): Block {
  const out: string[] = []
  let y = y0
  const kind = (i: MapItem) => i.kind ?? 'decision'
  const list = byThread(all, th)
  const attention = list.filter(i => (i.status === 'waiting' || i.status === 'open') && !i.userDropped)
    .sort((a, b) => Number(!a.pinned) - Number(!b.pinned))
  const settled = list
    .filter(i => (kind(i) === 'decision' || kind(i) === 'rule') && (i.status === 'decided' || i.status === 'done'))
    .sort((a, b) => Number(!a.pinned) - Number(!b.pinned) || Number(kind(a) !== 'rule') - Number(kind(b) !== 'rule') || b.turn - a.turn)
  const tasks = list.filter(i => kind(i) === 'task' && (i.status === 'decided' || i.status === 'done'))
  const parked = list.filter(i => i.status === 'parked')
  const dropped = list.filter(i => i.status === 'dropped')

  for (const line of wrap(th, w, 8.4, 2)) {
    y += 18
    out.push(`<text x="${x}" y="${y}" class="t" font-size="15" font-weight="600">${esc(line)}</text>`)
  }
  y += 8
  out.push(`<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y}" class="rule" stroke-width="2"/>`)
  y += 10

  for (const i of attention.slice(0, MAX_CARDS)) {
    const c = COLOR[i.status]
    const inner = w - 22
    const title = wrap(`${i.pinned ? '◆ ' : ''}${i.title}`, inner, 8, 2)
    const value = wrap(i.value, inner, 7, 4)
    const h = 12 + 14 + title.length * 18 + value.length * 17 + 8
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" class="card"/>`)
    out.push(`<rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${c}"/>`)
    let ty = y + 19
    const isNew = i.turn >= recentFrom ? ` <tspan fill="${COLOR.waiting}">•</tspan>` : ''
    out.push(`<text x="${x + 15}" y="${ty}" font-size="11" font-weight="700" fill="${c}" letter-spacing=".04em">${ICON[i.status]} ${esc(STATUS_LABEL[i.status].toUpperCase())}${isNew}</text>`)
    for (const l of title) { ty += 18; out.push(`<text x="${x + 15}" y="${ty}" class="t" font-size="14" font-weight="600">${esc(l)}</text>`) }
    for (const l of value) { ty += 17; out.push(`<text x="${x + 15}" y="${ty}" class="t" font-size="13">${esc(l)}</text>`) }
    y += h + 8
  }
  if (attention.length > MAX_CARDS) {
    y += 14
    out.push(`<text x="${x}" y="${y}" class="s" font-size="12">+${attention.length - MAX_CARDS} more open</text>`)
    y += 6
  }

  if (settled.length) {
    y += 16
    out.push(`<text x="${x}" y="${y}" class="s" font-size="11" font-weight="700" letter-spacing=".06em">SETTLED</text>`)
    y += 4
  }
  for (const i of settled.slice(0, MAX_SETTLED)) {
    const c = i.status === 'done' ? COLOR.done : COLOR.decided
    const mark = kind(i) === 'rule' ? '★' : ICON[i.status]
    const was = priorValues(i)
    const head = wrap(`${i.pinned ? '◆ ' : ''}${mark} ${i.title}`, w, 7.6, 2)
    const value = wrap(i.value, w - 12, 6.8, 3)
    for (const l of head) { y += 17; out.push(`<text x="${x}" y="${y}" font-size="13" font-weight="600" fill="${c}">${esc(l)}</text>`) }
    for (const l of value) { y += 16; out.push(`<text x="${x + 12}" y="${y}" class="t" font-size="12.5">${esc(l)}</text>`) }
    if (was.length) {
      for (const l of wrap(`↺ was ${was[was.length - 1]}`, w - 12, 6.4, 2)) {
        y += 15
        out.push(`<text x="${x + 12}" y="${y}" class="s" font-size="11.5">${esc(l)}</text>`)
      }
    }
    y += 5
  }
  if (settled.length > MAX_SETTLED) {
    y += 14
    out.push(`<text x="${x}" y="${y}" class="s" font-size="12">+${settled.length - MAX_SETTLED} more settled</text>`)
  }

  const meta: string[] = []
  if (tasks.length) {
    const done = tasks.filter(i => i.status === 'done').length
    meta.push(`Tasks: ${done} done, ${tasks.length - done} to build`)
  }
  if (parked.length) meta.push(`⏸ parked: ${parked.map(i => i.title).join(', ')}`)
  for (const line of meta) {
    for (const l of wrap(line, w, 6.6, 3)) { y += 16; out.push(`<text x="${x}" y="${y}" class="s" font-size="12">${esc(l)}</text>`) }
  }
  if (dropped.length) {
    for (const l of wrap(`✕ dropped: ${dropped.map(i => i.title).join(', ')}`, w, 6.6, 3)) {
      y += 16
      out.push(`<text x="${x}" y="${y}" class="s" font-size="12" text-decoration="line-through">${esc(l)}</text>`)
    }
  }
  return { svg: out, height: y - y0 + 8 }
}

export function boardSvg(all: MapItems, width: number, footer: string, recentFrom: number): { source: string; height: number; alt: string } {
  const c = counts(all)
  const ths = threads(all).slice(0, 12)
  const cols = Math.max(1, Math.min(MAX_COLS, Math.floor((width - PAD * 2 + GAP) / (MIN_COL + GAP))))
  const colW = Math.floor((width - PAD * 2 - GAP * (cols - 1)) / cols)
  const body: string[] = []
  let y = PAD

  y += 22
  body.push(`<text x="${PAD}" y="${y}" class="t" font-size="20" font-weight="700">Where things stand</text>`)
  y += 22
  body.push(`<text x="${PAD}" y="${y}" class="s" font-size="13">${c.waiting} waiting on you · ${c.open} open · ${c.decided} decided, not built · ${c.done} done</text>`)
  y += 12
  let lx = PAD
  const legend: [keyof typeof COLOR, string][] = [['waiting', 'waiting on you'], ['open', 'open'], ['decided', 'decided, not built'], ['done', 'done']]
  for (const [s, label] of legend) {
    if (lx + 30 + label.length * 6.5 > width - PAD) { lx = PAD; y += 22 }
    body.push(`<circle cx="${lx + 8}" cy="${y + 10}" r="8" fill="${COLOR[s]}"/><text x="${lx + 8}" y="${y + 14}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${ICON[s]}</text>`)
    body.push(`<text x="${lx + 21}" y="${y + 14}" class="s" font-size="12">${label}</text>`)
    lx += 30 + label.length * 6.5 + 12
  }
  if (lx + 120 <= width - PAD) {
    body.push(`<text x="${lx + 2}" y="${y + 14}" font-size="13" fill="${COLOR.decided}">★</text><text x="${lx + 18}" y="${y + 14}" class="s" font-size="12">standing rule</text>`)
  }
  y += 34

  if (!ths.length) {
    y += 8
    body.push(`<text x="${PAD}" y="${y}" class="s" font-size="13">Nothing settled yet. The map fills in as you work.</text>`)
    y += 12
  }
  for (let r = 0; r < ths.length; r += cols) {
    let rowH = 0
    ths.slice(r, r + cols).forEach((th, k) => {
      const b = threadBlock(all, th, PAD + k * (colW + GAP), y, colW, recentFrom)
      body.push(...b.svg)
      rowH = Math.max(rowH, b.height)
    })
    y += rowH + 18
  }
  for (const l of wrap(footer, width - PAD * 2, 6.4, 3)) {
    y += 15
    body.push(`<text x="${PAD}" y="${y}" class="s" font-size="11.5">${esc(l)}</text>`)
  }
  const height = Math.ceil(y + PAD)
  const style = `<style>
text{font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif}
.t{fill:#1F2937}.s{fill:#6B7280}.card{fill:#FFFFFF;stroke:#E5E7EB}.rule{stroke:#E5E7EB}
@media (prefers-color-scheme: dark){.t{fill:#E5E7EB}.s{fill:#9CA3AF}.card{fill:#1F2937;stroke:#374151}.rule{stroke:#374151}}
</style>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${style}${body.join('')}</svg>`
  const alt = `Living map: ${c.waiting} waiting on you, ${c.open} open, ${c.decided} decided not built, ${c.done} done, across ${ths.length} workstreams.`
  return { source, height, alt }
}
