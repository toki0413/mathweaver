import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

/**
 * Supported UI languages. `zh-CN` is the default; `en-US` is the fallback used
 * when a key is missing for the active language.
 */
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'] as const
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: AppLanguage = 'zh-CN'
export const FALLBACK_LANGUAGE: AppLanguage = 'en-US'

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  // React already escapes interpolated values, so i18next must not double-escape.
  interpolation: {
    escapeValue: false,
  },
  // Do not warn when a key is missing in the active language — fall back quietly.
  saveMissing: false,
})

export default i18n
