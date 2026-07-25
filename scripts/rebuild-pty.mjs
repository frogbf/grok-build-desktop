/**
 * Rebuild node-pty against the project's Electron ABI.
 *
 * Uses the local @electron/rebuild (3.x) which expects node-gyp@9 callback API.
 * Do NOT force node-gyp@10+ via overrides — electron-rebuild 3.x does
 * promisify(nodeGyp.commands[...]) which never resolves with async-only gyp 12
 * (CI hung ~20min on "Rebuild node-pty" on all platforms).
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rebuild } from '@electron/rebuild'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const electronVersion = require('electron/package.json').version
const rebuildPkg = require('@electron/rebuild/package.json')
// node-gyp is nested under @electron/rebuild (not always hoisted)
const requireFromRebuild = createRequire(require.resolve('@electron/rebuild/package.json'))
const gypPkgPath = requireFromRebuild.resolve('node-gyp/package.json')
const gypPkg = requireFromRebuild('node-gyp/package.json')

console.log(`[rebuild:pty] electron=${electronVersion}`)
console.log(`[rebuild:pty] @electron/rebuild=${rebuildPkg.version}`)
console.log(`[rebuild:pty] node-gyp=${gypPkg.version} @ ${path.dirname(gypPkgPath)}`)

const major = parseInt(String(gypPkg.version).split('.')[0], 10)
if (Number.isFinite(major) && major >= 10) {
  console.error(
    `[rebuild:pty] ERROR: node-gyp ${gypPkg.version} is incompatible with @electron/rebuild@${rebuildPkg.version}. ` +
      'electron-rebuild 3.x uses util.promisify on callback-style commands; node-gyp 10+ is async-only and hangs forever. ' +
      'Remove any package.json overrides that force a newer node-gyp.'
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

if (process.platform === 'win32' && !process.env.npm_config_msvs_version && !process.env.GYP_MSVS_VERSION) {
  process.env.npm_config_msvs_version = '2022'
  console.log('[rebuild:pty] default npm_config_msvs_version=2022')
}

const started = Date.now()
console.log('[rebuild:pty] starting @electron/rebuild ...')

await rebuild({
  buildPath: root,
  electronVersion,
  arch: process.arch,
  force: true,
  onlyModules: ['node-pty']
})

console.log(`[rebuild:pty] ok in ${((Date.now() - started) / 1000).toFixed(1)}s`)
