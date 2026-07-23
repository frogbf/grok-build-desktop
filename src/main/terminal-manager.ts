import { spawn as nodeSpawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)

export type TerminalTabInfo = {
  id: string
  cwd: string
  title: string
  pid: number | null
}

type PtyHandle = {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  pid: number
}

type ShellSpec = {
  file: string
  args: string[]
}

/**
 * PTY sessions for embedded terminals.
 * Uses node-pty when available; falls back is handled by caller.
 *
 * Windows defaults follow VS Code / Windows Terminal conventions:
 * prefer PowerShell (pwsh → powershell), never trust Unix-style SHELL.
 */
export class TerminalManager {
  private window: BrowserWindow | null = null
  private sessions = new Map<
    string,
    { pty: PtyHandle; cwd: string; title: string }
  >()
  private ptyModule: typeof import('node-pty') | null | undefined

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  private emit(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }

  private loadPty(): typeof import('node-pty') | null {
    if (this.ptyModule !== undefined) return this.ptyModule
    try {
      this.ptyModule = require('node-pty') as typeof import('node-pty')
      return this.ptyModule
    } catch (err) {
      console.error('[terminal] node-pty load failed', err)
      this.ptyModule = null
      return null
    }
  }

  isAvailable(): boolean {
    return this.loadPty() !== null
  }

  list(): TerminalTabInfo[] {
    return [...this.sessions.entries()].map(([id, s]) => ({
      id,
      cwd: s.cwd,
      title: s.title,
      pid: s.pty.pid,
    }))
  }

  create(cwd: string, title?: string): { ok: boolean; id?: string; error?: string } {
    const ptyLib = this.loadPty()
    if (!ptyLib) {
      return { ok: false, error: 'node-pty unavailable' }
    }

    const workDir = cwd && existsSync(cwd) ? cwd : homedir()
    const shells = resolveShellCandidates()
    const id = randomUUID()
    const tabTitle = title || basenamePath(workDir)
    const env = buildPtyEnv()

    let lastError: unknown
    for (const spec of shells) {
      try {
        const spawnOpts: Record<string, unknown> = {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: workDir,
          env,
        }
        // ConPTY is the modern Windows backend (VS Code default since ~1.50)
        if (process.platform === 'win32') {
          spawnOpts.useConpty = true
        }

        const pty = ptyLib.spawn(spec.file, spec.args, spawnOpts as Parameters<typeof ptyLib.spawn>[2])

        const handle: PtyHandle = {
          write: (data) => pty.write(data),
          resize: (cols, rows) => {
            try {
              pty.resize(cols, rows)
            } catch {
              // ignore
            }
          },
          kill: () => {
            try {
              pty.kill()
            } catch {
              // ignore
            }
          },
          pid: pty.pid,
        }

        this.sessions.set(id, { pty: handle, cwd: workDir, title: tabTitle })

        pty.onData((data: string) => {
          this.emit('terminal:data', { id, data })
        })

        pty.onExit(({ exitCode }: { exitCode: number }) => {
          this.sessions.delete(id)
          this.emit('terminal:exit', { id, exitCode })
        })

        return { ok: true, id }
      } catch (err) {
        lastError = err
        console.warn('[terminal] spawn failed', spec.file, err)
      }
    }

    return {
      ok: false,
      error:
        lastError instanceof Error
          ? lastError.message
          : lastError
            ? String(lastError)
            : 'failed to spawn shell',
    }
  }

  write(id: string, data: string): { ok: boolean } {
    const s = this.sessions.get(id)
    if (!s) return { ok: false }
    s.pty.write(data)
    return { ok: true }
  }

  resize(id: string, cols: number, rows: number): { ok: boolean } {
    const s = this.sessions.get(id)
    if (!s) return { ok: false }
    s.pty.resize(Math.max(2, cols), Math.max(1, rows))
    return { ok: true }
  }

  close(id: string): { ok: boolean } {
    const s = this.sessions.get(id)
    if (!s) return { ok: false }
    s.pty.kill()
    this.sessions.delete(id)
    return { ok: true }
  }

