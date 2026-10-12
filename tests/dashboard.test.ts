import { test, expect } from 'claude-code/testing'

import { DIVIDER, hmax, hshift, ratioFromDrag, splitWidths, todoSteps } from '../hooks/views'
import { badgeOf, hotDirs, hotFilesOf, isHot, parseGit, statusOf } from '../hooks/tree'
import { emptySession, reviveSession, saveSession, SAVED_OUTPUT } from '../hooks/model'
import { compute, DEFAULT_LAYOUT, isLeaf, movePanel, parseLayout, resize } from '../hooks/layout'

const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
let clock = 1_000_000

// Minimal fake answers for engine calls the test harness does not implement.
const host = (on: any, rec: { opens: any[]; closes: any[]; placed?: boolean; fileText?: string; ls?: string } = { opens: [], closes: [] }) => {
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
  on('fs.read', () => ({ value: rec.fileText ?? 'line1\nline2\n' }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => (e.argv.includes('--show-toplevel') ? out('/w\n') : e.argv.includes('-co') ? out(rec.ls ?? '') : out('')))
  on('ui.open', (_$: unknown, e: any) => (rec.opens.push(e), { value: { isPlaced: rec.placed ?? true } }))
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
  expect(cells.map(c => c.leaf.tabs.join('+')).sort()).toEqual(['arch+map+orch', 'exec', 'files+project', 'media+log', 'status', 'todo'])
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
  expect(node.children[1].tabs).toEqual(['exec', 'files', 'arch', 'map', 'media', 'log', 'project', 'orch'])
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

test('panel letters are hotkeys on the tab buttons, and zen keeps the keyboard on the pane', async ($, on) => {
  const opens: any[] = []
  host(on, { opens, closes: [] })
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const ui: any = await $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'Pane', requestId: 'asint',
    props: { title: 'ASINT', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } } as never)
  for (const [panel, key] of Object.entries({ todo: 't', exec: 'e', files: 'c', project: 'f', arch: 'a', map: 'm', media: 'i', log: 'l' })) {
    const tab = await ui.find({ key: `ct-${panel}` })
    // While the keyboard is in FILES or CHANGES, l means "in" (vim), so the LOG tab gives its letter up.
    if (tab) expect(tab.props.hotkey).toBe(panel === 'log' ? undefined : key)
  }
  // Re-opening the pane to resize it without focus hands the keyboard back to the prompt, and the next letter lands there.
  await ui.press({ key: 'zen-files' })
  expect(opens.at(-1).focus).toBe(true)
  await ui.press({ key: 'unzen' })
  expect(opens.at(-1).focus).toBe(true)
})

test('while the pane holds the keys, the cell of the last panel used gets the heavy border', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const focused: any = await $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'Pane', requestId: 'asint',
    props: { title: 'ASINT', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } } as never)
  await focused.press({ key: 'ct-exec' })
  const heavy = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props?.borderStyle === 'bold')
  const first = await heavy(focused)
  expect(first.length).toBe(1)
  // TODO sits in another cell of the default layout, so the heavy border moves with the key.
  await focused.press({ key: 'ct-todo' })
  const second = await heavy(focused)
  expect(second.length).toBe(1)
  expect(second[0].key ?? second[0].props.key).not.toBe(first[0].key ?? first[0].props.key)
})

test('without the keys, no cell gets the heavy border', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const ui: any = await mount($)
  expect((await ui.findAll({ type: 'Box' })).filter((b: any) => b.props?.borderStyle === 'bold').length).toBe(0)
})

const aboveProps = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 } }
const above = ($: any) => $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'AbovePrompt', props: aboveProps } as never)

test('the Dashboard button shows whenever the pane is not on screen, not only after Minimize', async ($, on) => {
  host(on)
  on('ui.render', ($$: any, e: any) => (globalThis as any).h($$.ui.resolve(e).Box, {}))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  // The engine has not drawn the pane (a narrow terminal queues it), and nobody pressed Minimize.
  expect(await (await above($)).find({ key: 'expand' })).toBeTruthy()
  await mount($)
  expect(await (await above($)).find({ key: 'expand' })).toBeFalsy()
})

test('pressing the Dashboard button on a terminal too narrow for the pane says why', async ($, on) => {
  const toasts: any[] = []
  host(on, { opens: [], closes: [], placed: false })
  on('ui.toast', (_$: unknown, e: any) => (toasts.push(e), { value: undefined }))
  on('ui.render', ($$: any, e: any) => (globalThis as any).h($$.ui.resolve(e).Box, {}))
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await (await above($)).press({ key: 'expand' })
  await new Promise(r => setTimeout(r, 20))
  expect(JSON.stringify(toasts)).toContain('144')
})

