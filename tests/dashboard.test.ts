import { test, expect } from 'claude-code/testing'

import { DIVIDER, hmax, hshift, ratioFromDrag, splitWidths, todoSteps } from '../hooks/views'
import { filesVim, treeVim } from '../hooks/vim'
import { gitQueries, listArgv, parseListing, TREE_MAX } from '../hooks/tree'
import { badgeOf, hotDirs, hotFilesOf, isHot, parseGit, statusOf } from '../hooks/tree'
import { changesList, emptySession, endAgentFromNotification, isBusy, reviveSession, saveSession, SAVED_OUTPUT } from '../hooks/model'
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
  const rowsOf = async () => (await ui.findAll({ type: 'Client' })).filter((n: any) => String(n.props?.module).endsWith('filetree.tsx')).flatMap((n: any) => n.props.props.rows)
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
  const rows = async () => (await ui.findAll({ type: 'Client' })).filter((n: any) => String(n.props?.module).endsWith('filetree.tsx')).flatMap((n: any) => n.props.props.rows)
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

test('a reply is drawn by the reply client with a diamond on its first block only', async ($, on) => {
  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  const first: any = await $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'AssistantMessage', props: { text: '# Title\n\nbody', isFirstOfReply: true } } as never)
  const reply = await first.find({ key: 'reply' })
  expect(reply.props.props.text).toBe('# Title\n\nbody')
  expect(await texts(first)).toContain('◆')
})

test('CHANGES list: newest first, reads hidden on request, and only one agent\'s files when picked', () => {
  const s = emptySession()
  const f = (path: string, op: 'R' | 'M' | 'A', lastAt: number, by: string[]) => ({ path, op, count: 1, lastAt, lastOp: op, by, diff: [] })
  s.files.set('/w/a.ts', f('/w/a.ts', 'M', 3, ['main']))
  s.files.set('/w/b.ts', f('/w/b.ts', 'R', 5, ['a1']))
  s.files.set('/w/c.ts', f('/w/c.ts', 'A', 4, ['a1', 'main']))
  expect(changesList(s, { showReads: true }).map(x => x.path)).toEqual(['/w/b.ts', '/w/c.ts', '/w/a.ts'])
  expect(changesList(s, { showReads: false }).map(x => x.path)).toEqual(['/w/c.ts', '/w/a.ts'])
  expect(changesList(s, { showReads: true, by: 'a1' }).map(x => x.path)).toEqual(['/w/b.ts', '/w/c.ts'])
  expect(changesList(s, { showReads: true, by: 'nobody' })).toEqual([])
})

test('opening an ORCH card narrows CHANGES to that agent and closing it lifts the filter', async ($, on) => {
  const saved = emptySession()
  saved.agents.set('a1', { id: 'a1', label: 'job', type: 'Explore', startedAt: 1000, endedAt: 2000, status: 'done' })
  saved.files.set('/w/mine.ts', { path: '/w/mine.ts', op: 'M', count: 1, lastAt: 1500, lastOp: 'M', by: ['a1'], diff: ['+x'] })
  saved.files.set('/w/other.ts', { path: '/w/other.ts', op: 'M', count: 1, lastAt: 1800, lastOp: 'M', by: ['main'], diff: ['+y'] })
  host(on, { opens: [], closes: [], fileText: JSON.stringify({ ...saveSession(saved), view: {} }) })
  await $.session.start({ source: 'resume', cwd: '/w' } as never).catch(() => {})
  const ui: any = await mount($)
  await ui.press({ key: 'ct-orch' })
  await ui.press({ key: 'zen-orch' })
  await ui.press({ key: 'op-t-a1' })
  await ui.press({ key: 'unzen' })
  await ui.press({ key: 'ct-files' })
  const open = await texts(ui)
  expect(open).toContain('mine.ts')
  expect(open).not.toContain('other.ts')
  expect(await ui.find({ key: 'by' })).toBeTruthy()
  await ui.press({ key: 'by' })
  expect(await texts(ui)).toContain('other.ts')
})

