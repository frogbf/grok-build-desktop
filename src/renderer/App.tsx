import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar, type ProjectGroup } from './components/Sidebar'
import { ChatThread } from './components/ChatThread'
import { Composer, type PromptOptions } from './components/Composer'
import { RightPanel, type PanelMode, type UsageSnapshot } from './components/RightPanel'
import { TerminalDock } from './components/TerminalDock'
import { SetupGate } from './components/SetupGate'
import { SettingsPage } from './components/SettingsPage'
import { SkillsPage } from './components/SkillsPage'
import { SessionSearch } from './components/SessionSearch'
import {
  basename,
  newSessionId,
  uid,
  type ChatMessage,
  type Session,
} from './lib/types'
import { parseStreamEvent } from './lib/stream'
import type { ModelOption } from './lib/agent-options'
import {
  loadTier,
  mapApiTierToTheme,
  saveTier,
  TIER_LABEL,
  type SubscriptionTier,
} from './lib/tier'
import { useLocale } from './hooks/useLocale'
import type { AccountSubscription, BootstrapState, GitStatus } from '../preload/index'
import './App.css'

const INITIAL_BOOT: BootstrapState = {
  phase: 'checking',
  available: false,
  binaryPath: null,
  version: null,
  authPresent: false,
  authPath: '',
  message: '…',
  installCommand: 'curl -fsSL https://x.ai/cli/install.sh | bash',
  lastError: null,
  busyAction: null,
}

function createSession(cwd: string, title = 'New'): Session {
  const now = Date.now()
  return {
    id: newSessionId(),
    title,
    cwd,
    projectName: basename(cwd) || 'workspace',
    updatedAt: now,
    status: 'idle',
    messages: [],
    onDisk: false,
  }
}

function groupSessions(sessions: Session[], fallbackCwd: string): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>()
  for (const s of sessions) {
    const key = s.cwd || fallbackCwd || '__none__'
    const name = s.projectName || basename(key) || 'project'
    if (!map.has(key)) {
      map.set(key, { name, cwd: s.cwd || fallbackCwd, sessions: [] })
    }
    map.get(key)!.sessions.push(s)
  }
  for (const g of map.values()) {
    g.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  // Prefer groups with most recent activity
  return [...map.values()].sort((a, b) => {
    const ta = a.sessions[0]?.updatedAt || 0
    const tb = b.sessions[0]?.updatedAt || 0
    return tb - ta
  })
}

