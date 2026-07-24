export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type ChatMessage = {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  meta?: {
    toolName?: string
    toolCallId?: string
    status?: 'running' | 'done' | 'error'
    /** Collapsed thought / tool card */
    kind?: 'thought' | 'tool' | 'text'
  }
}

export type Session = {
  /** Official Grok session UUID (also used as UI id). */
  id: string
  /**
   * Raw title from disk metadata / prompt snippet.
   * Prefer {@link sessionDisplayTitle} for UI so empty shells use i18n.
   */
  title: string
  cwd: string
  projectName: string
  updatedAt: number
  status: 'idle' | 'running' | 'error'
  messages: ChatMessage[]
  /** Session already exists under ~/.grok/sessions — next prompt uses --resume */
  onDisk?: boolean
  modelId?: string | null
  effort?: string | null
  /**
   * Shell-only / no real user chat (from main process, locale-neutral).
   * Sidebar hides these by default; titles use i18n when shown.
   */
  empty?: boolean
}

/** Localized label for sidebar / search rows. */
export function sessionDisplayTitle(
  s: Pick<Session, 'title' | 'empty'>,
  t: (key: 'emptySession' | 'newTask') => string,
): string {
  if (s.empty) return t('emptySession')
  const title = (s.title || '').trim()
  if (title) return title
  return t('newTask')
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback UUID v4-ish
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || path || 'workspace'
}