test('vim keys as pure functions: top, bottom, half pages, Enter and the preview focus', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ path: `d/f${i}`, dir: false, open: false, depth: 1 }))
  const dir = { path: 'd', dir: true, open: false, depth: 0 }
  const all = [dir, ...rows]
  const ui: any = { treeCur: 'd', treeFocus: 'tree', scroll: {}, hx: {} }
  expect(treeVim('bottom', all, ui)).toEqual({ manual: true })
  expect(ui.treeCur).toBe('d/f29')
  treeVim('top', all, ui)
  expect(ui.treeCur).toBe('d')
  treeVim('pagedown', all, ui)
  expect(ui.treeCur).toBe('d/f9')
  treeVim('pageup', all, ui)
  expect(ui.treeCur).toBe('d')
  expect(treeVim('enter', all, ui)).toEqual({ toggle: 'd' })
  ui.treeCur = 'd/f3'
  treeVim('enter', all, ui)
  expect(ui.treeFocus).toBe('preview')
  expect(treeVim('j', all, ui)).toEqual({ vpan: ['project:detail', 3] })
  treeVim('h', all, ui)
  expect(ui.treeFocus).toBe('tree')
  const list = [{ path: '/a' }, { path: '/b' }, { path: '/c' }] as any
  const fui: any = { selFile: '/a', filesFocus: 'list', scroll: {}, hx: {} }
  filesVim('bottom', list, fui)
  expect(fui.selFile).toBe('/c')
  filesVim('enter', list, fui)
  expect(fui.filesFocus).toBe('preview')
  expect(filesVim('top', list, fui)).toEqual({ vpan: ['files:detail', -1e6] })
})

test('the tree client holds the keys: gg and G jump, Enter goes in, a / search finds a name and n goes on', async ($, on) => {
  host(on, { opens: [], closes: [], ls: 'a/one.ts\na/two.ts\nb/three.ts\nz/last.ts\n' })
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await new Promise(r => setTimeout(r, 50))
  const ui: any = await mount($)
  await ui.press({ key: 'ct-project' })
  await ui.press({ key: 'zen-project' })
  const rows = async () => (await ui.findAll({ type: 'Client' })).filter((n: any) => String(n.props?.module).endsWith('filetree.tsx')).flatMap((n: any) => n.props.props.rows)
  const cursor = async () => (await rows()).find((r: any) => r.selected)?.name
  const key = async (k: string, mods: any = {}) => { await ui.key({ key: k, in: 'filetree', ...mods }); await new Promise(r => setTimeout(r, 20)) }
  await key('G')
  expect(await cursor()).toBe('z')
  await key('g'); await key('g')
  expect(await cursor()).toBe('a')
  await key('return')
  expect((await rows()).map((r: any) => r.name)).toEqual(['a', 'one.ts', 'two.ts', 'b', 'z'])
  await key('/'); await key('t'); await key('h'); await key('r'); await key('return')
  expect(await cursor()).toBe('three.ts')
})

test('a task notification ends the agent it names, and only if that agent still shows as running', () => {
  const s = emptySession()
  s.agents.set('a1', { id: 'a1', label: 'job', type: 'Explore', startedAt: 1000, status: 'running', doing: 'Reading x' })
  s.agents.set('a2', { id: 'a2', label: 'old', type: 'Plan', startedAt: 1000, endedAt: 1500, status: 'done' })
  const note = (id: string, status: string) => `<task-notification><task-id>${id}</task-id><status>${status}</status></task-notification>`
  expect(endAgentFromNotification(s, note('a2', 'completed'), 9000)).toBe(false)
  expect(endAgentFromNotification(s, note('zzz', 'completed'), 9000)).toBe(false)
  expect(endAgentFromNotification(s, note('a1', 'killed'), 9000)).toBe(true)
  expect(s.agents.get('a1')!.status).toBe('error')
  expect(s.agents.get('a1')!.endedAt).toBe(9000)
  expect(s.agents.get('a1')!.doing).toBeUndefined()
  expect(s.agents.get('a2')!.endedAt).toBe(1500)
})

