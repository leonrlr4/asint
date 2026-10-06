import type { Palette, Skin } from '../types'

// Palette derivation: derives the colors every asint UI shares from the terminal theme files.
// Adapted from aurora's palette.ts, adding kitty.conf and the named colors (red, green…) of Omarchy's newer colors.toml.

/** Used when no theme file can be read (tests, non-Omarchy machines): dark background, bright text, Claude orange accent. */
export const FALLBACK: Palette = {
  bg: '#1e1e1e',
  hi: '#ececec',
  base: '#7d7d7d',
  accent: '#d97757',
  muted: '#8a8a8a',
  faint: '#4a4a4a',
  surface: '#262626',
  success: '#8fbf7f',
  warn: '#d7a65f',
  error: '#e06c75',
}

/**
 * Hacker mode: a fixed phosphor palette that ignores the theme. The terminal background cannot be changed, so panels and color blocks paint their own black (bg).
 * Phosphor green as the main color, amber as the accent, red only for errors; all three exceed 7:1 contrast on #050805.
 */
export const HACKER: Palette = {
  bg: '#050805',
  hi: '#7dff9a',
  base: '#3fbf5f',
  accent: '#ffb000',
  muted: '#2f8a46',
  faint: '#1c4a28',
  surface: '#0b140d',
  success: '#7dff9a',
  warn: '#ffb000',
  error: '#ff6b6b',
}

type Rgb = [number, number, number]

const toRgb = (hex: string): Rgb => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = ([r, g, b]: Rgb) =>
  '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

/** t=0 gives a, t=1 gives b. */
export const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a)
  const y = toRgb(b)
  return toHex([0, 1, 2].map(i => x[i]! + (y[i]! - x[i]!) * t) as Rgb)
}

const luminance = (hex: string) => {
  const lin = toRgb(hex).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
}

export const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1! + 0.05) / (l2! + 0.05)
}

const chroma = (hex: string) => {
  const rgb = toRgb(hex)
  return Math.max(...rgb) - Math.min(...rgb)
}

