import { test, expect } from 'claude-code/testing'

const out = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

const host = (on: any, runs: string[][]) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 100, percent: 1 }, rateLimits: [] } }))
  on('env.get', (_$: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', (_$: unknown, e: any) => (runs.push([...e.argv]), e.argv[0] === 'git' ? out('', 128) : out('')))
}

test('/html opens beside the terminal by default (asint-tb -> terminal-browser); -b uses Brave', async ($, on: any) => {
  const runs: string[][] = []
  host(on, runs)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.command.run({ command: 'html', args: '~/a.html' } as never)
  expect(runs.some(r => r.some(a => a.endsWith('asint-tb')) && r.includes('/home/u/a.html'))).toBe(true)
  await $.command.run({ command: 'html', args: '-b https://x.dev' } as never)
  expect(runs.some(r => r.some(a => a.endsWith('asint-open')) && r.includes('https://x.dev'))).toBe(true)
})

test('Artifact publishing .html: publishes as usual and also opens the local file beside the terminal; creating Claude Docs is blocked', async ($, on: any) => {
  const runs: string[][] = []
  host(on, runs)
  on('tool.call', (_$: unknown, e: any) => (e.tool === 'Artifact' ? { result: {}, text: 'Published https://claude.ai/code/artifact/abc-123 (private)' } : { result: {} }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const r: any = await $.tool.call({ tool: 'Artifact', tool_use_id: 'a1', file_path: '/w/report.html' } as never)
  expect(r.deny).toBeUndefined()
  expect(runs.some(x => x.some(a => a.endsWith('asint-tb')) && x.includes('/w/report.html'))).toBe(true)
  const d: any = await $.tool.call({ tool: 'mcp__claude_ai_Claude_Docs__create', tool_use_id: 'd1' } as never)
  expect(String(d.deny)).toContain('Claude Docs')
})

test('system prompt carries the keep-output-in-the-terminal rule', async ($, on: any) => {
  host(on, [])
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const r: any = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
  expect(r.sections.find((x: any) => x.id === 'asint:output')?.text).toContain('Artifact')
})

test('/asint arch asks the main conversation to check or create the architecture diagram', async ($, on: any) => {
  host(on, [])
  const prompts: any[] = []
  on('prompt.submit', (_$: unknown, e: any) => (prompts.push(e), { text: e.text }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const r: any = await $.command.run({ command: 'asint', args: 'arch' } as never)
  expect(r.text).toContain('architecture diagram')
  // Submission is deferred to the next tick (the test environment has none); this only checks the command was accepted and not sent from inside the hook.
  expect(prompts.length).toBe(0)
})
