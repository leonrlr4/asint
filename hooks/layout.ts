// Dashboard layout: a nested split tree like tmux/i3, stored in ~/.config/asint/layout.json; edit it by hand or drag in edit mode.
// Pure data and computation; never touches $.

// files is the files this session touched (shown as CHANGES); project is the whole project's file tree (shown as FILES).
// The ids are not renamed so old layout.json files still load.
export type Panel = 'status' | 'todo' | 'exec' | 'files' | 'project' | 'arch' | 'map' | 'media' | 'log'
export const PANELS: Panel[] = ['status', 'todo', 'exec', 'files', 'project', 'arch', 'map', 'media', 'log']

/** Leaf: one cell can stack several panels (as tabs); active is the one shown. */
export type Leaf = { tabs: Panel[]; active?: number }
/** Split: row lays out left to right, col top to bottom; sizes are the children's ratios (summing to 1); fixed are children with a fixed line count (col only). */
export type Split = { split: 'row' | 'col'; sizes: number[]; children: LayoutNode[]; fixed?: (number | null)[] }
export type LayoutNode = Leaf | Split

export const isLeaf = (n: LayoutNode): n is Leaf => 'tabs' in n

/**
 * Default: a status bar across the top; the left column (35%) is work progress (plan → exec → files), the right column is for viewing:
 * Arch/Map tabs in the large cell on top, Media/Log tabs below.
 */
export const DEFAULT_LAYOUT: LayoutNode = {
  split: 'col',
  sizes: [0, 1],
  fixed: [4, null],
  children: [
    { tabs: ['status'] },
    {
      split: 'row',
      sizes: [0.35, 0.65],
      children: [
        { split: 'col', sizes: [0.3, 0.35, 0.35], children: [{ tabs: ['todo'] }, { tabs: ['exec'] }, { tabs: ['files', 'project'], active: 0 }] },
        { split: 'col', sizes: [0.65, 0.35], children: [{ tabs: ['arch', 'map'], active: 0 }, { tabs: ['media', 'log'], active: 0 }] },
      ],
    },
  ],
}

export type Rect = { x: number; y: number; w: number; h: number }
export type Path = number[]
export type Cell = { path: Path; leaf: Leaf; rect: Rect }
/** The border between two adjacent children: dragging it changes the ratio. */
export type Seam = { path: Path; index: number; dir: 'row' | 'col'; pos: number; rect: Rect }

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** Splits space among children by ratio: fixed-line children first, the rest by sizes, with the last absorbing rounding error. */
function divide(total: number, node: Split) {
  const fixed = node.fixed ?? []
  const fixedSum = node.children.reduce((n, _, i) => n + (fixed[i] ?? 0), 0)
  const flexTotal = node.children.reduce((n, _, i) => n + (fixed[i] == null ? node.sizes[i] ?? 0 : 0), 0) || 1
  const room = Math.max(0, total - fixedSum)
  const out = node.children.map((_, i) => (fixed[i] != null ? fixed[i]! : Math.floor((room * (node.sizes[i] ?? 0)) / flexTotal)))
  const used = out.reduce((a, b) => a + b, 0)
  const lastFlex = [...node.children.keys()].reverse().find(i => fixed[i] == null)
  if (lastFlex !== undefined) out[lastFlex] = out[lastFlex]! + (total - used)
  return out
}

/** Computes every cell's position and every border; the screen and the editor share this computation. */
export function compute(root: LayoutNode, rect: Rect) {
  const cells: Cell[] = []
  const seams: Seam[] = []
  const walk = (node: LayoutNode, r: Rect, path: Path) => {
    if (isLeaf(node)) {
      cells.push({ path, leaf: node, rect: r })
      return
    }
    const along = node.split === 'row' ? r.w : r.h
    const parts = divide(along, node)
    let off = 0
    node.children.forEach((child, i) => {
      const len = parts[i]!
      const cr = node.split === 'row' ? { x: r.x + off, y: r.y, w: len, h: r.h } : { x: r.x, y: r.y + off, w: r.w, h: len }
      walk(child, cr, [...path, i])
      off += len
      if (i < node.children.length - 1) {
        seams.push({
          path, index: i, dir: node.split,
          pos: node.split === 'row' ? r.x + off : r.y + off,
          rect: node.split === 'row' ? { x: r.x + off, y: r.y, w: 1, h: r.h } : { x: r.x, y: r.y + off, w: r.w, h: 1 },
        })
      }
    })
  }
  walk(root, rect, [])
  return { cells, seams }
}

