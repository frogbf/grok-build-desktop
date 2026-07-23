import { useCallback, useEffect, useState } from 'react'
import type { AccountProfile, AccountSubscription, BootstrapState } from '../../preload/index'
import {
  getLocalePreference,
  setLocalePreference,
  type AppLocale,
} from '../i18n'
import type { MessageKey } from '../i18n/locales/zh'
import type { UsageSnapshot } from './RightPanel'
import './SettingsPage.css'

type Props = {
  boot: BootstrapState
  usage: UsageSnapshot | null
  subscription: AccountSubscription | null
  t: (key: MessageKey) => string
  onBack: () => void
  onLogout?: () => void
  onRecheck: () => void
  /** Parent updates global subscription state; should return the new snapshot */
  onRefreshSubscription?: () => Promise<AccountSubscription | null>
}

function formatSyncedAt(ms: number | undefined | null): string {
  if (!ms) return '—'
  try {
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  } catch {
    return '—'
  }
}

export function SettingsPage({
  boot,
  usage,
  subscription,
  t,
  onBack,
  onLogout,
  onRecheck,
  onRefreshSubscription,
}: Props) {
  const locale = getLocalePreference()
  const [account, setAccount] = useState<AccountProfile | null>(null)
  /** Local copy so refresh updates UI even if parent is slow / missing */
  const [localSub, setLocalSub] = useState<AccountSubscription | null>(subscription)
  const [refreshing, setRefreshing] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    setLocalSub(subscription)
  }, [subscription])

  useEffect(() => {
    void window.grokDesktop.grok.accountProfile().then(setAccount)
  }, [boot.authPresent])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setFlash(null)
    try {
      let sub: AccountSubscription | null = null

      if (onRefreshSubscription) {
        sub = await onRefreshSubscription()
      } else if (typeof window.grokDesktop?.grok?.accountSubscription === 'function') {
        sub = await window.grokDesktop.grok.accountSubscription()
      } else {
        setFlash({
          kind: 'err',
          text: `${t('refreshAccountFail')}：客户端未加载账户接口，请完全重启 Desktop`,
        })
        return
      }

      if (sub) {
        setLocalSub(sub)
        if (sub.ok) {
          setFlash({
            kind: 'ok',
            text: `${t('refreshAccountOk')} · ${sub.subscriptionDisplay || sub.subscriptionTier || '—'} · ${sub.billing?.creditUsagePercent != null ? `${sub.billing.creditUsagePercent.toFixed(0)}%` : '—'}`,
          })
        } else {
          setFlash({
            kind: 'err',
            text: `${t('refreshAccountFail')}${sub.error ? `：${sub.error}` : ''}`,
          })
        }
      } else {
        setFlash({ kind: 'err', text: t('refreshAccountFail') })
      }

      const profile = await window.grokDesktop.grok.accountProfile()
      setAccount(profile)
    } catch (e) {
      setFlash({ kind: 'err', text: `${t('refreshAccountFail')}：${String(e)}` })
    } finally {
      setRefreshing(false)
    }
  }, [onRefreshSubscription, t])

  const sub = localSub
  const planLabel =
    sub?.subscriptionDisplay ||
    sub?.subscriptionTier ||
    (boot.authPresent ? t('accountPlanUnknown') : t('loggedOut'))

  const billing = sub?.billing
  const percent = billing?.creditUsagePercent

  return (
    <div className="settings-page">
      <main className="settings-main full">
        <button type="button" className="settings-back-inline" onClick={onBack}>
          ← {t('backToApp')}
        </button>
        <h1>{t('settings')}</h1>

        <section className="settings-block" id="account">
          <h2>{t('account')}</h2>
          <dl className="settings-kv">
            <div>
              <dt>{t('accountEmail')}</dt>
              <dd>
                {sub?.email || account?.email || (boot.authPresent ? '—' : t('loggedOut'))}
              </dd>
            </div>
            <div>
              <dt>{t('accountName')}</dt>
              <dd>{sub?.displayName || account?.displayName || '—'}</dd>
            </div>
            <div>
              <dt>{t('accountPlan')}</dt>
              <dd>
                <strong>{planLabel}</strong>
                {sub?.subscriptionTier &&
                sub.subscriptionDisplay &&
                sub.subscriptionDisplay !== sub.subscriptionTier
                  ? ` · ${sub.subscriptionTier}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt>{t('cliAuth')}</dt>
              <dd>{boot.authPresent ? t('loggedIn') : t('loggedOut')}</dd>
            </div>
            <div>
              <dt>{t('lastSynced')}</dt>
              <dd className="mono">{formatSyncedAt(sub?.fetchedAt)}</dd>
            </div>
          </dl>
          {sub?.error ? <p className="settings-error">{sub.error}</p> : null}
          {flash ? (
            <p className={flash.kind === 'ok' ? 'settings-ok' : 'settings-error'}>{flash.text}</p>
          ) : null}
          <div className="settings-actions">
            {boot.authPresent ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={refreshing}
                onClick={() => void onRefresh()}
              >
                {refreshing ? t('loading') : t('refreshAccount')}
              </button>
            ) : null}
            {onLogout && boot.authPresent ? (
              <button type="button" className="btn-ghost" onClick={onLogout}>
                {t('logout')}
              </button>
            ) : null}
          </div>
        </section>

        <section className="settings-block" id="usage">
          <h2>{t('usageQuota')}</h2>
          <p className="about-body">{t('usageQuotaHint')}</p>

          {billing && percent != null ? (
            <div className="quota-block">
              <div className="quota-label-row">
                <span>{t('periodUsage')}</span>
                <span className="mono">{percent.toFixed(0)}%</span>
              </div>
              <div className="quota-bar" aria-hidden>
                <div
                  className={`quota-fill ${percent >= 90 ? 'hot' : percent >= 70 ? 'warm' : ''}`}
                  style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                />
              </div>
              {billing.periodStart && billing.periodEnd ? (
                <p className="quota-period mono">
                  {billing.periodStart.slice(0, 10)} → {billing.periodEnd.slice(0, 10)}
                </p>
              ) : null}
              {billing.productUsage.length > 0 ? (
                <dl className="settings-kv quota-products">
                  <div>
                    <dt>{t('productUsage')}</dt>
                    <dd className="mono">
                      {billing.productUsage
                        .map((p) => `${p.product} ${p.usagePercent.toFixed(0)}%`)
                        .join(' · ')}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
          ) : (
            <p className="hint-inline">{t('noBillingYet')}</p>
          )}

          <dl className="settings-kv">
            <div>
              <dt>{t('lastTurnCost')}</dt>
              <dd className="mono">
                {usage?.costUsd != null ? `$${usage.costUsd.toFixed(4)}` : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('lastTurnTokens')}</dt>
              <dd className="mono">
                {usage?.totalTokens != null
                  ? `${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out / ${usage.totalTokens} total`
                  : '—'}
              </dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void window.grokDesktop.shell.openExternal('https://grok.com')}
            >
              {t('openUsageWeb')}
            </button>
          </div>
        </section>

        <section className="settings-block" id="language">
          <h2>{t('language')}</h2>
          <div className="lang-row">
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
                className={`lang-chip ${locale === value ? 'active' : ''}`}
                onClick={() => setLocalePreference(value as AppLocale)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-block" id="cli">
          <h2>{t('cliRuntime')}</h2>
          <dl className="settings-kv">
            <div>
              <dt>{t('cliVersion')}</dt>
              <dd className="mono">{boot.version || '—'}</dd>
            </div>
            <div>
              <dt>{t('cliPath')}</dt>
              <dd className="mono truncate" title={boot.binaryPath || ''}>
                {boot.binaryPath || '—'}
              </dd>
            </div>
            <div>
              <dt>{t('mode')}</dt>
              <dd>{boot.phase}</dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button type="button" className="btn-secondary" onClick={onRecheck}>
              {t('recheck')}
            </button>
          </div>
        </section>

        <section className="settings-block" id="about">
          <h2>{t('about')}</h2>
          <p className="about-body">{t('aboutBody')}</p>
        </section>
      </main>
    </div>
  )
}
