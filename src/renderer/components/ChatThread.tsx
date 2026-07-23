import { useEffect, useRef, type ReactNode } from 'react'
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

function greetingKey(): MessageKey {
  const h = new Date().getHours()
  if (h < 6) return 'greetingDawn'
  if (h < 11) return 'greetingMorning'
  if (h < 13) return 'greetingNoon'
  if (h < 18) return 'greetingAfternoon'
  return 'greetingEvening'
}

export function ChatThread({ messages, running, emptySlot, tier, t }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

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
        {messages.map((m) => {
          const isThought =
            m.meta?.kind === 'thought' ||
            (m.role === 'assistant' && m.id.startsWith('thought_'))
          const isTool = m.role === 'tool' || m.meta?.kind === 'tool'

          if (isThought) {
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

          if (isTool) {
            const st = m.meta?.status || 'done'
            return (
              <article key={m.id} className={`msg msg-tool status-${st}`}>
                <div className="tool-card">
                  <span className={`tool-dot ${st}`} />
                  <span className="tool-name mono">{m.meta?.toolName || t('tool')}</span>
                  <span className="tool-status">{st === 'running' ? '…' : st === 'error' ? '!' : '✓'}</span>
                  {m.content && m.content !== m.meta?.toolName ? (
                    <span className="tool-detail truncate" title={m.content}>
                      {m.content}
                    </span>
                  ) : null}
                </div>
              </article>
            )
          }

          return (
            <article key={m.id} className={`msg msg-${m.role}`}>
              <div className="msg-role">
                {m.role === 'user' && t('you')}
                {m.role === 'assistant' && 'Grok'}
                {m.role === 'system' && t('system')}
                {m.role === 'tool' && (m.meta?.toolName || t('tool'))}
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
