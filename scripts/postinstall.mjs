/**
 * Root package postinstall.
 * Rebuilds native deps for Electron when needed.
 *
 * Set SKIP_ELECTRON_INSTALL_APP_DEPS=1 to skip (CI does npm ci, then runs
 * rebuild:pty explicitly with the right toolchain). Electron's own package
 * install.js still runs on a normal `npm ci` (downloads the binary).
 */
import { execSync } from 'node:child_process'

if (process.env.SKIP_ELECTRON_INSTALL_APP_DEPS === '1') {
  console.log('[postinstall] SKIP_ELECTRON_INSTALL_APP_DEPS=1 — skip install-app-deps')
  process.exit(0)
}

try {
  execSync('npx electron-builder install-app-deps', {
    stdio: 'inherit',
    env: process.env
  })
} catch (err) {
  // Local machines without a full MSVC toolchain should still install deps.
  console.warn(
    '[postinstall] install-app-deps failed (ignored):',
    err && err.message ? err.message : err
  )
}
