import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { createInterface } from 'node:readline'
import { dialog } from 'electron'

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
  /**
   * Display title from Grok metadata / first user prompt.
   * Empty string when {@link empty} is true — UI localizes the placeholder.
   */
  title: string
  cwd: string
  projectName: string
  updatedAt: number
  modelId: string | null
  effort: string | null
  messageCount: number
  /**
   * Locale-neutral: no generated_title / session_summary / real user turn.
   * UI decides whether to hide or show with an i18n label.
   */
  empty: boolean
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

export type SkillItem = {
  name: string
  description: string
  sourceType: string
  path: string | null
  userInvocable: boolean
  disabled: boolean
}

/** High-level bootstrap phase for the Desktop shell. */
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

export type RuntimeEvent =
  | { type: 'bootstrap'; payload: BootstrapState }
  | { type: 'install_log'; line: string }
  | { type: 'stdout'; sessionId: string; line: string }
  | { type: 'stderr'; sessionId: string; line: string }
  | { type: 'exit'; sessionId: string; code: number | null }
  | { type: 'error'; sessionId: string; message: string }

const INSTALL_SH = 'curl -fsSL https://x.ai/cli/install.sh | bash'
const INSTALL_PS1 = 'irm https://x.ai/cli/install.ps1 | iex'

/**
 * Thin process manager: never reimplements the agent loop.
 * Desktop orchestrates install/login; agent work goes to official `grok` CLI.
 */
