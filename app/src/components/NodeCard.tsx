import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { MapNode, Purpose } from '../types'
import { NODE_W } from '../layout'
import { lookOf } from './look'

export type CardData = { node: MapNode; purpose: Purpose; threads: number; working: boolean }

export function NodeCard({ data, selected }: NodeProps) {
  const { node: n, purpose, threads, working } = data as CardData
  const l = lookOf(n, purpose)
  const recommended = n.summary.startsWith('Recommended:')
  const gone = n.dropped || n.status === 'dropped'
  return (
    <div style={{ width: NODE_W }}
      className={`rounded-xl px-3 py-2.5 shadow-sm ${l.box} ${selected ? 'ring-2 ring-cl-accent ring-offset-2 ring-offset-cl-bg' : ''} ${n.fresh ? 'fresh' : ''} ${working ? 'is-working' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${l.tagCls}`}>{l.tag}</span>
        <span className="flex items-center gap-1">
          {recommended && !gone && <span className="rounded-full bg-orange-100 px-1.5 text-[10px] font-semibold text-cl-accentDk">★ recommended</span>}
          {n.detail && <span className="text-[10px] text-cl-faint" title="Has an explanation">≡</span>}
          {threads > 0 && <span className="rounded-full bg-cl-panel px-1.5 text-[10px] text-cl-mute ring-1 ring-cl-line" title="Side threads">💬 {threads}</span>}
        </span>
      </div>
      <div className={`mt-0.5 text-[15px] font-semibold leading-snug ${l.title}`}>{n.title}</div>
      {n.summary && <div className="mt-0.5 whitespace-pre-line text-[13px] leading-snug text-cl-text">{n.summary.replace(/^Recommended:\s*/, '')}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
