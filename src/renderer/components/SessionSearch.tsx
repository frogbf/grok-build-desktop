import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '../lib/types'
import { sessionDisplayTitle } from '../lib/types'
import type { MessageKey } from '../i18n/locales/zh'
import './SessionSearch.css'

type Props = {
  open: boolean
  sessions: Session[]
  t: (key: MessageKey) => string
  onClose: () => void
  onSelect: (id: string) => void
}

function score(query: string, title: string, cwd: string, project: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const hay = `${title} ${project} ${cwd}`.toLowerCase()
  if (hay.includes(q)) return 10 + (title.toLowerCase().startsWith(q) ? 5 : 0)
  // token AND
  const parts = q.split(/\s+/).filter(Boolean)
  if (parts.every((p) => hay.includes(p))) return 6
  return 0
}

export function SessionSearch({ open, sessions, t, onClose, onSelect }: Props) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const ranked = sessions
      .map((s) => {
        const title = sessionDisplayTitle(s, t)
        return {
          s,
          title,
          sc: score(q, title, s.cwd || '', s.projectName || ''),
        }
      })
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc || b.s.updatedAt - a.s.updatedAt)
      .slice(0, 40)
    return ranked.map((x) => ({ s: x.s, title: x.title }))
  }, [sessions, q, t])

  useEffect(() => {
    if (!open) return
    setQ('')
    setIdx(0)
    const tmr = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(tmr)
  }, [open])

  useEffect(() => {
    setIdx(0)
  }, [q])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIdx((i) => Math.max(0, i - 1))
      }
      if (e.key === 'Enter' && results[idx]) {
        e.preventDefault()
        onSelect(results[idx].s.id)
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, results, idx, onClose, onSelect])

  if (!open) return null

  return (
    <div className="session-search-overlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div
        className="session-search-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="session-search-head">
          <input
            ref={inputRef}
            className="session-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchSessionsPlaceholder')}
            aria-label={t('search')}
          />
          <kbd className="session-search-kbd">Esc</kbd>
        </div>
        <div className="session-search-list">
          {results.length === 0 ? (
            <div className="session-search-empty">{t('searchNoResults')}</div>
          ) : (
            results.map(({ s, title }, i) => (
              <button
                key={s.id}
                type="button"
                className={`session-search-item ${i === idx ? 'active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  onSelect(s.id)
                  onClose()
                }}
              >
                <span className="session-search-title">
                  {title}
                  {s.status === 'running' ? (
                    <span className="session-search-running">· {t('running')}</span>
                  ) : null}
                </span>
                <span className="session-search-meta mono">
                  {s.projectName || '—'}
                  {s.cwd ? ` · ${s.cwd}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
