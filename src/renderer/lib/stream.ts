import type { UsageSnapshot } from '../components/RightPanel'

/** Structured event from one NDJSON line of `grok --output-format streaming-json`. */
export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'usage'; usage: UsageSnapshot }
  | { kind: 'ignore' }

/**
 * Parse one NDJSON line from official headless streaming-json.
 * Emits text / thought / system notices; usage is attached to `end` lines.
 */
export function parseStreamEvent(line: string): StreamEvent {
  const trimmed = line.trim()
  if (!trimmed) return { kind: 'ignore' }
  if (trimmed.startsWith('[desktop]')) return { kind: 'ignore' }

  try {
    const obj = JSON.parse(trimmed) as {
      type?: string
      data?: unknown
      message?: string | { content?: string | Array<{ text?: string }> }
      content?: string
      text?: string
      delta?: string
      percentage?: number
      error?: string
      total_cost_usd?: number
      usage?: {
        input_tokens?: number
        output_tokens?: number
        total_tokens?: number
      }
    }

    const type = (obj.type || '').toLowerCase()

    if (type === 'text') {
      return typeof obj.data === 'string' && obj.data
        ? { kind: 'text', text: obj.data }
        : { kind: 'ignore' }
    }

    if (type === 'thought') {
      return typeof obj.data === 'string' && obj.data
        ? { kind: 'thought', text: obj.data }
        : { kind: 'ignore' }
    }

    if (type === 'end') {
      if (typeof obj.total_cost_usd === 'number' || obj.usage) {
        return {
          kind: 'usage',
          usage: {
            costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : null,
            inputTokens: obj.usage?.input_tokens ?? null,
            outputTokens: obj.usage?.output_tokens ?? null,
            totalTokens: obj.usage?.total_tokens ?? null,
          },
        }
      }
      return { kind: 'ignore' }
    }

    if (type === 'error') {
      const msg =
        typeof obj.message === 'string'
          ? obj.message
          : typeof obj.data === 'string'
            ? obj.data
            : 'error'
      return { kind: 'system', text: msg }
    }

    if (type === 'max_turns_reached') {
      return { kind: 'system', text: 'Max turns reached' }
    }

    if (type === 'auto_compact_started') {
      const p = typeof obj.percentage === 'number' ? ` (${obj.percentage}%)` : ''
      return { kind: 'system', text: `Auto-compacting conversation${p}…` }
    }
    if (type === 'auto_compact_completed') {
      return { kind: 'system', text: 'Conversation compacted' }
    }
    if (type === 'auto_compact_failed') {
      return {
        kind: 'system',
        text: obj.error ? `Auto-compact failed: ${obj.error}` : 'Auto-compact failed',
      }
    }
    if (type === 'auto_compact_cancelled') {
      return { kind: 'system', text: 'Auto-compact cancelled' }
    }
    if (type === 'auto_continue_completed') {
      return { kind: 'system', text: 'Resumed after compaction' }
    }
    if (type === 'image_compressed') {
      return {
        kind: 'system',
        text: typeof obj.message === 'string' ? obj.message : 'Image compressed',
      }
    }

    // Unknown typed event — leave for raw log only
    if (type) return { kind: 'ignore' }

    // Fallbacks for other shapes
    if (typeof obj.content === 'string') return { kind: 'text', text: obj.content }
    if (typeof obj.text === 'string') return { kind: 'text', text: obj.text }
    if (typeof obj.delta === 'string') return { kind: 'text', text: obj.delta }
    if (typeof obj.message === 'string') return { kind: 'text', text: obj.message }
    if (Array.isArray(obj.message?.content)) {
      return {
        kind: 'text',
        text: obj.message.content.map((c) => c.text || '').join(''),
      }
    }
  } catch {
    // plain text line (non-JSON)
    return { kind: 'text', text: trimmed }
  }
  return { kind: 'ignore' }
}
