import { useEffect, useRef, useState } from 'react'
import type { SubscriptionTier } from '../lib/tier'
import type { GitStatus } from '../../preload/index'
import type { PanelMode } from './RightPanel'
import type { MessageKey } from '../i18n/locales/zh'
import { BrandMark } from './BrandMark'
import './TitleBar.css'

type Props = {
  mode: 'demo' | 'live'
  title?: string
  tier: SubscriptionTier
  git?: GitStatus | null
  cwd?: string
  panelOpen: boolean
  panelMode: PanelMode
  terminalOpen: boolean
  t: (key: MessageKey) => string
  onToggleTerminal: () => void
  onSetPanelMode: (mode: PanelMode) => void
  onTogglePanel: () => void
  onGitChanged?: () => void
}

export function TitleBar({
  mode,
  title,
  tier,
  git,
  cwd,
  panelOpen,
  panelMode,
  terminalOpen,
  t,
  onToggleTerminal,
  onSetPanelMode,
  onTogglePanel,
  onGitChanged,
}: Props) {
  const isDarwin = window.grokDesktop?.platform === 'darwin'
  const [menuOpen, setMenuOpen] = useState(false)
  const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const branchLabel = git?.isRepo
    ? git.detached
      ? `⎇ ${git.branch || 'HEAD'} (detached)`
      : `⎇ ${git.branch || '—'}`
    : null

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const openMenu = async () => {
    if (!git?.isRepo || !cwd || !window.grokDesktop?.git?.listBranches) return
    setMsg(null)
    setMenuOpen((o) => !o)
    if (menuOpen) return
    try {
      const res = await window.grokDesktop.git.listBranches(cwd)
      if (res.ok) setBranches(res.branches)
      else setBranches([])
    } catch {
      setBranches([])
    }
  }

  const onCheckout = async (name: string) => {
    if (!cwd || !window.grokDesktop?.git?.checkout || busy) return
    if (git?.dirty) {
      setMsg(t('gitCheckoutDirty'))
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const res = await window.grokDesktop.git.checkout(cwd, name)
      if (res.ok) {
        setMenuOpen(false)
        onGitChanged?.()
      } else {
        setMsg(res.message || t('gitCheckoutFail'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className={`titlebar ${isDarwin ? 'darwin' : ''}`}>
      <div className="titlebar-left">
        <BrandMark size={18} tier={tier} title="Singularity" />
        <span className="brand-text">Grok Build</span>
        <span className={`mode-dot ${mode}`} title={mode === 'live' ? 'Live CLI' : 'Demo'} />
      </div>

      <div className="titlebar-center">
        <span className="titlebar-title">{title || ''}</span>
        {branchLabel ? (
          <div className="titlebar-branch-wrap" ref={wrapRef}>
            <button
              type="button"
              className={`titlebar-branch ${git?.dirty ? 'dirty' : ''} ${menuOpen ? 'open' : ''}`}
              title={
                git?.dirty
                  ? `${branchLabel} · ${git.dirtyCount} uncommitted`
                  : `${branchLabel} — ${t('gitSwitchBranch')}`
              }
              onClick={() => void openMenu()}
              disabled={!cwd}
            >
              {branchLabel}
              {git?.dirty ? ` · ${git.dirtyCount}` : ''}
              <span className="titlebar-branch-caret">▾</span>
            </button>
            {menuOpen ? (
              <div className="titlebar-branch-menu">
                <div className="titlebar-branch-menu-head">{t('gitSwitchBranch')}</div>
                {msg ? <div className="titlebar-branch-msg">{msg}</div> : null}
                {git?.dirty ? (
                  <div className="titlebar-branch-msg warn">{t('gitCheckoutDirty')}</div>
                ) : null}
                <div className="titlebar-branch-list">
                  {branches.length === 0 ? (
                    <div className="titlebar-branch-empty">{t('loading')}</div>
                  ) : (
                    branches.map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        className={`titlebar-branch-item ${b.current ? 'current' : ''}`}
                        disabled={busy || b.current || Boolean(git?.dirty)}
                        title={b.name}
                        onClick={() => void onCheckout(b.name)}
                      >
                        <span className="mono truncate">{b.name}</span>
                        {b.current ? <span className="cur">✓</span> : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="titlebar-right">
        <div className="panel-switch" title="右侧面板">
          <button
            type="button"
            className={`titlebar-btn ${panelOpen && panelMode === 'review' ? 'active' : ''}`}
            onClick={() => onSetPanelMode('review')}
          >
            {t('panelReview')}
          </button>
          <button
            type="button"
            className={`titlebar-btn ${panelOpen && panelMode === 'browser' ? 'active' : ''}`}
            onClick={() => onSetPanelMode('browser')}
          >
            {t('panelBrowser')}
          </button>
        </div>

        <button
          type="button"
          className={`titlebar-icon-btn ${terminalOpen ? 'active' : ''}`}
          onClick={onToggleTerminal}
          title="底部终端 (Ctrl+`)"
          aria-label="Terminal"
        >
          <IconTerminal />
        </button>

        <button
          type="button"
          className={`titlebar-icon-btn ${panelOpen ? 'active' : ''}`}
          onClick={onTogglePanel}
          title="切换右侧面板"
          aria-label="Toggle panel"
        >
          <IconPanel />
        </button>

        {!isDarwin && (
          <div className="window-controls">
            <button type="button" onClick={() => window.grokDesktop.window.minimize()} aria-label="min">
              <svg width="10" height="1" viewBox="0 0 10 1">
                <rect width="10" height="1" fill="currentColor" />
              </svg>
            </button>
            <button type="button" onClick={() => window.grokDesktop.window.maximize()} aria-label="max">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className="close"
              onClick={() => window.grokDesktop.window.close()}
              aria-label="close"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

function IconTerminal() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </svg>
  )
}

function IconPanel() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  )
}