export class GrokRuntime {
  private window: BrowserWindow | null = null
  private children = new Map<string, ChildProcessWithoutNullStreams>()
  private busyAction: BootstrapState['busyAction'] = null
  private lastError: string | null = null

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  private emit(event: RuntimeEvent): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('grok:event', event)
    }
  }

  private authPath(): string {
    return join(homedir(), '.grok', 'auth.json')
  }

  private grokHome(): string {
    return process.env.GROK_HOME?.trim() || join(homedir(), '.grok')
  }

  private sessionsRoot(): string {
    return join(this.grokHome(), 'sessions')
  }

  private modelsCachePath(): string {
    return join(this.grokHome(), 'models_cache.json')
  }

  private installCommand(): string {
    return platform() === 'win32' ? INSTALL_PS1 : INSTALL_SH
  }

  /** Models from ~/.grok/models_cache.json (same source as CLI picker). */
  listModels(): ModelsCatalog {
    const fallback: ModelsCatalog = {
      defaultModel: 'grok-4.5',
      models: [
        {
          id: 'grok-4.5',
          name: 'Grok 4.5',
          efforts: [
            { id: 'high', value: 'high', label: 'High', default: true },
            { id: 'medium', value: 'medium', label: 'Medium' },
            { id: 'low', value: 'low', label: 'Low' },
          ],
          supportsReasoningEffort: true,
          hidden: false,
        },
      ],
      source: 'fallback',
    }

    const cachePath = this.modelsCachePath()
    if (!existsSync(cachePath)) return fallback

    try {
      const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as {
        models?: Record<
          string,
          {
            info?: {
              id?: string
              model?: string
              name?: string
              hidden?: boolean
              supports_reasoning_effort?: boolean
              reasoning_effort?: string
              reasoning_efforts?: Array<{
                id?: string
                value?: string
                label?: string
                default?: boolean
              }>
            }
          }
        >
      }

      const models: ModelInfo[] = []
      for (const [key, entry] of Object.entries(raw.models || {})) {
        const info = entry?.info
        if (!info) continue
        if (info.hidden) continue
        const id = (info.id || info.model || key).trim()
        if (!id) continue
        const efforts: ModelEffortOption[] = (info.reasoning_efforts || [])
          .map((e) => ({
            id: (e.id || e.value || '').trim(),
            value: (e.value || e.id || '').trim(),
            label: (e.label || e.value || e.id || '').trim(),
            default: Boolean(e.default),
          }))
          .filter((e) => e.value)

        if (efforts.length === 0 && info.supports_reasoning_effort) {
          const def = info.reasoning_effort || 'high'
          efforts.push(
            { id: 'high', value: 'high', label: 'High', default: def === 'high' },
            { id: 'medium', value: 'medium', label: 'Medium', default: def === 'medium' },
            { id: 'low', value: 'low', label: 'Low', default: def === 'low' },
          )
        }

        models.push({
          id,
          name: (info.name || id).trim(),
          efforts,
          supportsReasoningEffort: Boolean(info.supports_reasoning_effort ?? efforts.length > 0),
          hidden: false,
        })
      }

      if (models.length === 0) return fallback

      const defaultModel =
        models.find((m) => m.id === 'grok-4.5')?.id || models[0].id

      return { defaultModel, models, source: 'cache' }
    } catch {
      return fallback
    }
  }

  /** Scan ~/.grok/sessions/<encoded-cwd>/<uuid>/summary.json */
  listSessions(limit = 200): SessionListItem[] {
    const root = this.sessionsRoot()
    if (!existsSync(root)) return []

    const items: SessionListItem[] = []
    let groupDirs: string[] = []
    try {
      groupDirs = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return []
    }

    for (const groupName of groupDirs) {
      const groupPath = join(root, groupName)
      let cwd = this.decodeSessionGroupCwd(groupName, groupPath)
      if (!cwd) continue

      let sessionDirs: string[] = []
      try {
        sessionDirs = readdirSync(groupPath, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      } catch {
        continue
      }

      for (const sid of sessionDirs) {
        const sessionDir = join(groupPath, sid)
        const summaryPath = join(sessionDir, 'summary.json')
        if (!existsSync(summaryPath)) continue
        try {
          const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
            info?: { id?: string; cwd?: string }
            generated_title?: string
            session_summary?: string
            updated_at?: string
            last_active_at?: string
            created_at?: string
            current_model_id?: string
            reasoning_effort?: string
            num_messages?: number
            num_chat_messages?: number
          }
          const id = summary.info?.id || sid
          const sessionCwd = summary.info?.cwd || cwd
          const ts =
            Date.parse(summary.updated_at || '') ||
            Date.parse(summary.last_active_at || '') ||
            Date.parse(summary.created_at || '') ||
            0

          // Detect shell-only / aborted sessions (locale-neutral metadata).
          // Grok often records num_chat_messages=2 (system + skill injection) with no real chat.
          // Do NOT invent language-specific titles here — renderer uses i18n for empty rows.
          const generated = (summary.generated_title || '').trim()
          const sessionSummary = (summary.session_summary || '').trim()
          const fromPrompt = firstUserPromptSnippet(sessionDir)
          const msgCount = summary.num_chat_messages ?? summary.num_messages ?? 0
          // Prefer metadata titles; fall back to first real user prompt on disk.
          // "empty" only when we cannot find any user-facing signal yet.
          const empty = !generated && !sessionSummary && !fromPrompt
          const title = empty
            ? ''
            : clampTitle(generated || sessionSummary || fromPrompt || '')

          items.push({
            id,
            title,
            cwd: sessionCwd,
            projectName: basename(sessionCwd) || sessionCwd,
            updatedAt: ts,
            modelId: summary.current_model_id || null,
            effort: summary.reasoning_effort || null,
            messageCount: msgCount,
            empty,
          })
        } catch {
          // skip corrupt summary
        }
      }
    }

    items.sort((a, b) => b.updatedAt - a.updatedAt)
    return items.slice(0, Math.max(1, limit))
  }

  private decodeSessionGroupCwd(groupName: string, groupPath: string): string | null {
    const cwdFile = join(groupPath, '.cwd')
    if (existsSync(cwdFile)) {
      try {
        const text = readFileSync(cwdFile, 'utf8').trim()
        if (text) return text
      } catch {
        // fall through
      }
    }
    try {
      return decodeURIComponent(groupName)
    } catch {
      return groupName
    }
  }

  /** Resolve ~/.grok/sessions/<group>/<sessionId> directory. */
  findSessionDir(sessionId: string): string | null {
    if (!sessionId) return null
    const root = this.sessionsRoot()
    if (!existsSync(root)) return null
    try {
      for (const group of readdirSync(root, { withFileTypes: true })) {
        if (!group.isDirectory()) continue
        const dir = join(root, group.name, sessionId)
        if (existsSync(dir)) return dir
      }
    } catch {
      return null
    }
    return null
  }

  /**
   * Incrementally read tool_call / tool_call_update lines from updates.jsonl.
   * `byteOffset` is the previous read position; returns new offset + events.
   */
  readSessionToolEvents(
    sessionId: string,
    byteOffset = 0,
  ): {
    ok: boolean
    offset: number
    events: Array<{
      toolCallId: string
      title: string
      status: 'running' | 'done' | 'error'
      kind?: string
    }>
    error?: string
  } {
    const dir = this.findSessionDir(sessionId)
    if (!dir) return { ok: false, offset: byteOffset, events: [], error: 'session not found' }
    const path = join(dir, 'updates.jsonl')
    if (!existsSync(path)) return { ok: true, offset: 0, events: [] }

    try {
      const buf = readFileSync(path)
      const start = Math.max(0, Math.min(byteOffset, buf.length))
      // Align to next line if mid-line
      let from = start
      if (from > 0 && from < buf.length && buf[from - 1] !== 0x0a) {
        const nextNl = buf.indexOf(0x0a, from)
        from = nextNl >= 0 ? nextNl + 1 : buf.length
      }
      const chunk = buf.subarray(from).toString('utf8')
      const events: Array<{
        toolCallId: string
        title: string
        status: 'running' | 'done' | 'error'
        kind?: string
      }> = []
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line) as {
            params?: {
              update?: {
                sessionUpdate?: string
                toolCallId?: string
                title?: string
                kind?: string
                status?: string
                _meta?: { status?: string }
              }
            }
          }
          const u = obj.params?.update
          if (!u?.toolCallId) continue
          const su = u.sessionUpdate || ''
          if (su !== 'tool_call' && su !== 'tool_call_update') continue
          const statusRaw = (u.status || u._meta?.status || '').toLowerCase()
          let status: 'running' | 'done' | 'error' = 'running'
          if (su === 'tool_call_update' && (statusRaw === 'completed' || statusRaw === 'done' || statusRaw === 'success')) {
            status = 'done'
          } else if (statusRaw === 'failed' || statusRaw === 'error') {
            status = 'error'
          } else if (su === 'tool_call_update' && statusRaw) {
            status = statusRaw.includes('run') ? 'running' : 'done'
          }
          events.push({
            toolCallId: u.toolCallId,
            title: u.title || 'tool',
            status: su === 'tool_call' ? 'running' : status,
            kind: u.kind,
          })
        } catch {
          // skip bad line
        }
      }
      return { ok: true, offset: buf.length, events }
    } catch (err) {
      return {
        ok: false,
        offset: byteOffset,
        events: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Load recent user/assistant turns from chat_history.jsonl for UI display.
   * Filters system prompts and system-reminder injection blobs.
   */
  loadSessionHistory(
    sessionId: string,
    opts: { limit?: number } = {},
  ): { ok: boolean; messages: SessionHistoryMessage[]; cwd?: string; error?: string } {
    const limit = opts.limit ?? 80
    const root = this.sessionsRoot()
    if (!existsSync(root)) {
      return { ok: false, messages: [], error: 'sessions dir missing' }
    }

    let historyPath: string | null = null
    let cwd: string | undefined

    try {
      for (const group of readdirSync(root, { withFileTypes: true })) {
        if (!group.isDirectory()) continue
        const candidate = join(root, group.name, sessionId, 'chat_history.jsonl')
        if (existsSync(candidate)) {
          historyPath = candidate
          cwd = this.decodeSessionGroupCwd(group.name, join(root, group.name)) || undefined
          const summaryPath = join(root, group.name, sessionId, 'summary.json')
          if (existsSync(summaryPath)) {
            try {
              const s = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
                info?: { cwd?: string }
              }
              if (s.info?.cwd) cwd = s.info.cwd
            } catch {
              // ignore
            }
          }
          break
        }
      }
    } catch (err) {
      return { ok: false, messages: [], error: String(err) }
    }

    if (!historyPath) {
      return { ok: false, messages: [], error: 'session not found', cwd }
    }

    const messages: SessionHistoryMessage[] = []
    try {
      const lines = readFileSync(historyPath, 'utf8').split(/\r?\n/)
      let idx = 0
      for (const line of lines) {
        if (!line.trim()) continue
        let obj: {
          type?: string
          role?: string
          content?: unknown
        }
        try {
          obj = JSON.parse(line) as typeof obj
        } catch {
          continue
        }
        const role = (obj.type || obj.role || '').toLowerCase()
        if (role !== 'user' && role !== 'assistant') continue
        let text = extractHistoryText(obj.content)
        if (!text) continue
        if (role === 'user') {
          if (shouldSkipUserHistory(text)) continue
          text = sanitizeUserDisplayText(text)
          if (!text) continue
        }
        messages.push({
          id: `hist_${idx++}`,
          role: role as 'user' | 'assistant',
          content: text.length > 12000 ? `${text.slice(0, 12000)}…` : text,
          createdAt: 0,
        })
      }
    } catch (err) {
      return { ok: false, messages: [], error: String(err), cwd }
    }

    const sliced = messages.length > limit ? messages.slice(-limit) : messages
    return { ok: true, messages: sliced, cwd }
  }

  resolveBinary(): string | null {
    const candidates = [
      process.env.GROK_BIN,
      join(homedir(), '.grok', 'bin', 'grok'),
      join(homedir(), '.grok', 'bin', 'grok.exe'),
      join(homedir(), '.local', 'bin', 'grok'),
      '/usr/local/bin/grok',
      '/usr/bin/grok',
    ].filter(Boolean) as string[]

    for (const p of candidates) {
      if (existsSync(p)) return p
    }

    // PATH lookup via which / where
    try {
      const cmd = platform() === 'win32' ? 'where' : 'which'
      const result = this.runOnceSync(cmd, ['grok'], 2000)
      const first = result
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.toLowerCase().includes('could not') && existsSync(l))
      if (first) return first
    } catch {
      // ignore
    }

    return null
  }

  private hasAuthFile(): boolean {
    const p = this.authPath()
    if (!existsSync(p)) return false
    try {
      return statSync(p).size > 2
    } catch {
      return false
    }
  }

  /** API key env counts as authenticated for headless/CI-style use. */
  private hasApiKeyEnv(): boolean {
    return Boolean(process.env.XAI_API_KEY && process.env.XAI_API_KEY.trim())
  }

  async getBootstrap(): Promise<BootstrapState> {
    try {
      if (this.busyAction) {
        return this.buildState('busy', null, null, this.hasAuthFile() || this.hasApiKeyEnv())
      }

      const binaryPath = this.resolveBinary()
      if (!binaryPath) {
        return this.buildState('need_cli', null, null, false)
      }

      let version: string | null = null
      try {
        version = (await this.runOnce(binaryPath, ['--version'], 5000)).trim() || 'unknown'
      } catch (err) {
        this.lastError = String(err)
        return this.buildState(
          'need_cli',
          binaryPath,
          null,
          false,
          `二进制无法执行: ${String(err)}`,
        )
      }

      const authPresent = this.hasAuthFile() || this.hasApiKeyEnv()
      if (!authPresent) {
        return this.buildState('need_auth', binaryPath, version, false)
      }

      return this.buildState('ready', binaryPath, version, true)
    } catch (err) {
      this.lastError = String(err)
      return this.buildState('need_cli', null, null, false, `检测异常: ${String(err)}`)
    }
  }

  async getStatus(): Promise<GrokStatus> {
    const b = await this.getBootstrap()
    return {
      available: b.phase === 'ready',
      binaryPath: b.binaryPath,
      version: b.version,
      mode: b.phase === 'ready' ? 'live' : 'demo',
      message: b.message,
      phase: b.phase,
      authPresent: b.authPresent,
    }
  }

  private buildState(
    phase: BootstrapPhase,
    binaryPath: string | null,
    version: string | null,
    authPresent: boolean,
    messageOverride?: string,
  ): BootstrapState {
    const messages: Record<BootstrapPhase, string> = {
      checking: '正在检测 Grok Build CLI…',
      need_cli: '未检测到 Grok Build CLI。安装后即可使用官方 agent。',
      need_auth: '已找到 CLI，但尚未登录。将使用官方 `grok login`（OAuth）。',
      ready: binaryPath ? `已就绪 · ${binaryPath}` : '已就绪',
      busy:
        this.busyAction === 'install'
          ? '正在安装 Grok Build CLI…'
          : this.busyAction === 'login'
            ? '正在打开登录流程…'
            : this.busyAction === 'logout'
              ? '正在退出登录…'
              : '处理中…',
    }

    return {
      phase,
      available: phase === 'ready',
      binaryPath,
      version,
      authPresent,
      authPath: this.authPath(),
      message: messageOverride || messages[phase],
      installCommand: this.installCommand(),
      lastError: this.lastError,
      busyAction: this.busyAction,
    }
  }

  async refreshAndEmit(): Promise<BootstrapState> {
    const state = await this.getBootstrap()
    this.emit({ type: 'bootstrap', payload: state })
    return state
  }

  /**
   * User-confirmed install of official CLI.
   * Never silent: caller must have obtained confirmation (we also re-confirm via dialog).
   */
  async installCli(): Promise<{ ok: boolean; message: string }> {
    if (this.busyAction) {
      return { ok: false, message: '已有任务进行中' }
    }

    const win = this.window
    const cmd = this.installCommand()
    const detail =
      platform() === 'win32'
        ? `将在 PowerShell 中执行官方安装脚本：\n\n${cmd}\n\n仅在你确认后继续。`
        : `将执行官方安装脚本：\n\n${cmd}\n\n需要网络权限，仅在你确认后继续。`

    const boxOpts = {
      type: 'question' as const,
      buttons: ['取消', '确认安装'],
      defaultId: 1,
      cancelId: 0,
      title: '安装 Grok Build CLI',
      message: '一键安装官方 Grok Build CLI？',
      detail,
      noLink: true,
    }
    const { response } = win
      ? await dialog.showMessageBox(win, boxOpts)
      : await dialog.showMessageBox(boxOpts)

    if (response !== 1) {
      return { ok: false, message: '已取消安装' }
    }

    this.busyAction = 'install'
    this.lastError = null
    await this.refreshAndEmit()

    try {
      if (platform() === 'win32') {
        await this.runStreaming(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
          'install',
        )
      } else {
        await this.runStreaming('bash', ['-lc', cmd], 'install')
      }

      // ensure common install dir is visible even if shell PATH not refreshed
      const localBin = join(homedir(), '.grok', 'bin')
      if (existsSync(join(localBin, 'grok')) || existsSync(join(localBin, 'grok.exe'))) {
        process.env.PATH = `${localBin}${delimiter}${process.env.PATH || ''}`
      }

      this.busyAction = null
      const state = await this.refreshAndEmit()
      if (state.phase === 'need_cli') {
        return {
          ok: false,
          message: '安装命令已执行，但仍未找到 grok。请检查网络或手动安装后点「重新检测」。',
        }
      }
      return { ok: true, message: state.message }
    } catch (err) {
      this.lastError = String(err)
      this.busyAction = null
      await this.refreshAndEmit()
      return { ok: false, message: `安装失败: ${String(err)}` }
    }
  }

  /** Orchestrate official OAuth — does not implement OAuth itself. */
  async login(): Promise<{ ok: boolean; message: string }> {
    const binaryPath = this.resolveBinary()
    if (!binaryPath) {
      return { ok: false, message: '未找到 grok CLI，请先安装' }
    }
    if (this.busyAction) {
      return { ok: false, message: '已有任务进行中' }
    }

    this.busyAction = 'login'
    this.lastError = null
    await this.refreshAndEmit()

    try {
      // `grok login` opens browser; may take a while
      await this.runStreaming(binaryPath, ['login'], 'login', 10 * 60 * 1000)
      this.busyAction = null
      const state = await this.refreshAndEmit()
      if (state.phase === 'ready' || state.authPresent) {
        return { ok: true, message: '登录完成' }
      }
      return {
        ok: false,
        message: '登录流程已结束，但仍未检测到凭据。可重试或运行终端中的 grok login。',
      }
    } catch (err) {
      this.lastError = String(err)
      this.busyAction = null
      await this.refreshAndEmit()
      return { ok: false, message: `登录失败: ${String(err)}` }
    }
  }

  async logout(): Promise<{ ok: boolean; message: string }> {
    const binaryPath = this.resolveBinary()
    if (!binaryPath) {
      return { ok: false, message: '未找到 grok CLI' }
    }
    if (this.busyAction) {
      return { ok: false, message: '已有任务进行中' }
    }

    this.busyAction = 'logout'
    await this.refreshAndEmit()
    try {
      await this.runOnce(binaryPath, ['logout'], 15000)
      this.busyAction = null
      await this.refreshAndEmit()
      return { ok: true, message: '已退出登录' }
    } catch (err) {
      this.lastError = String(err)
      this.busyAction = null
      await this.refreshAndEmit()
      return { ok: false, message: `退出失败: ${String(err)}` }
    }
  }

  private runOnceSync(bin: string, args: string[], timeoutMs: number): string {
    const r = spawnSync(bin, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: process.env,
      windowsHide: true,
    })
    if (r.error) throw r.error
    return (r.stdout || r.stderr || '').toString()
  }

  private runOnce(
    bin: string,
    args: string[],
    timeoutMs: number,
    cwd?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        env: process.env,
        cwd: cwd && existsSync(cwd) ? cwd : undefined,
        windowsHide: true,
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('timeout'))
      }, timeoutMs)

      child.stdout.on('data', (d) => {
        out += d.toString()
      })
      child.stderr.on('data', (d) => {
        err += d.toString()
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(out || err)
        else reject(new Error(err || out || `exit ${code}`))
      })
    })
  }

  private runStreaming(
    bin: string,
    args: string[],
    logKind: 'install' | 'login',
    timeoutMs = 5 * 60 * 1000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        env: process.env,
        shell: false,
        // Hide console flash; install/login still stream stdout/stderr via pipes
        windowsHide: true,
      })

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('timeout'))
      }, timeoutMs)

      const onData = (buf: Buffer) => {
        const text = buf.toString()
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) {
            this.emit({ type: 'install_log', line: `[${logKind}] ${line}` })
          }
        }
      }

      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0 || code === null) resolve()
        // login may exit non-zero if user closes browser early
        else if (logKind === 'login' && this.hasAuthFile()) resolve()
        else reject(new Error(`exit ${code}`))
      })
    })
  }

  /**
   * Start a headless session. Requires ready bootstrap (CLI + auth).
   * Wires model / effort / permission-mode to official grok flags.
   * - New session: `-s <uuid>`
   * - Continue: `--resume <uuid>`
   */
  async startPromptSession(
    sessionId: string,
    cwd: string,
    prompt: string,
    opts: {
      model?: string
      effort?: string
      permissionMode?: string
      /** When true, continue an existing Grok session; when false, create with -s */
      resume?: boolean
      /** Inline vision images for --prompt-json (base64, no data: prefix). */
      images?: Array<{ mimeType: string; data: string; path?: string }>
      /** Extra non-image file paths (already merged into prompt by renderer when possible). */
      filePaths?: string[]
    } = {},
  ): Promise<void> {
    if (this.children.has(sessionId)) {
      this.stopSession(sessionId)
    }

    const boot = await this.getBootstrap()
    if (boot.phase !== 'ready' || !boot.binaryPath) {
      this.emit({
        type: 'error',
        sessionId,
        message:
          boot.phase === 'need_cli'
            ? '请先安装 Grok Build CLI'
            : boot.phase === 'need_auth'
              ? '请先登录（grok login）'
              : boot.message,
      })
      this.emit({ type: 'exit', sessionId, code: 1 })
      return
    }

    const catalog = this.listModels()
    const model = (opts.model || catalog.defaultModel || 'grok-4.5').trim()
    const modelInfo = catalog.models.find((m) => m.id === model)
    const defaultEffort =
      modelInfo?.efforts.find((e) => e.default)?.value ||
      modelInfo?.efforts[0]?.value ||
      'high'
    const effort = (opts.effort || defaultEffort).trim()
    const permissionMode = (opts.permissionMode || 'default').trim()
    const resume = Boolean(opts.resume)

    const images = (opts.images || []).filter(
      (im) => im && typeof im.data === 'string' && im.data.length > 0,
    )

    // Prefer --prompt-json with ACP image blocks when payload fits CLI arg limits.
    // Windows CreateProcess ~32k; leave headroom for other flags.
    const MAX_PROMPT_JSON = 28_000
    let usePromptJson = false
    let promptJson = ''
    if (images.length > 0) {
      const tagLines = images
        .map((im, i) =>
          im.path
            ? `[Image #${i + 1}] (${im.path} — attached inline; act on the path if needed, but do not Read it)`
            : `[Image #${i + 1}] (attached inline — already visible to you; do not read it from disk)`,
        )
        .join('\n')
      const textBody = [prompt.trim(), tagLines].filter(Boolean).join('\n\n')
      const blocks: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; mimeType: string; data: string }
      > = [
        {
          type: 'text',
          text: textBody || 'Please examine the attached image(s).',
        },
      ]
      for (const im of images) {
        let mime = (im.mimeType || 'image/png').toLowerCase()
        if (mime === 'image/jpg') mime = 'image/jpeg'
        blocks.push({ type: 'image', mimeType: mime, data: im.data })
      }
      promptJson = JSON.stringify(blocks)
      usePromptJson = promptJson.length <= MAX_PROMPT_JSON
    }

    // Large images: fall back to path mentions so the model can read_file (vision).
    let finalPrompt = prompt
    if (images.length > 0 && !usePromptJson) {
      const pathLines = images
        .map((im, i) => {
          const p = im.path || ''
          return p
            ? `[Image #${i + 1}] ${p} (user-attached image — use read_file to view it)`
            : `[Image #${i + 1}] (image omitted: payload too large for inline send)`
        })
        .join('\n')
      finalPrompt = [pathLines, prompt.trim()].filter(Boolean).join('\n\n')
    }

    const args: string[] = []
    if (usePromptJson) {
      args.push('--prompt-json', promptJson)
    } else {
      args.push('-p', finalPrompt)
    }
    args.push(
      '--output-format',
      'streaming-json',
      '-m',
      model,
      '--effort',
      effort,
      '--permission-mode',
      permissionMode,
    )

    if (resume) {
      args.push('--resume', sessionId)
    } else {
      // Official UUID for a new session under the target cwd group
      args.push('--session-id', sessionId)
    }

    const workCwd = cwd || homedir()
    const child = spawn(boot.binaryPath, args, {
      cwd: workCwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      windowsHide: true,
    })

    const modeTag = resume ? `--resume ${sessionId}` : `-s ${sessionId}`
    const imgTag = images.length
      ? usePromptJson
        ? ` images=${images.length} (prompt-json)`
        : ` images=${images.length} (path-fallback)`
      : ''
    this.emit({
      type: 'stderr',
      sessionId,
      line: `[desktop] grok ${modeTag} -m ${model} --effort ${effort} --permission-mode ${permissionMode} --cwd ${workCwd}${imgTag}`,
    })

    this.children.set(sessionId, child)

    const rlOut = createInterface({ input: child.stdout })
    const rlErr = createInterface({ input: child.stderr })

    rlOut.on('line', (line) => {
      this.emit({ type: 'stdout', sessionId, line })
    })
    rlErr.on('line', (line) => {
      this.emit({ type: 'stderr', sessionId, line })
    })
    child.on('error', (e) => {
      this.emit({ type: 'error', sessionId, message: e.message })
    })
    child.on('close', (code) => {
      this.children.delete(sessionId)
      this.emit({ type: 'exit', sessionId, code })
    })
  }

  stopSession(sessionId: string): void {
    const child = this.children.get(sessionId)
    if (!child) return
    // Windows: kill process tree (grok may spawn tools). Unix: SIGTERM is enough.
    if (platform() === 'win32' && child.pid) {
      try {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 5000,
        })
      } catch {
        try {
          child.kill()
        } catch {
          // ignore
        }
      }
    } else {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
    this.children.delete(sessionId)
  }

  /** Local OAuth profile from ~/.grok/auth.json (no tokens returned). */
  getAccountProfile(): AccountProfile {
    const empty: AccountProfile = {
      email: null,
      displayName: null,
      userId: null,
      teamId: null,
      expiresAt: null,
      authPresent: false,
    }
    const p = this.authPath()
    if (!existsSync(p)) return empty
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<
        string,
        {
          email?: string
          first_name?: string
          last_name?: string
          user_id?: string
          team_id?: string
          expires_at?: string
        }
      >
      const entry = Object.values(raw)[0]
      if (!entry) return empty
      const name = [entry.first_name, entry.last_name].filter(Boolean).join(' ').trim()
      return {
        email: entry.email || null,
        displayName: name || null,
        userId: entry.user_id || null,
        teamId: entry.team_id || null,
        expiresAt: entry.expires_at || null,
        authPresent: true,
      }
    } catch {
      return empty
    }
  }

  private configPath(): string {
    return join(this.grokHome(), 'config.toml')
  }

  private readDisabledSkills(): Set<string> {
    const p = this.configPath()
    if (!existsSync(p)) return new Set()
    try {
      const text = readFileSync(p, 'utf8')
      const m = text.match(/^\s*disabled\s*=\s*\[([^\]]*)\]/m)
      if (!m) return new Set()
      const names = [...m[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map(
        (x) => x[1] || x[2],
      )
      return new Set(names.filter(Boolean))
    } catch {
      return new Set()
    }
  }

  private writeDisabledSkills(disabled: Set<string>): void {
    const p = this.configPath()
    let text = existsSync(p) ? readFileSync(p, 'utf8') : ''
    const arr = [...disabled].sort().map((n) => `"${n.replace(/"/g, '\\"')}"`)
    const line = `disabled = [${arr.join(', ')}]`

    if (/^\s*disabled\s*=\s*\[[^\]]*\]/m.test(text)) {
      text = text.replace(/^\s*disabled\s*=\s*\[[^\]]*\]/m, line)
    } else if (/\[skills\]/.test(text)) {
      text = text.replace(/\[skills\]/, `[skills]\n${line}`)
    } else {
      text = `${text.trimEnd()}\n\n[skills]\n${line}\n`
    }
    writeFileSync(p, text, 'utf8')
  }

  /**
   * Skills via `grok inspect --json`, with filesystem fallback.
   */
  async listSkills(
    cwd?: string,
  ): Promise<{ ok: boolean; skills: SkillItem[]; error?: string; source: 'inspect' | 'fs' }> {
    const disabled = this.readDisabledSkills()
    const workCwd = cwd && existsSync(cwd) ? cwd : undefined
    const binary = this.resolveBinary()

    if (binary) {
      try {
        const out = await this.runOnceLoose(binary, ['inspect', '--json'], 45000, workCwd)
        const data = parseJsonObject(out) as {
          skills?: Array<{
            name?: string
            description?: string
            userInvocable?: boolean
            source?: { type?: string; path?: string }
          }>
        } | null
        if (data?.skills && Array.isArray(data.skills)) {
          const items = mapInspectSkills(data.skills, disabled)
          return { ok: true, skills: items, source: 'inspect' }
        }
        throw new Error('inspect JSON missing skills array')
      } catch (err) {
        console.error('[skills] inspect failed, falling back to fs', err)
        const fsItems = this.scanSkillsFromFs(workCwd, disabled)
        if (fsItems.length > 0) {
          return {
            ok: true,
            skills: fsItems,
            source: 'fs',
            error: err instanceof Error ? err.message : String(err),
          }
        }
        return {
          ok: false,
          skills: [],
          source: 'inspect',
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    const fsItems = this.scanSkillsFromFs(workCwd, disabled)
    return {
      ok: fsItems.length > 0,
      skills: fsItems,
      source: 'fs',
      error: binary ? undefined : 'CLI not found; scanned local skill dirs only',
    }
  }

  /** Like runOnce but accepts non-zero exit if stdout has JSON. */
  private runOnceLoose(
    bin: string,
    args: string[],
    timeoutMs: number,
    cwd?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        env: process.env,
        cwd: cwd && existsSync(cwd) ? cwd : undefined,
        windowsHide: true,
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('timeout'))
      }, timeoutMs)
      child.stdout.on('data', (d) => {
        out += d.toString()
      })
      child.stderr.on('data', (d) => {
        err += d.toString()
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const text = out || err
        if (code === 0) resolve(text)
        else if (text.includes('{')) resolve(text)
        else reject(new Error(err || out || `exit ${code}`))
      })
    })
  }

  private scanSkillsFromFs(cwd: string | undefined, disabled: Set<string>): SkillItem[] {
    const roots: Array<{ dir: string; sourceType: string }> = [
      { dir: join(this.grokHome(), 'skills'), sourceType: 'user' },
      { dir: join(this.grokHome(), 'bundled', 'skills'), sourceType: 'bundled' },
    ]
    if (cwd) {
      roots.unshift({ dir: join(cwd, '.grok', 'skills'), sourceType: 'project' })
    }
    const byName = new Map<string, SkillItem>()
    for (const { dir, sourceType } of roots) {
      if (!existsSync(dir)) continue
      let entries: string[] = []
      try {
        entries = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      } catch {
        continue
      }
      for (const name of entries) {
        const skillMd = join(dir, name, 'SKILL.md')
        if (!existsSync(skillMd)) continue
        const meta = parseSkillFrontmatter(skillMd)
        const id = meta.name || name
        if (byName.has(id)) continue
        byName.set(id, {
          name: id,
          description: meta.description || '',
          sourceType,
          path: skillMd,
          userInvocable: meta.userInvocable !== false,
          disabled: disabled.has(id),
        })
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  setSkillDisabled(name: string, disabled: boolean): { ok: boolean; message: string } {
    const n = name.trim()
    if (!n) return { ok: false, message: 'empty name' }
    const set = this.readDisabledSkills()
    if (disabled) set.add(n)
    else set.delete(n)
    try {
      this.writeDisabledSkills(set)
      return { ok: true, message: disabled ? `disabled ${n}` : `enabled ${n}` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  dispose(): void {
    for (const id of [...this.children.keys()]) {
      this.stopSession(id)
    }
  }
}

function mapInspectSkills(
  skills: Array<{
    name?: string
    description?: string
    userInvocable?: boolean
    source?: { type?: string; path?: string }
  }>,
  disabled: Set<string>,
): SkillItem[] {
  const items: SkillItem[] = []
  for (const s of skills) {
    const name = (s.name || '').trim()
    if (!name) continue
    items.push({
      name,
      description: (s.description || '').trim(),
      sourceType: s.source?.type || 'unknown',
      path: s.source?.path || null,
      userInvocable: Boolean(s.userInvocable),
      disabled: disabled.has(name),
    })
  }
  items.sort((a, b) => a.name.localeCompare(b.name))
  return items
}

function parseJsonObject(raw: string): unknown {
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in output')
  return JSON.parse(text.slice(start, end + 1))
}

function parseSkillFrontmatter(skillMdPath: string): {
  name?: string
  description?: string
  userInvocable?: boolean
} {
  try {
    const raw = readFileSync(skillMdPath, 'utf8')
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!m) return {}
    const body = m[1]
    const name = body.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim()
    const description = body.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim()
    const ui = body.match(/^user-invocable:\s*(true|false)/m)?.[1]
    return {
      name,
      description,
      userInvocable: ui === undefined ? undefined : ui === 'true',
    }
  } catch {
    return {}
  }
}

function extractHistoryText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: string; text?: string }
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text)
    }
  }
  return parts.join('\n').trim()
}

