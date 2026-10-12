// Changes to the dashboard's view state that clicks, the wheel and FILES' follow mode make. Pure: each function changes the
// view state it is given, or returns what the caller must change in state only register.tsx holds (the layout, the last panel used).

import { compute, isShown, type LayoutNode, type Panel } from './layout'
import { changesList, type Session } from './model'
import { DIVIDER, splitWidths, treeRows, type UiState, type ViewCtx, WIDE } from './views'

type Project = NonNullable<ViewCtx['project']>

/** Cells in the new layout whose tab set exactly matches a cell in the old one keep the old active tab. */
export function keepActive(next: LayoutNode, prev: LayoutNode): LayoutNode {
  const actives = new Map<string, number | undefined>()
  const collect = (n: LayoutNode) => ('tabs' in n ? actives.set(n.tabs.join(','), n.active) : n.children.forEach(collect))
  collect(prev)
  const walk = (n: LayoutNode): LayoutNode =>
    'tabs' in n ? (actives.get(n.tabs.join(',')) !== undefined ? { ...n, active: actives.get(n.tabs.join(',')) } : n) : { ...n, children: n.children.map(walk) }
  return walk(next)
}

/** The panel a scroll key belongs to: 'files:detail' → files. */
export const panelOf = (key: string) => key.split(':')[0] as Panel

/**
 * Pointer position in the pane → which region to scroll. Files/Exec have two regions side by side (or stacked): list and detail scroll
 * independently. Without a pointer (keyboard scrolling) it is the card clicked last.
 */
export function scrollKeyAt(
  shown: LayoutNode, size: { w: number; h: number }, pointer: { column: number; row: number } | undefined, lastPanel: Panel, splitRatio: Record<string, number>,
): string | undefined {
  const cells = compute(shown, { x: 0, y: 0, w: size.w, h: size.h }).cells
  const cell = pointer
    ? cells.find(c => pointer.column >= c.rect.x && pointer.column < c.rect.x + c.rect.w && pointer.row >= c.rect.y && pointer.row < c.rect.y + c.rect.h)
    : cells.find(c => c.leaf.tabs[c.leaf.active ?? 0] === lastPanel)
  if (!cell) return undefined
  const panel = cell.leaf.tabs[cell.leaf.active ?? 0]!
  if (panel !== 'files' && panel !== 'exec' && panel !== 'project') return panel === 'status' || panel === 'map' ? undefined : panel
  if (!pointer) return panel
  const innerW = cell.rect.w - 4
  if (innerW >= WIDE) return pointer.column - cell.rect.x - 2 < splitWidths(innerW, splitRatio[panel] ?? (panel === 'exec' ? 0.5 : 0.38)).left + DIVIDER ? panel : `${panel}:detail`
  return pointer.row - cell.rect.y - 2 < (cell.rect.h - 3) * 0.45 ? panel : `${panel}:detail`
}

/** Move a scroll or pan position by d, kept within 0..max. For output (Exec detail, Log) pass a flipped d: up shows older content. */
export function nudge(at: Record<string, number>, key: string, d: number, max: number) {
  at[key] = Math.min(max, Math.max(0, (at[key] ?? 0) + d))
}

/** Exec detail is output, so scrolling up shows older content; everywhere else scrolling down shows more. */
export const scrollSign = (key: string) => (key === 'exec:detail' ? -1 : 1)

// Panels that use the o key: in zen, the current cell gets it; otherwise the most recently used panel that is visible; failing that, the first visible in this order.
const O_PANELS: Panel[] = ['files', 'project', 'arch']
export function oOwner(zen: Panel | undefined, lastPanel: Panel, shown: LayoutNode): Panel {
  if (zen && O_PANELS.includes(zen)) return zen
  if (O_PANELS.includes(lastPanel) && isShown(shown, lastPanel)) return lastPanel
  return O_PANELS.find(t => isShown(shown, t)) ?? 'files'
}

/**
 * Jump FILES to this file: expand its folders, select it and scroll it into view. Returns the project (with the file added if it
 * is new), whether the layout should switch its cell to FILES (not in zen) and whether FILES becomes the last panel used
 * (not while zen shows another panel); undefined when follow mode is off or there is nothing to do.
 */
export function followFile(ui: UiState, project: Project, abs: string, projectShown: boolean): { project: Project; focus: boolean; last: boolean } | undefined {
  if (!ui.follow || !abs.startsWith(`${project.root}/`)) return undefined
  const rel = abs.slice(project.root.length + 1)
  if (ui.treeSel === rel && projectShown) return undefined
  // A new file isn't in the list yet: add it now; the next rescan picks it up for real.
  const next = project.paths.includes(rel) ? project : { ...project, paths: [...project.paths, rel] }
  const parts = rel.split('/')
  for (let i = 1; i < parts.length; i++) ui.treeOpen[parts.slice(0, i).join('/')] = true
  ui.treeSel = rel
  ui.scroll['project:detail'] = 0
  const idx = treeRows(next.paths, ui.treeOpen).findIndex(r => r.path === rel)
  ui.scroll.project = Math.max(0, idx - 3)
  return { project: next, focus: !ui.zen, last: !ui.zen || ui.zen === 'project' }
}

/** Open or close a FILES folder. A folder holding changed files (in `hot`) is open without being in treeOpen; closing it is remembered in treeShut. */
export function toggleDir(ui: Pick<UiState, 'treeOpen' | 'treeShut'>, dir: string, hot: ReadonlyMap<string, number>) {
  const isOpen = !!ui.treeOpen[dir] || (hot.has(dir) && !ui.treeShut[dir])
  if (isOpen) { delete ui.treeOpen[dir]; ui.treeShut[dir] = true }
  else { delete ui.treeShut[dir]; ui.treeOpen[dir] = true }
}

/** FILES shows another folder (undefined: the session's own): nothing open, nothing selected. */
export function resetTree(ui: UiState, root: string | undefined) {
  ui.treeRoot = root
  ui.treeOpen = {}; ui.treeShut = {}; ui.treeSel = undefined; ui.treeCur = undefined
}

/** Select a file in the FILES tree and show its preview from the top-left. */
export function selectTreeFile(ui: UiState, path: string) {
  ui.treeSel = path
  ui.scroll['project:detail'] = 0
  ui.hx['project:detail'] = 0
}

/** Select a file in CHANGES, showing its diff rather than the whole file. */
export function selectFile(ui: UiState, path: string) {
  ui.selFile = path
  ui.fullFile = false
  ui.hx['files:detail'] = 0
}

/** Show a TODO item's steps, none of them opened. */
export function selectTodo(ui: UiState, key: string) {
  ui.selTodo = key
  ui.selStep = undefined
  ui.scroll['todo:detail'] = 0
}

/** Opening an ORCH card also narrows CHANGES to that agent's files and selects the newest of them; closing it lifts the filter. */
export function toggleAgent(ui: UiState, s: Session, id: string) {
  ui.selAgent = ui.selAgent === id ? undefined : id
  ui.filesBy = ui.selAgent
  if (!ui.selAgent) return
  const newest = changesList(s, { showReads: ui.showReads, by: ui.selAgent })[0]
  if (newest) { selectFile(ui, newest.path); ui.scroll['files:detail'] = 0 }
}

/** Open the MAP message box for an agent next to the marker clicked (`at`); the same click again closes it. */
export function toggleMsg(ui: UiState, to: string, at: string | undefined) {
  const closing = ui.msgTo === to && ui.msgAt === at
  ui.msgTo = closing ? undefined : to
  ui.msgAt = closing ? undefined : at
}
