import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { ChatMessage } from '../lib/types'
import type { MessageKey } from '../i18n/locales/zh'
import type { SubscriptionTier } from '../lib/tier'
import { BrandMarkWatermark } from './BrandMark'
import { MarkdownBody } from './MarkdownBody'
import './ChatThread.css'

type Props = {
  messages: ChatMessage[]
  running: boolean
  emptySlot?: ReactNode
  tier?: SubscriptionTier
  t: (key: MessageKey) => string
}

type DisplayItem =
  | { type: 'single'; message: ChatMessage }
  | { type: 'tools'; tools: ChatMessage[] }

function greetingKey(): MessageKey {
  const h = new Date().getHours()
  if (h < 6) return 'greetingDawn'
  if (h < 11) return 'greetingMorning'
  if (h < 13) return 'greetingNoon'
  if (h < 18) return 'greetingAfternoon'
  return 'greetingEvening'
}

function isToolMsg(m: ChatMessage): boolean {
  return m.role === 'tool' || m.meta?.kind === 'tool'
}

function isThoughtMsg(m: ChatMessage): boolean {
  return m.meta?.kind === 'thought' || (m.role === 'assistant' && m.id.startsWith('thought_'))
}

/** Collapse consecutive tool rows into one expandable batch. */
function groupForDisplay(messages: ChatMessage[]): DisplayItem[] {
  const out: DisplayItem[] = []
  let toolBuf: ChatMessage[] = []
  const flushTools = () => {
    if (!toolBuf.length) return
    out.push({ type: 'tools', tools: toolBuf })
    toolBuf = []
  }
  for (const m of messages) {
    if (isToolMsg(m)) {
      toolBuf.push(m)
    } else {
      flushTools()
      out.push({ type: 'single', message: m })
    }
  }
  flushTools()
  return out
}

function toolLabel(m: ChatMessage): string {
  const name = (m.meta?.toolName || m.content || '').trim()
  if (!name || name.toLowerCase() === 'tool') return 'Tool'
  return name
}

function toolBatchSummary(tools: ChatMessage[], t: (key: MessageKey) => string): string {
  const n = tools.length
  const counts = new Map<string, number>()
  for (const m of tools) {
    let label = toolLabel(m)
    // Normalize "Web search: …" → "Web search"
    const colon = label.indexOf(':')
    if (colon > 0 && colon < 24) label = label.slice(0, colon).trim()
    // Cap long names
    if (label.length > 28) label = `${label.slice(0, 25)}…`
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  const parts: string[] = []
  for (const [name, c] of counts) {
    parts.push(c > 1 ? `${name} ×${c}` : name)
    if (parts.length >= 4) break
  }
  const more = counts.size > parts.length ? ` +${counts.size - parts.length}` : ''
  const names = parts.join(' · ') + more
  if (n === 1) return names
  return `${t('toolsUsed')} ${n} · ${names}`
}

function ToolRow({ m }: { m: ChatMessage }) {
  const st = m.meta?.status || 'done'
  const name = toolLabel(m)
  const detail = m.meta?.toolDetail || (m.content !== name ? m.content : '')
  return (
    <div className={`tool-card status-${st}`}>
      <span className={`tool-dot ${st}`} />
      <span className="tool-name mono" title={name}>
        {name}
      </span>
      <span className="tool-status" aria-hidden>
        {st === 'running' ? '…' : st === 'error' ? '!' : '✓'}
      </span>
      {detail && detail !== name ? (
        <span className="tool-detail truncate" title={detail}>
          {detail}
        </span>
      ) : null}
    </div>
  )
}

function ToolBatch({
  tools,
  t,
}: {
  tools: ChatMessage[]
  t: (key: MessageKey) => string
}) {
  const anyRunning = tools.some((m) => m.meta?.status === 'running')
  const allDone = tools.every((m) => m.meta?.status === 'done' || !m.meta?.status)
  // Single tool: always show the card (no collapse chrome)
  if (tools.length === 1) {
    return (
      <article className={`msg msg-tool status-${tools[0].meta?.status || 'done'}`}>
        <ToolRow m={tools[0]} />
      </article>
    )
  }
  // While running: keep expanded. When finished: remount collapsed so the answer is primary.
  const live = anyRunning || !allDone
  return (
    <details
      key={live ? 'live' : 'done'}
      className={`msg msg-tool-batch ${live ? 'running' : ''}`}
      open={live ? true : undefined}
    >
      <summary className="tool-batch-sum">
        <span className={`tool-dot ${live ? 'running' : 'done'}`} />
        <span className="tool-batch-label">{toolBatchSummary(tools, t)}</span>
        <span className="tool-batch-chevron" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="tool-batch-list">
        {tools.map((m) => (
          <ToolRow key={m.id} m={m} />
        ))}
      </div>
    </details>
  )
}

export function ChatThread({ messages, running, emptySlot, tier, t }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  const items = useMemo(() => groupForDisplay(messages), [messages])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, running])

  if (messages.length === 0) {
    return (
      <div className="thread empty-state">
        <div className="watermark" aria-hidden>
          <BrandMarkWatermark tier={tier} />
        </div>
        <div className="empty-center">
          <h1 className="greeting">
            {t(greetingKey())}，{t('greeting')}
          </h1>
          {emptySlot}
        </div>
      </div>
    )
  }

  return (
    <div className="thread">
      <div className="thread-inner">
        {items.map((item) => {
          if (item.type === 'tools') {
            return (
              <ToolBatch
                key={item.tools.map((m) => m.id).join('|')}
                tools={item.tools}
                t={t}
              />
            )
          }

          const m = item.message
          if (isThoughtMsg(m)) {
            return (
              <details key={m.id} className="msg msg-thought">
                <summary className="msg-thought-sum">
                  {t('thought')}
                  {running && m.id.startsWith('thought_stream') ? ' …' : ''}
                </summary>
                <div className="msg-body msg-thought-body selectable">{m.content}</div>
              </details>
            )
          }

          return (
            <article key={m.id} className={`msg msg-${m.role}`}>
              <div className="msg-role">
                {m.role === 'user' && t('you')}
                {m.role === 'assistant' && 'Grok'}
                {m.role === 'system' && t('system')}
              </div>
              {m.role === 'assistant' ? (
                <MarkdownBody content={m.content} mode="markdown" />
              ) : m.role === 'user' ? (
                <MarkdownBody content={m.content} mode="plain" />
              ) : (
                <div className="msg-body selectable">{m.content}</div>
              )}
            </article>
          )
        })}
        {running && (
          <div className="typing" aria-label="…">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}
