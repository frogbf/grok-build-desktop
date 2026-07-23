import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import type { GrokRuntime } from './grok-runtime'
import type { TerminalManager } from './terminal-manager'
import { checkoutBranch, getFileDiff, getGitStatus, listBranches } from './git-service'
import { fetchAccountSubscription } from './account-service'

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
      },
    ) => {
      await runtime.startPromptSession(payload.sessionId, payload.cwd, payload.prompt, {
        model: payload.model,
        effort: payload.effort,
        permissionMode: payload.permissionMode,
        resume: payload.resume,
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
}