test('project listing: git for a repository, find for a folder; paths lose the root and are cut at the maximum', () => {
  expect(listArgv('/w', true)).toEqual(['git', '-C', '/w', 'ls-files', '-co', '--exclude-standard'])
  expect(listArgv('/w', false)[0]).toBe('find')
  const out = ['/w/a/b.ts', 'c.md', '/w/d/e.py'].join('\n')
  expect(parseListing(out, '/w')).toEqual({ root: '/w', paths: ['a/b.ts', 'c.md', 'd/e.py'], truncated: false })
  const big = Array.from({ length: TREE_MAX + 3 }, (_, i) => `f${i}`).join('\n')
  const cut = parseListing(big, '/w')
  expect(cut.paths.length).toBe(TREE_MAX)
  expect(cut.truncated).toBe(true)
  expect(gitQueries(0).committed[3]).toBe('--since=1970-01-01T00:00:00.000Z')
})

import { archBaseFrom, archBack, archDirLabel, archPress, archPrune, archStamp, archUp, joinPath, likec4Errors, likec4Label } from '../hooks/archdir'
import { followFile, keepActive, nudge, oOwner, scrollSign, toggleAgent, toggleDir, toggleMsg } from '../hooks/viewstate'
import { agentTag, applyChecklist, endExec, endTask, isDocsCreate, parseTitle, prettyModel, recordTool, sendReport, summary } from '../hooks/events'
import { artifactUrl, htmlArgs, newMediaOf, openArgv, prepArgv, previewOf } from '../hooks/media'
import { editedLines } from '../hooks/live'
import type { UiState } from '../hooks/views'
import type { Exec } from '../hooks/model'

const freshUi = (): UiState => ({
  tab: 'files', mapView: 'combo', comboSlot: 0, fullFile: false, showReads: true, mediaFilter: 'ALL', scroll: {},
  archTrail: [], archDirs: [], archPanX: 0, hx: {}, splitRatio: {}, treeShut: {}, treeChanged: false, treeFocus: 'tree', filesFocus: 'list', treeOpen: {}, follow: true,
})

test('arch folders: repo paths resolve against the diagram, the trail starts at the system layer, labels name the workspace or repo', () => {
  expect(joinPath('/w/vault/02-Architecture/system-maps', '../../../api')).toBe('/w/api')
  expect(joinPath('/x', '/abs/./y')).toBe('/abs/y')
  expect(archBaseFrom('/w/api', '/w/vault/02-Architecture/system-maps', '/w/api/src')).toEqual(['/w/vault/02-Architecture/system-maps', '/w/api/docs'])
  expect(archBaseFrom(undefined, undefined, '/tmp/x')).toEqual(['/tmp/x/docs'])
  expect(archDirLabel('/home/me/acme/vault/02-Architecture/system-maps')).toBe('acme')
  expect(archDirLabel('/home/me/api/docs')).toBe('api')
  expect(likec4Label(['npx', '-y', 'likec4@1'])).toBe('npx likec4')
  expect(likec4Errors('\x1b[31mLine 3: bad\x1b[0m\nnoise\nError: x')).toBe('Line 3: bad\nError: x')
  expect(archStamp([{ name: 'b.c4', mtimeMs: 2 }, { name: 'a.c4', mtimeMs: 1 }])).toBe('a.c4:1|b.c4:2')
})

