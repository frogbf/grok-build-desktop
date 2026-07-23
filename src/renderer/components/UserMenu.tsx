import { useEffect, useRef, useState } from 'react'
import type { AccountSubscription } from '../../preload/index'
import {
  getLocalePreference,
  setLocalePreference,
  type AppLocale,
} from '../i18n'
import type { MessageKey } from '../i18n/locales/zh'
import { applyZoom, loadZoom, zoomIn, zoomOut, zoomReset } from '../lib/zoom'
import './UserMenu.css'

const UPGRADE_URL = 'https://grok.com/supergrok?referrer=grok-build'
const USAGE_URL = 'https://grok.com/?_s=usage'

type Props = {
  subscription: AccountSubscription | null
  mode: 'demo' | 'live'
  t: (key: MessageKey) => string
  onOpenSettings: (section?: 'usage' | 'account' | 'language') => void
  onLogout?: () => void
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const n = (name || '').trim()
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return n.slice(0, 2).toUpperCase()
  }
  const e = (email || '').trim()
  if (e) return e.slice(0, 2).toUpperCase()
  return '?'
}

export function UserMenu({ subscription, mode, t, onOpenSettings, onLogout }: Props) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(() => loadZoom())
  const [imgFailed, setImgFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const name =
    subscription?.displayName || subscription?.email?.split('@')[0] || t('account')
  const plan =
    subscription?.subscriptionDisplay || subscription?.subscriptionTier || null
  const percent = subscription?.billing?.creditUsagePercent
  const avatarUrl = subscription?.avatarDataUrl
  const locale = getLocalePreference()

  useEffect(() => {
    applyZoom(loadZoom())
  }, [])

  useEffect(() => {
    setImgFailed(false)
  }, [avatarUrl])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const setLang = (pref: AppLocale) => {
    setLocalePreference(pref)
  }

  return (
    <div className={`user-menu ${open ? 'open' : ''}`} ref={rootRef}>
      {open && (
        <div className="user-popover" role="menu">
          <div className="user-popover-head">
            <div className="user-popover-avatar" aria-hidden>
              {avatarUrl && !imgFailed ? (
                <img src={avatarUrl} alt="" onError={() => setImgFailed(true)} />
              ) : (
                <span>{initials(subscription?.displayName, subscription?.email)}</span>
              )}
            </div>
            <div className="user-popover-meta">
              <strong className="truncate" title={name}>
                {name}
              </strong>
              {subscription?.email ? (
                <span className="truncate muted" title={subscription.email}>
                  {subscription.email}
                </span>
              ) : null}
              {plan ? <span className="plan-chip">{plan}</span> : null}
            </div>
          </div>

          <div className="user-popover-section">
            <div className="section-label">{t('menuLanguage')}</div>
            <div className="lang-chips">
              {(
                [
                  ['system', 'languageSystem'],
                  ['zh', 'languageZh'],
                  ['en', 'languageEn'],
                ] as const
              ).map(([value, labelKey]) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${locale === value ? 'active' : ''}`}
                  onClick={() => setLang(value)}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="user-popover-section">
            <div className="section-label">{t('menuUsage')}</div>
            {percent != null ? (
              <button
                type="button"
                className="usage-block"
                onClick={() => {
                  setOpen(false)
                  onOpenSettings('usage')
                }}
              >
                <div className="usage-row">
                  <span>
                    {t('usedPercent')} {percent.toFixed(0)}%
                  </span>
                  {plan ? <span className="muted">{plan}</span> : null}
                </div>
                <div className="usage-bar">
                  <div
                    className={`usage-fill ${percent >= 90 ? 'hot' : percent >= 70 ? 'warm' : ''}`}
                    style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                  />
                </div>
              </button>
            ) : (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setOpen(false)
                  onOpenSettings('usage')
                }}
              >
                {t('noBillingYet')}
              </button>
            )}
            <button
              type="button"
              className="menu-item subtle"
              onClick={() => {
                setOpen(false)
                void window.grokDesktop.shell.openExternal(USAGE_URL)
              }}
            >
              {t('openUsageWeb')}
            </button>
          </div>

          <div className="user-popover-section">
            <div className="section-label">{t('menuZoom')}</div>
            <div className="zoom-row">
              <button
                type="button"
                className="chip"
                title={t('menuZoomOut')}
                onClick={() => setZoom(zoomOut(zoom))}
              >
                −
              </button>
              <button
                type="button"
                className="chip zoom-pct"
                title={t('menuZoomReset')}
                onClick={() => setZoom(zoomReset())}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="chip"
                title={t('menuZoomIn')}
                onClick={() => setZoom(zoomIn(zoom))}
              >
                +
              </button>
            </div>
          </div>

          <div className="user-popover-actions">
            <button
              type="button"
              className="menu-item accent"
              onClick={() => {
                setOpen(false)
                void window.grokDesktop.shell.openExternal(UPGRADE_URL)
              }}
            >
              {t('menuUpgrade')}
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
            >
              {t('menuSettings')}
            </button>
            {onLogout ? (
              <button
                type="button"
                className="menu-item danger"
                onClick={() => {
                  setOpen(false)
                  onLogout()
                }}
              >
                {t('menuLogout')}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <button
        type="button"
        className="user-row"
        title={t('userMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden>
          {avatarUrl && !imgFailed ? (
            <img className="avatar-img" src={avatarUrl} alt="" onError={() => setImgFailed(true)} />
          ) : (
            <span className="avatar-initials">
              {initials(subscription?.displayName, subscription?.email)}
            </span>
          )}
        </span>
        <div className="user-meta">
          <span className="user-name">{name}</span>
          <span className="user-mode">
            {mode === 'live' ? t('live') : t('setup')}
            {plan ? ` · ${plan}` : ''}
            {percent != null ? ` · ${percent.toFixed(0)}%` : ''}
          </span>
        </div>
      </button>
    </div>
  )
}
