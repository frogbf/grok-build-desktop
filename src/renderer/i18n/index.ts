import { en } from './locales/en'
import { zh, type MessageKey } from './locales/zh'

export type AppLocale = 'system' | 'zh' | 'en'
export type ResolvedLocale = 'zh' | 'en'

const STORAGE_KEY = 'grok-desktop-locale'

const catalogs: Record<ResolvedLocale, Record<MessageKey, string>> = {
  zh,
  en,
}

let preference: AppLocale = loadPreference()
let resolved: ResolvedLocale = resolve(preference)
const listeners = new Set<() => void>()

function loadPreference(): AppLocale {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'system' || v === 'zh' || v === 'en') return v
  } catch {
    // ignore
  }
  return 'system'
}

function systemLocale(): ResolvedLocale {
  const nav =
    typeof navigator !== 'undefined'
      ? navigator.language || (navigator as { userLanguage?: string }).userLanguage || 'en'
      : 'en'
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function resolve(pref: AppLocale): ResolvedLocale {
  if (pref === 'system') return systemLocale()
  return pref
}

export function getLocalePreference(): AppLocale {
  return preference
}

export function getResolvedLocale(): ResolvedLocale {
  return resolved
}

export function setLocalePreference(pref: AppLocale): void {
  preference = pref
  resolved = resolve(pref)
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn())
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function t(key: MessageKey): string {
  return catalogs[resolved][key] ?? catalogs.en[key] ?? key
}

export function useI18n(): {
  t: typeof t
  locale: AppLocale
  resolved: ResolvedLocale
  setLocale: typeof setLocalePreference
} {
  // Lightweight hook without importing React here — App will re-render via subscribe
  return {
    t,
    locale: preference,
    resolved,
    setLocale: setLocalePreference,
  }
}
