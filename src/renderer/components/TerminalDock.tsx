/**
 * Bottom terminal dock — VS Code style.
 * Pattern: main-process node-pty + renderer xterm (microsoft/node-pty electron example).
 * One xterm instance per tab; fit only when container has non-zero size.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { basename } from '../lib/types'
import './TerminalDock.css'

type Tab = {
  id: string
  cwd: string
  title: string
}

type Props = {
  open: boolean
  projectCwd: string
  height: number
  onHeightChange: (h: number) => void
  onClose: () => void
}

type TermBundle = {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
}

export function TerminalDock({ open, projectCwd, height, onHeightChange, onClose }: Props) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const tabsRef = useRef<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ptyOk, setPtyOk] = useState(true)

  const mountRef = useRef<HTMLDivElement>(null)
  const bundlesRef = useRef<Map<string, TermBundle>>(new Map())
  const creatingRef = useRef(false)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const fitActive = useCallback(() => {
    const id = activeIdRef.current
    if (!id) return
    const b = bundlesRef.current.get(id)
    const host = mountRef.current
    if (!b || !host) return
    if (host.clientWidth < 20 || host.clientHeight < 20) return
    try {
      b.fit.fit()
      if (b.term.cols > 1 && b.term.rows > 1) {
        void window.grokDesktop.terminal.resize(id, b.term.cols, b.term.rows)
      }
    } catch {
      // ignore fit races
    }
  }, [])

  const ensureBundle = useCallback(
    (id: string): TermBundle => {
      const existing = bundlesRef.current.get(id)
      if (existing) return existing

      const el = document.createElement('div')
      el.className = 'term-instance'
      el.style.display = 'none'
      el.style.width = '100%'
      el.style.height = '100%'

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
        convertEol: true,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(el)
      term.onData((data) => {
        void window.grokDesktop.terminal.write(id, data)
      })

      const bundle = { term, fit, el }
      bundlesRef.current.set(id, bundle)
      mountRef.current?.appendChild(el)
      return bundle
    },
    [],
  )

  const showTab = useCallback(
    (id: string | null) => {
      for (const [tid, b] of bundlesRef.current) {
        b.el.style.display = tid === id ? 'block' : 'none'
      }
      if (id) {
        const b = ensureBundle(id)
        b.el.style.display = 'block'
        requestAnimationFrame(() => {
          fitActive()
          b.term.focus()
        })
      }
    },
    [ensureBundle, fitActive],
  )

  const createTab = useCallback(
    async (cwd: string, forceNew = false) => {
      const work = cwd || ''
      if (!forceNew) {
        const hit = tabsRef.current.find((t) => t.cwd === work)
        if (hit) {
          setActiveId(hit.id)
          return hit.id
        }
      }
      if (creatingRef.current) return null
      creatingRef.current = true
      try {
        if (!window.grokDesktop?.terminal?.create) {
          setPtyOk(false)
          setError('terminal IPC missing — restart with npm run dev:safe')
          return null
        }
        const av = await window.grokDesktop.terminal.available()
        if (!av.ok) {
          setPtyOk(false)
          setError('node-pty 不可用，请点 ↗ 打开系统终端')
          return null
        }
        const same = tabsRef.current.filter((t) => t.cwd === work).length
        const base = basename(work) || 'shell'
        const title = forceNew && same > 0 ? `${base} · ${same + 1}` : base
        const res = await window.grokDesktop.terminal.create(work, title)
        if (!res.ok || !res.id) {
          setPtyOk(false)
          setError(res.error || '创建 PTY 失败')
          return null
        }
        const tab: Tab = { id: res.id, cwd: work, title }
        ensureBundle(res.id)
        setTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]))
        setActiveId(res.id)
        setError(null)
        setPtyOk(true)
        return res.id
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        creatingRef.current = false
      }
    },
    [ensureBundle],
  )

  // PTY data → correct xterm
  useEffect(() => {
    if (!window.grokDesktop?.terminal) return
    const offData = window.grokDesktop.terminal.onData(({ id, data }) => {
      const b = bundlesRef.current.get(id)
      if (b) b.term.write(data)
    })
    const offExit = window.grokDesktop.terminal.onExit(({ id }) => {
      const b = bundlesRef.current.get(id)
      if (b) {
        b.term.dispose()
        b.el.remove()
        bundlesRef.current.delete(id)
      }
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id)
        setActiveId((cur) => (cur === id ? next[0]?.id ?? null : cur))
        return next
      })
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  // Dispose all on unmount
  useEffect(() => {
    return () => {
      for (const [id, b] of bundlesRef.current) {
        try {
          b.term.dispose()
          b.el.remove()
        } catch {
          // ignore
        }
        void window.grokDesktop?.terminal?.close(id)
      }
      bundlesRef.current.clear()
    }
  }, [])

  // When dock opens → ensure tab for project
  useEffect(() => {
    if (!open) return
    void createTab(projectCwd)
    requestAnimationFrame(() => fitActive())
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow project when open
  useEffect(() => {
    if (!open || !projectCwd) return
    void createTab(projectCwd)
  }, [projectCwd, open, createTab])

  // Switch visible xterm
  useEffect(() => {
    if (!open) return
    showTab(activeId)
  }, [activeId, open, showTab])

  // Resize observer
  useEffect(() => {
    if (!open || !mountRef.current) return
    const ro = new ResizeObserver(() => fitActive())
    ro.observe(mountRef.current)
    return () => ro.disconnect()
  }, [open, fitActive, height])

  // Drag resize handle
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dy = dragRef.current.startY - e.clientY
      const next = Math.min(480, Math.max(120, dragRef.current.startH + dy))
      onHeightChange(next)
    }
    const onUp = () => {
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      fitActive()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onHeightChange, fitActive])

  const onCloseTab = async (id: string) => {
    await window.grokDesktop.terminal.close(id)
    const b = bundlesRef.current.get(id)
    if (b) {
      b.term.dispose()
      b.el.remove()
      bundlesRef.current.delete(id)
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeId === id) setActiveId(next[0]?.id ?? null)
      return next
    })
  }

  if (!open) return null

  return (
    <div className="terminal-dock" style={{ height }}>
      <div
        className="term-dock-resizer"
        onMouseDown={(e) => {
          dragRef.current = { startY: e.clientY, startH: height }
          document.body.style.cursor = 'row-resize'
          document.body.style.userSelect = 'none'
        }}
      />
      <div className="term-dock-bar">
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
                  void onCloseTab(t.id)
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <div className="term-tab-actions">
          <button
            type="button"
            className="term-action"
            title="新建终端"
            onClick={() => void createTab(projectCwd, true)}
          >
            +
          </button>
          <button
            type="button"
            className="term-action"
            title="系统终端"
            onClick={() =>
              void window.grokDesktop.terminal.openExternal(
                projectCwd || tabs.find((t) => t.id === activeId)?.cwd || '',
              )
            }
          >
            ↗
          </button>
          <button type="button" className="term-action" title="关闭面板" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      {error ? (
        <div className="term-error">
          {error}
          {!ptyOk ? (
            <button
              type="button"
              className="term-action"
              onClick={() =>
                void window.grokDesktop.terminal.openExternal(projectCwd || '')
              }
            >
              打开系统终端
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="term-dock-host" ref={mountRef} />
    </div>
  )
}
