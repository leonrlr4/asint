// The ARCH panel's architecture diagram: reads `likec4 export json` output and converts it to character-cell boxes and braille lines.
// Pure functions; register runs likec4 and views draws.

import type { Palette } from '../types'

import { Canvas } from './canvas'

export type ArchNode = {
  id: string
  title: string
  description?: string
  kind: string
  /** Has children, so it is a container: drawn as an outer frame with its nodes on top. */
  isGroup: boolean
  /** The view to switch to when clicked. */
  navigateTo?: string
  /** System-level elements point at a repo with metadata { repo '<relative path>' }; clicking switches to that repo's docs/ diagram. */
  repo?: string
  x: number
  y: number
  width: number
  height: number
}

export type ArchEdge = { id: string; source: string; target: string; label?: string; points: [number, number][] }

export type ArchView = { id: string; title: string; width: number; height: number; nodes: ArchNode[]; edges: ArchEdge[] }

export type ArchModel = { views: Record<string, ArchView>; first: string }

type RawNode = {
  id: string; title: string; description?: { txt?: string }; kind: string; children?: string[]; navigateTo?: string | null
  metadata?: Record<string, unknown>
  x: number; y: number; width: number; height: number
}
type RawEdge = { id: string; source: string; target: string; label?: string | null; points: [number, number][] }
type RawView = { id: string; title?: string | null; bounds: { x: number; y: number; width: number; height: number }; nodes: RawNode[]; edges: RawEdge[] }

/** `likec4 export json` output → only the fields drawing needs. Coordinates are shifted so the bounds' top-left is the origin. */
export function parseLikeC4(text: string): ArchModel | undefined {
  let raw: { views?: Record<string, RawView> }
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const views: Record<string, ArchView> = {}
  for (const [id, v] of Object.entries(raw.views ?? {})) {
    if (!v?.bounds || !Array.isArray(v.nodes)) continue
    const ox = v.bounds.x, oy = v.bounds.y
    views[id] = {
      id,
      title: v.title || id,
      width: v.bounds.width,
      height: v.bounds.height,
      nodes: v.nodes.map(n => ({
        id: n.id, title: n.title, description: n.description?.txt || undefined, kind: n.kind,
        isGroup: (n.children?.length ?? 0) > 0, navigateTo: n.navigateTo || undefined,
        repo: typeof n.metadata?.repo === 'string' ? n.metadata.repo : undefined,
        x: n.x - ox, y: n.y - oy, width: n.width, height: n.height,
      })),
      edges: (v.edges ?? []).map(e => ({
        id: e.id, source: e.source, target: e.target, label: e.label || undefined,
        points: e.points.map(([x, y]) => [x - ox, y - oy] as [number, number]),
      })),
    }
  }
  const ids = Object.keys(views)
  if (!ids.length) return undefined
  return { views, first: views.index ? 'index' : ids[0]! }
}

// Terminal width of a standard node (LikeC4 default 320×180 px): room for at least 12 characters, at most 20 cells.
const NODE_PX = 320
const MIN_NODE_COLS = 14
const MAX_NODE_COLS = 20

/** Cells per px horizontally; a cell is about twice as tall as wide, so vertically it is half of that. Fit into cols where possible, but never make a node smaller than MIN_NODE_COLS. */
export const archScale = (v: ArchView, cols: number) =>
  Math.min(MAX_NODE_COLS / NODE_PX, Math.max(MIN_NODE_COLS / NODE_PX, (cols - 1) / Math.max(1, v.width)))

export type CellRect = { x: number; y: number; w: number; h: number }

/** A node's character-cell position in the whole (unshifted) diagram. */
export function nodeRect(n: ArchNode, s: number): CellRect {
  const x = Math.round(n.x * s)
  const y = Math.round((n.y * s) / 2)
  return { x, y, w: Math.max(6, Math.round((n.x + n.width) * s) - x), h: Math.max(3, Math.round(((n.y + n.height) * s) / 2) - y) }
}

/** Size of the whole converted diagram, in cells. */
export const archSize = (v: ArchView, s: number) => ({ cols: Math.ceil(v.width * s) + 1, rows: Math.ceil((v.height * s) / 2) + 1 })

/** Samples a chain of cubic Bézier curves (Graphviz's 1+3n control points) into a polyline. */
export function bezier(points: [number, number][], steps = 12): [number, number][] {
  if (points.length < 4) return points
  const out: [number, number][] = [points[0]!]
  for (let i = 0; i + 3 < points.length; i += 3) {
    const [p0, p1, p2, p3] = [points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!]
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, u = 1 - t
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ])
    }
  }
  return out
}


/**
 * Draws a view's edges as a Raster, only the cols×rows window starting at (ox, oy).
 * Edges touching the selected node use accent, the rest a faint color. Arrowheads are drawn with dots: Raster only accepts width-1 characters,
 * and ▶◀ have emoji variants whose width depends on the implementation, so they are not worth the risk.
 */
export function drawEdges(v: ArchView, s: number, p: Palette, ox: number, oy: number, cols: number, rows: number, selected?: string) {
  const c = new Canvas(cols, rows)
  // A cell is 2×4 dots: px → dots scales by 2s both horizontally and vertically.
  const k = 2 * s
  const lit = (e: ArchEdge) => !!selected && (e.source === selected || e.target === selected)
  for (const e of [...v.edges].sort((a, b) => Number(lit(a)) - Number(lit(b)))) {
    const color = lit(e) ? p.accent : p.muted
    const pts = bezier(e.points).map(([x, y]) => [x * k - ox * 2, y * k - oy * 4] as [number, number])
    for (let i = 1; i < pts.length; i++) c.line(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], color)
    const end = pts.at(-1)!, prev = pts.at(-3) ?? pts[0]!
    const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1
    const ux = (end[0] - prev[0]) / len, uy = (end[1] - prev[1]) / len
    // Arrowhead wings: back 4 dots, spreading 3 dots to each side.
    for (const side of [1, -1]) c.line(end[0], end[1], end[0] - ux * 4 - uy * 3 * side, end[1] - uy * 4 + ux * 3 * side, color)
  }
  return c.encode()
}

/** A node's incoming and outgoing relations, for the detail row. */
export function relationsOf(v: ArchView, id: string) {
  const title = (nid: string) => v.nodes.find(n => n.id === nid)?.title ?? nid
  return {
    out: v.edges.filter(e => e.source === id).map(e => ({ to: title(e.target), label: e.label })),
    in: v.edges.filter(e => e.target === id).map(e => ({ from: title(e.source), label: e.label })),
  }
}
