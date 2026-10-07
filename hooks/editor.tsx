import type { ClientModule } from 'claude-code'

import type { Palette } from '../types'

import { compute, type LayoutNode, movePanel, type Panel, type Rect, rectOfPath, resize, type Seam, zoneOf } from './layout'

// Layout editor: draws the whole dashboard as wireframes; drag a border to resize, drag a title to move a panel.
// Only a Client receives mouse drags, so it is used just while editing; on mouse release the new layout is posted to the hooks to save.

export type EditorProps = {
  layout: LayoutNode
  width: number
  height: number
  palette: Palette
  labels: Record<Panel, string>
  /** UI language from the hooks side (client modules cannot import ./i18n). Every fixed string here is ASCII and the same in both languages. */
  lang?: 'en' | 'zh'
}

type Drag =
  | { kind: 'seam'; seam: Seam; parent: Rect }
  | { kind: 'panel'; panel: Panel; x: number; y: number }

type State = { layout: LayoutNode; drag?: Drag; hover?: { x: number; y: number } }

/** Merge consecutive same-color characters into one run, cutting elements from one per cell to one per run. */
const runs = (row: { ch: string; color: string }[]) => {
  const out: { text: string; color: string }[] = []
  for (const c of row) {
    const last = out[out.length - 1]
    if (last && last.color === c.color) last.text += c.ch
    else out.push({ text: c.ch, color: c.color })
  }
  return out
}

const Editor: ClientModule<EditorProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const p = props.palette
  if (surface.state === undefined) surface.setState({ layout: props.layout })
  const st = surface.state ?? { layout: props.layout }
  const full: Rect = { x: 0, y: 0, w: props.width, h: props.height }
  const { cells, seams } = compute(st.layout, full)

  const seamAt = (x: number, y: number) =>
    seams.find(s => (s.dir === 'row' ? Math.abs(x - s.pos) <= 1 && y >= s.rect.y && y < s.rect.y + s.rect.h : Math.abs(y - s.pos) <= 0 && x >= s.rect.x && x < s.rect.x + s.rect.w))
  const cellAt = (x: number, y: number) => cells.find(c => x >= c.rect.x && x < c.rect.x + c.rect.w && y >= c.rect.y && y < c.rect.y + c.rect.h)

  surface.onPointer(e => {
    const cur = surface.state ?? st
    if (e.type === 'down' && e.button === 'left') {
      const seam = seamAt(e.x, e.y)
      if (seam) {
        surface.setState({ ...cur, drag: { kind: 'seam', seam, parent: rectOfPath(cur.layout, seam.path, full) } })
        return
      }
      const cell = cellAt(e.x, e.y)
      if (cell) {
        // Move the tab whose name was pressed, otherwise the one currently shown.
        let off = cell.rect.x + 2
        let panel = cell.leaf.tabs[cell.leaf.active ?? 0]!
        for (const t of cell.leaf.tabs) {
          const len = props.labels[t].length + 3
          if (e.y === cell.rect.y + 1 && e.x >= off && e.x < off + len) panel = t
          off += len
        }
        surface.setState({ ...cur, drag: { kind: 'panel', panel, x: e.x, y: e.y } })
      }
      return
    }
    if (e.type === 'move') {
      if (cur.drag?.kind === 'seam') {
        const pos = cur.drag.seam.dir === 'row' ? e.x : e.y
        surface.setState({ ...cur, layout: resize(cur.layout, cur.drag.seam, pos, cur.drag.parent), drag: { ...cur.drag, seam: { ...cur.drag.seam, pos } } })
      } else if (cur.drag?.kind === 'panel') surface.setState({ ...cur, drag: { ...cur.drag, x: e.x, y: e.y } })
      else surface.setState({ ...cur, hover: { x: e.x, y: e.y } })
      return
    }
    if (e.type === 'up' && cur.drag) {
      let layout = cur.layout
      if (cur.drag.kind === 'panel') {
        const target = cellAt(e.x, e.y)
        if (target) layout = movePanel(layout, cur.drag.panel, target.path, zoneOf(target.rect, e.x, e.y))
      }
      surface.setState({ layout })
      surface.post({ layout: layout as never })
    }
  })

  // Draw the wireframes: one box per cell with the panel names inside; highlight the drag target cell and drop zone.
  const grid: { ch: string; color: string }[][] = Array.from({ length: props.height }, () =>
    Array.from({ length: props.width }, () => ({ ch: ' ', color: p.faint })))
  const put = (x: number, y: number, ch: string, color: string) => {
    if (y >= 0 && y < props.height && x >= 0 && x < props.width) grid[y]![x] = { ch, color }
  }
  const drag = st.drag
  const dropCell = drag?.kind === 'panel' ? cellAt(drag.x, drag.y) : undefined
  const zone = dropCell && drag?.kind === 'panel' ? zoneOf(dropCell.rect, drag.x, drag.y) : undefined
  for (const c of cells) {
    const { x, y, w, h: tall } = c.rect
    const isDrop = dropCell === c
    const col = isDrop ? p.accent : p.muted
    for (let i = 1; i < w - 1; i++) { put(x + i, y, '─', col); put(x + i, y + tall - 1, '─', col) }
    for (let j = 1; j < tall - 1; j++) { put(x, y + j, '│', col); put(x + w - 1, y + j, '│', col) }
    put(x, y, '╭', col); put(x + w - 1, y, '╮', col); put(x, y + tall - 1, '╰', col); put(x + w - 1, y + tall - 1, '╯', col)
    let off = x + 2
    c.leaf.tabs.forEach((t, k) => {
      const label = `[${props.labels[t]}]`
      const color = k === (c.leaf.active ?? 0) ? p.hi : p.base
      ;[...label].forEach((ch, i) => put(off + i, y + 1, ch, drag?.kind === 'panel' && drag.panel === t ? p.accent : color))
      off += label.length + 1
    })
    const size = `${w}×${tall}`
    ;[...size].forEach((ch, i) => put(x + w - 2 - size.length + i, y + tall - 2, ch, p.faint))
    if (isDrop && zone) {
      // The wireframe is a one-char-per-cell array and a two-cell CJK char would skew the row, so the hint is in English.
      const hint = zone === 'center' ? '[ drop: stack as tab ]' : `[ drop: split ${zone} ]`
      const hy = y + Math.floor(tall / 2)
      ;[...hint].forEach((ch, i) => put(x + Math.max(2, Math.floor((w - hint.length) / 2)) + i, hy, ch, p.accent))
    }
  }
  for (const s of seams) {
    if (drag?.kind === 'seam' && drag.seam.path.join() === s.path.join() && drag.seam.index === s.index) {
      if (s.dir === 'row') for (let j = s.rect.y; j < s.rect.y + s.rect.h; j++) put(s.pos, j, '┃', p.accent)
      else for (let i = s.rect.x; i < s.rect.x + s.rect.w; i++) put(i, s.pos, '━', p.accent)
    }
  }
  return (
    <Box flexDirection="column" width={props.width} height={props.height}>
      {grid.map((row, y) => (
        <Text key={`r${y}`} wrap="truncate-end">
          {runs(row).map(r => <Text color={r.color}>{r.text}</Text>)}
        </Text>
      ))}
    </Box>
  )
}

export default Editor
