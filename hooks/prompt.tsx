import type { Elements } from 'claude-code'

import type { Palette } from '../types'

import { t } from './i18n'
import { type Size } from './image'

// Around the prompt (sub-project B): pure functions for the bar above it (pasted images, status line, repo/branch/cwd, plain-language button).

/** Location info shown above the prompt. Outside a git repo, root and branch are both absent. */
export type Location = {
  cwd: string
  home?: string
  /** Repo root directory. */
  root?: string
  /** Branch name; `@<short sha>` on a detached HEAD. */
  branch?: string
  /** Number of uncommitted files (lines of git status --porcelain). */
  dirty: number
}

export type Picture = { n: number; path: string; size: Size }

// main, master, prod and branches starting with prod/ need extra care when changing things, so the whole cell turns red.
export const isProtected = (branch: string | undefined) => !!branch && (/^(main|master|prod)$/.test(branch) || branch.startsWith('prod/'))

/** Width on the terminal: CJK and full-width characters take two cells. */
export const cells = (s: string) => [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0)

const tilde = (path: string, home?: string) => (home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path)

/**
 * The cwd split into a dim prefix and a bright suffix: inside a repo, everything from the repo directory name on is bright; outside a repo, all of it is.
 * Longer than max cells, it is cut from the left and prefixed with `…`; the right end (the current directory) always stays whole.
 */
export function cwdParts(loc: Location, max: number): { dim: string; bright: string } {
  const full = tilde(loc.cwd, loc.home)
  let dim = ''
  let bright = full
  if (loc.root && (loc.cwd === loc.root || loc.cwd.startsWith(`${loc.root}/`))) {
    const parent = tilde(loc.root.slice(0, loc.root.lastIndexOf('/') + 1), loc.home)
    dim = parent
    bright = full.slice(parent.length)
  }
  if (cells(dim) + cells(bright) <= max) return { dim, bright }
  // Sacrifice the dim prefix first; only if still too long, cut the left of the bright part.
  if (cells(bright) + 1 <= max) {
    const keep = [...dim]
    while (keep.length && cells(keep.join('')) + cells(bright) + 1 > max) keep.shift()
    return { dim: `…${keep.join('')}`, bright }
  }
  const keep = [...bright]
  while (keep.length && cells(keep.join('')) + 1 > max) keep.shift()
  return { dim: '…', bright: keep.join('') }
}

export const imageTags = (text: string) => [...new Set([...text.matchAll(/\[Image #(\d+)\]/g)].map(m => Number(m[1])))]

/** The largest box within columns×rows cells that keeps the aspect ratio; a cell is about twice as tall as wide. */
export const fitCells = ({ width, height }: Size, columns: number, rows: number) => {
  const clamp = (n: number) => Math.max(1, Math.min(255, Math.round(n)))
  const across = Math.min(columns, (rows * 2 * width) / Math.max(1, height))
  return { columns: clamp(across), rows: clamp((across * height) / Math.max(1, width) / 2) }
}

/** A row of thumbnails splitting columns evenly, each at most rows lines tall; a rounded frame plus number, frame and number taking 2 columns and 3 lines. */
export function tiles(el: Elements['terminal'], p: Palette, list: readonly Picture[], columns: number, rows: number) {
  const { Box, Image, Text } = el
  const share = Math.floor((columns - (list.length - 1)) / Math.max(1, list.length)) - 2
  return (
    <Box flexDirection="row" columnGap={1}>
      {list.map(pic => (
        <Box key={`image-${pic.n}`} flexDirection="column" alignItems="center" borderStyle="round" borderColor={p.faint}>
          <Image source={{ file: pic.path, format: 'png' }} {...fitCells(pic.size, Math.max(1, share), rows)} alt={`[Image #${pic.n}]`} />
          <Text color={p.muted}>#{pic.n}</Text>
        </Box>
      ))}
    </Box>
  )
}

/** Lines taken by a thumbnail's frame and number. */
export const TILE_CHROME_ROWS = 3

const clipCells = (s: string, max: number) => {
  if (cells(s) <= max) return s
  const out = [...s]
  while (out.length && cells(out.join('')) + 1 > max) out.pop()
  return `${out.join('')}…`
}

// Most cells the session name may take; longer names are truncated.
const TITLE_MAX = 24

/** Width of the left part of the location row (session name, repo, branch, uncommitted count), excluding cwd. */
export function headWidth(loc: Location, title?: string) {
  const repo = loc.root ? loc.root.slice(loc.root.lastIndexOf('/') + 1) : undefined
  const guarded = isProtected(loc.branch)
  const tw = title ? cells(`◆ ${clipCells(title, TITLE_MAX)}`) + 3 : 0
  const r = repo ? cells(`⎇ ${repo}  ${guarded ? ` ${loc.branch} ` : loc.branch ?? ''}${guarded ? ` ${t('受保護', 'protected')}` : ''}${loc.dirty > 0 ? `  ±${loc.dirty}` : ''}`) + 3 : 0
  return tw + r
}

/**
 * Location row: session name (chosen by an LLM), repo, branch, uncommitted count, cwd.
 * width is the width this row gets and cwd takes what is left; too long, it is cut from the left and the current directory always stays whole.
 */
export function locationRow(el: Elements['terminal'], p: Palette, loc: Location, width: number, title?: string) {
  const { Box, Text } = el
  const repo = loc.root ? loc.root.slice(loc.root.lastIndexOf('/') + 1) : undefined
  const guarded = isProtected(loc.branch)
  const dirty = loc.dirty > 0 ? `±${loc.dirty}` : ''
  const { dim, bright } = cwdParts(loc, Math.max(8, width - headWidth(loc, title)))
  return (
    <Box flexDirection="row">
      {title ? <Text color={p.accent} bold>◆ {clipCells(title, TITLE_MAX)}   </Text> : null}
      {repo ? (
        <Box flexDirection="row" flexShrink={0}>
          <Text color={p.hi} bold>⎇ {repo}</Text>
          <Text>  </Text>
          {guarded
            ? <Text backgroundColor={p.error} color={p.bg} bold> {loc.branch} </Text>
            : <Text color={p.hi}>{loc.branch}</Text>}
          {guarded ? <Text color={p.error} bold> {t('受保護', 'protected')}</Text> : null}
          {dirty ? <Text color={p.warn}>  {dirty}</Text> : null}
          <Text>   </Text>
        </Box>
      ) : null}
      <Text color={p.muted} wrap="truncate-start">{dim}</Text>
      <Text color={p.hi} bold wrap="truncate-start">{bright}</Text>
    </Box>
  )
}
