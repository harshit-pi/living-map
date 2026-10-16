export type Kind = 'question' | 'option' | 'fact'
export type Status = 'open' | 'answered' | 'proposed' | 'chosen' | 'dropped' | 'info'
export type Purpose = 'decide' | 'learn'
export type View = 'visual' | 'text'

export type MapNode = {
  id: string
  parent: string | null
  kind: Kind
  title: string
  summary: string
  detail: string
  status: Status
  by: 'claude' | 'you'
  updatedAt: number
  order: number
  dropped?: boolean
  fresh?: boolean
  revealed?: boolean
}

export type ChatLine = { role: 'you' | 'claude' | 'system'; text: string; ts: number; view?: View | 'thread' }
export type Thread = { id: string; nodeId: string; title: string; createdAt: number; messages: ChatLine[] }

// The topic diagram (Learn). A blank has `blank: true`, a `prompt`, and no answer.
type Blankable = { id: string; blank?: boolean; prompt?: string; filled?: boolean }
export type SeqStep = Blankable & { from: string; to: string; label: string }
export type ConceptNode = Blankable & { label: string; note?: string }
export type Link = { from: string; to: string; label: string }
export type TimeEvent = Blankable & { when: string; label: string; note?: string }
export type Box = Blankable & { label: string; rows?: string[] }
export type Cell = Blankable & { text: string }
export type Diagram =
  | { form: 'sequence'; title: string; lanes: string[]; steps: SeqStep[] }
  | { form: 'concept'; title: string; nodes: ConceptNode[]; links: Link[] }
  | { form: 'timeline'; title: string; events: TimeEvent[] }
  | { form: 'structure'; title: string; boxes: Box[]; arrows: Link[] }
  | { form: 'grid'; title: string; columns: string[]; rows: { label: string; cells: Cell[] }[] }
export type Fill = { text: string; state: 'pending' | 'right' | 'wrong' }

export type Usage = {
  turns: number; input: number; output: number; costUsd: number
  last: { input: number; output: number; costUsd: number; ms: number; firstMs?: number; model?: string; effort?: string } | null
}

export type MapDoc = {
  id: string
  title: string
  purpose: Purpose
  nodes: Record<string, MapNode>
  chat: ChatLine[]
  threads: Record<string, Thread>
  diagram: Diagram | null
  diagramAt?: number
  fills: Record<string, Fill>
  usage: Usage
  canUndo: boolean
}

export type Working = { label: string; nodeId: string | null; threadId: string | null; since: number }

export type Settings = { model: string; effort: string; view: View }

export type NodeAction = 'choose' | 'drop' | 'restore' | 'deeper' | 'challenge' | 'explain' | 'hint' | 'answer'

export type Action =
  | { type: 'new'; text: string; purpose: Purpose }
  | { type: NodeAction; nodeId: string }
  | { type: 'thread'; nodeId: string; threadId?: string; text: string }
  | { type: 'fork'; nodeId: string }
  | { type: 'fill'; blankId: string; text: string }
  | { type: 'message'; text: string; selection: string[] }
  | { type: 'purpose'; purpose: Purpose }
  | { type: 'next' | 'undo' | 'stop' }
  | { type: 'open'; mapId: string }

export type MapSummary = {
  id: string; title: string; purpose: Purpose; updatedAt: number
  nodes: number; open: number; done: number; form: string | null; current: boolean
}