/** The rectangle of the node at path (the editor needs the parent's bounds while dragging a border). */
export function rectOfPath(root: LayoutNode, path: Path, full: Rect): Rect {
  let r = full
  let node = root
  for (const i of path) {
    if (isLeaf(node)) break
    const parts = divide(node.split === 'row' ? r.w : r.h, node)
    const off = parts.slice(0, i).reduce((a, b) => a + b, 0)
    r = node.split === 'row' ? { x: r.x + off, y: r.y, w: parts[i]!, h: r.h } : { x: r.x, y: r.y + off, w: r.w, h: parts[i]! }
    node = node.children[i]!
  }
  return r
}

export const nodeAt = (root: LayoutNode, path: Path): LayoutNode => path.reduce<LayoutNode>((n, i) => (n as Split).children[i]!, root)

/** Border drag: moves the border between children index and index+1 to pos (in the parent's cells), leaving at least 3 cells on each side. */
export function resize(root: LayoutNode, seam: Seam, pos: number, parentRect: Rect): LayoutNode {
  const next = clone(root)
  const node = nodeAt(next, seam.path) as Split
  const along = node.split === 'row' ? parentRect.w : parentRect.h
  const start = node.split === 'row' ? parentRect.x : parentRect.y
  const parts = divide(along, node)
  const before = parts.slice(0, seam.index).reduce((a, b) => a + b, 0)
  const pair = parts[seam.index]! + parts[seam.index + 1]!
  const a = Math.max(3, Math.min(pair - 3, pos - start - before))
  const fixed = node.fixed ?? []
  if (fixed[seam.index] != null || fixed[seam.index + 1] != null) {
    // The fixed-line side takes the new line count.
    if (fixed[seam.index] != null) fixed[seam.index] = a
    else fixed[seam.index + 1] = pair - a
    node.fixed = fixed
    return next
  }
  const share = (node.sizes[seam.index] ?? 0) + (node.sizes[seam.index + 1] ?? 0)
  node.sizes[seam.index] = (share * a) / pair
  node.sizes[seam.index + 1] = share - node.sizes[seam.index]!
  return next
}

/** Removes a panel from the tree; an emptied leaf is removed entirely, and a split left with one child collapses. */
function removePanel(root: LayoutNode, panel: Panel): LayoutNode | undefined {
  if (isLeaf(root)) {
    const tabs = root.tabs.filter(t => t !== panel)
    if (!tabs.length) return undefined
    // Keep the other fields (movePanel's target-cell marker lives here).
    return { ...root, tabs, active: Math.min(root.active ?? 0, tabs.length - 1) }
  }
  const kept: { child: LayoutNode; size: number; fixed: number | null }[] = []
  root.children.forEach((c, i) => {
    const r = removePanel(c, panel)
    if (r) kept.push({ child: r, size: root.sizes[i] ?? 0, fixed: root.fixed?.[i] ?? null })
  })
  if (!kept.length) return undefined
  if (kept.length === 1) return kept[0]!.child
  const total = kept.reduce((n, k) => n + k.size, 0) || 1
  const out: Split = { split: root.split, sizes: kept.map(k => k.size / total), children: kept.map(k => k.child) }
  if (kept.some(k => k.fixed != null)) out.fixed = kept.map(k => k.fixed)
  return out
}

export type Zone = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** Decides the drop from the pointer position in the target cell: within 25% of an edge splits to that side, the middle stacks as a tab. */
export function zoneOf(rect: Rect, x: number, y: number): Zone {
  const fx = (x - rect.x) / Math.max(1, rect.w)
  const fy = (y - rect.y) / Math.max(1, rect.h)
  const edge = Math.min(fx, 1 - fx, fy, 1 - fy)
  if (edge > 0.25) return 'center'
  if (edge === fx) return 'left'
  if (edge === 1 - fx) return 'right'
  if (edge === fy) return 'top'
  return 'bottom'
}

