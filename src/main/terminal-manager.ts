import { spawn as nodeSpawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
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

/**
 * PTY sessions for embedded terminals.
 * Uses node-pty when available; falls back is handled by caller.
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
    const shell =
      process.env.SHELL ||
      (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')
    const id = randomUUID()
    const tabTitle = title || basenamePath(workDir)

    try {
      const pty = ptyLib.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: workDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      })

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
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
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
      // win
      const child = nodeSpawn(
        'cmd',
        ['/c', 'start', 'cmd', '/K', `cd /d ${workDir}`],
        { detached: true, stdio: 'ignore' },
      )
      child.unref()
      return { ok: true, message: 'Opened cmd' }
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

function basenamePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || path || 'shell'
}
