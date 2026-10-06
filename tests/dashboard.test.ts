import { test, expect } from 'claude-code/testing'

import { compute, DEFAULT_LAYOUT, isLeaf, movePanel, parseLayout, resize } from '../hooks/layout'

const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
let clock = 1_000_000

// Minimal fake answers for engine calls the test harness does not implement.
const host = (on: any, rec: { opens: any[]; closes: any[] } = { opens: [], closes: [] }) => {
  const kv = new Map<string, unknown>()
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: kv.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => (kv.set(e.key, e.value), { value: undefined }))
  on('clock.now', () => ({ value: (clock += 1000) }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 450_000, window: 1_000_000, percent: 45 }, rateLimits: [{ kind: 'five_hour', percentUsed: 7 }, { kind: 'seven_day', percentUsed: 59 }], cost: { usd: 5.89 } } }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/nonexistent' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: 'line1\nline2\n' }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => out(''))
  on('ui.open', (_$: unknown, e: any) => (rec.opens.push(e), { value: { isPlaced: true } }))
  on('ui.close', (_$: unknown, e: any) => (rec.closes.push(e), { value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('tool.call', (_$: unknown, e: { tool: string }) =>
    e.tool === 'Edit'
      ? { result: { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } }
      : e.tool === 'Bash' ? { result: { stdout: 'ok\n', stderr: '', interrupted: false } } : { result: {} })
}

const mount = ($: any) =>
  $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'Pane', requestId: 'asint',
    props: { title: 'ASINT', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } } as never)

const texts = async (ui: any) => (await ui.findAll({})).map((n: any) => n.text ?? '').join('\n')

test('after Edit, the Files tab lists the file and shows the diff', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path: '/w/hooks/a.ts', old_string: 'a', new_string: 'b' } as never)
  const ui = await mount($)
  expect(await (ui as any).find({ text: /a\.ts/ })).toBeTruthy()
  expect(await (ui as any).find({ type: 'Code' })).toBeTruthy()
})

test('Bash goes to the Exec tab, TodoWrite updates the progress at the top', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', description: 'run tests' } as never)
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'd1', todos: [
    { content: 'write tests', status: 'completed', activeForm: 'Writing tests' },
    { content: 'wire up data', status: 'in_progress', activeForm: 'Wiring up data' },
    { content: 'wrap up', status: 'pending', activeForm: 'Wrapping up' },
  ] } as never)
  const ui = await mount($)
  
  const all = await texts(ui)
  expect(all).toContain('1/3')
  expect(await (ui as any).find({ text: /npm test/ })).toBeTruthy()
})

test('Map tab draws a Raster', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/w/README.md' } as never)
  const ui = await mount($)
  await (ui as any).press({ key: 'ct-map' })
  expect(await (ui as any).find({ type: 'Raster' })).toBeTruthy()
})

test('the asint checklist tool updates the top progress and the Todo tab', async ($, on) => {
  host(on)
  on('tool.register', () => ({ value: { tool: 'mcp__asint__checklist' } }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const r = await $.tool.call({ tool: 'mcp__asint__checklist', tool_use_id: 'c1', todos: [
    { content: 'prepare', status: 'completed' }, { content: 'check', status: 'in_progress', activeForm: 'Checking' }, { content: 'wrap up', status: 'pending' },
  ] } as never)
  expect(String((r as any).text)).toBe('checklist 1/3')
  const ui = await mount($)
  
  expect(await texts(ui)).toContain('1/3')
})

test('default layout: status row is fixed at 4 rows, cells tile the area exactly with no overlap', () => {
  const { cells } = compute(DEFAULT_LAYOUT, { x: 0, y: 0, w: 120, h: 60 })
  expect(cells.find(c => c.leaf.tabs.includes('status'))!.rect.h).toBe(4)
  expect(cells.reduce((n, c) => n + c.rect.w * c.rect.h, 0)).toBe(120 * 60)
  expect(cells.map(c => c.leaf.tabs.join('+')).sort()).toEqual(['arch+map', 'exec', 'files+project', 'media+log', 'status', 'todo'])
})

test('dragging a title: moving LOG to the right of TODO splits it, moving it to the center stacks it as a tab', () => {
  const full = { x: 0, y: 0, w: 120, h: 60 }
  const todo = compute(DEFAULT_LAYOUT, full).cells.find(c => c.leaf.tabs.includes('todo'))!
  const right = movePanel(DEFAULT_LAYOUT, 'log', todo.path, 'right')
  const cellsR = compute(right, full).cells
  expect(cellsR.find(c => c.leaf.tabs.includes('log'))!.leaf.tabs).toEqual(['log'])
  expect(cellsR.find(c => c.leaf.tabs.includes('media'))!.leaf.tabs).toEqual(['media'])
  const center = movePanel(DEFAULT_LAYOUT, 'log', todo.path, 'center')
  expect(compute(center, full).cells.find(c => c.leaf.tabs.includes('todo'))!.leaf.tabs).toEqual(['todo', 'log'])
})

test('dragging a border changes the ratio; a broken config falls back to the default', () => {
  const full = { x: 0, y: 0, w: 100, h: 50 }
  const seam = compute(DEFAULT_LAYOUT, full).seams.find(s => s.dir === 'row')!
  const next = resize(DEFAULT_LAYOUT, seam, 50, { x: 0, y: 4, w: 100, h: 46 })
  const row = (next as any).children[1]
  expect(isLeaf(row)).toBe(false)
  expect(Math.round(row.sizes[0] * 100)).toBe(50)
  expect(parseLayout('{"tabs":["nope"]}')).toEqual(DEFAULT_LAYOUT)
  expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT)
})

test('zen: one card fills the pane and requests a wider pane; pressing again restores', async ($, on) => {
  const opens: any[] = []
  host(on, { opens, closes: [] })
  on('ui.render', ($$: any, e: any) => (globalThis as any).h($$.ui.resolve(e).Box, {}))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  // The bar above the prompt reports the chat column width: 95 + 5 reserved by the engine = 100.
  await $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 95, scroll: { offset: 0, bodyRows: 20 } } } as never)
  const ui: any = await $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'Pane', requestId: 'asint', viewport: { columns: 200, rows: 60 },
    props: { title: 'ASINT', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } } as never)
  await ui.press({ key: 'zen-files' })
  expect(await ui.find({ key: 'ct-todo' })).toBeFalsy()
  expect(await ui.find({ key: 'unzen' })).toBeTruthy()
  // Terminal ~ chat 100 + pane 100 + borders 4 = 204; leaving 50 columns for chat gives 154.
  expect(opens.at(-1).columns).toBe(154)
  await ui.press({ key: 'unzen' })
  expect(await ui.find({ key: 'ct-todo' })).toBeTruthy()
  expect(opens.at(-1).columns).toBe(100)
})

