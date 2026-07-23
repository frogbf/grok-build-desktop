import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GitStatus = {
  isRepo: boolean
  branch: string | null
  detached: boolean
  dirty: boolean
  dirtyCount: number
  ahead: number
  behind: number
  /** Short porcelain lines for review panel (max ~40) */
  shortStatus: string[]
  error?: string
}

export type GitBranchItem = {
  name: string
  current: boolean
}

function emptyStatus(partial?: Partial<GitStatus>): GitStatus {
  return {
    isRepo: false,
    branch: null,
    detached: false,
    dirty: false,
    dirtyCount: 0,
    ahead: 0,
    behind: 0,
    shortStatus: [],
    ...partial,
  }
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: 8000,
      maxBuffer: 1024 * 512,
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    })
    return { ok: true, out: (stdout || '').trim(), err: (stderr || '').trim() }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      out: (err.stdout || '').trim(),
      err: (err.stderr || err.message || String(e)).trim(),
    }
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  if (!cwd) return emptyStatus({ error: 'no cwd' })

  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out !== 'true') {
    return emptyStatus()
  }

  const [branchRes, statusRes] = await Promise.all([
    git(cwd, ['branch', '--show-current']),
    git(cwd, ['status', '--porcelain=v1', '-b']),
  ])

  let branch = branchRes.ok && branchRes.out ? branchRes.out : null
  let detached = false

  if (!branch) {
    detached = true
    const head = await git(cwd, ['rev-parse', '--short', 'HEAD'])
    if (head.ok && head.out) branch = head.out
  }

  const lines = statusRes.ok
    ? statusRes.out.split(/\r?\n/).filter(Boolean)
    : []
  const header = lines.find((l) => l.startsWith('## ')) || ''
  const fileLines = lines.filter((l) => !l.startsWith('## '))

  let ahead = 0
  let behind = 0
  const aheadM = header.match(/ahead\s+(\d+)/i)
  const behindM = header.match(/behind\s+(\d+)/i)
  if (aheadM) ahead = Number(aheadM[1]) || 0
  if (behindM) behind = Number(behindM[1]) || 0

  // If branch --show-current empty but header has name
  if (!branch && header) {
    const m = header.match(/^##\s+([^\s.]+)/)
    if (m && m[1] !== 'HEAD') {
      branch = m[1]
      detached = false
    }
  }

  return {
    isRepo: true,
    branch,
    detached,
    dirty: fileLines.length > 0,
    dirtyCount: fileLines.length,
    ahead,
    behind,
    shortStatus: fileLines.slice(0, 40),
  }
}

export async function listBranches(cwd: string): Promise<{
  ok: boolean
  branches: GitBranchItem[]
  error?: string
}> {
  if (!cwd) return { ok: false, branches: [], error: 'no cwd' }
  const res = await git(cwd, ['branch', '--format=%(refname:short)%09%(HEAD)'])
  if (!res.ok) return { ok: false, branches: [], error: res.err || 'git branch failed' }
  const branches: GitBranchItem[] = []
  for (const line of res.out.split(/\r?\n/).filter(Boolean)) {
    const [name, head] = line.split('\t')
    if (!name) continue
    branches.push({ name, current: head === '*' })
  }
  // Fallback format without --format
  if (branches.length === 0) {
    const plain = await git(cwd, ['branch'])
    if (!plain.ok) return { ok: false, branches: [], error: plain.err }
    for (const line of plain.out.split(/\r?\n/).filter(Boolean)) {
      const current = line.startsWith('*')
      const name = line.replace(/^\*?\s+/, '').trim()
      if (name) branches.push({ name, current })
    }
  }
  return { ok: true, branches }
}

export async function checkoutBranch(
  cwd: string,
  name: string,
): Promise<{ ok: boolean; message: string }> {
  if (!cwd || !name) return { ok: false, message: 'cwd and branch required' }
  const status = await getGitStatus(cwd)
  if (!status.isRepo) return { ok: false, message: 'not a git repository' }
  if (status.dirty) {
    return {
      ok: false,
      message: `工作区有 ${status.dirtyCount} 处未提交改动，请先 commit 或 stash 后再切换分支`,
    }
  }
  const res = await git(cwd, ['checkout', name])
  if (!res.ok) return { ok: false, message: res.err || 'checkout failed' }
  return { ok: true, message: `switched to ${name}` }
}

/** Parse a porcelain status line into path + codes. */
export function parseStatusLine(line: string): {
  code: string
  path: string
  origPath?: string
} | null {
  if (!line || line.length < 4) return null
  // XY path  OR  XY orig -> path  OR  "path with spaces"
  const code = line.slice(0, 2)
  const rest = line.slice(3)
  if (rest.includes(' -> ')) {
    const [a, b] = rest.split(' -> ')
    return { code, path: stripQuotes(b || a || ''), origPath: stripQuotes(a || '') }
  }
  return { code, path: stripQuotes(rest) }
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1).replace(/\\"/g, '"')
  }
  return t
}

/**
 * File-level diff for review panel.
 * - Untracked: show first ~200 lines of file content as "new file" preview
 * - Staged-only (XY starts with M/A/D and second is space): prefer cached
 * - Else: unstaged working tree diff, fall back to cached
 */
export async function getFileDiff(
  cwd: string,
  filePath: string,
  opts?: { staged?: boolean },
): Promise<{ ok: boolean; diff: string; mode: 'unstaged' | 'staged' | 'untracked' | 'empty'; error?: string }> {
  if (!cwd || !filePath) {
    return { ok: false, diff: '', mode: 'empty', error: 'cwd and path required' }
  }

  // Detect untracked via status
  const st = await git(cwd, ['status', '--porcelain=v1', '--', filePath])
  const line = st.ok ? st.out.split(/\r?\n/).find(Boolean) || '' : ''
  const code = line.slice(0, 2)

  if (code === '??') {
    // Untracked: synthesize a new-file style diff (git --no-index exits 1 on differences)
    const diffRes = await git(cwd, ['diff', '--no-index', '--', '/dev/null', filePath])
    const body = diffRes.out || ''
    if (body) {
      return { ok: true, diff: trimDiff(body), mode: 'untracked' }
    }
    return {
      ok: true,
      diff: `(untracked) ${filePath}\n(empty or unreadable)`,
      mode: 'untracked',
    }
  }

  const preferStaged = Boolean(opts?.staged) || (code[0] !== ' ' && code[0] !== '?' && code[1] === ' ')

  if (preferStaged) {
    const cached = await git(cwd, ['diff', '--cached', '--', filePath])
    if (cached.ok && cached.out) {
      return { ok: true, diff: trimDiff(cached.out), mode: 'staged' }
    }
  }

  const unstaged = await git(cwd, ['diff', '--', filePath])
  if (unstaged.ok && unstaged.out) {
    return { ok: true, diff: trimDiff(unstaged.out), mode: 'unstaged' }
  }

  const cached = await git(cwd, ['diff', '--cached', '--', filePath])
  if (cached.ok && cached.out) {
    return { ok: true, diff: trimDiff(cached.out), mode: 'staged' }
  }

  // Deleted or binary / no textual diff
  if (line) {
    return {
      ok: true,
      diff: `${line}\n(no textual diff — binary, pure rename, or empty change)`,
      mode: 'empty',
    }
  }

  return { ok: false, diff: '', mode: 'empty', error: 'no diff for path' }
}

function trimDiff(s: string, max = 120_000): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n\n… truncated (${s.length} bytes)`
}
