import type { ClientModule } from 'claude-code'

import type { Palette, Skin } from '../types'

import { formatDuration, mix } from './palette'

// A "currently running" row: a shimmer sweeps left to right and the timer on the right ticks every second. Used for the running Exec command and the current checklist item.
// Timing runs on the surface side, so no per-frame round trip to the hooks; power-saving spec of one frame per 100ms.

export type ShimmerProps = {
  text: string
  palette: Palette
  skin: Skin
  /** Milliseconds already elapsed at render time; a local tick counts up from there. */
  elapsedMs: number
  /** Shown after the timer on the right; empty string hides it. */
  suffix?: string
  width: number
  /** UI language from the hooks side (client modules cannot import ./i18n). Every fixed string here is ASCII and the same in both languages. */
  lang?: 'en' | 'zh'
}

type State = { ticks: number }

const TICK_MS = 100
const BARS = ['▁', '▃', '▅', '▇', '▅', '▃']
const RADIUS = 4

const Shimmer: ClientModule<ShimmerProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const p = props.palette
  if (surface.state === undefined) {
    surface.setState({ ticks: 0 })
    surface.every(TICK_MS, () => surface.setState({ ticks: (surface.state?.ticks ?? 0) + 1 }))
  }
  const ticks = surface.state?.ticks ?? 0
  // Animation and text style are shared by every skin (user decision, 2026-10-06); the skin only picks colors.
  const glyph = BARS[ticks % BARS.length]
  const elapsed = props.elapsedMs + ticks * TICK_MS
  const timer = `${formatDuration(elapsed)}${props.suffix ? ` ${props.suffix}` : ''}`
  const room = Math.max(4, props.width - timer.length - 4)
  const chars = [...props.text].slice(0, room)
  const span = chars.length + RADIUS * 4
  const center = ((ticks * 0.8) % span) - RADIUS * 2
  const glow = (i: number) => Math.max(0, 1 - Math.abs(i - center) / RADIUS)
  // The whole row sits in one Text with nested Texts for color: with one Box child per character, the layout engine
  // pushes two-cell-wide CJK characters onto the next line or drops them.
  return (
    <Box flexDirection="row" width={props.width}>
      <Text color={p.accent} bold>{`${glyph} `}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          {chars.map((ch, i) => (
            <Text color={mix(p.base, p.hi, glow(i))} bold={glow(i) > 0.5}>{ch}</Text>
          ))}
        </Text>
      </Box>
      <Text color={p.accent}>{` ${timer}`}</Text>
    </Box>
  )
}

export default Shimmer
