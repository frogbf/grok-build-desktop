/**
 * Project file search for composer `@` mentions.
 * Prefer `git ls-files` (respects .gitignore); fall back to a bounded walk.
 *
 * Cross-platform notes:
 * - Relative paths always use posix `/` (matches Grok CLI `@path` mentions).
 * - Absolute paths use `path.join` so Windows gets `\` / drive letters.
 * - Hits are sandboxed under cwd (no `..` escape).
 * - Git may be missing from PATH when the app is launched from a GUI — fall back to walk.
 * - Windows non-ASCII paths: `core.quotepath=false` + UTF-8 buffer decode.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

export type FileSearchHit = {
  /** Path relative to cwd, posix-style separators. */
  path: string
  /** Absolute path (OS-native separators). */
  absPath: string
  isDir: boolean
  score: number
}

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.hvigor',
  'oh_modules',
  'dist',
  'build',
  'out',
  'release',
  '.next',
  '.nuxt',
  'coverage',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.idea',
  '.vscode',
  '.grok',
  // Windows / packaging noise
  'AppData',
  '$RECYCLE.BIN',
  'System Volume Information',
])

const MAX_INDEX = 8000
const MAX_WALK_DEPTH = 12
const GIT_TIMEOUT_MS = 8_000

function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

function normalizeRoot(cwd: string): string | null {
  try {
    let root = resolve(cwd.trim())
    if (!existsSync(root)) return null
    try {
      // Resolve junctions / symlinks when possible (Windows + Unix)
      root = realpathSync(root)
    } catch {
      // keep resolved path
    }
    const st = statSync(root)
    if (!st.isDirectory()) return null
    return root
  } catch {
    return null
  }
}

/** Ensure abs path stays under root (blocks `..` / symlink escape best-effort). */
function safeAbsUnderRoot(root: string, relPosix: string): string | null {
  const cleaned = toPosix(relPosix).replace(/^\/+/, '')
  if (!cleaned || cleaned.includes('\0')) return null
  // Reject absolute / drive / UNC smuggled in relative segment
  if (isAbsolute(cleaned) || /^[A-Za-z]:/.test(cleaned) || cleaned.startsWith('//')) {
    return null
  }
  const segments = cleaned.split('/').filter((s) => s && s !== '.')
  if (segments.some((s) => s === '..')) return null
  const abs = normalize(join(root, ...segments))
  const rootNorm = normalize(root)
  const prefix = rootNorm.endsWith(sep) ? rootNorm : rootNorm + sep
  if (abs !== rootNorm && !abs.startsWith(prefix)) {
    // Windows: compare case-insensitive
    const a = abs.toLowerCase()
    const p = prefix.toLowerCase()
    const r = rootNorm.toLowerCase()
    if (a !== r && !a.startsWith(p)) return null
  }
  return abs
}

/** Subsequence fuzzy score (higher is better). 0 = no match. */
export function fuzzyScore(query: string, text: string): number {
  // Normalize path seps so `src\foo` query matches `src/foo` on Windows typing habits
  const q = query.trim().toLowerCase().replace(/\\/g, '/')
  if (!q) return 1
  const t = text.toLowerCase().replace(/\\/g, '/')
  if (t === q) return 10_000
  if (t.startsWith(q)) return 5_000 + Math.max(0, 100 - t.length)
  if (t.includes(q)) return 2_000 + Math.max(0, 80 - t.indexOf(q))

  const base = t.includes('/') ? t.slice(t.lastIndexOf('/') + 1) : t
  if (base.startsWith(q)) return 3_500 + Math.max(0, 50 - base.length)
  if (base.includes(q)) return 1_500

  let qi = 0
  let score = 0
  let consecutive = 0
  let lastMatch = -2
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      consecutive = i === lastMatch + 1 ? consecutive + 1 : 1
      score += 10 + consecutive * 6
      if (i === 0 || t[i - 1] === '/' || t[i - 1] === '-' || t[i - 1] === '_' || t[i - 1] === '.') {
        score += 18
      }
      lastMatch = i
      qi++
    }
  }
  if (qi < q.length) return 0
  score += Math.max(0, 40 - t.length)
  return score
}

