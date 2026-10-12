import type { ClientModule } from 'claude-code'

import type { Palette } from '../types'

// The draggable line between a card's list and its preview. Only a Client receives mouse drags: the pointer is held from
// the press to the release, so the moves keep coming when it leaves the 3 columns. Each move posts the column the left
// side should now end at; the hooks redraw the card, which moves this divider under the pointer, so the new position is
// always worked out from the props of the moment (props.left) plus how far the pointer is from where it grabbed.

export type DividerProps = {
  /** Panel the divider belongs to; the hooks keep one ratio per panel. */
  panel: string
  palette: Palette
  rows: number
  /** The left side's width now, and the width of the whole card body (left, divider and right). */
  left: number
  total: number
}

type State = { grab?: number; hover?: boolean }

const Divider: ClientModule<DividerProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const p = props.palette
  const st = surface.state ?? {}
  surface.onPointer(e => {
    const cur = surface.state ?? {}
    if (e.type === 'enter') surface.setState({ ...cur, hover: true })
    else if (e.type === 'leave') surface.setState({ ...cur, hover: false })
    else if (e.type === 'down' && e.button === 'left') surface.setState({ ...cur, grab: e.x })
    else if (e.type === 'move' && cur.grab !== undefined && e.button === 'left') {
      surface.post({ split: { panel: props.panel, left: props.left + (e.x - cur.grab), total: props.total, final: false } })
    } else if (e.type === 'up') {
      if (cur.grab !== undefined) surface.post({ split: { panel: props.panel, left: props.left + (e.x - cur.grab), total: props.total, final: true } })
      surface.setState({ ...cur, grab: undefined })
    }
  })
  const lit = st.grab !== undefined || st.hover
  const line = Array.from({ length: Math.max(1, props.rows) }, () => ` ${lit ? '┃' : '│'} `).join('\n')

  return (
    <Box width={3} flexShrink={0}>
      <Text color={lit ? p.accent : p.faint}>{line}</Text>
    </Box>
  )
}

export default Divider
