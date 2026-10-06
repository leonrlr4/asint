import type { Palette } from '../types'

import { Canvas, mix } from './canvas'
import { short, type Session } from './model'

// The Map tab's four renderings, fed by real Session data. Power-saving spec: no trailing gradients, breathing drift or particle swarms;
// only the scan line, a single dot travelling along each beam, and recently touched files lit (within 5 seconds, no fade-out).

// board is not drawn on the Raster: views.tsx renders it as a kanban/list with regular components.
export type MapView = 'radar' | 'graph' | 'heat' | 'combo' | 'board'
type Op = 'R' | 'E' | 'W' | 'B' | 'X'
type Ev = { t: number; who: string; op: Op; file: string }

const RECENT_S = 5
const BEAM_S = 1.2

export type MapInput = { s: Session; now: number; focus?: string; comboSlot: 0 | 1 }

const opColor = (p: Palette, op: Op) => (op === 'E' ? p.warn : op === 'W' ? p.success : op === 'B' ? p.accent : op === 'X' ? p.error : p.hi)
const dirOf = (f: string) => {
  const parts = f.split('/')
  return parts.length > 1 ? parts[parts.length - 2]! : '.'
}

export function agentsOf(s: Session) {
  const subs = [...s.agents.values()].sort((a, b) => a.startedAt - b.startedAt)
  return [{ id: 'main', label: 'MAIN', running: s.vitals.turnRunning }, ...subs.map((a, i) => ({ id: a.id, label: `A${i + 1}`, running: a.status === 'running' }))]
}

function events(s: Session, now: number, span: number): Ev[] {
  return s.log
    .filter(e => e.op && e.file && now - e.at <= span * 1000)
    .map(e => ({ t: (e.at - now) / 1000, who: e.who, op: e.op as Op, file: e.file! }))
}

/** The n most recently touched files at most; Map draws only these so hundreds of dots do not pile up. */
const hotFiles = (s: Session, n: number) => [...s.files.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, n)

const agentColor = (p: Palette, i: number) => [p.accent, p.success, p.warn, p.hi, p.error][i % 5]!
const dim = (p: Palette, c: string, focus: string | undefined, who: string[] | string) =>
  !focus || (Array.isArray(who) ? who.includes(focus) : who === focus) ? c : mix(c, p.bg, 0.75)

function header(c: Canvas, p: Palette, title: string, s: Session) {
  c.write(1, 0, title, p.accent)
  const right = `FILES ${s.files.size}  EXEC ${s.execs.length}  AGT ${[...s.agents.values()].filter(a => a.status === 'running').length + 1}`
  c.write(c.cols - right.length - 1, 0, right, p.muted)
}

// ── Radar ──
type Box = { x: number; y: number; w: number; h: number }

const radarGeom = (box: Box) => ({ cx: box.x + box.w / 2, cy: box.y + box.h / 2 + 2, R: Math.min(box.w / 2 - 10, box.h / 2 - 8) })

/**
 * Position (in dots) of the i-th agent on the radar: main at the center, subagents fixed evenly on a ring at 0.2R.
 * They no longer orbit, so markers stay clickable and the chat popup does not lose track of them.
 */
function radarAgentXY(i: number, n: number, g: ReturnType<typeof radarGeom>) {
  if (i === 0) return { x: g.cx, y: g.cy }
  const a = ((i - 1) / Math.max(1, n - 1)) * Math.PI * 2 - Math.PI / 2
  return { x: g.cx + Math.cos(a) * g.R * 0.2, y: g.cy + Math.sin(a) * g.R * 0.2 }
}

