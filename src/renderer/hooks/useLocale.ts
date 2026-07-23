import { useEffect, useState } from 'react'
import {
  getLocalePreference,
  getResolvedLocale,
  setLocalePreference,
  subscribeLocale,
  t as translate,
  type AppLocale,
  type ResolvedLocale,
} from '../i18n'
import type { MessageKey } from '../i18n/locales/zh'

export function useLocale(): {
  t: (key: MessageKey) => string
  locale: AppLocale
  resolved: ResolvedLocale
  setLocale: (pref: AppLocale) => void
  tick: number
} {
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeLocale(() => setTick((n) => n + 1)), [])

  return {
    t: translate,
    locale: getLocalePreference(),
    resolved: getResolvedLocale(),
    setLocale: setLocalePreference,
    tick,
  }
}
