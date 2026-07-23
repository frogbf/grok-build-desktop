import type { AccountSubscription } from '../../preload/index'
import type { Session } from '../lib/types'
import type { MessageKey } from '../i18n/locales/zh'
import { UserMenu } from './UserMenu'
import './Sidebar.css'

export type ProjectGroup = {
  name: string
  cwd: string
  sessions: Session[]
}

type Props = {
  groups: ProjectGroup[]
  activeId: string | null
  statusMessage: string
  mode: 'demo' | 'live'
  subscription: AccountSubscription | null
  t: (key: MessageKey) => string
  onOpenSettings: (section?: 'usage' | 'account' | 'language') => void
  onLogout?: () => void
  onSelect: (id: string) => void
  onNewSession: () => void
  onPickCwd: () => void
  onSearch?: () => void
  onOpenSkills?: () => void
}

function relTime(ts: number): string {
  if (!ts) return ''
  const days = Math.max(0, Math.floor((Date.now() - ts) / 86400000))
  if (days === 0) return '0d'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

export function Sidebar({
  groups,
  activeId,
  statusMessage,
  mode,
  subscription,
  t,
  onOpenSettings,
  onLogout,
  onSelect,
  onNewSession,
  onPickCwd,
  onSearch,
  onOpenSkills,
}: Props) {
  return (
    <aside className="sidebar">
      <nav className="nav-block">
        <button type="button" className="nav-item" onClick={onNewSession}>
          <span className="nav-icon">
            <IconPlus />
          </span>
          <span className="nav-label">{t('newTask')}</span>
          <span className="kbd">Ctrl+N</span>
        </button>
        <button type="button" className="nav-item" onClick={onSearch}>
          <span className="nav-icon">
            <IconSearch />
          </span>
          <span className="nav-label">{t('search')}</span>
          <span className="kbd">Ctrl+K</span>
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => onOpenSettings()}
        >
          <span className="nav-icon">
            <IconGear />
          </span>
          <span className="nav-label">{t('settings')}</span>
          <span className="kbd">Ctrl+,</span>
        </button>
        <button type="button" className="nav-item" onClick={onOpenSkills} title={t('skills')}>
          <span className="nav-icon">
            <IconSpark />
          </span>
          <span className="nav-label">{t('skills')}</span>
        </button>
      </nav>

      <div className="view-toggle">
        <span className="projects-label">
          <IconFolder /> {t('projects')}
        </span>
        <div className="toggle-actions">
          <button type="button" className="icon-btn" onClick={onPickCwd} title={t('openProject')}>
            <IconFolderPlus />
          </button>
        </div>
      </div>

      <div className="project-scroll">
        {groups.length === 0 && (
          <div className="empty-projects">
            <p>{t('noSessions')}</p>
            <button type="button" className="linkish" onClick={onPickCwd}>
              {t('pickWorkspace')}
            </button>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.cwd || g.name} className="project-group">
            <button type="button" className="project-head" onClick={onPickCwd} title={g.cwd}>
              <IconFolder />
              <span className="project-name">{g.name}</span>
            </button>
            <div className="thread-list">
              {g.sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`thread-item ${s.id === activeId ? 'active' : ''}`}
                  onClick={() => onSelect(s.id)}
                  title={s.title}
                >
                  <span className="thread-title">{s.title || t('newTask')}</span>
                  <span className="thread-time">{relTime(s.updatedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <footer className="sidebar-foot">
        <UserMenu
          subscription={subscription}
          mode={mode}
          t={t}
          onOpenSettings={onOpenSettings}
          onLogout={onLogout}
        />
        <p className="status-line" title={statusMessage}>
          {statusMessage}
        </p>
      </footer>
    </aside>
  )
}

function IconPlus() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}
function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}
function IconSpark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" />
    </svg>
  )
}
function IconGear() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9c.3.6.9 1 1.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  )
}
function IconFolder() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  )
}
function IconFolderPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1" />
      <path d="M3 7v10a2 2 0 002 2h7" />
      <path d="M17 14v6M14 17h6" />
    </svg>
  )
}
