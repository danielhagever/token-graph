/** One API response of the main chat: its four token counts. */
export type Point = {
  /** The response's message id (transcript) or turnId:index (live). */
  id: string
  /** The turn it belongs to, when known live. */
  turn: string
  /** Which prompt of the chat it answered, from 1. */
  p: number
  /** When it arrived, ms since epoch (0 when unknown). */
  t: number
  i: number
  o: number
  cr: number
  cw: number
}

export type Meta = {
  usd?: number
  ctx?: number
  win?: number
  model?: string
  /** The context a compaction left, and `ctx` as it read then: shown until a new response moves `ctx`. */
  compacted?: { after: number; ctxThen?: number }
  /** How many times this chat has been compacted. */
  compactions?: number
  /** Where the points came from last: the transcript file, or live only. */
  source: 'transcript' | 'live'
}

declare module 'claude-code' {
  interface PluginState {
    'token-graph': { points: Shaped<Point[]>; meta: Shaped<Meta>; busy: boolean }
  }
}
