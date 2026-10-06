import { test, expect } from 'claude-code/testing'

import { archScale, archSize, bezier, drawEdges, nodeRect, parseLikeC4, relationsOf } from '../hooks/arch'
import { Canvas } from '../hooks/canvas'
import { draw } from '../hooks/map'
import { emptySession, upsertAgent } from '../hooks/model'
import { FALLBACK } from '../hooks/palette'
import { LIKEC4_JSON, SYSTEM_JSON } from './likec4-fixture'

test('parse likec4 export: three views, the overview drills down into asint and external', () => {
  const m = parseLikeC4(LIKEC4_JSON)!
  expect(m.first).toBe('index')
  expect(Object.keys(m.views).sort()).toEqual(['asint', 'ext', 'index'])
  const asint = m.views.index!.nodes.find(n => n.id === 'asint')!
  expect(asint.navigateTo).toBe('asint')
  const group = m.views.asint!.nodes.find(n => n.id === 'asint')!
  expect(group.isGroup).toBe(true)
  expect(parseLikeC4('not json')).toBeUndefined()
})

test('scale: nodes are at least 14 cells wide, and no more than 20 when there is room', () => {
  const v = parseLikeC4(LIKEC4_JSON)!.views.asint!
  const narrow = archScale(v, 40)
  expect(nodeRect(v.nodes.find(n => n.id === 'asint.register')!, narrow).w).toBeGreaterThanOrEqual(14)
  const wide = archScale(v, 1000)
  expect(nodeRect(v.nodes.find(n => n.id === 'asint.register')!, wide).w).toBeLessThanOrEqual(20)
  expect(archSize(v, narrow).cols).toBeGreaterThan(40)
})

test('edges are drawn as a Raster, relations list their labels', () => {
  const v = parseLikeC4(LIKEC4_JSON)!.views.asint!
  expect(bezier([[0, 0], [1, 0], [2, 0], [3, 0]], 3)).toHaveLength(4)
  const cells = drawEdges(v, archScale(v, 80), FALLBACK, 0, 0, 80, 30, 'asint.register')
  expect(cells.length).toBeGreaterThan(100)
  const rel = relationsOf(v, 'asint.register')
  expect(rel.out.some(x => x.to === 'views.tsx' && x.label === 'ViewCtx')).toBe(true)
  expect(rel.in.some(x => x.from === 'Claude Code engine')).toBe(true)
})

test('radar: all four subagent markers are visible (no two overlap on the same spot)', () => {
  const s = emptySession()
  for (const id of ['a1', 'a2', 'a3', 'a4']) upsertAgent(s, { id, label: id, type: 'Explore', startedAt: 0, status: 'running' })
  const c = new Canvas(80, 30)
  draw('radar', c, FALLBACK, { s, now: 1000, focus: undefined, comboSlot: 0 })
  const text = String.fromCodePoint(...[...c.text].map(x => x || 32))
  for (const tag of ['[M]', '[1]', '[2]', '[3]', '[4]']) expect(text).toContain(tag)
})

test('system layer: elements with metadata { repo } resolve a repo path, so its diagram can be opened from the node', () => {
  const m = parseLikeC4(SYSTEM_JSON)!
  const api = m.views.shop!.nodes.find(n => n.id === 'shop.api')!
  expect(api.repo).toBe('../../../shop-api')
  const backoffice = m.views.index!.nodes.find(n => n.id === 'backoffice')!
  expect(backoffice.repo).toBe('../../../backoffice')
  expect(m.views.index!.nodes.find(n => n.id === 'shop')!.navigateTo).toBe('shop')
})