function listGitFiles(cwd: string, includeHidden: boolean): string[] | null {
  try {
    // -c core.quotepath=false: keep UTF-8 paths (CJK/emoji) unescaped
    const r = spawnSync(
      'git',
      [
        '-c',
        'core.quotepath=false',
        '-C',
        cwd,
        'ls-files',
        '-co',
        '--exclude-standard',
        '-z',
      ],
      {
        encoding: 'buffer',
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        // Don't use shell — safer on Windows with paths containing spaces/&
        shell: false,
        env: {
          ...process.env,
          // Prefer UTF-8 output when git honors it
          LANG: process.env.LANG || 'en_US.UTF-8',
          LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
        },
      },
    )
    if (r.error || r.status !== 0 || !r.stdout) return null
    const raw = r.stdout.toString('utf8')
    const parts = raw.split('\0').filter(Boolean)
    const out: string[] = []
    for (const p of parts) {
      const posix = toPosix(p).replace(/^\.\//, '')
      if (!posix || posix === '.') continue
      if (!includeHidden && posix.split('/').some((seg) => seg.startsWith('.'))) continue
      // Skip git submodule gitlinks noise if any odd entries
      if (posix.endsWith('/')) continue
      out.push(posix)
      if (out.length >= MAX_INDEX) break
    }
    return out
  } catch {
    return null
  }
}

function walkFiles(cwd: string, includeHidden: boolean): string[] {
  const out: string[] = []

  const walk = (dir: string, depth: number) => {
    if (out.length >= MAX_INDEX || depth > MAX_WALK_DEPTH) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      // EACCES / EPERM / broken symlinks — skip (common on macOS Desktop / Windows system dirs)
      return
    }
    for (const name of entries) {
      if (out.length >= MAX_INDEX) return
      if (name === '.' || name === '..') continue
      if (!includeHidden && name.startsWith('.')) continue
      if (DEFAULT_IGNORE.has(name)) continue
      // Windows reserved device names rarely appear as folders; skip ADS-looking names
      if (process.platform === 'win32' && /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) {
        continue
      }
      const abs = join(dir, name)
      let st
      try {
        // lstat: do not follow symlinks (avoids loops / scanning outside the project)
        st = lstatSync(abs)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        walk(abs, depth + 1)
      } else if (st.isFile()) {
        const rel = toPosix(relative(cwd, abs))
        if (rel && !rel.startsWith('..') && !isAbsolute(rel)) out.push(rel)
      }
    }
  }

  walk(cwd, 0)
  return out
}

type IndexCache = { at: number; paths: string[] }
const indexCache = new Map<string, IndexCache>()
const CACHE_TTL_MS = 15_000

function listIndex(cwd: string, includeHidden: boolean): string[] {
  const key = `${cwd}\0${includeHidden ? '1' : '0'}`
  const hit = indexCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.paths

  // Prefer git index when available (PATH may lack git for GUI-launched apps → null)
  const git = listGitFiles(cwd, includeHidden)
  const paths = git && git.length > 0 ? git : walkFiles(cwd, includeHidden)
  indexCache.set(key, { at: Date.now(), paths })
  if (indexCache.size > 8) {
    const oldest = [...indexCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) indexCache.delete(oldest[0])
  }
  return paths
}

/**
 * Search project files under cwd.
 * Query may start with `!` to include hidden paths.
 */
export function searchProjectFiles(
  cwd: string,
  query: string,
  opts?: { limit?: number },
): { ok: boolean; hits: FileSearchHit[]; error?: string } {
  const root = normalizeRoot(cwd)
  if (!root) {
    return {
      ok: false,
      hits: [],
      error: (cwd || '').trim() ? 'directory not found' : 'no project directory',
    }
  }

  let q = (query || '').trim().replace(/\\/g, '/')
  let includeHidden = false
  if (q.startsWith('!')) {
    includeHidden = true
    q = q.slice(1)
  }

  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 100)
  let paths: string[]
  try {
    paths = listIndex(root, includeHidden)
  } catch (e) {
    return { ok: false, hits: [], error: e instanceof Error ? e.message : String(e) }
  }

  const scored: FileSearchHit[] = []
  for (const p of paths) {
    const sc = fuzzyScore(q, p)
    if (sc <= 0) continue
    const absPath = safeAbsUnderRoot(root, p)
    if (!absPath) continue
    scored.push({
      path: toPosix(p),
      absPath,
      isDir: false,
      score: sc,
    })
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return { ok: true, hits: scored.slice(0, limit) }
}