test('code previews scroll sideways: lines shift left, a diff keeps its marker, short files offer no scroll', () => {
  const long = '0123456789'.repeat(12)
  expect(hshift(['abcdef', 'xy'], 2, false)).toEqual(['cdef', ''])
  expect(hshift(['+abcdef', ' xy'], 2, true)).toEqual(['+cdef', ' '])
  expect(hshift(['abc'], 0, false)).toEqual(['abc'])
  expect(hmax(['short line'], 80)).toBe(0)
  expect(hmax([long], 80)).toBe(long.length - 40)
})

test('FILES preview: a long line shows the scroll buttons, and ▶ shifts the code left', async ($, on) => {
  const long = 'const veryLongName = ' + 'x'.repeat(200) + '\n'
  host(on, { opens: [], closes: [], fileText: long.repeat(5) })
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path: '/w/hooks/a.ts', old_string: 'a', new_string: 'b' } as never)
  const ui: any = await mount($)
  await ui.press({ key: 'full' })
  expect(await ui.find({ key: 'files:detail-right' })).toBeTruthy()
  const before = (await ui.find({ type: 'Code' })).props.source as string
  await ui.press({ key: 'files:detail-right' })
  const after = (await ui.find({ type: 'Code' })).props.source as string
  expect(after).not.toBe(before)
  expect(after.length).toBeLessThan(before.length)
})

test('every scrollable card has ▼ and ▲ (j and k); FILES scrolls its preview', async ($, on) => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n')
  host(on, { opens: [], closes: [], fileText: text })
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path: '/w/hooks/a.ts', old_string: 'a', new_string: 'b' } as never)
  const ui: any = await mount($)
  await ui.press({ key: 'full' })
  // The buttons read the sizes of the previous draw, so draw once more (a toggle there and back).
  await ui.press({ key: 'reads' })
  await ui.press({ key: 'reads' })
  const first = async () => String((await ui.find({ type: 'Code' })).props.source).split('\n')[0]
  expect(await first()).toBe('line 1')
  await ui.press({ key: 'l-files' })
  await ui.press({ key: 'down-files' })
  const down = await first()
  expect(down).not.toBe('line 1')
  await ui.press({ key: 'up-files' })
  expect(await first()).toBe('line 1')
})

test('dragging the divider: the drag column becomes a ratio that gives back the same widths, and neither side gets too narrow', () => {
  const total = 120
  const r = ratioFromDrag(40, total)
  expect(splitWidths(total, r).left).toBe(40)
  expect(splitWidths(total, r).left + DIVIDER + splitWidths(total, r).right).toBe(total)
  expect(splitWidths(total, ratioFromDrag(0, total)).left).toBeGreaterThanOrEqual(16)
  expect(splitWidths(total, ratioFromDrag(500, total)).right).toBeGreaterThanOrEqual(16)
})

test('a card in zen draws a divider the user can grab, and a dragged ratio reaches the layout', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', description: 'run tests' } as never)
  const ui: any = await mount($)
  await ui.press({ key: 'zen-exec' })
  const divider = (await ui.findAll({ type: 'Client' })).find((n: any) => String(n.props?.module).endsWith('divider.tsx'))
  expect(divider).toBeTruthy()
  expect(divider.props.props.panel).toBe('exec')
})

test('TODO steps: the commands and tool calls of whoever worked on the item, while it was in progress, oldest first', () => {
  const s = emptySession()
  const item = { key: 'k', content: 'wire up data', status: 'completed' as const, startedAt: 1000, doneAt: 9000, by: 'main' as const }
  s.execs.push(
    { id: 'e0', who: 'main', command: 'ls before', startedAt: 500, endedAt: 600, status: 'ok', exit: 0 },
    { id: 'e1', who: 'main', command: 'npm test', description: 'run tests', startedAt: 2000, endedAt: 3000, status: 'ok', exit: 0 },
    { id: 'e2', who: 'agent-1', command: 'other agent', startedAt: 2500, endedAt: 2600, status: 'ok', exit: 0 },
    { id: 'e3', who: 'main', command: 'after', startedAt: 9500, endedAt: 9600, status: 'ok', exit: 0 },
  )
  s.log.push({ at: 1500, who: 'main', kind: 'tool', text: 'Edit a.ts', op: 'E' }, { at: 1600, who: 'main', kind: 'turn', text: 'ignored' })
  const steps = todoSteps(s, item, 20000)
  expect(steps.map(x => x.text)).toEqual(['Edit a.ts', 'run tests'])
  expect(todoSteps(s, { ...item, startedAt: undefined }, 20000)).toEqual([])
})

