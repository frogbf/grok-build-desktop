import { contextBridge, ipcRenderer, webFrame } from 'electron'

export type BootstrapPhase =
  | 'checking'
  | 'need_cli'
  | 'need_auth'
  | 'ready'
  | 'busy'

export type BootstrapState = {
  phase: BootstrapPhase
  available: boolean
  binaryPath: string | null
  version: string | null
  authPresent: boolean
  authPath: string
  message: string
  installCommand: string
  lastError: string | null
  busyAction: null | 'install' | 'login' | 'logout'
}

export type GrokStatus = {
  available: boolean
  binaryPath: string | null
  version: string | null
  mode: 'demo' | 'live'
  message: string
  phase: BootstrapPhase
  authPresent: boolean
}

export type ModelEffortOption = {
  id: string
  value: string
  label: string
  default?: boolean
}

export type ModelInfo = {
  id: string
  name: string
  efforts: ModelEffortOption[]
  supportsReasoningEffort: boolean
  hidden: boolean
}

export type ModelsCatalog = {
  defaultModel: string
  models: ModelInfo[]
  source: 'cache' | 'fallback'
}

export type SessionListItem = {
  id: string
  title: string
  cwd: string
  projectName: string
  updatedAt: number
  modelId: string | null
  effort: string | null
  messageCount: number
}

export type SessionHistoryMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
}

export type AccountProfile = {
  email: string | null
  displayName: string | null
  userId: string | null
  teamId: string | null
  expiresAt: string | null
  authPresent: boolean
}

export type AccountBillingSnapshot = {
  creditUsagePercent: number | null
  periodStart: string | null
  periodEnd: string | null
  periodType: string | null
  productUsage: Array<{ product: string; usagePercent: number }>
  onDemandCap: number | null
  onDemandUsed: number | null
}

export type AccountSubscription = {
  ok: boolean
  authPresent: boolean
  email: string | null
  displayName: string | null
  userId: string | null
  subscriptionTier: string | null
  subscriptionDisplay: string | null
  hasGrokCodeAccess: boolean | null
  allowAccess: boolean | null
  profileImageAssetId: string | null
  avatarDataUrl: string | null
  billing: AccountBillingSnapshot | null
  fetchedAt: number
  error?: string
}

export type GitStatus = {
  isRepo: boolean
  branch: string | null
  detached: boolean
  dirty: boolean
  dirtyCount: number
  ahead: number
  behind: number
  shortStatus: string[]
  error?: string
}

export type GitBranchItem = {
  name: string
  current: boolean
}

export type SkillItem = {
  name: string
  description: string
  sourceType: string
  path: string | null
  userInvocable: boolean
  disabled: boolean
}

export type TerminalTabInfo = {
  id: string
  cwd: string
  title: string
  pid: number | null
}

export type RuntimeEvent =
  | { type: 'bootstrap'; payload: BootstrapState }
  | { type: 'install_log'; line: string }
  | { type: 'stdout'; sessionId: string; line: string }
  | { type: 'stderr'; sessionId: string; line: string }
  | { type: 'exit'; sessionId: string; code: number | null }
  | { type: 'error'; sessionId: string; message: string }

const api = {
  platform: process.platform as NodeJS.Platform,
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  grok: {
    bootstrap: (): Promise<BootstrapState> => ipcRenderer.invoke('grok:bootstrap'),
    status: (): Promise<GrokStatus> => ipcRenderer.invoke('grok:status'),
    recheck: (): Promise<BootstrapState> => ipcRenderer.invoke('grok:recheck'),
    install: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('grok:install'),
    login: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('grok:login'),
    logout: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('grok:logout'),
    listModels: (): Promise<ModelsCatalog> => ipcRenderer.invoke('grok:listModels'),
    listSessions: (limit?: number): Promise<SessionListItem[]> =>
      ipcRenderer.invoke('grok:listSessions', limit),
    loadSessionHistory: (
      sessionId: string,
      limit?: number,
    ): Promise<{
      ok: boolean
      messages: SessionHistoryMessage[]
      cwd?: string
      error?: string
    }> => ipcRenderer.invoke('grok:loadSessionHistory', sessionId, limit),
    accountProfile: (): Promise<AccountProfile> => ipcRenderer.invoke('grok:accountProfile'),
    accountSubscription: (): Promise<AccountSubscription> =>
      ipcRenderer.invoke('grok:accountSubscription'),
    listSkills: (
      cwd?: string,
    ): Promise<{ ok: boolean; skills: SkillItem[]; error?: string; source: 'inspect' | 'fs' }> =>
      ipcRenderer.invoke('grok:listSkills', cwd),
    setSkillDisabled: (
      name: string,
      disabled: boolean,
    ): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('grok:setSkillDisabled', name, disabled),
    prompt: (payload: {
      sessionId: string
      cwd: string
      prompt: string
      model?: string
      effort?: string
      permissionMode?: string
      resume?: boolean
    }): Promise<{ ok: boolean }> => ipcRenderer.invoke('grok:prompt', payload),
    stop: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('grok:stop', sessionId),
    sessionToolEvents: (
      sessionId: string,
      byteOffset?: number,
    ): Promise<{
      ok: boolean
      offset: number
      events: Array<{
        toolCallId: string
        title: string
        status: 'running' | 'done' | 'error'
        kind?: string
      }>
      error?: string
    }> => ipcRenderer.invoke('grok:sessionToolEvents', sessionId, byteOffset),
    onEvent: (handler: (event: RuntimeEvent) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: RuntimeEvent) => handler(event)
      ipcRenderer.on('grok:event', listener)
      return () => {
        ipcRenderer.removeListener('grok:event', listener)
      }
    },
  },
  git: {
    status: (cwd: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', cwd),
    listBranches: (
      cwd: string,
    ): Promise<{ ok: boolean; branches: GitBranchItem[]; error?: string }> =>
      ipcRenderer.invoke('git:listBranches', cwd),
    checkout: (
      cwd: string,
      name: string,
    ): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('git:checkout', cwd, name),
    diff: (
      cwd: string,
      filePath: string,
      staged?: boolean,
    ): Promise<{
      ok: boolean
      diff: string
      mode: 'unstaged' | 'staged' | 'untracked' | 'empty'
      error?: string
    }> => ipcRenderer.invoke('git:diff', cwd, filePath, staged),
  },
  terminal: {
    available: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('terminal:available'),
    list: (): Promise<TerminalTabInfo[]> => ipcRenderer.invoke('terminal:list'),
    create: (
      cwd: string,
      title?: string,
    ): Promise<{ ok: boolean; id?: string; error?: string }> =>
      ipcRenderer.invoke('terminal:create', cwd, title),
    write: (id: string, data: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    close: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('terminal:close', id),
    openExternal: (cwd: string): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('terminal:openExternal', cwd),
    onData: (handler: (payload: { id: string; data: string }) => void): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { id: string; data: string },
      ) => handler(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit: (
      handler: (payload: { id: string; exitCode: number }) => void,
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { id: string; exitCode: number },
      ) => handler(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    },
  },
  shell: {
    openPath: (filePath: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('shell:openPath', filePath),
    openExternal: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('shell:openExternal', url),
  },
  dialog: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),
  },
  ui: {
    getZoomFactor: (): number => webFrame.getZoomFactor(),
    setZoomFactor: (factor: number): number => {
      const f = Math.min(1.6, Math.max(0.75, factor))
      webFrame.setZoomFactor(f)
      return f
    },
  },
}

contextBridge.exposeInMainWorld('grokDesktop', api)

export type GrokDesktopApi = typeof api
