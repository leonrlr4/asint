import { test, expect } from 'claude-code/testing'

import { getLang, setLang } from '../hooks/i18n'

test('/asint lang zh switches UI strings to Chinese, /asint lang en switches them back', async ($, on: any) => {
  const kv = new Map<string, unknown>()
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: kv.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => (kv.set(e.key, e.value), { value: undefined }))
  on('env.get', () => ({ value: undefined }))
  try {
    const zh: any = await $.command.run({ command: 'asint', args: 'lang zh' } as never)
    expect(zh.text).toBe('介面語言已切換')
    expect(kv.get('lang')).toBe('zh')
    expect(((await $.command.run({ command: 'skin', args: 'hacker' } as never)) as any).text).toBe('駭客模式')

    const en: any = await $.command.run({ command: 'asint', args: 'lang en' } as never)
    expect(en.text).toBe('Interface language updated')
    expect(kv.get('lang')).toBe('en')
    expect(((await $.command.run({ command: 'skin', args: 'hacker' } as never)) as any).text).toBe('Hacker mode')
  } finally {
    setLang('en')
  }
  expect(getLang()).toBe('en')
})
