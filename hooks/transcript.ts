import type { Point } from '../types'

type Line = {
  type?: string
  subtype?: string
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  timestamp?: string
  message?: {
    id?: string
    model?: string
    content?: unknown
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number | null
      cache_creation_input_tokens?: number | null
    }
  }
}

/** A prompt the person typed: plain text, not a tool result or a meta note. */
function isPrompt(d: Line): boolean {
  if (d.type !== 'user' || d.isSidechain || d.isMeta || d.isCompactSummary) return false
  const c = d.message?.content
  if (typeof c === 'string') return !c.startsWith('<local-command') && !c.startsWith('<command-')
  if (!Array.isArray(c)) return false
  const types = c.map(b => (b as { type?: string })?.type)
  return types.includes('text') && !types.includes('tool_result')
}

/** Every main-chat API response in the transcript, one point per message id, and how often it was compacted. */
export function parseTranscript(text: string): { points: Point[]; model?: string; compactions: number } {
  const byId = new Map<string, Point>()
  let prompt = 0
  let compactions = 0
  let model: string | undefined
  for (const raw of text.split('\n')) {
    if (!raw) continue
    let d: Line
    try {
      d = JSON.parse(raw)
    } catch {
      continue
    }
    if (d.subtype === 'compact_boundary' && !d.isSidechain) {
      compactions++
      continue
    }
    if (isPrompt(d)) {
      prompt++
      continue
    }
    const m = d.message
    if (d.type !== 'assistant' || d.isSidechain || !m?.id || !m.usage) continue
    if (m.model === '<synthetic>') continue
    model = m.model ?? model
    const u = m.usage
    const prev = byId.get(m.id)
    byId.set(m.id, {
      id: m.id,
      turn: '',
      p: prev?.p ?? Math.max(1, prompt),
      t: prev?.t ?? (d.timestamp ? Date.parse(d.timestamp) || 0 : 0),
      i: u.input_tokens ?? 0,
      o: u.output_tokens ?? 0,
      cr: u.cache_read_input_tokens ?? 0,
      cw: u.cache_creation_input_tokens ?? 0,
    })
  }

  return { points: [...byId.values()], model, compactions }
}