test('TODO: picking an item shows its steps, and a step opens inline with its command', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'd1', todos: [
    { content: 'write tests', status: 'in_progress', activeForm: 'Writing tests' },
    { content: 'wrap up', status: 'pending', activeForm: 'Wrapping up' },
  ] } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', description: 'run tests' } as never)
  const ui: any = await mount($)
  expect(await texts(ui)).toContain('run tests')
  await ui.press({ key: 'tsel-1' })
  expect(await texts(ui)).toContain('wrap up')
  expect(await texts(ui)).toContain('Not started yet')
})

test('saving a session and reading it back keeps the data; what was running comes back as interrupted', () => {
  const s = emptySession()
  s.todos.push({ key: 'k', content: 'wire up data', status: 'in_progress', startedAt: 1000 })
  s.execs.push({ id: 'e1', who: 'main', command: 'npm test', startedAt: 2000, status: 'running' }, { id: 'e2', who: 'main', command: 'ls', startedAt: 2500, endedAt: 2600, status: 'ok', exit: 0, stdout: 'x'.repeat(SAVED_OUTPUT + 5) })
  s.agents.set('a1', { id: 'a1', label: 'research', type: 'Explore', startedAt: 3000, status: 'running', doing: 'Grep x' })
  s.files.set('/w/a.ts', { path: '/w/a.ts', op: 'M', count: 2, lastAt: 4000, lastOp: 'M', by: ['main'], diff: ['-a', '+b'] })
  s.vitals.turnRunning = true
  const back = reviveSession(JSON.stringify(saveSession(s)))!
  expect(back.todos[0]!.content).toBe('wire up data')
  expect(back.execs[0]!.status).toBe('error')
  expect(back.execs[1]!.status).toBe('ok')
  expect(back.execs[1]!.stdout!.length).toBe(SAVED_OUTPUT)
  expect(back.agents.get('a1')!.status).toBe('error')
  expect(back.agents.get('a1')!.doing).toBeUndefined()
  expect(back.files.get('/w/a.ts')!.diff).toEqual(['-a', '+b'])
  expect(back.vitals.turnRunning).toBe(false)
})

test('a damaged or foreign saved file starts the session empty', () => {
  expect(reviveSession(undefined)).toBeUndefined()
  expect(reviveSession('not json')).toBeUndefined()
  expect(reviveSession('{"v":2}')).toBeUndefined()
  expect(reviveSession('{"v":1,"files":{}}')).toBeUndefined()
})

test('a resumed session shows its saved checklist and picks up the view it was left in', async ($, on) => {
  const s = emptySession()
  s.todos.push({ key: 'k', content: 'saved checklist item', status: 'completed', startedAt: 1000, doneAt: 2000, by: 'main' })
  const saved = JSON.stringify({ ...saveSession(s), view: { selTodo: 'k', showReads: false, tab: 'nonsense-type-is-fine' } })
  host(on, { opens: [], closes: [], fileText: saved })
  await $.session.start({ source: 'resume', cwd: '/w' } as never).catch(() => {})
  const ui: any = await mount($)
  expect(await texts(ui)).toContain('saved checklist item')
})

test('git output becomes marks: changed beats committed, untracked is its own mark', () => {
  const g = parseGit('src/a.ts\n', 'new.txt\n', 'src/a.ts\nsrc/b.ts\n\n')
  expect(g.get('src/a.ts')).toBe('M')
  expect(g.get('src/b.ts')).toBe('C')
  expect(g.get('new.txt')).toBe('?')
  expect(g.size).toBe(3)
})

test('file badges: known types get two letters, unknown ones the extension, folders of dotfiles are GT', () => {
  expect(badgeOf('client.ts').text).toBe('TS')
  expect(badgeOf('package.json').text).toBe('{}')
  expect(badgeOf('Dockerfile').text).toBe('DK')
  expect(badgeOf('.gitignore').text).toBe('GT')
  expect(badgeOf('notes.xyz').text).toBe('XY')
  expect(badgeOf('LICENSE').text).toBe('  ')
})

