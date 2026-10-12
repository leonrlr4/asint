import type { ClientElements, ClientModule, RenderElement } from 'claude-code'

import type { Palette } from '../types'

import { mix } from './palette'

// One row of the FILES tree, drawn on the surface side so the name itself can carry the color and the motion (a Button's
// label cannot be colored): a changed file's name takes its status color, the file being edited right now has a light sweeping
// through its name. A click is posted to the hooks as { pick }, the same way the running EXEC row does it.

export type TreeRowProps = {
  palette: Palette
  width: number
  depth: number
  dir: boolean
  open: boolean
  name: string
  /** Two-letter file type and the palette slot it is drawn in; empty for a folder. */
  badge: string
  badgeTone: Tone
  /** The status chip text ("edited", "committed"…) and the tone it and the name take; empty when the file is untouched. */
  chip: string
  /** Empty when the file is untouched (props cannot hold undefined). */
  tone: Tone | ''
  editing: boolean
  /** Last touch time ("03:31:54") or empty. */
  time: string
  /** Changed files inside a folder; 0 for files and quiet folders. */
  count: number
  selected: boolean
  /** What a click reports to the hooks as { pick }. */
  pick: string
}

export type Tone = 'accent' | 'success' | 'warn' | 'error' | 'muted' | 'faint'

type State = { ticks: number }

const TICK_MS = 100
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const RADIUS = 3

type RowEl = ClientElements

/** Draws one row. Shared by the single-row client below and by the whole-tree client (filetree.tsx). */
export function rowView(el: RowEl, props: TreeRowProps, ticks: number): RenderElement {
  const { Box, Text } = el
  const p = props.palette
  const color = (t: Tone | '' | undefined) => (t === 'accent' ? p.accent : t === 'success' ? p.success : t === 'warn' ? p.warn : t === 'error' ? p.error : t === 'muted' ? p.muted : t === 'faint' ? p.faint : undefined)
  const nameColor = props.dir ? (props.count ? p.accent : p.muted) : color(props.tone) ?? (props.selected ? p.hi : p.base)
  const bg = props.selected ? p.surface : props.editing ? mix(p.bg, p.accent, 0.14) : undefined
  const label = props.dir ? `${props.name}/` : props.name
  const chars = [...label]
  const span = chars.length + RADIUS * 4
  const center = ((ticks * 0.9) % span) - RADIUS * 2
  const glow = (i: number) => (props.editing ? Math.max(0, 1 - Math.abs(i - center) / RADIUS) : 0)
  const indent = '  '.repeat(props.depth)
  const mark = props.dir ? `${props.open ? '▾' : '▸'} ` : `${props.badge} `
  const spin = props.editing ? `${SPIN[ticks % SPIN.length]} ` : ''
  const count = props.count ? ` ${props.count}` : ''
  return (
    <Box flexDirection="row" width={props.width} backgroundColor={bg}>
      <Text>{indent}</Text>
      <Text color={props.dir ? (props.count ? p.accent : p.faint) : color(props.badgeTone)} bold={!props.dir}>{mark}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          {chars.map((ch, i) => (
            <Text color={props.editing ? mix(nameColor, p.hi, glow(i)) : nameColor} bold={props.editing || props.selected || props.tone === 'success' || glow(i) > 0.5}>{ch}</Text>
          ))}
        </Text>
      </Box>
      {count ? <Text color={p.accent}>{count}</Text> : null}
      {props.chip ? <Text color={color(props.tone)} bold={props.editing}>{` ${spin}${props.chip}`}</Text> : null}
      {props.time ? <Text color={p.faint}>{` ${props.time}`}</Text> : null}
    </Box>
  )
}

const TreeRow: ClientModule<TreeRowProps, State> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ ticks: 0 })
    // Only the row being edited moves; every other row is drawn once.
    if (props.editing) surface.every(TICK_MS, () => surface.setState({ ticks: (surface.state?.ticks ?? 0) + 1 }))
  }
  surface.onPointer(e => {
    if (e.type === 'down' && e.button === 'left') surface.post({ pick: props.pick })
  })
  return rowView(surface.elements, props, props.editing ? surface.state?.ticks ?? 0 : 0)
}

export default TreeRow
