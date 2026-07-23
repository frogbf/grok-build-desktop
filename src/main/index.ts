import { app, BrowserWindow, shell, ipcMain, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { GrokRuntime } from './grok-runtime'
import { TerminalManager } from './terminal-manager'

// GPU: only disable by default on Linux (remote/VM sandboxes). Win/mac keep HW accel.
// Override: GROK_DESKTOP_DISABLE_GPU=1 force off; =0 force on (even on Linux).
const disableGpuEnv = process.env.GROK_DESKTOP_DISABLE_GPU
if (
  disableGpuEnv === '1' ||
  (process.platform === 'linux' && disableGpuEnv !== '0')
) {
  app.disableHardwareAcceleration()
}
if (process.env.GROK_DESKTOP_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
}
// Always allow no-sandbox when explicitly passed via CLI args from npm scripts
if (process.argv.includes('--no-sandbox')) {
  app.commandLine.appendSwitch('no-sandbox')
}

let mainWindow: BrowserWindow | null = null
const runtime = new GrokRuntime()
const terminals = new TerminalManager()

function resolvePreload(): string {
  const candidates = [
    join(__dirname, '../preload/index.cjs'),
    join(__dirname, '../preload/index.js'),
    join(__dirname, '../preload/index.mjs'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]
}

/**
 * Fixed OS window / taskbar icon: white singularity (same art as in-app
 * BrandMark free / empty-state watermark). Does not follow subscription tier.
 */
function resolveAppIcon(): string | undefined {
  const names = ['icon.png', 'icon-free.png', 'icon-256.png']
  const bases = [
    join(__dirname, '../../resources'),
    join(app.getAppPath(), 'resources'),
    process.resourcesPath || '',
    join(process.cwd(), 'resources'),
  ]

  for (const base of bases) {
    if (!base) continue
    for (const name of names) {
      const p = join(base, name)
      if (existsSync(p)) return p
    }
  }
  return undefined
}

function createWindow(): void {
  const preload = resolvePreload()
  const iconPath = resolveAppIcon()
  console.log('[grok-desktop] preload =', preload, 'exists=', existsSync(preload))
  console.log('[grok-desktop] icon =', iconPath || '(default electron)')

  const icon =
    iconPath && existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath)
      : undefined

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0a0a0b',
    ...(icon && !icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // ensure preload runs for http://localhost dev server
      webSecurity: true,
    },
  })

  // Ensure WM/taskbar picks up the icon even if constructor option is ignored
  if (icon && !icon.isEmpty()) {
    mainWindow.setIcon(icon)
  }

  mainWindow.webContents.on('did-finish-load', () => {
    void mainWindow?.webContents
      .executeJavaScript('Boolean(window.grokDesktop)')
      .then((ok) => {
        console.log('[grok-desktop] window.grokDesktop injected =', ok)
        if (!ok) {
          console.error(
            '[grok-desktop] Preload did not expose grokDesktop. Check preload path and console.',
          )
        }
      })
      .catch((e) => console.error('[grok-desktop] inject check failed', e))
  })

  mainWindow.webContents.on('preload-error', (_event, path, error) => {
    console.error('[grok-desktop] preload-error', path, error)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    void runtime.refreshAndEmit()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  runtime.attachWindow(mainWindow)
  terminals.attachWindow(mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc(runtime, terminals)

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  runtime.dispose()
  terminals.dispose()
  if (process.platform !== 'darwin') app.quit()
})
