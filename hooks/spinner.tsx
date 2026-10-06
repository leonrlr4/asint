import type { ClientModule } from 'claude-code'

import type { Palette, Skin } from '../types'

import { formatDuration, mix } from './palette'

export type SpinnerProps = {
  text: string
  mode: string
  palette: Palette
  skin: Skin
  /** Milliseconds already elapsed at render time; a local tick counts up from there, so no per-frame round trip to the hooks. */
  elapsedMs: number
  /** UI language from the hooks side (client modules cannot import ./i18n). Every fixed string here is ASCII and the same in both languages. */
  lang?: 'en' | 'zh'
}

type State = { ticks: number; elapsedAtMount: number }

// One frame per 50ms (20fps): smooth shimmer without raising the terminal's redraw cost.
const TICK_MS = 50
const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂']
// "Decode" effect: characters under the glow flash as hex noise, then resolve back.
const NOISE = '0123456789ABCDEF#$%&*<>/\\|'
// The shimmer moves 0.6 chars per frame with a 3-char glow radius; 8 blank cells on each side let it slide in and out.
const SPEED = 0.6
const RADIUS = 3
const PAD = 8

// The engine's spinner modes; any other (future) value is not shown.
const MODES = new Set(['thinking', 'requesting', 'responding', 'tool-input', 'tool-use'])

/** Fixed pseudo-random: the same cell and frame always shows the same noise char, so the display does not jitter. */
const noise = (i: number, t: number) => NOISE[(i * 7 + Math.floor(t / 2) * 13) % NOISE.length]!

const Spinner: ClientModule<SpinnerProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { palette: p } = props

  if (surface.state === undefined) {
    surface.setState({ ticks: 0, elapsedAtMount: props.elapsedMs })
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (s) surface.setState({ ...s, ticks: s.ticks + 1 })
    })
  }
  const { ticks, elapsedAtMount } = surface.state ?? { ticks: 0, elapsedAtMount: props.elapsedMs }

  const chars = [...props.text]
  const span = chars.length + PAD * 2
  const center = ((ticks * SPEED) % span) - PAD
  const glow = (i: number) => {
    const d = Math.abs(i - center)
    if (d >= RADIUS) return 0
    return (Math.cos((d / RADIUS) * Math.PI) + 1) / 2
  }

  const breath = (Math.sin((ticks * TICK_MS * 2 * Math.PI) / 1600) + 1) / 2
  const elapsed = Math.max(props.elapsedMs, elapsedAtMount + ticks * TICK_MS)
  // Animation and text style are shared by every skin (user decision, 2026-10-06); the skin only picks colors.
  const glyph = BARS[ticks % BARS.length]

  return (
    <Box flexDirection="row">
      <Text color={mix(p.accent, p.base, breath * 0.5)}>{`[${glyph}] `}</Text>
      {chars.map((ch, i) => {
        const g = glow(i)
        // CJK characters are two cells wide; swapping one for one-cell noise would shift the rest left, so only ASCII is scrambled.
        const scramble = g > 0.55 && ch.charCodeAt(0) < 128 && ch !== ' '
        return <Text color={mix(p.base, p.hi, g)}>{scramble ? noise(i, ticks) : ch}</Text>
      })}
      <Text color={p.muted}>
        {`  T+${formatDuration(elapsed)}${MODES.has(props.mode) ? ` :: ${props.mode.toUpperCase()}` : ''}`}
      </Text>
    </Box>
  )
}

export default Spinner
