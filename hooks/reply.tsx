import type { ClientModule, JsonValue } from 'claude-code'

import type { Palette } from '../types'

import { renderMarkdown } from './markdown'

// A reply is laid out on the terminal side: only here is the width the block was really given known (the docked pane and the scrollbar
// already taken off), so breaking lines ourselves cannot overrun the right edge. The engine calls again when the width changes.

// At most 100 cells per line: with a longer line the eye loses its place when it wraps; documents usually keep lines to 60 to 100 characters.
const MEASURE = 100

export type ReplyProps = { text: string; palette: Palette }

const Reply: ClientModule<ReplyProps & JsonValue> = (props, surface) =>
  renderMarkdown(surface.elements, props.palette, props.text, Math.min(MEASURE, surface.columns || 80))

export default Reply
