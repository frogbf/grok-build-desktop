/**
 * Desktop slash commands (CLI-inspired).
 * Local actions run in the GUI; agent/skill prompts are inserted or submitted.
 */
import { fuzzyFilter } from './fuzzy'
import type { MessageKey } from '../i18n/locales/zh'
import type { ModelOption } from './agent-options'

export type SlashAction =
  | { type: 'local'; id: string }
  | { type: 'insert'; text: string; submit?: boolean }
  | { type: 'set_model'; modelId: string }
  | { type: 'set_effort'; effort: string }
  | { type: 'set_access'; access: 'full' | 'ask' | 'readonly' }

export type SlashCommand = {
  /** Primary name without leading slash */
  name: string
  aliases?: string[]
  /** i18n description key, or raw description for skills */
  descriptionKey?: MessageKey
  description?: string
  /** Argument hint shown in menu */
  argHint?: string
  source: 'builtin' | 'skill' | 'model'
  /** When true, picking inserts `/name ` and keeps the menu closed for args */
  needsArgs?: boolean
  action: SlashAction
}

const BUILTINS: SlashCommand[] = [
  {
    name: 'new',
    aliases: ['clear'],
    descriptionKey: 'slashNew',
    source: 'builtin',
    action: { type: 'local', id: 'new' },
  },
  {
    name: 'resume',
    descriptionKey: 'slashResume',
    source: 'builtin',
    action: { type: 'local', id: 'resume' },
  },
  {
    name: 'settings',
    aliases: ['config', 'preferences', 'prefs'],
    descriptionKey: 'slashSettings',
    source: 'builtin',
    action: { type: 'local', id: 'settings' },
  },
  {
    name: 'skills',
    descriptionKey: 'slashSkills',
    source: 'builtin',
    action: { type: 'local', id: 'skills' },
  },
  {
    name: 'usage',
    aliases: ['cost'],
    descriptionKey: 'slashUsage',
    source: 'builtin',
    action: { type: 'local', id: 'usage' },
  },
  {
    name: 'copy',
    descriptionKey: 'slashCopy',
    source: 'builtin',
    action: { type: 'local', id: 'copy' },
  },
  {
    name: 'home',
    aliases: ['welcome'],
    descriptionKey: 'slashHome',
    source: 'builtin',
    action: { type: 'local', id: 'home' },
  },
  {
    name: 'model',
    aliases: ['m'],
    descriptionKey: 'slashModel',
    argHint: '<name> [effort]',
    needsArgs: true,
    source: 'builtin',
    action: { type: 'insert', text: '/model ' },
  },
  {
    name: 'effort',
    descriptionKey: 'slashEffort',
    argHint: 'low|medium|high|xhigh',
    needsArgs: true,
    source: 'builtin',
    action: { type: 'insert', text: '/effort ' },
  },
  {
    name: 'always-approve',
    descriptionKey: 'slashAlwaysApprove',
    source: 'builtin',
    action: { type: 'set_access', access: 'full' },
  },
  {
    name: 'auto',
    descriptionKey: 'slashAuto',
    source: 'builtin',
    action: { type: 'set_access', access: 'ask' },
  },
  {
    name: 'plan',
    descriptionKey: 'slashPlan',
    argHint: '[description]',
    source: 'builtin',
    // Enter plan/read-only mode; optional description is submitted as a prompt
    action: { type: 'set_access', access: 'readonly' },
  },
  {
    name: 'imagine',
    descriptionKey: 'slashImagine',
    argHint: '<description>',
    needsArgs: true,
    source: 'builtin',
    action: { type: 'insert', text: '/imagine ' },
  },
  {
    name: 'remember',
    descriptionKey: 'slashRemember',
    argHint: '<note>',
    needsArgs: true,
    source: 'builtin',
    action: { type: 'insert', text: '/remember ' },
  },
  {
    name: 'compact',
    descriptionKey: 'slashCompact',
    argHint: '[context]',
    source: 'builtin',
    action: { type: 'insert', text: '/compact', submit: true },
  },
  {
    name: 'docs',
    aliases: ['howto', 'guides'],
    descriptionKey: 'slashDocs',
    source: 'builtin',
    action: { type: 'local', id: 'docs' },
  },
  {
    name: 'terminal',
    descriptionKey: 'slashTerminal',
    source: 'builtin',
    action: { type: 'local', id: 'terminal' },
  },
  {
    name: 'help',
    descriptionKey: 'slashHelp',
    source: 'builtin',
    action: { type: 'local', id: 'help' },
  },
]

export type SkillLike = {
  name: string
  description: string
  userInvocable?: boolean
  disabled?: boolean
}

