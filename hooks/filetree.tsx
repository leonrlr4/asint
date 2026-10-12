import type { ClientModule } from 'claude-code'

import type { Palette } from '../types'

import { rowView, type TreeRowProps } from './treerow'

// The whole FILES tree as one client, so it can hold the keyboard once it is clicked: j k h l, Enter, gg G, Ctrl-d Ctrl-u and a
// search with / n N, the way a file explorer in vim behaves. The tree's state lives with the hooks; this module draws the visible
// rows, turns keys into plain words and posts them. A frame carries one post at most, so every key waits in a queue that is posted
// whole each time and trimmed when the hooks acknowledge it; nothing is lost when two keys land in one frame.

export type TreeKey = 'h' | 'j' | 'k' | 'l' | 'enter' | 'top' | 'bottom' | 'pagedown' | 'pageup' | 'next' | 'prev'

export type FileTreeProps = {
  palette: Palette
  width: number
  /** The rows in view, each drawn like a TreeRow; `pick` says what a click on it means. */
  rows: Omit<TreeRowProps, 'palette' | 'width'>[]
  /** The newest key number the hooks have handled for this instance (epoch tells instances apart); older keys leave the queue. */
  ack: { epoch: string; n: number }
  /** The search the hooks are showing a match for, drawn under the rows while it is being typed. */
  search: string
}

type State = { epoch: string; ticks: number; seq: number; queue: { n: number; key: TreeKey | string }[]; g: boolean; typing?: string }

const TICK_MS = 300

/** What a key means in the tree, or undefined for keys it does not use. */
export function keyWord(key: string, mods: { ctrl?: true; shift?: true }): TreeKey | undefined {
  if (mods.ctrl) return key === 'd' ? 'pagedown' : key === 'u' ? 'pageup' : undefined
  switch (key) {
    case 'j': case 'down': return 'j'
    case 'k': case 'up': return 'k'
    case 'h': case 'left': return 'h'
    case 'l': case 'right': return 'l'
    case 'return': return 'enter'
    case 'G': case 'end': return 'bottom'
    case 'home': return 'top'
    case 'pagedown': return 'pagedown'
    case 'pageup': return 'pageup'
    case 'n': return 'next'
    case 'N': return 'prev'
    default: return key === 'g' && mods.shift ? 'bottom' : undefined
  }
}

const FileTree: ClientModule<FileTreeProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const p = props.palette
  if (surface.state === undefined) {
    surface.setState({ epoch: Math.random().toString(36).slice(2, 10), ticks: 0, seq: 0, queue: [], g: false })
    surface.every(TICK_MS, () => surface.setState({ ...(surface.state as State), ticks: ((surface.state as State)?.ticks ?? 0) + 1 }))
  }
  const st: State = surface.state ?? { epoch: '', ticks: 0, seq: 0, queue: [], g: false }
  // Keys the hooks have handled leave the queue.
  const acked = (cur: State) => (props.ack.epoch === cur.epoch ? props.ack.n : 0)

  const push = (cur: State, word: string, extra: Partial<State> = {}) => {
    const n = cur.seq + 1
    const next: State = { ...cur, ...extra, seq: n, queue: [...cur.queue.filter(q => q.n > acked(cur)), { n, key: word }].slice(-30) }
    surface.setState(next)
    surface.post({ epoch: cur.epoch, keys: next.queue })
  }

  surface.onPointer(e => {
    if (e.type === 'down' && e.button === 'left') {
      const row = props.rows[e.y]
      if (row) surface.post({ pick: row.pick })
    }
  })

  surface.onKey(e => {
    const cur = (surface.state as State | undefined) ?? st
    // While a search is being typed every printable key goes to it; Enter hands it over, Backspace edits.
    if (cur.typing !== undefined) {
      if (e.key === 'return') push(cur, `search:${cur.typing}`, { typing: undefined })
      else if (e.key === 'backspace') surface.setState({ ...cur, typing: cur.typing.slice(0, -1) })
      else if (e.key.length === 1 && !e.ctrl && !e.meta) surface.setState({ ...cur, typing: cur.typing + e.key })
      return
    }
    if (e.key === '/' && !e.ctrl) { surface.setState({ ...cur, typing: '', g: false }); return }
    if (e.key === 'g' && !e.ctrl && !e.shift) {
      if (cur.g) push(cur, 'top', { g: false })
      else surface.setState({ ...cur, g: true })
      return
    }
    const word = keyWord(e.key, { ctrl: e.ctrl, shift: e.shift })
    if (word) push(cur, word, { g: false })
    else if (cur.g) surface.setState({ ...cur, g: false })
  })

  const ticks = st.ticks
  return (
    <Box flexDirection="column" width={props.width}>
      {props.rows.map((r, i) => (
        <Box key={`ft-${i}`}>{rowView(surface.elements, { ...r, palette: p, width: props.width }, ticks)}</Box>
      ))}
      {st.typing !== undefined ? <Text color={p.accent}>{`/${st.typing}▏`}</Text> : props.search ? <Text color={p.faint}>{`/${props.search}  n N`}</Text> : null}
    </Box>
  )
}

export default FileTree
