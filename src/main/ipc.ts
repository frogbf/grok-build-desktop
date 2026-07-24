import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GrokRuntime } from './grok-runtime'
import type { TerminalManager } from './terminal-manager'
import { checkoutBranch, getFileDiff, getGitStatus, listBranches } from './git-service'
import { fetchAccountSubscription } from './account-service'

const MAX_VISION_IMAGE_BYTES = 20 * 1024 * 1024

function attachmentsDir(): string {
  const dir = join(app.getPath('temp'), 'grok-desktop-attachments')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function extForMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim()
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg'
  if (m === 'image/gif') return '.gif'
  if (m === 'image/webp') return '.webp'
  if (m === 'image/bmp') return '.bmp'
  return '.png'
}

/** Vision-safe extensions only — blocks arbitrary filesystem reads via IPC. */
const VISION_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

function mimeFromExt(filePath: string): string {
  const e = extname(filePath).toLowerCase()
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.gif') return 'image/gif'
  if (e === '.webp') return 'image/webp'
  if (e === '.bmp') return 'image/bmp'
  if (e === '.png') return 'image/png'
  return 'application/octet-stream'
}

/** Cheap magic-byte check so we never base64-encode auth.json / .env as "images". */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true
  // WEBP (RIFF....WEBP)
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true
  }
  return false
}

