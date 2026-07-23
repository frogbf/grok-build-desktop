import { useEffect, useMemo, useState } from 'react'
import type { GitStatus } from '../../preload/index'
import type { MessageKey } from '../i18n/locales/zh'
import { BrowserPane } from './BrowserPane'
import './RightPanel.css'

export type PanelMode = 'review' | 'browser'

export type UsageSnapshot = {
  costUsd: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

type Props = {
  mode: PanelMode
  cwd: string
  appMode: 'demo' | 'live'
  binaryPath: string | null
  cliVersion?: string | null
  rawLog: string[]
  usage: UsageSnapshot | null
  git: GitStatus | null
  t: (key: MessageKey) => string
  onModeChange: (mode: PanelMode) => void
  onClose: () => void
  onRefreshGit?: () => void
}

type FileRow = {
  line: string
  code: string
  path: string
}

function parseRows(lines: string[]): FileRow[] {
  const rows: FileRow[] = []
  for (const line of lines) {
    if (!line || line.length < 4) continue
    const code = line.slice(0, 2)
    let rest = line.slice(3)
    if (rest.includes(' -> ')) {
      rest = rest.split(' -> ').pop() || rest
    }
    const path = rest.replace(/^"|"$/g, '').trim()
    if (path) rows.push({ line, code, path })
  }
  return rows
}

export function RightPanel({
  mode,
  cwd,
  appMode,
  binaryPath,
  cliVersion,
  rawLog,
  usage,
  git,
  t,
  onModeChange,
  onClose,
  onRefreshGit,
}: Props) {
  const branchText = !git?.isRepo
    ? t('gitNoRepo')
    : git.detached
      ? `${git.branch || 'HEAD'} · ${t('gitDetached')}`
      : git.branch || '—'

  const files = useMemo(() => parseRows(git?.shortStatus || []), [git?.shortStatus])
  const [selected, setSelected] = useState<string | null>(null)
  const [diffText, setDiffText] = useState('')
  const [diffMode, setDiffMode] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)

  useEffect(() => {
    // Clear selection when cwd/status changes if path gone
    if (selected && !files.some((f) => f.path === selected)) {
      setSelected(null)
      setDiffText('')
      setDiffMode('')
    }
  }, [files, selected])

  const loadDiff = async (path: string) => {
    setSelected(path)
    if (!cwd || !window.grokDesktop?.git?.diff) {
      setDiffText('')
      return
    }
    setDiffLoading(true)
    try {
      const res = await window.grokDesktop.git.diff(cwd, path)
      if (res.ok) {
        setDiffText(res.diff || t('gitNoDiff'))
        setDiffMode(res.mode)
      } else {
        setDiffText(res.error || t('gitNoDiff'))
        setDiffMode('')
      }
    } catch (e) {
      setDiffText(e instanceof Error ? e.message : String(e))
    } finally {
      setDiffLoading(false)
    }
  }

  return (
    <aside className="right-panel">
      <div className="right-panel-head">
        <div className="right-panel-modes">
          {(['review', 'browser'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`rp-mode ${mode === m ? 'active' : ''}`}
              onClick={() => onModeChange(m)}
            >
              {t(MODE_LABEL[m])}
            </button>
          ))}
        </div>
        <button type="button" className="rp-close" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      <div className="right-panel-body">
        {mode === 'browser' && <BrowserPane />}
        {mode === 'review' && (
          <div className="review-pane">
            <section className="inspector-block">
              <div className="git-head-row">
                <h3>{t('gitBranch')}</h3>
                {onRefreshGit ? (
                  <button type="button" className="git-refresh" onClick={onRefreshGit}>
                    {t('gitRefresh')}
                  </button>
                ) : null}
              </div>
              <dl className="kv">
                <div>
                  <dt>{t('gitBranch')}</dt>
                  <dd className="mono truncate" title={branchText}>
                    {branchText}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {git?.isRepo
                      ? git.dirty
                        ? `${t('gitDirty')} · ${git.dirtyCount}`
                        : t('gitClean')
                      : '—'}
                    {git?.isRepo && (git.ahead > 0 || git.behind > 0)
                      ? ` · ↑${git.ahead} ↓${git.behind}`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt>{t('directory')}</dt>
                  <dd className="mono truncate" title={cwd}>
                    {cwd || '—'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="inspector-block grow">
              <h3>{t('gitChanges')}</h3>
              {!git?.isRepo ? (
                <p className="hint">{t('gitNoRepo')}</p>
              ) : files.length === 0 ? (
                <p className="hint">{t('gitNoChanges')}</p>
              ) : (
                <ul className="git-file-list">
                  {files.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        className={`git-file-row ${selected === f.path ? 'active' : ''}`}
                        onClick={() => void loadDiff(f.path)}
                        title={f.line}
                      >
                        <span className="git-file-code mono">{f.code}</span>
                        <span className="git-file-path mono truncate">{f.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {selected ? (
                <div className="git-diff-block">
                  <div className="git-diff-head">
                    <span className="mono truncate" title={selected}>
                      {selected}
                    </span>
                    {diffMode ? <span className="git-diff-mode">{diffMode}</span> : null}
                  </div>
                  <pre className="mono diff-sample selectable">
                    {diffLoading ? t('loading') : diffText || t('gitNoDiff')}
                  </pre>
                </div>
              ) : files.length > 0 ? (
                <p className="hint">{t('gitDiffHint')}</p>
              ) : null}
            </section>

            <section className="inspector-block">
              <h3>{t('lastUsage')}</h3>
              {usage ? (
                <dl className="kv usage-kv">
                  <div>
                    <dt>Cost</dt>
                    <dd className="mono">
                      {usage.costUsd != null ? `$${usage.costUsd.toFixed(4)}` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>In</dt>
                    <dd className="mono">{usage.inputTokens ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Out</dt>
                    <dd className="mono">{usage.outputTokens ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd className="mono">{usage.totalTokens ?? '—'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="hint">{t('noUsageYet')}</p>
              )}
            </section>

            <details className="inspector-block runtime-details">
              <summary>{t('runtimeCollapsed')}</summary>
              <dl className="kv">
                <div>
                  <dt>{t('mode')}</dt>
                  <dd>{appMode}</dd>
                </div>
                <div>
                  <dt>{t('cliVersion')}</dt>
                  <dd className="mono">{cliVersion || '—'}</dd>
                </div>
                <div>
                  <dt>CLI</dt>
                  <dd className="mono truncate" title={binaryPath || ''}>
                    {binaryPath || '—'}
                  </dd>
                </div>
              </dl>
              <div className="log mono selectable">
                {rawLog.length === 0 ? (
                  <span className="muted">{t('waitingOutput')}</span>
                ) : (
                  rawLog.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 16)}`}>{line}</div>
                  ))
                )}
              </div>
            </details>
          </div>
        )}
      </div>
    </aside>
  )
}

const MODE_LABEL: Record<PanelMode, MessageKey> = {
  review: 'panelReview',
  browser: 'panelBrowser',
}
