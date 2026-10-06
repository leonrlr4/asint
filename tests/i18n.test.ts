import { test, expect } from 'claude-code/testing'

import { getLang, langFromLocale, setLang, t } from '../hooks/i18n'

test('locale detection: Chinese locales get zh, everything else en', () => {
  for (const l of ['zh_TW.UTF-8', 'zh_CN', 'zh', 'ZH_HK.utf8']) expect(langFromLocale(l)).toBe('zh')
  for (const l of ['en_US.UTF-8', 'C', 'C.UTF-8', 'ja_JP', 'zhuang', '', undefined]) expect(langFromLocale(l)).toBe('en')
})

test('t picks the string for the current language', () => {
  const before = getLang()
  setLang('zh')
  expect(t('中文', 'English')).toBe('中文')
  setLang('en')
  expect(t('中文', 'English')).toBe('English')
  setLang(before)
})
