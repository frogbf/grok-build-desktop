import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { basename } from '../lib/types'
import './TerminalPane.css'

type Tab = {
  id: string
  cwd: string
  title: string
}

type Props = {
  projectCwd: string
  followProject?: boolean
}

export function TerminalPane({ projectCwd, followProject = true }: Props) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const tabsRef = useRef<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const creatingRef = useRef(false)

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const createTab = useCallback(async (cwd: string, forceNew = false) => {
    const work = cwd || ''
    if (!forceNew) {
      const existing = tabsRef.current.find((t) => t.cwd === work)
      if (existing) {
        setActiveId(existing.id)
        return existing.id
      }
    }
    if (creatingRef.current) return null
    creatingRef.current = true
    try {
      const sameCount = tabsRef.current.filter((t) => t.cwd === work).length
      const titleBase = basename(work) || 'shell'
      const title = forceNew && sameCount > 0 ? `${titleBase} · ${sameCount + 1}` : titleBase
      const res = await window.grokDesktop.terminal.create(work, title)
      if (!res.ok || !res.id) {
        setAvailable(false)
        setError(res.error || '无法创建终端')
        return null
      }
      const tab: Tab = { id: res.id, cwd: work, title }
      setTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]))
      setActiveId(res.id)
      setAvailable(true)
      setError(null)
      return res.id
    } finally {
      creatingRef.current = false
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const av = await window.grokDesktop.terminal.available()
      setAvailable(av.ok)
      if (!av.ok) {
        setError('内嵌终端不可用（node-pty），可点 ↗ 打开系统终端')
        return
      }
      if (projectCwd) await createTab(projectCwd)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!followProject || !projectCwd || !available) return
    void createTab(projectCwd)
  }, [projectCwd, followProject, available, createTab])

  useEffect(() => {
    if (!hostRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#0c0c0e',
        foreground: '#e8e8ed',
        cursor: '#c084fc',
        selectionBackground: 'rgba(192,132,252,0.35)',
      },
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    term.onData((data) => {
      const id = activeIdRef.current
      if (id) void window.grokDesktop.terminal.write(id, data)
    })

    const onResize = () => {
      try {
        fit.fit()
        const id = activeIdRef.current
        if (id && term.cols && term.rows) {
          void window.grokDesktop.terminal.resize(id, term.cols, term.rows)
        }
      } catch {
        // ignore
      }
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(hostRef.current)
    window.addEventListener('resize', onResize)

    // Buffer data for inactive tabs is dropped; only active tab is shown.
    // Full multi-buffer would need per-tab Terminal instances — ok for v1.
    const offData = window.grokDesktop.terminal.onData(({ id, data }) => {
      if (id === activeIdRef.current) term.write(data)
    })
    const offExit = window.grokDesktop.terminal.onExit(({ id }) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id)
        setActiveId((cur) => {
          if (cur !== id) return cur
          return next[0]?.id ?? null
        })
        return next
      })
    })

    return () => {
      offData()
      offExit()
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!activeId || !termRef.current || !fitRef.current) return
    termRef.current.focus()
    try {
      fitRef.current.fit()
      void window.grokDesktop.terminal.resize(
        activeId,
        termRef.current.cols,
        termRef.current.rows,
      )
    } catch {
      // ignore
    }
  }, [activeId])

  const onNew = async () => {
    const cwd = projectCwd || tabs.find((t) => t.id === activeId)?.cwd || ''
    await createTab(cwd, true)
  }

  const onClose = async (id: string) => {
    await window.grokDesktop.terminal.close(id)
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeId === id) setActiveId(next[0]?.id ?? null)
      return next
    })
  }

  const openExternal = async () => {
    const cwd = projectCwd || tabs.find((t) => t.id === activeId)?.cwd || ''
    await window.grokDesktop.terminal.openExternal(cwd)
  }

  return (
    <div className="term-pane">
      <div className="term-tabs">
        <div className="term-tab-list">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`term-tab ${t.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(t.id)}
              title={t.cwd}
            >
              <span>{t.title}</span>
              <span
                className="term-tab-x"
                onClick={(e) => {
                  e.stopPropagation()
                  void onClose(t.id)
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <div className="term-tab-actions">
          <button type="button" className="term-action" onClick={() => void onNew()} title="新建">
            +
          </button>
          <button
            type="button"
            className="term-action"
            onClick={() => void openExternal()}
            title="系统终端"
          >
            ↗
          </button>
        </div>
      </div>
      {error ? <div className="term-error">{error}</div> : null}
      <div className="term-host" ref={hostRef} />
    </div>
  )
}
