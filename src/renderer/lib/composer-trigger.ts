/**
 * Detect active `@` file mention or `/` slash command at the textarea caret.
 *
 * Cross-platform:
 * - Do not treat emails (`a@b.com`) as file mentions (char before @ is word).
 * - Do not treat `http://`, `//`, or Unix absolute paths (`/Users/...`) as slash commands.
 * - Windows `C:\...` does not start with `/`, so it won't open the slash menu.
 */

export type TriggerKind = 'file' | 'slash'

export type ActiveTrigger = {
  kind: TriggerKind
  /** Full match including @ or / */
  raw: string
  /** Query after @ / /  (for @ may start with !) */
  query: string
  /** Start index in the full value */
  start: number
  /** End index (= caret when typing) */
  end: number
}

/** Common absolute roots that look like pasted paths, not slash commands. */
const ABS_PATH_PREFIX =
  /^\/(?:Users|home|var|tmp|etc|opt|usr|private|Volumes|mnt|media|root|Applications|System|Library|bin|sbin|dev|proc|run)\b/i

/**
 * Find trigger immediately before `caret` in `value`.
 * - `@` / `@!` path tokens (no spaces)
 * - `/` commands only when at line start or after whitespace (not mid-word like https://)
 */
export function findActiveTrigger(value: string, caret: number): ActiveTrigger | null {
  if (caret < 0 || caret > value.length) return null
  const before = value.slice(0, caret)

  // File mention: @ or @! then non-space path chars.
  // Require start / whitespace / open-bracket so `user@host` emails don't match.
  const at = before.match(/(?:^|[\s([{])(@!?[^\s]*)$/)
  if (at) {
    const raw = at[1]
    const start = caret - raw.length
    // Avoid `@` in the middle of tokens like `npm@1.2.3` if boundary was wrong
    if (start > 0 && /[\w.]/.test(value[start - 1]!)) return null
    return {
      kind: 'file',
      raw,
      query: raw.slice(1).replace(/\\/g, '/'), // strip @; normalize Win seps in query
      start,
      end: caret,
    }
  }

  // Slash: token starting with `/` after whitespace or at start of value/line.
  const slash = before.match(/(?:^|[\s\n\r])(\/[^\s]*)$/)
  if (slash) {
    const raw = slash[1]
    const start = caret - raw.length
    // `http://`, `//comment`
    if (start > 0 && value[start - 1] === '/') return null
    // Pasted Unix absolute path — don't steal it as a slash command
    if (ABS_PATH_PREFIX.test(raw)) return null
    // Multi-segment path with a file-ish extension → likely a path, not `/cmd`
    if ((raw.match(/\//g) || []).length >= 2 && /\.[a-zA-Z0-9]{1,8}$/.test(raw)) {
      return null
    }
    return {
      kind: 'slash',
      raw,
      query: raw.slice(1),
      start,
      end: caret,
    }
  }

  return null
}

/** Replace [start, end) with `insert` and return new value + caret. */
export function replaceRange(
  value: string,
  start: number,
  end: number,
  insert: string,
): { value: string; caret: number } {
  const next = value.slice(0, start) + insert + value.slice(end)
  return { value: next, caret: start + insert.length }
}