test('arch clicks: select, then drill into a view or a repo; breadcrumbs go back and a vanished view resets the trail', () => {
  const ui = freshUi()
  ui.archDirs = ['/w/vault/02-Architecture/system-maps']
  const view = { id: 'index', title: 'Index', width: 1, height: 1, nodes: [], edges: [] }
  const arch = { dir: ui.archDirs[0]!, model: { views: { index: view, api: { ...view, id: 'api' } }, first: 'index' } }
  const node = { id: 'n', title: 'N', kind: 'system', isGroup: false, x: 0, y: 0, width: 1, height: 1 }
  expect(archPress(ui, { ...node, navigateTo: 'api' }, arch)).toBe(false)
  expect(ui.archSel).toBe('n')
  ui.archPanX = 4
  expect(archPress(ui, { ...node, navigateTo: 'api' }, arch)).toBe(false)
  expect(ui.archTrail).toEqual(['index', 'api'])
  expect([ui.archSel, ui.archPanX, ui.scroll.arch]).toEqual([undefined, 0, 0])
  archBack(ui, 0)
  expect(ui.archTrail).toEqual(['index'])
  ui.archSel = 'r'
  expect(archPress(ui, { ...node, id: 'r', repo: '../../../api' }, arch)).toBe(true)
  expect(ui.archDirs.at(-1)).toBe('/w/api/docs')
  expect(ui.archTrail).toEqual([])
  archUp(ui, 0)
  expect(ui.archDirs).toEqual(['/w/vault/02-Architecture/system-maps'])
  ui.archTrail = ['index', 'gone']
  archPrune(ui, arch)
  expect(ui.archTrail).toEqual([])
})

test('layout reload keeps each cell\'s active tab; the o key goes to the visible panel used last', () => {
  const prev = { split: 'row' as const, sizes: [0.5, 0.5], children: [{ tabs: ['files', 'exec'] as const, active: 1 }, { tabs: ['map'] as const }] }
  const next = keepActive({ split: 'col', sizes: [0.5, 0.5], children: [{ tabs: ['map'] }, { tabs: ['files', 'exec'] }] }, prev as never)
  expect((next as any).children[1].active).toBe(1)
  const shown = { split: 'row', sizes: [0.5, 0.5], children: [{ tabs: ['files'] }, { tabs: ['log', 'arch'], active: 1 }] } as never
  expect(oOwner(undefined, 'arch', shown)).toBe('arch')
  expect(oOwner(undefined, 'project', shown)).toBe('files')
  expect(oOwner('project', 'arch', shown)).toBe('project')
})

test('follow mode opens the edited file\'s folders and selects it, adding a new file; off or outside the root it does nothing', () => {
  const ui = freshUi()
  const project = { root: '/w', paths: ['a/b.ts'], truncated: false }
  const f = followFile(ui, project, '/w/a/new.ts', false)!
  expect(f.project.paths).toEqual(['a/b.ts', 'a/new.ts'])
  expect(ui.treeOpen).toEqual({ a: true })
  expect(ui.treeSel).toBe('a/new.ts')
  expect([f.focus, f.last]).toEqual([true, true])
  ui.zen = 'log'
  expect(followFile(ui, project, '/w/a/b.ts', false)).toMatchObject({ focus: false, last: false })
  expect(followFile(ui, project, '/elsewhere/x.ts', false)).toBeUndefined()
  ui.follow = false
  expect(followFile(ui, project, '/w/a/b.ts', false)).toBeUndefined()
})

