/* eslint-disable react-refresh/only-export-components -- context + hooks co-located by design */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { messages, translate, type LocaleId, type MessageKey } from './messages'

const DEFAULT_LOCALE: LocaleId = 'en'

/** Best-effort locale from the OS/browser; falls back to English until a matching catalog exists. */
function detectLocale(): LocaleId {
  const base = (typeof navigator !== 'undefined' ? navigator.language : '').split('-')[0] ?? ''
  return (Object.keys(messages) as string[]).includes(base) ? (base as LocaleId) : DEFAULT_LOCALE
}

export type T = (key: MessageKey, params?: Record<string, string | number>) => string

export interface I18nContextValue {
  locale: LocaleId
  setLocale: (locale: LocaleId) => void
  t: T
}

export const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, params) => translate(DEFAULT_LOCALE, key, params)
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<LocaleId>(detectLocale)
  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT(): T {
  return useContext(I18nContext).t
}

export function useLocale(): LocaleId {
  return useContext(I18nContext).locale
}
