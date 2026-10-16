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