test('file status: editing beats a commit beats the session edit beats git; reading alone is not hot', () => {
  const touched = (op: 'R' | 'M' | 'A') => ({ path: '/w/a.ts', op, count: 1, lastAt: 1, lastOp: op, by: ['main'], diff: [] })
  expect(statusOf(touched('M'), 'C', true)?.kind).toBe('editing')
  expect(statusOf(touched('M'), 'C', false)?.kind).toBe('committed')
  expect(statusOf(touched('A'), undefined, false)?.kind).toBe('new')
  expect(statusOf(touched('M'), undefined, false)?.kind).toBe('edited')
  expect(statusOf(touched('R'), undefined, false)?.kind).toBe('read')
  expect(statusOf(undefined, 'M', false)?.kind).toBe('modified')
  expect(statusOf(undefined, '?', false)?.kind).toBe('untracked')
  expect(statusOf(undefined, undefined, false)).toBeUndefined()
  expect(isHot(touched('R'), undefined, false)).toBe(false)
  expect(isHot(touched('M'), undefined, false)).toBe(true)
})

test('hot folders: every ancestor of a hot file, with a count', () => {
  const files = new Map([['/w/src/api/a.ts', { path: '/w/src/api/a.ts', op: 'M' as const, count: 1, lastAt: 1, lastOp: 'M' as const, by: ['main'], diff: [] }]])
  const hot = hotFilesOf(['src/api/a.ts', 'src/api/b.ts', 'docs/x.md', 'README.md'], '/w', files, new Map([['docs/x.md', '?' as const]]), undefined)
  expect(hot).toEqual(['src/api/a.ts', 'docs/x.md'])
  const dirs = hotDirs(hot)
  expect([...dirs.keys()].sort()).toEqual(['docs', 'src', 'src/api'])
  expect(dirs.get('src')).toBe(1)
})

test('FILES tree: a file the agent edited gets a badge, a status and its folders open; others stay quiet', async ($, on) => {
  host(on, { opens: [], closes: [], ls: 'src/api/a.ts\nsrc/api/b.ts\ndocs/x.md\nREADME.md\n' })
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await new Promise(r => setTimeout(r, 50))
  await $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path: '/w/src/api/a.ts', old_string: 'a', new_string: 'b' } as never)
  const ui: any = await mount($)
  await ui.press({ key: 'ct-project' })
  await ui.press({ key: 'zen-project' })
  const rowsOf = async () => (await ui.findAll({ type: 'Client' })).filter((n: any) => String(n.props?.module).endsWith('treerow.tsx')).map((n: any) => n.props.props)
  const rows = await rowsOf()
  const file = rows.find((r: any) => r.name === 'a.ts')
  expect(file.badge).toBe('TS')
  expect(file.chip).toBe('edited')
  expect(file.tone).toBe('warn')
  expect(file.pick).toBe('file:src/api/a.ts')
  expect(rows.find((r: any) => r.name === 'b.ts').chip).toBe('')
  expect(rows.find((r: any) => r.name === 'src').count).toBe(1)
  expect(rows.some((r: any) => r.name === 'x.md')).toBe(false)
})

test('vim keys in the FILES tree: j and k move the cursor, l opens a folder or goes into a file, h comes back out', async ($, on) => {
  host(on, { opens: [], closes: [], ls: 'src/api/a.ts\nsrc/api/b.ts\nsrc/c.ts\nREADME.md\n' })
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await new Promise(r => setTimeout(r, 50))
  const ui: any = await mount($)
  await ui.press({ key: 'ct-project' })
  await ui.press({ key: 'zen-project' })
  const rows = async () => (await ui.findAll({ type: 'Client' })).filter((n: any) => String(n.props?.module).endsWith('treerow.tsx')).map((n: any) => n.props.props)
  const cursor = async () => (await rows()).find((r: any) => r.selected)?.name
  const names = async () => (await rows()).map((r: any) => r.name)
  expect(await names()).toEqual(['src', 'README.md'])
  await ui.press({ key: 'down-project' })
  await ui.press({ key: 'down-project' })
  expect(await cursor()).toBe('README.md')
  await ui.press({ key: 'up-project' })
  expect(await cursor()).toBe('src')
  await ui.press({ key: 'l-project' })
  expect(await names()).toEqual(['src', 'api', 'c.ts', 'README.md'])
  await ui.press({ key: 'l-project' })
  expect(await cursor()).toBe('api')
  await ui.press({ key: 'l-project' })
  expect(await names()).toEqual(['src', 'api', 'a.ts', 'b.ts', 'c.ts', 'README.md'])
  await ui.press({ key: 'down-project' })
  expect(await cursor()).toBe('a.ts')
  await ui.press({ key: 'l-project' })
  await ui.press({ key: 'down-project' })
  expect(await cursor()).toBe('a.ts')
  await ui.press({ key: 'h-project' })
  await ui.press({ key: 'down-project' })
  expect(await cursor()).toBe('b.ts')
  await ui.press({ key: 'h-project' })
  expect(await cursor()).toBe('api')
  await ui.press({ key: 'h-project' })
  expect(await names()).toEqual(['src', 'api', 'c.ts', 'README.md'])
})

