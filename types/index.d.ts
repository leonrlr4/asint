/** Colors derived from the terminal theme, or fixed in hacker mode; every asint UI takes its colors from here. */
export type Palette = {
  /** Terminal background; in hacker mode panels and color blocks paint this color themselves. */
  bg: string
  /** Text color with the highest contrast against the background. */
  hi: string
  /** hi pulled halfway toward the background. */
  base: string
  accent: string
  muted: string
  faint: string
  /** A background one step lighter than bg, used as the block behind user messages. */
  surface: string
  success: string
  warn: string
  error: string
}

/** `omarchy` follows the current theme; `hacker` uses a fixed phosphor palette. */
export type Skin = 'omarchy' | 'hacker'

declare module 'claude-code' {
  interface PluginState {
    asint: {
      /** The palette currently in effect (skin already applied). */
      palette: Palette
      skin: Skin
      turnStartedAt: number
      /** The chat column's palette: phosphor text over the theme's backgrounds. */
      chatPalette: Palette
    }
  }
}
