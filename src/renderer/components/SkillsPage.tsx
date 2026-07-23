import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SkillItem } from '../../preload/index'
import type { MessageKey } from '../i18n/locales/zh'
import './SkillsPage.css'

type Props = {
  cwd: string
  t: (key: MessageKey) => string
  onBack: () => void
}

export function SkillsPage({ cwd, t, onBack }: Props) {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'inspect' | 'fs' | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!window.grokDesktop?.grok?.listSkills) {
        throw new Error('listSkills IPC missing — restart app with npm run dev:safe')
      }
      const res = await window.grokDesktop.grok.listSkills(cwd || undefined)
      setSkills(Array.isArray(res.skills) ? res.skills : [])
      setSource(res.source || null)
      if (!res.ok && res.error) setError(res.error)
      else if (res.error && res.source === 'fs') setError(`${t('skillsFsFallback')}: ${res.error}`)
      else setError(null)
    } catch (err) {
      setSkills([])
      setSource(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [cwd, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return skills
    return skills.filter(
      (x) =>
        x.name.toLowerCase().includes(s) ||
        x.description.toLowerCase().includes(s) ||
        x.sourceType.toLowerCase().includes(s),
    )
  }, [skills, q])

  const groups = useMemo(() => {
    const map = new Map<string, SkillItem[]>()
    for (const sk of filtered) {
      const key = sk.sourceType || 'unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(sk)
    }
    return [...map.entries()]
  }, [filtered])

  const toggle = async (sk: SkillItem) => {
    setBusy(sk.name)
    try {
      const res = await window.grokDesktop.grok.setSkillDisabled(sk.name, !sk.disabled)
      if (!res.ok) setError(res.message)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const openPath = async (path: string | null) => {
    if (!path) return
    await window.grokDesktop.shell.openPath(path)
  }

  return (
    <div className="skills-page">
      <header className="skills-head">
        <button type="button" className="skills-back" onClick={onBack}>
          ← {t('backToApp')}
        </button>
        <h1>{t('skills')}</h1>
        <p className="skills-sub">{t('skillsHint')}</p>
        <div className="skills-toolbar">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('skillsSearch')}
            className="skills-search"
          />
          <button type="button" className="btn-secondary" onClick={() => void refresh()}>
            {t('recheck')}
          </button>
        </div>
        {source ? (
          <p className="skills-source">
            {source === 'inspect' ? t('skillsSourceInspect') : t('skillsSourceFs')}
            {skills.length ? ` · ${skills.length}` : ''}
          </p>
        ) : null}
        {error ? (
          <div className="skills-error">
            <span>{error}</span>
            <button type="button" className="btn-secondary" onClick={() => void refresh()}>
              {t('recheck')}
            </button>
          </div>
        ) : null}
      </header>

      <div className="skills-body">
        {loading ? (
          <p className="skills-empty">{t('loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="skills-empty">{t('noSkills')}</p>
        ) : (
          groups.map(([src, list]) => (
            <section key={src} className="skills-group">
              <h2>
                {src} · {list.length}
              </h2>
              <ul>
                {list.map((sk) => (
                  <li key={`${src}-${sk.name}`} className={sk.disabled ? 'disabled' : ''}>
                    <div className="skill-main">
                      <strong>{sk.userInvocable ? `/${sk.name}` : sk.name}</strong>
                      <span className="skill-desc">{sk.description || '—'}</span>
                      {sk.path ? (
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => void openPath(sk.path)}
                        >
                          {sk.path}
                        </button>
                      ) : null}
                    </div>
                    <label className="skill-toggle">
                      <input
                        type="checkbox"
                        checked={!sk.disabled}
                        disabled={busy === sk.name}
                        onChange={() => void toggle(sk)}
                      />
                      <span>{sk.disabled ? t('skillOff') : t('skillOn')}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
