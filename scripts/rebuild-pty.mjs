/**
 * Rebuild node-pty against the project's Electron ABI.
 * Uses the local @electron/rebuild + overridden node-gyp (not a bare `npx`
 * fetch that can pull a detached package with its own node-gyp@9).
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rebuild } from '@electron/rebuild'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const electronVersion = require('electron/package.json').version
const gypPkg = require('node-gyp/package.json')
const rebuildPkg = require('@electron/rebuild/package.json')

console.log(`[rebuild:pty] electron=${electronVersion}`)
console.log(`[rebuild:pty] @electron/rebuild=${rebuildPkg.version}`)
console.log(`[rebuild:pty] node-gyp=${gypPkg.version} @ ${path.dirname(require.resolve('node-gyp/package.json'))}`)

const major = parseInt(String(gypPkg.version).split('.')[0], 10)
if (Number.isFinite(major) && major < 12) {
  console.error(
    `[rebuild:pty] ERROR: node-gyp ${gypPkg.version} cannot detect VS 2022/2026 reliably. ` +
      'Expected package.json overrides to hoist node-gyp@^12.1.0.'
  )
  process.exit(1)
}

// msvc-dev-cmd / VS Developer Prompt sets VCINSTALLDIR. node-gyp treats that as a
// *strict* match against the install path; nested toolset dirs cause every
// candidate to be rejected ("Could not find any Visual Studio installation").
if (process.platform === 'win32' && process.env.VCINSTALLDIR) {
  console.log(`[rebuild:pty] clearing VCINSTALLDIR=${process.env.VCINSTALLDIR}`)
  delete process.env.VCINSTALLDIR
}

// Prefer year when unset so finder can pick the runner's VS 2022 (or 2026 with gyp 12).
if (process.platform === 'win32' && !process.env.npm_config_msvs_version && !process.env.GYP_MSVS_VERSION) {
  process.env.npm_config_msvs_version = '2022'
  console.log('[rebuild:pty] default npm_config_msvs_version=2022')
}

await rebuild({
  buildPath: root,
  electronVersion,
  arch: process.arch,
  force: true,
  onlyModules: ['node-pty']
})

console.log('[rebuild:pty] ok')
