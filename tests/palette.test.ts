import { test, expect } from 'claude-code/testing'

import { FIXTURES } from './fixtures'
import { contrast, fromFootIni, fromKitty, fromToml, HACKER, sourcesFor } from '../hooks/palette'
import { pngSize } from '../hooks/image'

const fixture = (name: string) => FIXTURES[name]!

const readable = (p: Record<string, string>) => {
  for (const k of ['hi', 'accent', 'success', 'warn', 'error']) expect(contrast(p[k]!, p.bg!)).toBeGreaterThanOrEqual(3)
}

test('miasma kitty.conf yields a readable dark palette', () => {
  const p = fromKitty(fixture('miasma.kitty.conf'))!
  expect(p.bg).toBe('#222222')
  readable(p)
})

test('kitty and foot configs of the same theme yield the same palette', () => {
  expect(fromFootIni(fixture('miasma.foot.ini'))).toEqual(fromKitty(fixture('miasma.kitty.conf')))
})

test('light theme catppuccin-latte: uses named colors, and darkens ones that are too light toward the foreground instead of changing hue', () => {
  const p = fromToml(fixture('catppuccin-latte.colors.toml'))!
  expect(p.accent).toBe('#1e66f5')
  expect(p.error).toBe('#d20f39')
  // green is too light and gets darkened, but must not be swapped for cyan (#179299).
  expect(p.success).not.toBe('#179299')
  expect(p.success.slice(0, 3)).not.toBe('#17')
  readable(p)
})

test('tokyo-night colors.toml yields a readable palette', () => {
  readable(fromToml(fixture('tokyo-night.colors.toml'))!)
})

test('every main hacker palette color exceeds 7:1 contrast on black', () => {
  for (const k of ['hi', 'accent', 'success', 'error'] as const) expect(contrast(HACKER[k], HACKER.bg)).toBeGreaterThan(7)
})

test('reads the theme file of the terminal currently in use first', () => {
  expect(sourcesFor('xterm-kitty')[0]![0]).toBe('kitty.conf')
  expect(sourcesFor('ghostty xterm-ghostty')[0]![0]).toBe('ghostty.conf')
  expect(sourcesFor(' foot')[0]![0]).toBe('foot.ini')
})

test('pngSize reads width and height from the PNG header and returns undefined for non-PNG data', () => {
  // A whole 1x1 transparent PNG; the bytes past the first 32 base64 characters do not affect the result.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  expect(pngSize(png)).toEqual({ width: 1, height: 1 })
  expect(pngSize(btoa('GIF89a' + '\0'.repeat(30)))).toBeUndefined()
})
