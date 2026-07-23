import type { BootstrapState } from '../../preload/index'
import type { MessageKey } from '../i18n/locales/zh'
import type { SubscriptionTier } from '../lib/tier'
import { BrandMark } from './BrandMark'
import './SetupGate.css'

type Props = {
  boot: BootstrapState
  logs: string[]
  actionMessage: string | null
  tier: SubscriptionTier
  t: (key: MessageKey) => string
  onInstall: () => void
  onLogin: () => void
  onRecheck: () => void
  onLogout?: () => void
  onOpenSettings?: () => void
}

export function SetupGate({
  boot,
  logs,
  actionMessage,
  tier,
  t,
  onInstall,
  onLogin,
  onRecheck,
  onLogout,
  onOpenSettings,
}: Props) {
  const busy = boot.phase === 'busy' || boot.phase === 'checking'

  return (
    <div className="setup-gate">
      <div className="setup-card">
        <div className="setup-brand">
          <div className="setup-logo" aria-hidden>
            <BrandMark size={44} tier={tier} />
          </div>
          <div>
            <h1>{t('appName')}</h1>
            <p className="setup-sub">{t('appTagline')}</p>
          </div>
        </div>

        <ol className="setup-steps">
          <li className={stepClass(boot, 'cli')}>
            <span className="step-idx">1</span>
            <div className="step-body">
              <strong>{t('stepCli')}</strong>
              <span className="step-desc">
                {boot.binaryPath
                  ? `${t('stepCliDescFound')} · ${boot.binaryPath}`
                  : t('stepCliDescMissing')}
              </span>
              {boot.version ? <span className="step-meta mono">{boot.version}</span> : null}
            </div>
          </li>
          <li className={stepClass(boot, 'auth')}>
            <span className="step-idx">2</span>
            <div className="step-body">
              <strong>{t('stepAuth')}</strong>
              <span className="step-desc">
                {boot.authPresent ? t('stepAuthOk') : t('stepAuthDesc')}
              </span>
            </div>
          </li>
          <li className={stepClass(boot, 'ready')}>
            <span className="step-idx">3</span>
            <div className="step-body">
              <strong>{t('stepReady')}</strong>
              <span className="step-desc">{t('stepReadyDesc')}</span>
            </div>
          </li>
        </ol>

        <p className="setup-message">{boot.message}</p>
        {boot.lastError ? <p className="setup-error">{boot.lastError}</p> : null}
        {actionMessage ? <p className="setup-action-msg">{actionMessage}</p> : null}

        <div className="setup-actions">
          {(boot.phase === 'need_cli' || boot.phase === 'checking') && (
            <button type="button" className="btn-main" disabled={busy} onClick={onInstall}>
              {busy && boot.busyAction === 'install' ? t('installing') : t('installCli')}
            </button>
          )}
          {(boot.phase === 'need_auth' || (boot.binaryPath && !boot.authPresent)) &&
            boot.phase !== 'need_cli' && (
              <button type="button" className="btn-main" disabled={busy} onClick={onLogin}>
                {busy && boot.busyAction === 'login' ? t('waitingLogin') : t('login')}
              </button>
            )}
          <button type="button" className="btn-secondary" disabled={busy} onClick={onRecheck}>
            {t('recheck')}
          </button>
          {boot.authPresent && onLogout ? (
            <button type="button" className="btn-ghost" disabled={busy} onClick={onLogout}>
              {t('logout')}
            </button>
          ) : null}
          {onOpenSettings ? (
            <button type="button" className="btn-ghost" onClick={onOpenSettings}>
              {t('settings')}
            </button>
          ) : null}
        </div>

        {boot.phase === 'need_cli' && (
          <div className="setup-manual">
            <div className="manual-label">{t('manualInstall')}</div>
            <code className="manual-cmd selectable">{boot.installCommand}</code>
          </div>
        )}

        {logs.length > 0 && (
          <pre className="setup-log mono selectable">
            {logs.slice(-40).map((l, i) => (
              <div key={`${i}-${l.slice(0, 24)}`}>{l}</div>
            ))}
          </pre>
        )}

        <p className="setup-footnote">{t('aboutBody')}</p>
      </div>
    </div>
  )
}

function stepClass(boot: BootstrapState, which: 'cli' | 'auth' | 'ready'): string {
  if (which === 'cli') {
    if (boot.binaryPath && boot.phase !== 'need_cli') return 'done'
    if (boot.phase === 'need_cli' || boot.busyAction === 'install') return 'current'
    return ''
  }
  if (which === 'auth') {
    if (boot.authPresent && boot.phase === 'ready') return 'done'
    if (boot.phase === 'need_auth' || boot.busyAction === 'login') return 'current'
    if (boot.binaryPath && boot.phase !== 'need_cli') return 'current'
    return ''
  }
  if (boot.phase === 'ready') return 'done'
  return ''
}
