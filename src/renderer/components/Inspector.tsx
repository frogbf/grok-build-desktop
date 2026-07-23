import type { MessageKey } from '../i18n/locales/zh'
import './Inspector.css'

type Props = {
  cwd: string
  mode: 'demo' | 'live'
  binaryPath: string | null
  rawLog: string[]
  cliVersion?: string | null
  t: (key: MessageKey) => string
}

export function Inspector({ cwd, mode, binaryPath, rawLog, cliVersion, t }: Props) {
  return (
    <aside className="inspector">
      <div className="inspector-head">{t('inspector')}</div>

      <section className="inspector-block">
        <h3>{t('diffPreview')}</h3>
        <p className="hint">{t('diffHint')}</p>
        <pre className="mono diff-sample selectable">{`@@ -12,6 +12,8 @@
-  // TODO
+  return startAgent()`}</pre>
      </section>

      <section className="inspector-block">
        <h3>{t('runtime')}</h3>
        <dl className="kv">
          <div>
            <dt>{t('mode')}</dt>
            <dd>{mode}</dd>
          </div>
          <div>
            <dt>{t('cliVersion')}</dt>
            <dd className="mono">{cliVersion || '—'}</dd>
          </div>
          <div>
            <dt>{t('directory')}</dt>
            <dd className="mono truncate" title={cwd}>
              {cwd || '—'}
            </dd>
          </div>
          <div>
            <dt>CLI</dt>
            <dd className="mono truncate" title={binaryPath || ''}>
              {binaryPath || '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="inspector-block grow">
        <h3>{t('stream')}</h3>
        <div className="log mono selectable">
          {rawLog.length === 0 ? (
            <span className="muted">{t('waitingOutput')}</span>
          ) : (
            rawLog.map((line, i) => <div key={`${i}-${line.slice(0, 16)}`}>{line}</div>)
          )}
        </div>
      </section>
    </aside>
  )
}