function shouldSkipUserHistory(text: string): boolean {
  const t = text.trimStart()
  if (t.startsWith('<user_info>')) return true
  if (t.startsWith('<system-reminder>')) return true
  if (t.startsWith('<agent_skills>') || t.startsWith('<available_skills>')) return true
  if (t.startsWith('<skill_information>')) return true
  // Compaction / resume injection blobs (not real user turns)
  if (t.startsWith('This session is being continued from a previous conversation')) return true
  if (t.startsWith('The summary below covers the earlier portion')) return true
  // Very long injected context without real user prose
  if (t.length > 4000 && (t.includes('<system-reminder>') || t.includes('## Available Skills'))) {
    return true
  }
  return false
}

function clampTitle(text: string, max = 56): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1)}…`
}

/** First non-injected user message text for sidebar title fallback. */
function firstUserPromptSnippet(sessionDir: string): string | null {
  const historyPath = join(sessionDir, 'chat_history.jsonl')
  if (!existsSync(historyPath)) return null
  try {
    // Read at most ~256KB — enough for early turns, avoids huge histories
    const raw = readFileSync(historyPath, 'utf8')
    const slice = raw.length > 262144 ? raw.slice(0, 262144) : raw
    for (const line of slice.split(/\r?\n/)) {
      if (!line.trim()) continue
      let obj: { type?: string; role?: string; content?: unknown }
      try {
        obj = JSON.parse(line) as typeof obj
      } catch {
        continue
      }
      const role = (obj.type || obj.role || '').toLowerCase()
      if (role !== 'user') continue
      const text = extractHistoryText(obj.content)
      if (!text || shouldSkipUserHistory(text)) continue
      const cleaned = sanitizeUserDisplayText(text)
      if (!cleaned) continue
      return cleaned
    }
  } catch {
    return null
  }
  return null
}

/**
 * Grok stores user turns as:
 *   <user_query>\n...\n</user_query>
 * often followed by skill_information / system-reminder / attachments.
 * Strip wrappers for UI display only (does not rewrite disk).
 */
function sanitizeUserDisplayText(text: string): string {
  let s = text.trim()
  if (!s) return ''

  // Prefer content inside <user_query>…</user_query>
  // Use last well-formed pair first when nested/malformed wrappers appear
  // e.g. `<user_query>prefix<user_query>\nreal\n</user_query>`
  const queryParts: string[] = []
  const re = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    let inner = m[1].trim()
    // Nested open tags inside the capture: keep the innermost prose
    const nested = inner.lastIndexOf('<user_query>')
    if (nested >= 0) {
      inner = inner.slice(nested + '<user_query>'.length).trim()
    }
    if (inner) queryParts.push(inner)
  }
  if (queryParts.length > 0) {
    // Multiple real user turns in one row are rare; join them
    s = queryParts.join('\n\n')
  } else {
    // No wrapper: strip known injection blocks if present
    s = s
      .replace(/<skill_information>[\s\S]*?<\/skill_information>/gi, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
      .replace(/<agent_skills>[\s\S]*?<\/agent_skills>/gi, '')
      .replace(/<available_skills>[\s\S]*?<\/available_skills>/gi, '')
      .replace(/<attached_files>[\s\S]*?<\/attached_files>/gi, '')
      .trim()
  }

  // Image-only placeholders
  if (!s && /<image_files>/i.test(text)) {
    return '[图片]'
  }

  // Drop leftover bare tags / common wrappers if any
  s = s
    .replace(/<\/?user_query>/gi, '')
    .replace(/<\/?skill_information>/gi, '')
    .replace(/<\/?system-reminder>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return s
}
