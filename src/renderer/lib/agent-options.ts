/** Mirrors official `grok` CLI flags where possible. */

export const DEFAULT_MODEL = 'grok-4.5'
export const DEFAULT_EFFORT = 'high'

/** UI access mode → CLI `--permission-mode`. */
export type AccessUi = 'full' | 'ask' | 'readonly'

export const ACCESS_TO_PERMISSION: Record<AccessUi, string> = {
  /** YOLO-style: skip interactive prompts */
  full: 'bypassPermissions',
  /** Normal approvals */
  ask: 'default',
  /** Plan-oriented / lower blast radius */
  readonly: 'plan',
}

export type EffortOption = {
  id: string
  value: string
  label: string
  default?: boolean
}

export type ModelOption = {
  id: string
  name: string
  efforts: EffortOption[]
  supportsReasoningEffort: boolean
}

export function cycle<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current as T)
  if (i < 0) return list[0]
  return list[(i + 1) % list.length]
}

export function defaultEffortFor(model: ModelOption | undefined): string {
  if (!model?.efforts?.length) return DEFAULT_EFFORT
  return model.efforts.find((e) => e.default)?.value || model.efforts[0].value
}

export function effortLabel(model: ModelOption | undefined, value: string): string {
  const hit = model?.efforts.find((e) => e.value === value || e.id === value)
  if (hit?.label) {
    // Shorten "High Effort" → "High" for chip
    return hit.label.replace(/\s*Effort\s*$/i, '').trim() || hit.label
  }
  return value
}