export default function App() {
  const { t, tick } = useLocale()
  void tick

  const [boot, setBoot] = useState<BootstrapState>(INITIAL_BOOT)
  const [setupLogs, setSetupLogs] = useState<string[]>([])
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [tier, setTier] = useState<SubscriptionTier>(() => loadTier())
  const [showSettings, setShowSettings] = useState(false)
  const [showSkills, setShowSkills] = useState(false)

  const [cwd, setCwd] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('review')
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(220)
  const [rawLog, setRawLog] = useState<string[]>([])
  const [lastUsage, setLastUsage] = useState<UsageSnapshot | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [defaultModel, setDefaultModel] = useState('grok-4.5')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [subscription, setSubscription] = useState<AccountSubscription | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const toolOffsetRef = useRef(0)

  const ready = boot.phase === 'ready'
  const mode = ready ? 'live' : 'demo'

  const refreshSubscription = useCallback(async (): Promise<AccountSubscription | null> => {
    if (typeof window.grokDesktop?.grok?.accountSubscription !== 'function') {
      return null
    }
    try {
      const sub = await window.grokDesktop.grok.accountSubscription()
      setSubscription(sub)
      if (sub.ok) {
        const mapped = mapApiTierToTheme(sub.subscriptionTier, sub.subscriptionDisplay)
        if (mapped) {
          setTier(mapped)
          saveTier(mapped, false)
        }
      }
      return sub
    } catch {
      return null
    }
  }, [])

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  )

  const workCwd = cwd || active?.cwd || ''

  const refreshGit = useCallback(async (dir?: string) => {
    const work = (dir ?? workCwd).trim()
    if (!work || !window.grokDesktop?.git?.status) {
      setGitStatus(null)
      return
    }
    try {
      const st = await window.grokDesktop.git.status(work)
      setGitStatus(st)
    } catch {
      setGitStatus(null)
    }
  }, [workCwd])

  const groups = useMemo(() => groupSessions(sessions, cwd), [sessions, cwd])

  const projectName = useMemo(() => {
    if (active?.projectName) return active.projectName
    if (cwd) return basename(cwd)
    return t('selectProject')
  }, [active, cwd, t])

  const hasMessages = (active?.messages.length ?? 0) > 0
  const isEmptyHome = !active || !hasMessages

  const patchSession = useCallback((id: string, fn: (s: Session) => Session) => {
    setSessions((list) => list.map((s) => (s.id === id ? fn(s) : s)))
  }, [])

  const refreshBootstrap = useCallback(async () => {
    const api = window.grokDesktop
    if (!api?.grok?.bootstrap) {
      setBoot((prev) => ({
        ...prev,
        phase: 'need_cli',
        message:
          'window.grokDesktop missing — run: npm run dev:safe (Electron, not browser)',
        lastError:
          typeof window !== 'undefined' && window.location?.protocol?.startsWith('http')
            ? window.location.href
            : 'preload missing',
      }))
      return
    }
    try {
      const state = await api.grok.bootstrap()
      setBoot(state)
    } catch (err) {
      setBoot((prev) => ({
        ...prev,
        phase: 'need_cli',
        message: 'IPC failed',
        lastError: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [])

  const loadModels = useCallback(async () => {
    const api = window.grokDesktop
    if (!api?.grok?.listModels) return
    try {
      const catalog = await api.grok.listModels()
      setDefaultModel(catalog.defaultModel || 'grok-4.5')
      setModels(
        catalog.models.map((m) => ({
          id: m.id,
          name: m.name,
          efforts: m.efforts,
          supportsReasoningEffort: m.supportsReasoningEffort,
        })),
      )
    } catch {
      // keep previous / fallback in Composer
    }
  }, [])

  const loadSessionsFromDisk = useCallback(async () => {
    const api = window.grokDesktop
    if (!api?.grok?.listSessions) return
    try {
      const items = await api.grok.listSessions(200)
      setSessions((prev) => {
        // Keep in-memory draft sessions that are not yet on disk
        const drafts = prev.filter((s) => !s.onDisk && s.messages.length === 0)
        const draftIds = new Set(drafts.map((s) => s.id))
        const fromDisk: Session[] = items
          .filter((it) => !draftIds.has(it.id))
          .map((it) => {
            const existing = prev.find((s) => s.id === it.id)
            // Preserve already-loaded messages / running state
            if (existing && (existing.messages.length > 0 || existing.status === 'running')) {
              return {
                ...existing,
                title: it.title || existing.title,
                cwd: it.cwd,
                projectName: it.projectName,
                updatedAt: Math.max(existing.updatedAt, it.updatedAt),
                onDisk: true,
                modelId: it.modelId,
                effort: it.effort,
              }
            }
            return {
              id: it.id,
              title: it.title || '—',
              cwd: it.cwd,
              projectName: it.projectName,
              updatedAt: it.updatedAt,
              status: 'idle' as const,
              messages: existing?.messages ?? [],
              onDisk: true,
              modelId: it.modelId,
              effort: it.effort,
            }
          })
        const diskIds = new Set(fromDisk.map((s) => s.id))
        const keepDrafts = drafts.filter((d) => !diskIds.has(d.id))
        return [...keepDrafts, ...fromDisk]
      })
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void refreshBootstrap()
    const timer = window.setTimeout(() => {
      if (!window.grokDesktop) void refreshBootstrap()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [refreshBootstrap])

  // When ready, pull models + official sessions + account
  useEffect(() => {
    if (!ready) return
    void loadModels()
    void loadSessionsFromDisk()
    void refreshSubscription()
  }, [ready, loadModels, loadSessionsFromDisk, refreshSubscription])

  // Git status for title bar / review panel
  useEffect(() => {
    void refreshGit(workCwd)
  }, [workCwd, refreshGit])

  useEffect(() => {
    const onFocus = () => {
      void refreshGit()
    }
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void refreshGit(), 8000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [refreshGit])

  useEffect(() => {
    if (!window.grokDesktop) return
    const off = window.grokDesktop.grok.onEvent((event) => {
      if (event.type === 'bootstrap') setBoot(event.payload)
      if (event.type === 'install_log') {
        setSetupLogs((logs) => [...logs.slice(-80), event.line])
      }
      if (event.type === 'stdout' || event.type === 'stderr') {
        setRawLog((log) => [...log.slice(-200), event.line])
        const ev = parseStreamEvent(event.line)
        if (ev.kind === 'ignore') return
        if (ev.kind === 'usage') {
          setLastUsage(ev.usage)
          return
        }
        if (ev.kind === 'system') {
          patchSession(event.sessionId, (s) => ({
            ...s,
            onDisk: true,
            messages: [
              ...s.messages,
              {
                id: uid('sys'),
                role: 'system',
                content: ev.text,
                createdAt: Date.now(),
              },
            ],
          }))
          return
        }
        if (ev.kind === 'thought') {
          patchSession(event.sessionId, (s) => {
            const last = s.messages[s.messages.length - 1]
            if (last?.meta?.kind === 'thought' && last.id.startsWith('thought_stream')) {
              return {
                ...s,
                onDisk: true,
                messages: s.messages.map((m) =>
                  m.id === last.id ? { ...m, content: `${m.content}${ev.text}` } : m,
                ),
              }
            }
            return {
              ...s,
              onDisk: true,
              messages: [
                ...s.messages,
                {
                  id: `thought_stream_${uid()}`,
                  role: 'assistant',
                  content: ev.text,
                  createdAt: Date.now(),
                  meta: { kind: 'thought' },
                },
              ],
            }
          })
          return
        }
        if (ev.kind === 'text') {
          patchSession(event.sessionId, (s) => {
            const last = s.messages[s.messages.length - 1]
            if (last?.role === 'assistant' && last.id.startsWith('stream_')) {
              return {
                ...s,
                onDisk: true,
                messages: s.messages.map((m) =>
                  m.id === last.id ? { ...m, content: `${m.content}${ev.text}` } : m,
                ),
              }
            }
            return {
              ...s,
              onDisk: true,
              messages: [
                ...s.messages,
                {
                  id: `stream_${uid()}`,
                  role: 'assistant',
                  content: ev.text,
                  createdAt: Date.now(),
                  meta: { kind: 'text' },
                },
              ],
            }
          })
        }
      }
      if (event.type === 'error') {
        setRawLog((log) => [...log, `[error] ${event.message}`])
        patchSession(event.sessionId, (s) => ({
          ...s,
          status: 'error',
          messages: [
            ...s.messages,
            {
              id: uid('sys'),
              role: 'system',
              content: event.message,
              createdAt: Date.now(),
            },
          ],
        }))
      }
      if (event.type === 'exit') {
        patchSession(event.sessionId, (s) => ({
          ...s,
          status: event.code && event.code !== 0 ? 'error' : 'idle',
          onDisk: true,
          updatedAt: Date.now(),
        }))
        void refreshGit()
        // Refresh titles from disk after turn
        if (event.code === 0 || event.code === null) {
          void loadSessionsFromDisk()
        }
      }
    })
    return () => off()
  }, [patchSession, loadSessionsFromDisk, refreshGit])

  const runningSessionId = useMemo(
    () => sessions.find((s) => s.status === 'running')?.id ?? null,
    [sessions],
  )

  // Poll updates.jsonl for tool_call cards while a session is running
  useEffect(() => {
    if (!runningSessionId || !window.grokDesktop?.grok?.sessionToolEvents) return

    // Reset offset only when the running session changes
    toolOffsetRef.current = 0

    const tick = async () => {
      try {
        const res = await window.grokDesktop.grok.sessionToolEvents(
          runningSessionId,
          toolOffsetRef.current,
        )
        if (!res.ok) return
        toolOffsetRef.current = res.offset
        if (!res.events.length) return
        patchSession(runningSessionId, (s) => {
          let messages = [...s.messages]
          for (const ev of res.events) {
            const existingIdx = messages.findIndex(
              (m) => m.meta?.toolCallId === ev.toolCallId,
            )
            if (existingIdx >= 0) {
              const prev = messages[existingIdx]
              messages[existingIdx] = {
                ...prev,
                content: ev.title,
                meta: {
                  ...prev.meta,
                  kind: 'tool',
                  toolName: ev.title,
                  toolCallId: ev.toolCallId,
                  status: ev.status,
                },
              }
            } else {
              messages.push({
                id: `tool_${ev.toolCallId}`,
                role: 'tool',
                content: ev.title,
                createdAt: Date.now(),
                meta: {
                  kind: 'tool',
                  toolName: ev.title,
                  toolCallId: ev.toolCallId,
                  status: ev.status,
                },
              })
            }
          }
          return { ...s, messages, onDisk: true }
        })
      } catch {
        // ignore poll errors
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), 1200)
    return () => window.clearInterval(timer)
  }, [runningSessionId, patchSession])

  const onNewSession = useCallback(() => {
    if (!ready) return
    const s = createSession(cwd, t('newTask'))
    setSessions((list) => [s, ...list])
    setActiveId(s.id)
    setRawLog([])
  }, [cwd, ready, t])

  const openPanel = useCallback((mode: PanelMode) => {
    setPanelMode(mode)
    setPanelOpen(true)
  }, [])

  const toggleTerminal = useCallback(() => {
    setTerminalOpen((o) => !o)
  }, [])

  const togglePanel = useCallback(() => {
    setPanelOpen((o) => !o)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        onNewSession()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (ready) setSearchOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
        setShowSkills(false)
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault()
        toggleTerminal()
      }
      if (e.key === 'Escape' && panelOpen && !searchOpen) {
        setPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNewSession, toggleTerminal, ready, panelOpen, searchOpen])

  const onPickCwd = async () => {
    if (!ready) return
    const dir = await window.grokDesktop.dialog.pickDirectory()
    if (!dir) return
    setCwd(dir)
    const name = basename(dir)
    setSessions((list) =>
      list.map((s) =>
        s.id === activeId && !s.onDisk
          ? { ...s, cwd: dir, projectName: name }
          : s,
      ),
    )
  }

  const onSelectSession = async (id: string) => {
    setActiveId(id)
    setRawLog([])
    const existing = sessions.find((s) => s.id === id)
    if (!existing) return
    if (existing.cwd) setCwd(existing.cwd)

    // Reload history for idle disk sessions so sanitize / filter updates apply
    // (skip while running so in-flight stream is not wiped)
    const loadHistory = window.grokDesktop?.grok?.loadSessionHistory
    const shouldLoadHistory =
      existing.onDisk &&
      existing.status !== 'running' &&
      typeof loadHistory === 'function' &&
      (existing.messages.length === 0 || existing.messages.every((m) => m.id.startsWith('hist_')))
    if (shouldLoadHistory && loadHistory) {
      setHistoryLoading(true)
      try {
        const res = await loadHistory(id, 80)
        if (res.ok) {
          const msgs: ChatMessage[] = res.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt || existing.updatedAt,
          }))
          patchSession(id, (s) => ({
            ...s,
            messages: msgs,
            cwd: res.cwd || s.cwd,
            projectName: basename(res.cwd || s.cwd),
            onDisk: true,
          }))
          if (res.cwd) setCwd(res.cwd)
        }
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  const ensureSession = (): { id: string; resume: boolean; sessionCwd: string } => {
    if (activeId && sessions.some((s) => s.id === activeId)) {
      const s = sessions.find((x) => x.id === activeId)!
      const resume = Boolean(s.onDisk || s.messages.some((m) => m.role === 'user'))
      return {
        id: s.id,
        resume,
        sessionCwd: cwd || s.cwd || '',
      }
    }
    const s = createSession(cwd, t('newTask'))
    setSessions((list) => [s, ...list])
    setActiveId(s.id)
    return { id: s.id, resume: false, sessionCwd: cwd || s.cwd || '' }
  }

  const onSubmit = async (text: string, opts: PromptOptions) => {
    if (!ready) {
      setActionMessage(t('needReady'))
      return
    }
    const { id: sessionId, resume, sessionCwd } = ensureSession()
    const now = Date.now()
    const userMsg: ChatMessage = {
      id: uid('user'),
      role: 'user',
      content: text,
      createdAt: now,
    }

    setSessions((list) =>
      list.map((s) => {
        if (s.id !== sessionId) return s
        const title =
          s.messages.filter((m) => m.role === 'user').length === 0
            ? text.slice(0, 42)
            : s.title
        return {
          ...s,
          title,
          status: 'running',
          updatedAt: now,
          cwd: sessionCwd || s.cwd,
          projectName: basename(sessionCwd || s.cwd),
          messages: [...s.messages, userMsg],
        }
      }),
    )
    setRawLog([])
    toolOffsetRef.current = 0
    setPanelOpen(true)
    if (panelMode !== 'browser') setPanelMode('review')

    await window.grokDesktop.grok.prompt({
      sessionId,
      cwd: sessionCwd,
      prompt: text,
      model: opts.model,
      effort: opts.effort,
      permissionMode: opts.permissionMode,
      resume,
    })
  }

  const onStop = () => {
    if (!activeId) return
    window.grokDesktop.grok.stop(activeId)
    patchSession(activeId, (s) => ({ ...s, status: 'idle' }))
  }

  const onInstall = async () => {
    setActionMessage(null)
    setSetupLogs([])
    const res = await window.grokDesktop.grok.install()
    setActionMessage(res.message)
    await refreshBootstrap()
  }

  const onLogin = async () => {
    setActionMessage(null)
    const res = await window.grokDesktop.grok.login()
    setActionMessage(res.message)
    await refreshBootstrap()
  }

  const onLogout = async () => {
    setActionMessage(null)
    const res = await window.grokDesktop.grok.logout()
    setActionMessage(res.message)
    await refreshBootstrap()
  }

  const onRecheck = async () => {
    setActionMessage(null)
    const state = await window.grokDesktop.grok.recheck()
    setBoot(state)
    if (state.phase === 'ready') {
      await loadModels()
      await loadSessionsFromDisk()
    }
  }

  const composer = (
    <Composer
      projectName={projectName}
      floating={isEmptyHome}
      disabled={!ready || historyLoading}
      running={active?.status === 'running'}
      models={models}
      defaultModel={defaultModel}
      t={t}
      onSubmit={onSubmit}
      onStop={onStop}
      onPickProject={onPickCwd}
    />
  )

  return (
    <div className="app-shell" data-tier={tier}>
      <TitleBar
        mode={mode}
        tier={tier}
        git={gitStatus}
        cwd={workCwd}
        t={t}
        title={
          showSettings
            ? t('settings')
            : showSkills
              ? t('skills')
              : ready
                ? hasMessages
                  ? active?.title
                  : TIER_LABEL[tier]
                : t('setup')
        }
        panelOpen={panelOpen}
        panelMode={panelMode}
        terminalOpen={terminalOpen}
        onToggleTerminal={toggleTerminal}
        onSetPanelMode={openPanel}
        onTogglePanel={togglePanel}
        onGitChanged={() => void refreshGit()}
      />

      <SessionSearch
        open={searchOpen}
        sessions={sessions}
        t={t}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => {
          void onSelectSession(id)
        }}
      />

      {showSettings ? (
        <div className="workspace setup-only">
          <SettingsPage
            boot={boot}
            usage={lastUsage}
            subscription={subscription}
            t={t}
            onBack={() => setShowSettings(false)}
            onLogout={boot.authPresent ? onLogout : undefined}
            onRecheck={onRecheck}
            onRefreshSubscription={refreshSubscription}
          />
        </div>
      ) : showSkills ? (
        <div className="workspace setup-only">
          <SkillsPage
            cwd={cwd || active?.cwd || ''}
            t={t}
            onBack={() => setShowSkills(false)}
          />
        </div>
      ) : !ready ? (
        <div className="workspace setup-only">
          <main className="main-pane">
            <SetupGate
              boot={boot}
              logs={setupLogs}
              actionMessage={actionMessage}
              tier={tier}
              t={t}
              onInstall={onInstall}
              onLogin={onLogin}
              onRecheck={onRecheck}
              onLogout={boot.authPresent ? onLogout : undefined}
              onOpenSettings={() => setShowSettings(true)}
            />
          </main>
        </div>
      ) : (
        <div className={`workspace ${panelOpen ? 'with-right' : ''}`}>
          <Sidebar
            groups={groups}
            activeId={activeId}
            statusMessage={boot.message}
            mode={mode}
            subscription={subscription}
            t={t}
            onOpenSettings={() => {
              setShowSkills(false)
              setShowSettings(true)
            }}
            onLogout={boot.authPresent ? onLogout : undefined}
            onSelect={(id) => {
              void onSelectSession(id)
            }}
            onNewSession={onNewSession}
            onPickCwd={onPickCwd}
            onSearch={() => setSearchOpen(true)}
            onOpenSkills={() => {
              setShowSettings(false)
              setShowSkills(true)
            }}
          />

          <main className="main-pane">
            <div className="main-chat">
              <ChatThread
                messages={active?.messages ?? []}
                running={active?.status === 'running' || historyLoading}
                emptySlot={isEmptyHome ? composer : undefined}
                tier={tier}
                t={t}
              />
              {!isEmptyHome && composer}
            </div>
            <TerminalDock
              open={terminalOpen}
              projectCwd={cwd || active?.cwd || ''}
              height={terminalHeight}
              onHeightChange={setTerminalHeight}
              onClose={() => setTerminalOpen(false)}
            />
          </main>

          {panelOpen && (
            <RightPanel
              mode={panelMode}
              cwd={cwd || active?.cwd || ''}
              appMode={mode}
              binaryPath={boot.binaryPath}
              cliVersion={boot.version}
              rawLog={rawLog}
              usage={lastUsage}
              git={gitStatus}
              t={t}
              onModeChange={(m) => {
                setPanelMode(m)
                setPanelOpen(true)
              }}
              onClose={() => setPanelOpen(false)}
              onRefreshGit={() => void refreshGit()}
            />
          )}
        </div>
      )}
    </div>
  )
}
