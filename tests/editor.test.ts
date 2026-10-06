import { test, expect } from 'claude-code/testing'

const out = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// Regression: keepActive used to write `active: undefined` into leaves, and a Client's props holding
// undefined makes the engine refuse the whole pane, so pressing g showed an empty pane.
test('the layout editor draws (its Client props hold no undefined)', async ($, on: any) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 100, percent: 1 }, rateLimits: [] } }))
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', () => out('', 1))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const ui: any = await $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'Pane', requestId: 'asint', viewport: { columns: 200, rows: 60 },
    props: { title: 'ASINT', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } } as never)
  await ui.press({ key: 'edit-layout' })
  expect(await ui.find({ type: 'Client' })).toBeTruthy()
  expect(await ui.find({ key: 'layout-done' })).toBeTruthy()
})