  /** Open system terminal as fallback. */
  openExternal(cwd: string): { ok: boolean; message: string } {
    const workDir = cwd && existsSync(cwd) ? cwd : homedir()
    try {
      if (process.platform === 'linux') {
        const candidates: Array<[string, string[]]> = [
          ['gnome-terminal', ['--working-directory', workDir]],
          ['x-terminal-emulator', ['--working-directory', workDir]],
          ['konsole', ['--workdir', workDir]],
          ['xfce4-terminal', ['--working-directory', workDir]],
        ]
        for (const [bin, args] of candidates) {
          try {
            const child = nodeSpawn(bin, args, {
              cwd: workDir,
              detached: true,
              stdio: 'ignore',
            })
            child.unref()
            return { ok: true, message: `Opened ${bin}` }
          } catch {
            // try next
          }
        }
        return { ok: false, message: 'No system terminal found' }
      }

      if (process.platform === 'darwin') {
        const child = nodeSpawn('open', ['-a', 'Terminal', workDir], {
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        return { ok: true, message: 'Opened Terminal.app' }
      }

      // Windows: open PowerShell in a new console at workDir (path-safe)
      return openWindowsExternalTerminal(workDir)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) {
      this.close(id)
    }
  }
}

/**
 * Ordered shell candidates.
 * Windows: pwsh → powershell → cmd (never process.env.SHELL — often MSYS/Git Bash paths).
 * Unix: $SHELL if real path, else zsh/bash.
 */
function resolveShellCandidates(): ShellSpec[] {
  const override = process.env.GROK_DESKTOP_SHELL?.trim()
  // Bare name (powershell.exe) or existing path — optional user override
  if (
    override &&
    (existsSync(override) || (!override.includes('/') && !override.includes('\\')))
  ) {
    const isCmd = /cmd(\.exe)?$/i.test(override)
    const isPs = !isCmd && process.platform === 'win32'
    return [{ file: override, args: isPs ? ['-NoLogo'] : [] }]
  }

  if (process.platform === 'win32') {
    const list: ShellSpec[] = []
    const pwsh = resolveWindowsPwsh()
    if (pwsh) list.push({ file: pwsh, args: ['-NoLogo'] })
    list.push({ file: 'powershell.exe', args: ['-NoLogo'] })
    list.push({ file: process.env.ComSpec || 'cmd.exe', args: [] })
    return list
  }

  const shell = process.env.SHELL?.trim()
  if (shell && existsSync(shell)) {
    return [{ file: shell, args: [] }]
  }
  if (existsSync('/bin/zsh')) return [{ file: '/bin/zsh', args: [] }]
  if (existsSync('/bin/bash')) return [{ file: '/bin/bash', args: [] }]
  return [{ file: '/bin/sh', args: [] }]
}

/** PowerShell 7+ if installed; otherwise null (caller falls back to Windows PowerShell 5.1). */
function resolveWindowsPwsh(): string | null {
  const fromPath = whichOnWindows('pwsh.exe')
  if (fromPath) return fromPath

  const programFiles = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean) as string[]

  for (const root of programFiles) {
    const candidate = join(root, 'PowerShell', '7', 'pwsh.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function whichOnWindows(bin: string): string | null {
  try {
    const r = spawnSync('where.exe', [bin], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    })
    if (r.status !== 0) return null
    const first = (r.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && existsSync(l))
    return first || null
  } catch {
    return null
  }
}

function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  // Do not inherit a Unix-style SHELL into Windows PowerShell sessions
  if (process.platform === 'win32') {
    delete env.SHELL
  }
  return env
}

/**
 * Launch an external console on Windows.
 * Prefer PowerShell with LiteralPath so spaces / special chars work.
 */
function openWindowsExternalTerminal(workDir: string): { ok: boolean; message: string } {
  const psCommand = `Set-Location -LiteralPath ${psSingleQuoted(workDir)}`
  const attempts: Array<{ file: string; args: string[]; label: string }> = []

  const pwsh = resolveWindowsPwsh()
  if (pwsh) {
    attempts.push({
      file: pwsh,
      args: ['-NoLogo', '-NoExit', '-Command', psCommand],
      label: 'pwsh',
    })
  }
  attempts.push({
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoExit', '-Command', psCommand],
    label: 'powershell',
  })
  // Last resort: cmd with quoted cd
  attempts.push({
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/K', `cd /d ${cmdQuoted(workDir)}`],
    label: 'cmd',
  })

  for (const a of attempts) {
    try {
      const child = nodeSpawn(a.file, a.args, {
        cwd: workDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      child.unref()
      return { ok: true, message: `Opened ${a.label}` }
    } catch {
      // try next
    }
  }
  return { ok: false, message: 'Failed to open Windows terminal' }
}

/** PowerShell single-quoted string (escape ' as ''). */
function psSingleQuoted(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** Quote for cmd.exe when path may contain spaces. */
function cmdQuoted(s: string): string {
  if (!/[ \t"&<>|^]/.test(s)) return s
  return `"${s.replace(/"/g, '""')}"`
}

function basenamePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || path || 'shell'
}