test('minimize: closes the pane and remembers; the next session does not open it automatically', async ($, on) => {
  const closes: any[] = []
  const opens: any[] = []
  host(on, { opens, closes })
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const ui: any = await mount($)
  await ui.press({ key: 'minimize' })
  expect(closes.length).toBe(1)
  opens.length = 0
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  expect(opens.length).toBe(0)
})

test('an old layout.json without FILES (project): it gets stacked into the CHANGES cell', () => {
  const old = { split: 'row', sizes: [0.5, 0.5], children: [{ tabs: ['status', 'todo'] }, { tabs: ['exec', 'files', 'arch', 'map', 'media', 'log'] }] }
  const node = parseLayout(JSON.stringify(old)) as any
  expect(node.children[1].tabs).toEqual(['exec', 'files', 'arch', 'map', 'media', 'log', 'project'])
})

test('MAP: clicking an agent on the radar opens a small window, and the submitted message goes through session.send', async ($, on) => {
  host(on)
  const sent: any[] = []
  const prompts: any[] = []
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'ag1' }))
  on('session.send', (_$: unknown, e: any) => (sent.push(e), { isDelivered: true }))
  on('prompt.submit', (_$: unknown, e: any) => (prompts.push(e), { text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.agent.spawn({ subagentType: 'Explore', description: 'find files', prompt: 'x' } as never).catch(() => {})
  const ui: any = await mount($)
  await ui.press({ key: 'ct-map' })
  await ui.press({ key: 'mv-radar' })
  await ui.press({ key: 'spot-ag1' })
  expect(await ui.find({ key: 'msg-input-ag1' })).toBeTruthy()
  await ui.input({ key: 'msg-input-ag1', text: 'also look at views.tsx', kind: 'submit' })
  await new Promise(r => (globalThis as any).setTimeout(r, 20))
  expect(sent[0]?.text).toBe('also look at views.tsx')
  expect(sent[0]?.to).toBe('ag1')
})

test('MAP: the board lists agents with a ✉ button', async ($, on) => {
  host(on)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'ag1' }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.agent.spawn({ subagentType: 'Explore', description: 'find files', prompt: 'x' } as never).catch(() => {})
  const ui: any = await mount($)
  await ui.press({ key: 'ct-map' })
  await ui.press({ key: 'mv-board' })
  expect(await ui.find({ key: 'bm-ag1' })).toBeTruthy()
  expect(await ui.find({ key: 'bm-main' })).toBeTruthy()
})

test('MAP: a message sent from [M] goes through prompt.submit, same as the user typing it', async ($, on) => {
  host(on)
  const prompts: any[] = []
  on('prompt.submit', (_$: unknown, e: any) => (prompts.push(e), { text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const ui: any = await mount($)
  await ui.press({ key: 'ct-map' })
  await ui.press({ key: 'mv-radar' })
  await ui.press({ key: 'spot-main' })
  await ui.input({ key: 'msg-input-main', text: 'pause for a moment', kind: 'submit' })
  await new Promise(r => (globalThis as any).setTimeout(r, 20))
  expect(prompts.at(-1)?.text).toBe('pause for a moment')
})

test('MAP: agents on the relation graph are clickable too and open the same message window', async ($, on) => {
  host(on)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'ag1' }))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.agent.spawn({ subagentType: 'Explore', description: 'find files', prompt: 'x' } as never).catch(() => {})
  const ui: any = await mount($)
  await ui.press({ key: 'ct-map' })
  await ui.press({ key: 'mv-graph' })
  expect(await ui.find({ key: 'spot-ag1' })).toBeFalsy()
  await ui.press({ key: 'spotg-ag1' })
  expect(await ui.find({ key: 'msg-input-ag1' })).toBeTruthy()
  expect(await ui.find({ key: 'spotg-main' })).toBeTruthy()
})
