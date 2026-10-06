// UI language. Detected from the system locale (LC_ALL, LC_MESSAGES, LANG): Chinese locales get
// Traditional Chinese, everything else English. `/asint lang zh|en|auto` overrides it per user.

export type Lang = 'en' | 'zh'

let current: Lang = 'en'

export const setLang = (lang: Lang) => {
  current = lang
}

/** The language in effect; client modules receive it as a `lang` prop because they cannot read this state. */
export const getLang = () => current

/** `zh_TW.UTF-8`, `zh_CN`, `zh` → zh; anything else (including unset or `C`) → en. */
export const langFromLocale = (locale: string | undefined): Lang => (/^zh([_.-]|$)/i.test(locale ?? '') ? 'zh' : 'en')

/**
 * Pick the string for the current language. Call sites keep both versions side by side,
 * so a missing translation is visible in the source instead of failing at runtime.
 */
export const t = (zh: string, en: string) => (current === 'zh' ? zh : en)
