import { test, expect } from 'claude-code/testing'
import { LIKEC4_JSON } from './likec4-fixture'

const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
test('ARCH: clicking nodes, drilling down, breadcrumbs and panning left/right all render (no error screen)', async ($, on: any) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  let t = 1_000_000
  on('clock.now', () => ({ value: (t += 1000) }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 100, percent: 14 }, rateLimits: [], cost: { usd: 1 } } }))
  on('env.get', () => ({ value: undefined }))
  on('fs.list', (_$: unknown, e: any) => ({ value: e.path === '/w/docs' ? [{ name: 'architecture.c4', kind: 'file', size: 1, mtimeMs: 5, isLink: false }] : [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_$: unknown, e: any) => ({ value: String(e.path).endsWith('.json') ? LIKEC4_JSON : '' }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_$: unknown, e: any) => (e.argv[0] === 'git' ? { value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } : out('')))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const mount = () => $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'Pane', requestId: 'asint', viewport: { columns: 200, rows: 60 },
    props: { title: 'ASINT', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } } as never)
  const ui: any = await mount()
  await new Promise(r => (globalThis as any).setTimeout(r, 50))
  await ui.press({ key: 'ct-todo' }).catch(() => {})
  const btns = async () => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key ?? b.props?.key).filter((k: string) => k?.startsWith('anb-') || k?.startsWith('arch-'))
  const texts = async () => (await ui.findAll({})).map((n: any) => n.text).filter(Boolean).join('/')
  expect(await btns()).toContain('anb-asint')
  for (const k of ['anb-asint', 'anb-asint', 'anb-asint.register', 'arch-crumb-0', 'anb-ext', 'anb-ext', 'anb-ext.git', 'arch-right', 'arch-left']) {
    const have = await btns()
    if (!have.includes(k)) continue
    await ui.press({ key: k })
    expect(await texts()).not.toContain('asint view error')
  }
  // After drilling into asint the diagram is wider than the view, so the pan buttons appear (previous bug: their hotkey was invalid and the whole pane went blank).
  await ui.press({ key: 'arch-crumb-0' })
  await ui.press({ key: 'anb-asint' })
  await ui.press({ key: 'anb-asint' })
  expect(await btns()).toContain('arch-right')
  await ui.press({ key: 'arch-right' })
  expect(await texts()).not.toContain('asint view error')
})