export function buildSlashCatalog(
  models: ModelOption[],
  skills: SkillLike[],
): SlashCommand[] {
  const modelCmds: SlashCommand[] = models.map((m) => ({
    name: `model ${m.name || m.id}`,
    aliases: [`model ${m.id}`, `m ${m.id}`],
    description: m.id,
    descriptionKey: undefined,
    source: 'model' as const,
    action: { type: 'set_model' as const, modelId: m.id },
  }))

  const skillCmds: SlashCommand[] = skills
    .filter((s) => !s.disabled && s.userInvocable !== false)
    .map((s) => ({
      name: s.name,
      description: s.description || s.name,
      needsArgs: true,
      source: 'skill' as const,
      action: {
        type: 'insert' as const,
        text: `/${s.name} `,
      },
    }))

  return [...BUILTINS, ...modelCmds, ...skillCmds]
}

/** Parse `/model foo` or `/effort high` when the user submits a full slash line. */
export function tryParseSlashLine(
  text: string,
  models: ModelOption[],
): SlashAction | null {
  const raw = text.trim()
  if (!raw.startsWith('/')) return null
  const body = raw.slice(1).trim()
  if (!body) return null

  const parts = body.split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const rest = parts.slice(1)

  if (cmd === 'new' || cmd === 'clear') return { type: 'local', id: 'new' }
  if (cmd === 'resume') return { type: 'local', id: 'resume' }
  if (cmd === 'settings' || cmd === 'config' || cmd === 'preferences' || cmd === 'prefs') {
    return { type: 'local', id: 'settings' }
  }
  if (cmd === 'skills') return { type: 'local', id: 'skills' }
  if (cmd === 'usage' || cmd === 'cost') return { type: 'local', id: 'usage' }
  if (cmd === 'copy') return { type: 'local', id: 'copy' }
  if (cmd === 'home' || cmd === 'welcome') return { type: 'local', id: 'home' }
  if (cmd === 'docs' || cmd === 'howto' || cmd === 'guides') return { type: 'local', id: 'docs' }
  if (cmd === 'terminal') return { type: 'local', id: 'terminal' }
  if (cmd === 'help') return { type: 'local', id: 'help' }
  if (cmd === 'always-approve') return { type: 'set_access', access: 'full' }
  if (cmd === 'auto') return { type: 'set_access', access: 'ask' }
  if (cmd === 'plan' && rest.length === 0) return { type: 'set_access', access: 'readonly' }

  if (cmd === 'model' || cmd === 'm') {
    if (!rest.length) return null
    const name = rest.join(' ').toLowerCase()
    // last token may be effort
    const effortCandidates = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
    let effort: string | undefined
    let modelQuery = name
    const last = rest[rest.length - 1].toLowerCase()
    if (rest.length >= 2 && effortCandidates.has(last)) {
      effort = last === 'max' ? 'xhigh' : last
      modelQuery = rest.slice(0, -1).join(' ').toLowerCase()
    }
    const hit =
      models.find((m) => m.id.toLowerCase() === modelQuery) ||
      models.find((m) => (m.name || '').toLowerCase() === modelQuery) ||
      models.find((m) => m.id.toLowerCase().includes(modelQuery)) ||
      models.find((m) => (m.name || '').toLowerCase().includes(modelQuery))
    if (hit) {
      // model + optional effort handled by caller via two actions — return model; effort separate
      if (effort) {
        // encode effort in a synthetic local — caller checks set_model then set_effort
        return { type: 'set_model', modelId: `${hit.id}::${effort}` }
      }
      return { type: 'set_model', modelId: hit.id }
    }
    return null
  }

  if (cmd === 'effort' && rest[0]) {
    const e = rest[0].toLowerCase()
    if (['low', 'medium', 'high', 'xhigh', 'max'].includes(e)) {
      return { type: 'set_effort', effort: e === 'max' ? 'xhigh' : e }
    }
  }

  // Skills / agent prompts: leave as-is for submit (return null)
  return null
}

export function filterSlashCommands(
  catalog: SlashCommand[],
  query: string,
  limit = 40,
): SlashCommand[] {
  // query is text after leading `/`, may include spaces (e.g. "model gr")
  return fuzzyFilter(
    catalog,
    query,
    (c) => [c.name, ...(c.aliases || []), c.description || '', c.descriptionKey || ''],
    limit,
  )
}

export function commandLabel(c: SlashCommand): string {
  return `/${c.name.split(' ')[0]}`
}

export function commandTitle(c: SlashCommand): string {
  return `/${c.name}`
}