/** Moves panel to zone of the target cell; moving onto itself does nothing. */
export function movePanel(root: LayoutNode, panel: Panel, target: Path, zone: Zone): LayoutNode {
  const tgt = nodeAt(root, target)
  if (!isLeaf(tgt)) return root
  if (tgt.tabs.length === 1 && tgt.tabs[0] === panel) return root
  // Mark the target leaf first: removing panel can shift paths, and the marker finds it again.
  const marked = clone(root)
  const mark = nodeAt(marked, target) as Leaf & { __target?: true }
  mark.__target = true
  const removed = removePanel(marked, panel) ?? { tabs: [] }
  const place = (n: LayoutNode): LayoutNode => {
    if (isLeaf(n)) {
      if (!(n as Leaf & { __target?: true }).__target) return n
      const leaf: Leaf = { tabs: n.tabs, active: n.active }
      if (zone === 'center') return { tabs: [...leaf.tabs, panel], active: leaf.tabs.length }
      const fresh: Leaf = { tabs: [panel] }
      const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
      const children = zone === 'left' || zone === 'top' ? [fresh, leaf] : [leaf, fresh]
      return { split: dir, sizes: [0.5, 0.5], children }
    }
    return { ...n, children: n.children.map(place) }
  }
  return place(removed)
}

/** Reads the config file: a bad format or missing panels fall back to the default, so every panel has a place. */
export function parseLayout(text: string | undefined): LayoutNode {
  if (!text) return clone(DEFAULT_LAYOUT)
  try {
    const node = JSON.parse(text) as LayoutNode
    const seen = new Set<Panel>()
    const ok = (n: LayoutNode): boolean => {
      if (isLeaf(n)) return Array.isArray(n.tabs) && n.tabs.length > 0 && n.tabs.every(t => PANELS.includes(t) && !seen.has(t) && (seen.add(t), true))
      return (n.split === 'row' || n.split === 'col') && Array.isArray(n.children) && n.children.length > 0 &&
        Array.isArray(n.sizes) && n.sizes.length === n.children.length && n.children.every(ok)
    }
    return ok(node) ? addMissing(node, seen) : clone(DEFAULT_LAYOUT)
  } catch {
    return clone(DEFAULT_LAYOUT)
  }
}

/** Panels added later (absent from old config files) stack onto the CHANGES cell, or the first non-status-bar cell if there is none. */
function addMissing(root: LayoutNode, seen: Set<Panel>): LayoutNode {
  const missing = PANELS.filter(t => !seen.has(t) && t !== 'status')
  if (!missing.length) return root
  let placed = false
  const walk = (n: LayoutNode, wants: (l: Leaf) => boolean): LayoutNode => {
    if (placed) return n
    if (isLeaf(n)) {
      if (!wants(n)) return n
      placed = true
      return { ...n, tabs: [...n.tabs, ...missing] }
    }
    return { ...n, children: n.children.map(c => walk(c, wants)) }
  }
  const first = walk(root, l => l.tabs.includes('files'))
  return placed ? first : walk(root, l => !l.tabs.includes('status'))
}

/** Whether a panel is the tab currently shown in its cell. */
export function isShown(root: LayoutNode, panel: Panel) {
  const walk = (n: LayoutNode): boolean =>
    isLeaf(n) ? n.tabs[n.active ?? 0] === panel : n.children.some(walk)
  return walk(root)
}

/** Makes a panel the current tab of its cell (on a shortcut key or when new content arrives). */
export function focusPanel(root: LayoutNode, panel: Panel): LayoutNode {
  const walk = (n: LayoutNode): LayoutNode =>
    isLeaf(n) ? (n.tabs.includes(panel) ? { ...n, active: n.tabs.indexOf(panel) } : n) : { ...n, children: n.children.map(walk) }
  return walk(root)
}
