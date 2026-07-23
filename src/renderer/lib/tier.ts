/** Visual identity tied to SuperGrok-style subscription tiers. */
export type SubscriptionTier = 'free' | 'super' | 'heavy'

export const TIER_ORDER: SubscriptionTier[] = ['free', 'super', 'heavy']

export const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: 'Free',
  super: 'Super',
  heavy: 'Heavy',
}

export const TIER_HINT: Record<SubscriptionTier, string> = {
  free: '白色奇点',
  super: '紫色奇点',
  heavy: '金色奇点',
}

const STORAGE_KEY = 'grok-desktop-tier'
const MANUAL_KEY = 'grok-desktop-tier-manual'

export function loadTier(): SubscriptionTier {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'free' || v === 'super' || v === 'heavy') return v
  } catch {
    // ignore
  }
  return 'super'
}

export function isTierManual(): boolean {
  try {
    return localStorage.getItem(MANUAL_KEY) === '1'
  } catch {
    return false
  }
}

export function saveTier(tier: SubscriptionTier, manual = true): void {
  try {
    localStorage.setItem(STORAGE_KEY, tier)
    if (manual) localStorage.setItem(MANUAL_KEY, '1')
  } catch {
    // ignore
  }
}

export function nextTier(tier: SubscriptionTier): SubscriptionTier {
  const i = TIER_ORDER.indexOf(tier)
  return TIER_ORDER[(i + 1) % TIER_ORDER.length]
}

/**
 * Map live API tier (GrokPro / SuperGrok / …) to theme chip.
 * Prefer display name when both are present.
 */
export function mapApiTierToTheme(
  subscriptionTier: string | null | undefined,
  subscriptionDisplay: string | null | undefined,
): SubscriptionTier | null {
  const s = `${subscriptionDisplay || ''} ${subscriptionTier || ''}`.toLowerCase().trim()
  if (!s) return null
  if (s.includes('heavy')) return 'heavy'
  if (s.includes('free') || s.includes('xbasic') || s.includes('x basic')) return 'free'
  if (
    s.includes('supergrok') ||
    s.includes('grokpro') ||
    s.includes('grok pro') ||
    s.includes('premium') ||
    s.includes('pro')
  ) {
    return 'super'
  }
  return 'super'
}