test('tree folders, scrolling, the message box and ORCH cards change only the view state they own', () => {
  const ui = freshUi()
  toggleDir(ui, 'src', new Map([['src', 1]]))
  expect(ui.treeShut).toEqual({ src: true })
  toggleDir(ui, 'src', new Map([['src', 1]]))
  expect([ui.treeOpen, ui.treeShut]).toEqual([{ src: true }, {}])
  nudge(ui.scroll, 'log', 50, 10)
  expect(ui.scroll.log).toBe(10)
  nudge(ui.scroll, 'exec:detail', scrollSign('exec:detail') * 3, 10)
  expect(ui.scroll['exec:detail']).toBe(0)
  toggleMsg(ui, 'main', 'radar')
  expect(ui.msgTo).toBe('main')
  toggleMsg(ui, 'main', 'radar')
  expect(ui.msgTo).toBeUndefined()
  const s = emptySession()
  s.files.set('/w/x.ts', { path: '/w/x.ts', op: 'M', count: 1, lastAt: 1, lastOp: 'M', by: ['a1'], diff: [] })
  toggleAgent(ui, s, 'a1')
  expect([ui.selAgent, ui.filesBy, ui.selFile]).toEqual(['a1', 'a1', '/w/x.ts'])
  toggleAgent(ui, s, 'a1')
  expect([ui.selAgent, ui.filesBy]).toEqual([undefined, undefined])
})

test('tool calls: Bash results end their Exec, file tools touch Files and ask for WEB or MEDIA, others go to the Log', () => {
  const s = emptySession()
  const x: Exec = { id: 't1', who: 'main', command: 'ls', startedAt: 1, status: 'running' }
  expect(endExec(x, { stdout: 'ok' }, undefined, false, 5)).toBeUndefined()
  expect([x.status, x.exit, x.stdout, x.endedAt]).toEqual(['ok', 0, 'ok', 5])
  const bg: Exec = { ...x, id: 't2', status: 'running' }
  expect(endExec(bg, { backgroundTaskId: 'b9' }, undefined, false, 5)).toBe('b9')
  expect(bg.status).toBe('background')
  const r = { failed: false, who: 'main', at: 9, line: 'Write /w/p.html', brief: 'Writing p.html' }
  expect(recordTool(s, 'Write', {}, { type: 'create' }, { ...r, path: '/w/p.html' })).toEqual({ fresh: 'files', web: '/w/p.html', media: undefined })
  expect(s.files.get('/w/p.html')!.op).toBe('A')
  expect(recordTool(s, 'Edit', {}, {}, { ...r, path: '/w/a.png' }).media).toBe('/w/a.png')
  expect(recordTool(s, 'Read', {}, {}, { ...r, path: '/tmp/scratchpad/.shots/x.png' })).toEqual({})
  expect(recordTool(s, 'Grep', {}, {}, { ...r, failed: true, path: undefined })).toEqual({})
  expect(s.log.at(-1)!.kind).toBe('error')
  expect(applyChecklist(s, 'nope', 'main', 1)).toEqual({ error: 'todos must be an array' })
  expect(applyChecklist(s, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }], 'main', 1)).toEqual({ text: 'checklist 1/2' })
  expect(summary('Bash', { command: 'ls -la\nmore' })).toBe('Bash ls -la')
  expect(isDocsCreate({ tool: 'mcp__claude_ai_Claude_Docs__create' })).toBe(true)
  expect(isDocsCreate({ tool: 'mcp__claude_ai_Claude_Docs__read' })).toBe(false)
})

test('a background task notification ends its command with the exit code and the output read so far', () => {
  const s = emptySession()
  s.execs.push({ id: 'e1', who: 'main', command: 'sleep', startedAt: 1, status: 'background', outputPath: '/t/tasks/b9.output' })
  const note = '<task-notification><task-id>b9</task-id><status>failed</status>exit code 3</task-notification>'
  expect(endTask(s, note, new Map([['e1', 'tail']]), 50)).toBe(true)
  expect(s.execs[0]).toMatchObject({ status: 'error', exit: 3, endedAt: 50, stdout: 'tail' })
  expect(endTask(s, note, new Map(), 60)).toBe(false)
})