import { renderSprite, roleOf, runsOf, SPRITE_COLS, SPRITE_ROWS } from '../hooks/sprites'

test('workers: every role draws the same size, a working one moves and a failed one looks different', () => {
  for (const role of ['main', 'explore', 'plan', 'general', 'guide', 'designer', 'developer', 'reviewer', 'tester', 'writer', 'security', 'scholar', 'other'] as const) {
    const rows = renderSprite(role, 'working', 0)
    expect(rows.length).toBe(SPRITE_ROWS)
    for (const row of rows) expect(row.length).toBe(SPRITE_COLS)
  }
  const still = JSON.stringify(renderSprite('explore', 'working', 0))
  expect(JSON.stringify(renderSprite('explore', 'working', 1))).not.toBe(still)
  expect(JSON.stringify(renderSprite('explore', 'failed', 0))).not.toBe(JSON.stringify(renderSprite('explore', 'idle', 0)))
  expect(JSON.stringify(renderSprite('plan', 'idle', 0))).not.toBe(JSON.stringify(renderSprite('general', 'idle', 0)))
  expect(roleOf('Explore')).toBe('explore')
  expect(roleOf('claude-code-guide')).toBe('guide')
  expect(roleOf('code-reviewer')).toBe('reviewer')
  expect(roleOf('ui-designer')).toBe('designer')
  expect(roleOf('test-runner')).toBe('tester')
  expect(roleOf('security-auditor')).toBe('security')
  expect(roleOf('threat-model')).toBe('security')
  expect(roleOf('doc-writer')).toBe('writer')
  expect(roleOf('bio-analyst')).toBe('scholar')
  expect(roleOf('statusline-setup')).toBe('developer')
  expect(roleOf('claude')).toBe('other')
  // Names that a plain substring match got wrong.
  expect(roleOf('docker-expert')).toBe('other')
  expect(roleOf('linux-admin')).toBe('other')
  expect(roleOf('credit-risk-analyst')).toBe('scholar')
  expect(roleOf('explanation-writer')).toBe('writer')
  expect(roleOf('style-guide-enforcer')).toBe('designer')
  expect(roleOf('data-engineer')).toBe('developer')
  expect(roleOf('api-designer')).toBe('developer')
  expect(roleOf('debugger')).toBe('developer')
  expect(roleOf('db-migrator')).toBe('developer')
  expect(roleOf('performance-optimizer')).toBe('developer')
  expect(runsOf(renderSprite('other', 'idle', 0)[0]!).map(r => r.ch).join('').length).toBe(SPRITE_COLS)
})

test('ORCH: a resumed session shows each agent as a card with its kind and task, failed ones counted, and a click opens its steps', async ($, on) => {
  const saved = emptySession()
  saved.agents.set('a1', { id: 'a1', label: 'finished job', type: 'Explore', startedAt: 1000, endedAt: 5000, status: 'done' })
  saved.agents.set('a2', { id: 'a2', label: 'cut off job', type: 'Plan', startedAt: 2000, status: 'running' })
  saved.log.push({ at: 2500, who: 'a2', kind: 'tool', text: 'Read /home/me/a/b/c/file.ts' })
  host(on, { opens: [], closes: [], fileText: JSON.stringify({ ...saveSession(saved), view: {} }) })
  await $.session.start({ source: 'resume', cwd: '/w' } as never).catch(() => {})
  const ui: any = await mount($)
  await ui.press({ key: 'ct-orch' })
  await ui.press({ key: 'zen-orch' })
  const text = await texts(ui)
  expect(text).toContain('MAIN')
  expect(text).toContain('finished job')
  expect(text).toContain('cut off job')
  expect(text).toContain('Failed 1')
  expect(text).toContain('Done 1')
  expect(text).not.toContain('file.ts')
  await ui.press({ key: 'op-t-a2' })
  expect(await texts(ui)).toContain('…/c/file.ts')
  await ui.press({ key: 'op-t-a2' })
  expect(await texts(ui)).not.toContain('…/c/file.ts')
})

test('/asint root changes the folder FILES shows and /asint root with nothing goes back', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const set: any = await $.command.run({ command: 'asint', args: 'root ~/Projects/asint' } as never)
  expect(set.text).toContain('Projects/asint')
  const back: any = await $.command.run({ command: 'asint', args: 'root' } as never)
  expect(back.text).toContain('back')
})
