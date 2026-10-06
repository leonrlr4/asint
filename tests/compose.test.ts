import { test, expect } from 'claude-code/testing'

test('projects with a LikeC4 architecture diagram get a system prompt rule to update the diagram when the architecture changes; others do not', async ($, on: any) => {
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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', (_$: unknown, e: any) => ({ value: { exitCode: e.argv[0] === 'git' ? 128 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  let hasC4 = true
  on('fs.list', (_$: unknown, e: any) => ({ value: e.path === '/w/docs' && hasC4 ? [{ name: 'architecture.c4', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] : [] }))
  on('prompt.compose', () => ({ sections: [{ id: 'core', text: 'base', scope: 'shared' }] }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const args = { model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never
  const r1: any = await $.prompt.compose(args)
  const rule = r1.sections.find((x: any) => x.id === 'asint:arch')
  expect(rule?.scope).toBe('session')
  expect(rule?.text).toContain('/w/docs/architecture.c4')
  hasC4 = false
  const r2: any = await $.prompt.compose(args)
  expect(r2.sections.some((x: any) => x.id === 'asint:arch')).toBe(false)
})