export function registerIpc(runtime: GrokRuntime, terminals: TerminalManager): void {
  ipcMain.handle('grok:bootstrap', async () => runtime.getBootstrap())
  ipcMain.handle('grok:status', async () => runtime.getStatus())
  ipcMain.handle('grok:recheck', async () => runtime.refreshAndEmit())

  ipcMain.handle('grok:install', async () => runtime.installCli())
  ipcMain.handle('grok:login', async () => runtime.login())
  ipcMain.handle('grok:logout', async () => runtime.logout())

  ipcMain.handle('grok:listModels', async () => runtime.listModels())
  ipcMain.handle('grok:listSessions', async (_evt, limit?: number) =>
    runtime.listSessions(typeof limit === 'number' ? limit : 200),
  )
  ipcMain.handle(
    'grok:loadSessionHistory',
    async (_evt, sessionId: string, limit?: number) =>
      runtime.loadSessionHistory(sessionId, {
        limit: typeof limit === 'number' ? limit : 80,
      }),
  )
  ipcMain.handle('grok:accountProfile', async () => runtime.getAccountProfile())
  ipcMain.handle('grok:accountSubscription', async () => fetchAccountSubscription())
  ipcMain.handle('grok:listSkills', async (_evt, cwd?: string) =>
    runtime.listSkills(typeof cwd === 'string' ? cwd : undefined),
  )

  // Git (review / title bar)
  ipcMain.handle('git:status', async (_evt, cwd: string) =>
    getGitStatus(typeof cwd === 'string' ? cwd : ''),
  )
  ipcMain.handle('git:listBranches', async (_evt, cwd: string) =>
    listBranches(typeof cwd === 'string' ? cwd : ''),
  )
  ipcMain.handle('git:checkout', async (_evt, cwd: string, name: string) =>
    checkoutBranch(typeof cwd === 'string' ? cwd : '', typeof name === 'string' ? name : ''),
  )
  ipcMain.handle(
    'git:diff',
    async (_evt, cwd: string, filePath: string, staged?: boolean) =>
      getFileDiff(typeof cwd === 'string' ? cwd : '', typeof filePath === 'string' ? filePath : '', {
        staged: Boolean(staged),
      }),
  )
  ipcMain.handle(
    'grok:sessionToolEvents',
    async (_evt, sessionId: string, byteOffset?: number) =>
      runtime.readSessionToolEvents(
        typeof sessionId === 'string' ? sessionId : '',
        typeof byteOffset === 'number' ? byteOffset : 0,
      ),
  )
  ipcMain.handle(
    'grok:setSkillDisabled',
    async (_evt, name: string, disabled: boolean) => runtime.setSkillDisabled(name, disabled),
  )

  ipcMain.handle(
    'grok:prompt',
    async (
      _evt,
      payload: {
        sessionId: string
        cwd: string
        prompt: string
        model?: string
        effort?: string
        permissionMode?: string
        resume?: boolean
        /** ACP image blocks for --prompt-json (base64, no data: prefix). */
        images?: Array<{ mimeType: string; data: string; path?: string }>
        /** Non-image absolute paths to mention in the text prompt. */
        filePaths?: string[]
      },
    ) => {
      await runtime.startPromptSession(payload.sessionId, payload.cwd, payload.prompt, {
        model: payload.model,
        effort: payload.effort,
        permissionMode: payload.permissionMode,
        resume: payload.resume,
        images: Array.isArray(payload.images) ? payload.images : undefined,
        filePaths: Array.isArray(payload.filePaths) ? payload.filePaths : undefined,
      })
      return { ok: true }
    },
  )

  ipcMain.handle('grok:stop', async (_evt, sessionId: string) => {
    runtime.stopSession(sessionId)
    return { ok: true }
  })

  // Terminal
  ipcMain.handle('terminal:available', async () => ({
    ok: terminals.isAvailable(),
  }))
  ipcMain.handle('terminal:list', async () => terminals.list())
  ipcMain.handle('terminal:create', async (_evt, cwd: string, title?: string) =>
    terminals.create(cwd || '', title),
  )
  ipcMain.handle('terminal:write', async (_evt, id: string, data: string) =>
    terminals.write(id, data),
  )
  ipcMain.handle(
    'terminal:resize',
    async (_evt, id: string, cols: number, rows: number) => terminals.resize(id, cols, rows),
  )
  ipcMain.handle('terminal:close', async (_evt, id: string) => terminals.close(id))
  ipcMain.handle('terminal:openExternal', async (_evt, cwd: string) =>
    terminals.openExternal(cwd || ''),
  )

  ipcMain.handle('shell:openPath', async (_evt, filePath: string) => {
    if (!filePath) return { ok: false }
    const err = await shell.openPath(filePath)
    return { ok: !err, message: err || '' }
  })
  ipcMain.handle('shell:openExternal', async (_evt, url: string) => {
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'createDirectory'],
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths
  })

  /** Persist a clipboard / paste image so the CLI can receive path or base64. */
  ipcMain.handle(
    'fs:saveClipboardImage',
    async (
      _evt,
      payload: { base64: string; mimeType?: string; name?: string },
    ): Promise<{ ok: boolean; path?: string; mimeType?: string; size?: number; error?: string }> => {
      try {
        const b64 = typeof payload?.base64 === 'string' ? payload.base64 : ''
        if (!b64) return { ok: false, error: 'empty image' }
        // Reject data-URL prefix if a caller passes it by mistake
        const raw = b64.includes(',') ? b64.slice(b64.lastIndexOf(',') + 1) : b64
        const buf = Buffer.from(raw, 'base64')
        if (!buf.length) return { ok: false, error: 'invalid base64' }
        if (buf.length > MAX_VISION_IMAGE_BYTES) {
          return { ok: false, error: `image too large (>${MAX_VISION_IMAGE_BYTES} bytes)` }
        }
        if (!looksLikeImage(buf)) {
          return { ok: false, error: 'payload is not a recognized image' }
        }
        const mime =
          (typeof payload.mimeType === 'string' && payload.mimeType) || 'image/png'
        const mimeOk = /^image\/(png|jpe?g|gif|webp)$/i.test(mime.split(';')[0].trim())
        if (!mimeOk) return { ok: false, error: 'unsupported image mime type' }
        const ext = extForMime(mime)
        const safe =
          (payload.name || 'paste')
            .replace(/[^\w.\-]+/g, '_')
            .slice(0, 40) || 'paste'
        const filePath = join(attachmentsDir(), `${safe}-${randomUUID().slice(0, 8)}${ext}`)
        writeFileSync(filePath, buf)
        return { ok: true, path: filePath, mimeType: mime, size: buf.length }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  ipcMain.handle(
    'fs:readImageBase64',
    async (
      _evt,
      filePath: string,
    ): Promise<{
      ok: boolean
      base64?: string
      mimeType?: string
      size?: number
      name?: string
      error?: string
    }> => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { ok: false, error: 'missing path' }
        }
        // Deny path tricks / non-image reads (renderer is trusted, but keep defense-in-depth).
        if (filePath.includes('\0')) return { ok: false, error: 'invalid path' }
        const ext = extname(filePath).toLowerCase()
        if (!VISION_EXTS.has(ext)) {
          return { ok: false, error: 'only image files can be read (png/jpeg/gif/webp)' }
        }
        if (!existsSync(filePath)) return { ok: false, error: 'file not found' }
        const buf = readFileSync(filePath)
        if (buf.length > MAX_VISION_IMAGE_BYTES) {
          return { ok: false, error: `image too large (>${MAX_VISION_IMAGE_BYTES} bytes)` }
        }
        if (!looksLikeImage(buf)) {
          return { ok: false, error: 'file content is not a recognized image' }
        }
        return {
          ok: true,
          base64: buf.toString('base64'),
          mimeType: mimeFromExt(filePath),
          size: buf.length,
          name: basename(filePath),
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )
}
