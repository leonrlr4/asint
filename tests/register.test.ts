import { test, expect } from 'claude-code/testing'

// In-memory $.store so /skin can save and read back.
const memoryStore = (on: any) => {
  const kv = new Map<string, unknown>()
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: kv.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => (kv.set(e.key, e.value), { value: undefined }))
  return kv
}

test('/skin toggles between the two palettes and remembers the choice', async ($, on) => {
  const kv = memoryStore(on)
  const first = await $.command.run({ command: 'skin', args: '' } as never)
  expect(first.text).toBe('Dashboard in phosphor colors too')
  expect(kv.get('skin')).toBe('hacker')
  const second = await $.command.run({ command: 'skin', args: '' } as never)
  expect(second.text).toContain('Omarchy')
})

test('spinner is drawn by the client module and receives the current skin', async ($, on) => {
  memoryStore(on)
  on('clock.now', () => ({ value: 1_000 }))
  await $.command.run({ command: 'skin', args: 'hacker' } as never)
  const ui = await $.ui.mount({ plugin: 'asint', surface: 'terminal', component: 'Spinner',
    props: { word: 'Working', message: null, suffix: '…', mode: 'thinking' } } as never)
  const client = await (ui as any).find({ type: 'Client' })
  expect(client.props.props.skin).toBe('hacker')
})