export function radar(c: Canvas, p: Palette, { s, now, focus }: MapInput, box: Box = { x: 0, y: 0, w: c.w, h: c.h }) {
  const g = radarGeom(box)
  const { cx, cy, R } = g
  if (R < 8) return
  for (const k of [0.5, 1]) c.ring(cx, cy, R * k, p.faint, k === 1 ? 0 : 2)
  const files = hotFiles(s, 40)
  const dirs = [...new Set(files.map(f => dirOf(f.path)))].slice(0, 12)
  const sector = (2 * Math.PI) / Math.max(1, dirs.length)
  dirs.forEach((d, i) => {
    const a = i * sector - Math.PI / 2
    c.line(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, p.faint, 3)
    const la = a + sector / 2
    c.write(Math.round((cx + Math.cos(la) * (R + 6)) / 2) - 2, Math.round((cy + Math.sin(la) * (R + 6)) / 4), d.toUpperCase().slice(0, 10), p.muted)
  })
  const sweep = ((now / 4000) % 1) * Math.PI * 2 - Math.PI / 2
  c.line(cx, cy, cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R, mix(p.accent, p.bg, 0.3))
  const pos = new Map<string, { x: number; y: number }>()
  for (const f of files) {
    const di = Math.max(0, dirs.indexOf(dirOf(f.path)))
    const sib = files.filter(x => dirOf(x.path) === dirOf(f.path))
    const j = sib.indexOf(f)
    const a = di * sector - Math.PI / 2 + sector * ((j + 0.5) / Math.max(1, sib.length))
    // The more recently touched, the closer to the center: inner ring within a minute, drifting outward with age.
    const age = Math.min(1, (now - f.lastAt) / 600_000)
    const r = R * (0.35 + 0.6 * age)
    pos.set(f.path, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  const agents = agentsOf(s)
  const apos = (i: number) => radarAgentXY(i, agents.length, g)
  for (const e of events(s, now, BEAM_S)) {
    const ai = agents.findIndex(a => a.id === e.who)
    const fp = pos.get(e.file)
    if (ai < 0 || !fp) continue
    const a = apos(ai)
    const col = dim(p, opColor(p, e.op), focus, e.who)
    c.line(a.x, a.y, fp.x, fp.y, mix(col, p.bg, 0.4), 2)
    const [src, dst] = e.op === 'R' ? [fp, a] : [a, fp]
    const q = Math.min(1, -e.t / BEAM_S)
    c.disc(src.x + (dst.x - src.x) * q, src.y + (dst.y - src.y) * q, 1, p.hi)
  }
  for (const f of files) {
    const { x, y } = pos.get(f.path)!
    const recent = (now - f.lastAt) / 1000 < RECENT_S
    const col = dim(p, recent ? opColor(p, f.lastOp === 'A' ? 'W' : f.lastOp === 'M' ? 'E' : 'R') : p.base, focus, f.by)
    c.disc(x, y, f.count > 4 ? 1 : 0, col)
    if (recent || f.count > 4) c.write(Math.round(x / 2) + 2, Math.round(y / 4), short(f.path).slice(0, 24), col)
  }
  agents.forEach((a, i) => {
    const { x, y } = apos(i)
    const col = dim(p, a.running ? agentColor(p, i) : p.faint, focus, a.id)
    c.ring(x, y, i === 0 ? 4 : 3, col)
    c.write(Math.round(x / 2) - 1, Math.round(y / 4), i === 0 ? '[M]' : `[${i}]`, col)
  })
}

// ── Relation graph ──
/** Position (in dots) of the i-th agent in the relation graph: laid out along a horizontal row in the middle. */
function graphAgentXY(i: number, n: number, box: Box) {
  return { x: box.x + box.w / 2 + (i - (n - 1) / 2) * Math.min(24, box.w / (n + 1)), y: box.y + box.h / 2 + 2 }
}

export function graph(c: Canvas, p: Palette, { s, now, focus }: MapInput, box: Box = { x: 0, y: 0, w: c.w, h: c.h }) {
  const files = hotFiles(s, 24)
  const agents = agentsOf(s)
  const midY = box.y + box.h / 2 + 2
  const rx = box.w * 0.4, ry = box.h * 0.4
  const fpos = (k: number) => {
    const a = (k / Math.max(1, files.length)) * Math.PI * 2 + 0.3
    return { x: box.x + box.w / 2 + Math.cos(a) * rx, y: midY + Math.sin(a) * ry }
  }
  const apos = (i: number) => graphAgentXY(i, agents.length, box)
  files.forEach((f, k) => {
    for (const who of f.by) {
      const ai = agents.findIndex(a => a.id === who)
      if (ai < 0) continue
      const a = apos(ai), fp = fpos(k)
      c.line(a.x, a.y, fp.x, fp.y, dim(p, mix(agentColor(p, ai), p.bg, 0.78), focus, who), 2)
    }
  })
  for (const e of events(s, now, BEAM_S)) {
    const ai = agents.findIndex(a => a.id === e.who)
    const k = files.findIndex(f => f.path === e.file)
    if (ai < 0 || k < 0) continue
    const a = apos(ai), fp = fpos(k)
    const col = dim(p, opColor(p, e.op), focus, e.who)
    c.line(a.x, a.y, fp.x, fp.y, col)
    const [src, dst] = e.op === 'R' ? [fp, a] : [a, fp]
    const q = Math.min(1, -e.t / BEAM_S)
    c.disc(src.x + (dst.x - src.x) * q, src.y + (dst.y - src.y) * q, 1, p.hi)
  }
  files.forEach((f, k) => {
    const { x, y } = fpos(k)
    const recent = (now - f.lastAt) / 1000 < RECENT_S
    const col = dim(p, recent ? p.hi : p.base, focus, f.by)
    c.disc(x, y, Math.min(2, Math.floor(f.count / 3)), col)
    c.write(Math.round(x / 2) + 2, Math.round(y / 4), `${short(f.path).slice(0, 22)}${f.count > 1 ? ` x${f.count}` : ''}`, col)
  })
  agents.forEach((a, i) => {
    const { x, y } = apos(i)
    const col = dim(p, a.running ? agentColor(p, i) : p.faint, focus, a.id)
    c.disc(x, y, i === 0 ? 3 : 2, col)
    c.write(Math.round(x / 2) - 2, Math.round(y / 4) + 2, a.label, col)
  })
}

// ── Heat treemap ──
export function heat(c: Canvas, p: Palette, { s, now, focus }: MapInput, rowsTop = 1, rowsH = c.rows - 1) {
  const files = hotFiles(s, 60)
  if (!files.length) {
    c.write(2, rowsTop + 1, 'no files touched yet', p.muted)
    return
  }
  const dirs = [...new Set(files.map(f => dirOf(f.path)))]
  const W = c.cols - 2
  const total = files.reduce((n, f) => n + f.count, 0)
  let col = 1
  for (const d of dirs) {
    const fs = files.filter(f => dirOf(f.path) === d)
    const dn = fs.reduce((n, f) => n + f.count, 0)
    const dw = Math.max(10, Math.round((W * dn) / total))
    if (col + 4 >= c.cols) break
    c.write(col, rowsTop, `${d}/`.slice(0, dw - 1), p.muted)
    let row = rowsTop + 1
    for (const f of fs) {
      const fh = Math.max(2, Math.round(((rowsH - 2) * f.count) / dn))
      if (row >= rowsTop + rowsH) break
      const recent = (now - f.lastAt) / 1000 < RECENT_S
      const hot = Math.min(1, f.count / 8)
      const bg = dim(p, recent ? mix(p.surface, p.hi, 0.3) : mix(p.surface, p.warn, hot * 0.5), focus, f.by)
      c.fill(col, row, dw - 1, Math.min(fh - 1, rowsTop + rowsH - row), bg)
      c.write(col + 1, row, short(f.path).slice(0, dw - 3), p.hi, bg)
      c.write(col + 1, row + 1 < row + fh - 1 ? row + 1 : row, `${f.op} x${f.count}`, p.muted, bg)
      row += fh
    }
    col += dw
  }
}

// ── Timeline ──
export function timeline(c: Canvas, p: Palette, { s, now, focus }: MapInput, top: number, span = 60) {
  const agents = agentsOf(s)
  const x0 = 11, x1 = c.cols - 2
  c.write(1, top, `-${span}s`, p.muted)
  c.write(x1 - 3, top, 'NOW', p.accent)
  agents.slice(0, Math.floor((c.rows - top - 1) / 2)).forEach((a, i) => {
    const r = top + 1 + i * 2
    const col = dim(p, a.running ? agentColor(p, i) : p.faint, focus, a.id)
    c.write(1, r, a.label.padEnd(9).slice(0, 9), col)
    for (let x = x0; x <= x1; x++) c.write(x, r, '-', p.faint)
    for (const e of events(s, now, span)) {
      if (e.who !== a.id) continue
      const x = Math.round(x1 + (e.t / span) * (x1 - x0))
      c.write(x, r, e.op, dim(p, opColor(p, e.op), focus, e.who))
    }
    if (a.running) c.write(x1, r, '>', col)
  })
}

/** Where on the canvas the radar is drawn (in dots); undefined when this rendering has no radar. Drawing and click hotspots share it. */
function radarBox(view: MapView, cols: number, rows: number, agentCount: number, comboSlot: 0 | 1): Box | undefined {
  const w = cols * 2, h = rows * 4
  if (view === 'radar') return { x: 0, y: 4, w, h: h - 4 }
  if (view !== 'combo') return undefined
  const tlRows = Math.min(2 + agentCount * 2, Math.floor(rows * 0.35))
  const topH = (rows - tlRows - 1) * 4
  if (cols >= 110) return { x: 0, y: 4, w: w / 2, h: topH - 4 }
  return comboSlot === 0 ? { x: 0, y: 4, w, h: topH - 4 } : undefined
}

/** Where on the canvas the relation graph is drawn (in dots); undefined when this rendering has no relation graph. */
function graphBox(view: MapView, cols: number, rows: number, agentCount: number, comboSlot: 0 | 1): Box | undefined {
  const w = cols * 2, h = rows * 4
  if (view === 'graph') return { x: 0, y: 4, w, h: h - 4 }
  if (view !== 'combo') return undefined
  const tlRows = Math.min(2 + agentCount * 2, Math.floor(rows * 0.35))
  const topH = (rows - tlRows - 1) * 4
  if (cols >= 110) return { x: w / 2, y: 4, w: w / 2, h: topH - 4 }
  return comboSlot === 1 ? { x: 0, y: 4, w, h: topH - 4 } : undefined
}

export type AgentSpot = { key: string; id: string; tag: string; col: number; row: number }

/**
 * Character-cell position of each agent marker on the radar and the relation graph, for click hotspots; in combined mode both diagrams contribute.
 * Radar keys are spot-<id>, relation-graph keys are spotg-<id>.
 */
export function agentSpots(view: MapView, cols: number, rows: number, s: Session, comboSlot: 0 | 1): AgentSpot[] {
  const agents = agentsOf(s)
  const out: AgentSpot[] = []
  const rbox = radarBox(view, cols, rows, agents.length, comboSlot)
  const g = rbox && radarGeom(rbox)
  if (g && g.R >= 8) agents.forEach((a, i) => {
    const { x, y } = radarAgentXY(i, agents.length, g)
    out.push({ key: `spot-${a.id}`, id: a.id, tag: i === 0 ? '[M]' : `[${i}]`, col: Math.round(x / 2) - 1, row: Math.round(y / 4) })
  })
  const gbox = graphBox(view, cols, rows, agents.length, comboSlot)
  if (gbox) agents.forEach((a, i) => {
    const { x, y } = graphAgentXY(i, agents.length, gbox)
    // Relation-graph labels sit two rows below the dot (where graph() calls c.write).
    out.push({ key: `spotg-${a.id}`, id: a.id, tag: a.label, col: Math.round(x / 2) - 2, row: Math.round(y / 4) + 2 })
  })
  return out
}

export function draw(view: MapView, c: Canvas, p: Palette, input: MapInput) {
  const title = { radar: 'RADAR', graph: 'GRAPH', heat: 'HEATMAP', combo: 'COMBO', board: 'BOARD' }[view]
  header(c, p, `MAP // ${title}`, input.s)
  const agentCount = agentsOf(input.s).length
  const tlRows = Math.min(2 + agentCount * 2, Math.floor(c.rows * 0.35))
  const rbox = radarBox(view, c.cols, c.rows, agentCount, input.comboSlot)
  if (view === 'radar') return radar(c, p, input, rbox)
  if (view === 'graph') return graph(c, p, input, { x: 0, y: 4, w: c.w, h: c.h - 4 })
  if (view === 'heat') return heat(c, p, input)
  if (view === 'board') return
  const topH = (c.rows - tlRows - 1) * 4
  if (rbox) radar(c, p, input, rbox)
  if (c.cols >= 110) graph(c, p, input, { x: c.w / 2, y: 4, w: c.w / 2, h: topH - 4 })
  else if (input.comboSlot === 1) graph(c, p, input, { x: 0, y: 4, w: c.w, h: topH - 4 })
  timeline(c, p, input, c.rows - tlRows)
}