const hue = (hex: string) => {
  const [r, g, b] = toRgb(hex).map(v => v / 255) as Rgb
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return -1
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** Among the candidates, the color whose hue is closest to target (saturated, at least 3:1 against the background); fallback if none. */
const nearestHue = (colors: string[], bg: string, target: number, fallback: string) => {
  const ok = colors.filter(x => chroma(x) > 40 && contrast(x, bg) >= 3)
  if (!ok.length) return fallback
  const dist = (x: string) => {
    const d = Math.abs(hue(x) - target)
    return Math.min(d, 360 - d)
  }
  return ok.reduce((best, x) => (dist(x) < dist(best) ? x : best))
}

/**
 * A color the theme author labelled green is green, which beats guessing by hue; under 3:1 against the background it is pulled toward the text color until legible.
 * Common with light themes: catppuccin-latte's green #40a02b is only 2.9:1 on #eff1f5.
 */
const named = (x: string | undefined, bg: string, fg: string) => {
  if (!x) return undefined
  for (let t = 0; t <= 1; t += 0.1) {
    const y = mix(x, fg, t)
    if (contrast(y, bg) >= 3) return y
  }
  return undefined
}

type Source = {
  bg: string
  fg: string
  /** Bright colors of the same family as fg (color7, color15…); the highest-contrast one becomes hi. */
  neutrals: string[]
  /** Saturated candidates; the first is the theme's own accent (if it has one). */
  colorful: string[]
  red?: string
  green?: string
  yellow?: string
}

export const derive = ({ bg, fg, neutrals, colorful, red, green, yellow }: Source): Palette => {
  const hi = [fg, ...neutrals].reduce((best, x) => (contrast(x, bg) > contrast(best, bg) ? x : best))
  const readable = colorful.filter(x => contrast(x, bg) >= 3)
  // Use the theme's accent if it is legible, otherwise the most saturated one; fall back to hi if everything is gray.
  const accent = readable[0] && colorful[0] === readable[0]
    ? readable[0]
    : readable.length
      ? readable.reduce((best, x) => (chroma(x) > chroma(best) ? x : best))
      : hi
  return {
    bg,
    hi,
    base: mix(hi, bg, 0.5),
    accent,
    muted: mix(fg, bg, 0.35),
    faint: mix(fg, bg, 0.75),
    surface: mix(bg, fg, 0.07),
    // color1/color2 are not always red/green (some themes make color2 red), so without named colors pick by hue.
    success: named(green, bg, fg) ?? nearestHue(colorful, bg, 120, mix(fg, bg, 0.35)),
    warn: named(yellow, bg, fg) ?? nearestHue(colorful, bg, 45, accent),
    error: named(red, bg, fg) ?? nearestHue(colorful, bg, 0, hi),
  }
}

const hex = (s: string) => '#' + s.replace('#', '').toLowerCase()

/** kitty.conf: `colorN #rrggbb`, `foreground #…`, `background #…`. These are the colors kitty actually draws. */
export const fromKitty = (conf: string): Palette | undefined => {
  const c: Record<string, string> = {}
  for (const m of conf.matchAll(/^\s*(\w+)\s+#?([0-9a-fA-F]{6})\s*$/gm)) c[m[1]!] = hex(m[2]!)
  if (!c.background || !c.foreground) return undefined
  const pick = (ids: number[]) => ids.map(i => c[`color${i}`]).filter((x): x is string => !!x)
  return derive({
    bg: c.background,
    fg: c.foreground,
    neutrals: pick([7, 15]),
    colorful: pick([1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]),
  })
}

/** foot.ini: `regularN=rrggbb` in the `[colors-dark]` section. */
export const fromFootIni = (ini: string): Palette | undefined => {
  const c: Record<string, string> = {}
  for (const m of ini.matchAll(/^\s*([\w-]+)\s*=\s*([0-9a-fA-F]{6})\s*$/gm)) c[m[1]!] = hex(m[2]!)
  if (!c.background || !c.foreground) return undefined
  const pick = (prefix: string, ids: number[]) =>
    ids.map(i => c[`${prefix}${i}`]).filter((x): x is string => !!x)
  return derive({
    bg: c.background,
    fg: c.foreground,
    neutrals: pick('regular', [7]).concat(pick('bright', [7])),
    colorful: pick('regular', [1, 2, 3, 4, 5, 6]),
  })
}

/** Omarchy's colors.toml: `key = "#rrggbb"`; newer versions have named colors (red, green, accent…), older ones only colorN. */
export const fromToml = (toml: string): Palette | undefined => {
  const c: Record<string, string> = {}
  for (const m of toml.matchAll(/^\s*(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/gm)) c[m[1]!] = m[2]!.toLowerCase()
  if (!c.background || !c.foreground) return undefined
  const keys = ['accent', 'red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta',
    'color1', 'color2', 'color3', 'color4', 'color5', 'color6']
  return derive({
    bg: c.background,
    fg: c.foreground,
    neutrals: [c.color7, c.color15, c.bright_foreground].filter((x): x is string => !!x),
    colorful: keys.map(k => c[k]).filter((x): x is string => !!x),
    red: c.red,
    green: c.green,
    yellow: c.yellow,
  })
}

/** ghostty.conf: `background = #…`, `palette = N=#…`. */
export const fromGhostty = (conf: string): Palette | undefined => {
  const c: Record<string, string> = {}
  for (const m of conf.matchAll(/^\s*(background|foreground)\s*=\s*#?([0-9a-fA-F]{6})\s*$/gm)) c[m[1]!] = hex(m[2]!)
  for (const m of conf.matchAll(/^\s*palette\s*=\s*(\d+)\s*=\s*#?([0-9a-fA-F]{6})\s*$/gm)) c[`color${m[1]}`] = hex(m[2]!)
  if (!c.background || !c.foreground) return undefined
  const pick = (ids: number[]) => ids.map(i => c[`color${i}`]).filter((x): x is string => !!x)
  return derive({
    bg: c.background,
    fg: c.foreground,
    neutrals: pick([7, 15]),
    colorful: pick([1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]),
  })
}

type Parser = (text: string) => Palette | undefined
const KITTY: [string, Parser] = ['kitty.conf', fromKitty]
const GHOSTTY: [string, Parser] = ['ghostty.conf', fromGhostty]
const FOOT: [string, Parser] = ['foot.ini', fromFootIni]
const TOML: [string, Parser] = ['colors.toml', fromToml]

/**
 * Files tried in order within the theme directory: the one for the running terminal first (it holds the real on-screen background), colors.toml last.
 * Within one Omarchy theme directory the terminals' files can disagree (some themes ship a light colors.toml and a dark foot.ini).
 */
export const sourcesFor = (term: string): [string, Parser][] => {
  if (/kitty/.test(term)) return [KITTY, GHOSTTY, FOOT, TOML]
  if (/ghostty/.test(term)) return [GHOSTTY, KITTY, FOOT, TOML]
  if (/foot/.test(term)) return [FOOT, KITTY, GHOSTTY, TOML]
  return [KITTY, GHOSTTY, FOOT, TOML]
}

export const paletteFor = (skin: Skin, theme: Palette) => (skin === 'hacker' ? HACKER : theme)

export const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}
