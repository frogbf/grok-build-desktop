import freeUrl from '../assets/singularity-free.png'
import superUrl from '../assets/singularity-super.png'
import heavyUrl from '../assets/singularity-heavy.png'
import { loadTier, type SubscriptionTier } from '../lib/tier'
import './BrandMark.css'

const TIER_SRC: Record<SubscriptionTier, string> = {
  free: freeUrl,
  super: superUrl,
  heavy: heavyUrl,
}

function resolveTier(tier?: SubscriptionTier): SubscriptionTier {
  if (tier) return tier
  // Prefer live data-tier on document (set by App)
  if (typeof document !== 'undefined') {
    const t = document.documentElement.getAttribute('data-tier')
      || document.querySelector('.app-shell')?.getAttribute('data-tier')
    if (t === 'free' || t === 'super' || t === 'heavy') return t
  }
  return loadTier()
}

type MarkProps = {
  size?: number
  className?: string
  title?: string
  tier?: SubscriptionTier
}

/** App mark — tier-specific singularity asset (white / purple / gold). */
export function BrandMark({ size = 18, className = '', title = 'Singularity', tier }: MarkProps) {
  const t = resolveTier(tier)
  return (
    <img
      src={TIER_SRC[t]}
      width={size}
      height={size}
      alt=""
      title={title}
      draggable={false}
      className={`brand-mark-img tier-${t} ${className}`.trim()}
      data-tier-art={t}
    />
  )
}

/** Empty-state watermark — same tier art, larger. */
export function BrandMarkWatermark({ tier }: { tier?: SubscriptionTier }) {
  const t = resolveTier(tier)
  return (
    <div className={`brand-watermark-photo tier-${t}`} aria-hidden data-tier-art={t}>
      <img src={TIER_SRC[t]} alt="" draggable={false} />
    </div>
  )
}
