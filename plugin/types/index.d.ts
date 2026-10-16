export type MapStatus = 'waiting' | 'open' | 'decided' | 'done' | 'parked' | 'dropped'
export type MapKind = 'decision' | 'rule' | 'task' | 'question'
export type MapHistory = { value: string; status: MapStatus; turn: number }
export type MapItem = {
  id: string
  thread: string
  title: string
  value: string
  status: MapStatus
  turn: number
  first_turn: number
  history: MapHistory[]
  kind?: MapKind
  source?: string // the turn that last set it: the user's words, then the AI's
  pinned?: boolean // always in the summary Claude gets
  userDropped?: boolean // dropped from the board by the user
}
export type MapItems = Record<string, MapItem>
export type MapTurn = { idx: number; human: string; ai: string }
export type MapMeta = {
  cwd: string
  injected: boolean
  turns: number
  updates: number
  tokensIn: number
  tokensOut: number
  lastError: string
  live?: number // turns captured live in this session
  backfilled?: boolean // the conversation before the plugin loaded was queued
  extractions?: number
  lastExtractAt?: number // epoch ms
  compactions?: number // compactions that got the summary back
  injections?: number // sessions or /clears that got the summary with the first prompt
  lookups?: number // map_lookup calls Claude made
  focus?: string // the item the pane's details show
  bandHidden?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'living-map': {
      items: MapItems
      pending: MapTurn[]
      meta: MapMeta
      prompts: Record<string, string>
    }
  }
}
