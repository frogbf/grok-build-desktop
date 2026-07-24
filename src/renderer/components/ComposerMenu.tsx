import { useEffect, useRef } from 'react'
import './ComposerMenu.css'

export type MenuItem = {
  id: string
  title: string
  description?: string
  meta?: string
  metaKind?: 'skill' | 'model' | 'file' | 'builtin'
}

type Props = {
  open: boolean
  kind: 'file' | 'slash'
  query: string
  items: MenuItem[]
  activeIndex: number
  emptyLabel: string
  titleLabel: string
  onHover: (index: number) => void
  onPick: (index: number) => void
}

export function ComposerMenu({
  open,
  kind,
  query,
  items,
  activeIndex,
  emptyLabel,
  titleLabel,
  onHover,
  onPick,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items.length])

  if (!open) return null

  const prefix = kind === 'file' ? '@' : '/'
  const displayQuery = query ? `${prefix}${query}` : prefix

  return (
    <div className="composer-menu" role="listbox" aria-label={titleLabel}>
      <div className="composer-menu-head">
        <span>{titleLabel}</span>
        <span className="composer-menu-head-query">{displayQuery}</span>
      </div>
      <div className="composer-menu-list" ref={listRef}>
        {items.length === 0 ? (
          <div className="composer-menu-empty">{emptyLabel}</div>
        ) : (
          items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              ref={i === activeIndex ? activeRef : undefined}
              className={`composer-menu-item ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                // prevent textarea blur before pick
                e.preventDefault()
                onPick(i)
              }}
            >
              <span className="composer-menu-title">{item.title}</span>
              {item.description ? (
                <span className="composer-menu-desc">{item.description}</span>
              ) : null}
              {item.meta ? (
                <span className={`composer-menu-meta ${item.metaKind || ''}`}>{item.meta}</span>
              ) : null}
            </button>
          ))
        )}
      </div>
      <div className="composer-menu-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>Tab</kbd>/<kbd>Enter</kbd> accept
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  )
}