test('session title, model name and MAP message reports', () => {
  expect(parseTitle('"aiTitle":"Generated"\n"customTitle":"Mine"\n"aiTitle":"Later"\n')).toBe('Mine')
  expect(parseTitle('"aiTitle":"Only"\n')).toBe('Only')
  expect(parseTitle(undefined)).toBeUndefined()
  expect(prettyModel('claude-opus-4-5')).toBe('opus-4.5')
  const s = emptySession()
  s.agents.set('b', { id: 'b', label: 'b', type: 'Plan', startedAt: 20, status: 'running' })
  s.agents.set('a', { id: 'a', label: 'a', type: 'Plan', startedAt: 10, status: 'running' })
  expect([agentTag(s, 'main'), agentTag(s, 'a'), agentTag(s, 'b')]).toEqual(['[M]', '[1]', '[2]'])
  expect(sendReport(s, 'all', 'hi', ['a', 'b'], []).toast).toBe('Sent to 2 subagents')
  expect(sendReport(s, 'b', 'hi', ['b'], ['[2] gone']).toast).toBe('Not delivered: [2] gone')
  expect(sendReport(s, 'b', 'hi', ['b'], []).log).toBe('You → [2]: hi')
})

test('media helpers: new files found after a command, previews, /html arguments and Artifact links', () => {
  expect(newMediaOf('/w/a.png\n/w/notes.md\n/w/scratchpad/.shots/s.png\n/w/b.gif\n/w/c.jpg\n/w/d.png')).toEqual(['/w/a.png', '/w/b.gif'])
  expect(previewOf('{"width":2,"height":3,"frames":["/f/0.png"]}')).toEqual({ frame: '/f/0.png', width: 2, height: 3 })
  expect(previewOf('not json')).toBeUndefined()
  expect(prepArgv('/b', '/w/a b.png', true)).toEqual(['/b/media-prep', '/w/a b.png', '/tmp/asint-media/preview-_w_a_b_png'])
  expect(openArgv('/b', '/w/x.ts')).toEqual(['setsid', '-f', 'xdg-terminal-exec', 'nvim', '/w/x.ts'])
  expect(openArgv('/b', '/w/x.pdf')).toEqual(['setsid', '-f', '/b/asint-open', '/w/x.pdf'])
  expect(htmlArgs('-b  ~/a.html')).toEqual({ brave: true, raw: '~/a.html' })
  expect(htmlArgs('-t x')).toEqual({ brave: false, raw: 'x' })
  expect(artifactUrl('Published: https://claude.ai/artifact/abc).', undefined)).toBe('https://claude.ai/artifact/abc')
})

test('a finished edit highlights the lines its new content fills', () => {
  expect(editedLines({ tool: 'Edit', new: 'b\nc' }, 'a\nb\nc\nd')).toEqual({ from: 1, to: 2 })
  expect(editedLines({ tool: 'Write', new: 'x\ny\nz' }, 'x\ny\nz')).toEqual({ from: 0, to: 2 })
  expect(editedLines({ tool: 'Edit', new: 'missing' }, 'a')).toEqual({ from: 0, to: 0 })
})

test('a checklist item that is in progress while nothing runs is waiting for the user, not running', async ($, on) => {
  const s = emptySession()
  expect(isBusy(s)).toBe(false)
  s.vitals.turnRunning = true
  expect(isBusy(s)).toBe(true)
  s.vitals.turnRunning = false
  s.agents.set('a1', { id: 'a1', label: 'job', type: 'Plan', startedAt: 1, status: 'running' })
  expect(isBusy(s)).toBe(true)
  s.agents.get('a1')!.status = 'done'
  s.execs.push({ id: 'e', who: 'main', command: 'sleep 1', startedAt: 1, status: 'background' })
  expect(isBusy(s)).toBe(true)
  s.execs[0]!.status = 'ok'
  expect(isBusy(s)).toBe(false)

  host(on)
  await $.session.start({ source: 'startup', cwd: '/w' } as never).catch(() => {})
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'd1', todos: [{ content: 'ask the user first', status: 'in_progress', activeForm: 'Asking' }] } as never)
  const ui: any = await mount($)
  const all = await texts(ui)
  expect(all).toContain('waiting')
  expect(all).toContain('Waiting for you')
})
