// Vim keys for the FILES tree and the CHANGES list. Pure: each function changes the view state it is given and returns what the
// caller must do that needs the engine (scroll a preview, open or close a folder, hold FILES' follow mode).

import type { FileEntry } from './model'
import type { UiState } from './views'

export type VimKey = 'h' | 'j' | 'k' | 'l' | 'enter' | 'top' | 'bottom' | 'pagedown' | 'pageup'
export type VimEffect = { vpan?: [string, number]; toggle?: string; manual?: boolean }
export type TreeRowLite = { path: string; dir: boolean; open: boolean; depth: number }

type TreeUi = Pick<UiState, 'treeCur' | 'treeSel' | 'treeFocus' | 'keepCursor' | 'scroll' | 'hx'>
type FilesUi = Pick<UiState, 'selFile' | 'fullFile' | 'filesFocus' | 'keepCursor' | 'scroll' | 'hx'>

/** How far a half page moves, in rows. */
const PAGE = 10

function cursorTo(ui: TreeUi, row: TreeRowLite): VimEffect {
  ui.treeCur = row.path
  ui.keepCursor = true
  if (!row.dir) {
    ui.treeSel = row.path
    ui.scroll['project:detail'] = 0
    ui.hx['project:detail'] = 0
  }
  return { manual: true }
}

/** The tree: the cursor walks the rows, l and Enter go in, h goes out. In the preview j and k scroll and h comes back. */
export function treeVim(key: VimKey, rows: readonly TreeRowLite[], ui: TreeUi): VimEffect | undefined {
  if (ui.treeFocus === 'preview') {
    if (key === 'h') ui.treeFocus = 'tree'
    else if (key === 'j' || key === 'k') return { vpan: ['project:detail', key === 'j' ? 3 : -3] }
    else if (key === 'pagedown' || key === 'pageup') return { vpan: ['project:detail', key === 'pagedown' ? PAGE : -PAGE] }
    else if (key === 'top') return { vpan: ['project:detail', -1e6] }
    else if (key === 'bottom') return { vpan: ['project:detail', 1e6] }
    return undefined
  }
  if (!rows.length) return undefined
  const here = ui.treeCur ?? ui.treeSel
  const idx = Math.max(0, rows.findIndex(r => r.path === here))
  const row = rows[idx]!
  const at = (i: number) => rows[Math.min(rows.length - 1, Math.max(0, i))]!
  if (key === 'j' || key === 'k') return cursorTo(ui, at(idx + (key === 'j' ? 1 : -1)))
  if (key === 'pagedown' || key === 'pageup') return cursorTo(ui, at(idx + (key === 'pagedown' ? PAGE : -PAGE)))
  if (key === 'top') return cursorTo(ui, at(0))
  if (key === 'bottom') return cursorTo(ui, at(rows.length - 1))
  if (key === 'l' || key === 'enter') {
    if (!row.dir) {
      const effect = cursorTo(ui, row)
      ui.treeFocus = 'preview'
      return effect
    }
    if (!row.open) return { toggle: row.path }
    if (key === 'l' && rows[idx + 1] && rows[idx + 1]!.depth > row.depth) return cursorTo(ui, rows[idx + 1]!)
    return key === 'enter' ? { toggle: row.path } : undefined
  }
  if (key === 'h') {
    if (row.dir && row.open) return { toggle: row.path }
    const parent = [...rows.slice(0, idx)].reverse().find(r => r.dir && r.depth < row.depth)
    if (parent) return cursorTo(ui, parent)
  }
  return undefined
}

/** The CHANGES list: the same keys on the list of files the session touched. */
export function filesVim(key: VimKey, list: readonly FileEntry[], ui: FilesUi): VimEffect | undefined {
  if (ui.filesFocus === 'preview') {
    if (key === 'h') ui.filesFocus = 'list'
    else if (key === 'j' || key === 'k') return { vpan: ['files:detail', key === 'j' ? 3 : -3] }
    else if (key === 'pagedown' || key === 'pageup') return { vpan: ['files:detail', key === 'pagedown' ? PAGE : -PAGE] }
    else if (key === 'top') return { vpan: ['files:detail', -1e6] }
    else if (key === 'bottom') return { vpan: ['files:detail', 1e6] }
    return undefined
  }
  if (!list.length) return undefined
  const idx = Math.max(0, list.findIndex(f => f.path === ui.selFile))
  const pick = (i: number) => {
    ui.selFile = list[Math.min(list.length - 1, Math.max(0, i))]!.path
    ui.fullFile = false
    ui.hx['files:detail'] = 0
    ui.scroll['files:detail'] = 0
    ui.keepCursor = true
  }
  if (key === 'j' || key === 'k') pick(idx + (key === 'j' ? 1 : -1))
  else if (key === 'pagedown' || key === 'pageup') pick(idx + (key === 'pagedown' ? PAGE : -PAGE))
  else if (key === 'top') pick(0)
  else if (key === 'bottom') pick(list.length - 1)
  else if (key === 'l' || key === 'enter') ui.filesFocus = 'preview'
  return undefined
}
