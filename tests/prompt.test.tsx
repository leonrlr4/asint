import { test, expect } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => void

import { cwdParts, imageTags, isProtected } from '../hooks/prompt'
import { treeRows } from '../hooks/views'

test('protected branches: main, master, prod and anything under prod/', () => {
  for (const b of ['main', 'master', 'prod', 'prod/2026-10']) expect(isProtected(b)).toBe(true)
  for (const b of ['feat/main-page', 'production', 'mainline', undefined]) expect(isProtected(b)).toBe(false)
})

test('cwd: dim before the repo, bright from the repo on, truncated from the left when too long', () => {
  const loc = { cwd: '/home/u/Work/app/src/api', home: '/home/u', root: '/home/u/Work/app', dirty: 0 }
  expect(cwdParts(loc, 80)).toEqual({ dim: '~/Work/', bright: 'app/src/api' })
  expect(cwdParts(loc, 14)).toEqual({ dim: '…k/', bright: 'app/src/api' })
  expect(cwdParts(loc, 6)).toEqual({ dim: '…', bright: 'c/api' })
  expect(cwdParts({ cwd: '/etc/x', dirty: 0 }, 80)).toEqual({ dim: '', bright: '/etc/x' })
})

test('image tags in the draft are deduplicated', () => {
  expect(imageTags('see [Image #1] and [Image #3], plus [Image #1]')).toEqual([1, 3])
})

const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('bar above the prompt: session name, repo, red protected branch, cwd, compact numbers', async ($, on: any) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path.endsWith('/sid.jsonl') }))
  on('clock.now', () => ({ value: 1_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/home/u/Work/app/src' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 100, percent: 14 }, rateLimits: [], cost: { usd: 2.2 } } }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.list', (_$: unknown, e: { path: string }) => ({ value: e.path.endsWith('/projects') ? [{ name: '-home-u', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) =>
    e.argv[0] === 'sh' ? out('"customTitle":"asint prompt redesign"\n"aiTitle":"engine-generated title"\n') :
    e.argv.includes('--abbrev-ref') ? out('/home/u/Work/app\nmain\n') : e.argv.includes('--porcelain') ? out(' M a\n?? b\n') : out(''))
  await $.session.start({ source: 'startup', cwd: '/home/u/Work/app/src' } as never).catch(() => {})
  // refreshLocation and the title read run in the background; wait for them to finish.
  await new Promise(r => setTimeout(r, 50))
  const ui = await $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 } } } as never)
  const all = (await (ui as any).findAll({})).map((n: any) => n.text ?? '').join('|')
  expect(all).toContain('asint prompt redesign')
  expect(all).not.toContain('engine-generated title')
  expect(all).toContain('ctx')
  expect(all).toContain('$2.20')
  expect(all).toContain('⎇ app')
  expect(all).toContain('protected')
  expect(all).toContain('±2')
  expect(all).toContain('app/src')
})

test('file tree: folders first, collapsed ones stay closed, expanded ones indent', () => {
  const paths = ['b.ts', 'docs/x.md', 'docs/sub/y.md', 'a.ts']
  expect(treeRows(paths, {}).map(r => r.path)).toEqual(['docs', 'a.ts', 'b.ts'])
  const open = treeRows(paths, { docs: true, 'docs/sub': true })
  expect(open.map(r => `${r.depth}:${r.path}`)).toEqual(['0:docs', '1:docs/sub', '2:docs/sub/y.md', '1:docs/x.md', '0:a.ts', '0:b.ts'])
})
