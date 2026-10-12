// The little workers of the ORCH page: a 12 x 10 pixel creature drawn with half-block characters (two pixels per cell, so 12 columns
// by 5 rows of text), with a hat and a tool for each kind of subagent. Pure data and computation; never touches $.

/** One drawn cell: the character and its colors; colors are hex strings, absent means the card's own background. */
export type Cell = { ch: string; fg?: string; bg?: string }

export type Role = 'main' | 'explore' | 'plan' | 'general' | 'guide' | 'designer' | 'developer' | 'reviewer' | 'tester' | 'writer' | 'security' | 'scholar' | 'other'
export type Mood = 'working' | 'done' | 'failed' | 'idle'

const W = 12
const H = 10

/** Pixel letters: o body, e eye, d dark body shade, and the hat and tool colors of each role. */
const BODY = '#d97757'
const SHADE = '#b85c3f'
const EYE = '#2a1d18'

const COLORS: Record<string, string> = {
  o: BODY, d: SHADE, e: EYE,
  // explorer: brown cap, magnifier
  b: '#8a5a3c', B: '#c98b5a', g: '#9ec6e8', s: '#6f7b86',
  // planner: blue cap, clipboard
  u: '#4f7fbf', U: '#86aee0', w: '#e8e4da', k: '#3a3f48',
  // general: yellow hard hat, wrench
  y: '#f0c43a', Y: '#b8801f', m: '#9aa3ab',
  // guide: glasses and a green book
  r: '#e8e4da', n: '#4f9b6e', N: '#2f6b48',
  // main: crown
  c: '#f5d36b', C: '#c9962e', j: '#e0573f',
  // designer: red beret, brush
  R: '#c0394f', Q: '#8f2a3b', a: '#4a90e2', z: '#b5895a', p: '#e6c28a',
  // reviewer: grey cap; writer: green beanie; security: dark helmet; scholar: black cap
  G: '#6b7480', Z: '#4a5059', V: '#3f9a62', X: '#2c6b43', h: '#2b2f38', S: '#5b8def', l: '#7fd0e0',
}

/** The body, rows 3 to 9; hats go over rows 0 to 4 and tools beside the body. */
const BASE = [
  '............',
  '............',
  '............',
  '..oooooooo..',
  '.oooooooooo.',
  '.ooeooooeoo.',
  '.oooooooooo.',
  '..oooooooo..',
  '..o.o..o.o..',
  '..o.o..o.o..',
]

type Overlay = Record<number, string>

/** Rows to paint over the base; a "." keeps what is below. */
const OVERLAYS: Record<Role, Overlay> = {
  main: {
    1: '..c..cc..c..',
    2: '..cccccccc..',
    3: '..CCCCCCCC..',
  },
  explore: {
    1: '...bbbbbb...',
    2: '..bBBBBBBb..',
    3: '..bbbbbbbbbs',
    5: '...........g',
    6: '..........sg',
  },
  plan: {
    1: '...uuuuuu...',
    2: '..uUUUUUUu..',
    3: '..uuuuuuuu..',
    4: '..........kk',
    5: '..........ww',
    6: '..........ww',
    7: '..........kk',
  },
  general: {
    1: '....yyyy....',
    2: '..yyyyyyyy..',
    3: '..YYYYYYYY..',
    5: 'mm..........',
    6: '.m..........',
  },
  guide: {
    4: '.rrrr..rrrr.',
    5: '.r..r..r..r.',
    6: '..........nn',
    7: '..........NN',
  },
  designer: {
    1: '....RRRR..a.',
    2: '..RRRRRRRR.z',
    3: '..QQQQQQQQ.z',
    5: 'pp.........z',
    6: 'pp.........z',
  },
  developer: {
    2: '...kkkkkk...',
    3: '..kk....kk..',
    4: '.kk......kk.',
    5: '.kk......kk.',
    6: '..mmmmmmmm..',
    7: '..mwwwwwwm..',
  },
  reviewer: {
    1: '...GGGGGG...',
    2: '..ZZZZZZZZ..',
    3: '.GGGGGGGGGG.',
    4: '..........j.',
    5: '..........j.',
    6: '..........m.',
    7: '..........m.',
  },
  tester: {
    4: '.lll....lll.',
    5: '.l.l....l.l.',
    6: '..........nn',
    7: '.........nnn',
    8: '.........nnn',
  },
  writer: {
    1: '....cVVc....',
    2: '..VVVVVVVV..',
    3: '..XXXXXXXX..',
    5: 'ww..........',
    6: 'wk..........',
    7: 'ww..........',
  },
  security: {
    1: '...hhhhhh...',
    2: '..hhhhhhhh..',
    3: '..hSSSSSSh..',
    5: 'uu..........',
    6: 'uUu.........',
    7: '.u..........',
  },
  scholar: {
    1: '.kkkkkkkkkk.',
    2: '..kkkkkkkk.c',
    3: '..hhhhhhhh.c',
    6: '..........nn',
    7: '..........NN',
  },
  other: {},
}

/** Cells of the eyes by mood: working blinks now and then, done is content (a flat line), failed is crossed. */
function eyes(mood: Mood, frame: number): [string, string] {
  if (mood === 'failed') return ['.oxoooooxoo.', '.oooooooooo.']
  if (mood === 'done') return ['.oooooooooo.', '.oeeooooeeo.']
  if (mood === 'idle' || frame % 12 === 0) return ['.oooooooooo.', '.oeeooooeeo.']
  return ['.ooeooooeoo.', '.oooooooooo.']
}

/**
 * The creature as rows of cells. A working one bobs up and down and its legs shuffle; one that is done or idle stands still.
 * `frame` counts animation steps (about 300 ms each).
 */
export function renderSprite(role: Role, mood: Mood, frame: number): Cell[][] {
  const px: string[][] = BASE.map(r => [...r])
  const [e1, e2] = eyes(mood, frame)
  px[5] = [...e1]
  px[6] = [...e2]
  // Legs: working feet alternate.
  if (mood === 'working' && frame % 2 === 1) { px[8] = [...'..o..o.o..o.']; px[9] = [...'.o..o...o..o'] }
  const over = OVERLAYS[role]
  for (const [rowText, y] of Object.entries(over).map(([y, t]) => [t, Number(y)] as const)) {
    for (let x = 0; x < W; x++) {
      const ch = rowText[x]
      if (ch && ch !== '.') px[y]![x] = ch
    }
  }
  // Mood x: the crossed eye pixel is dark like an eye.
  const color = (ch: string | undefined) => (ch === 'x' ? EYE : ch && ch !== '.' ? COLORS[ch] : undefined)
  // Working: the whole creature rises one pixel on odd frames.
  const lift = mood === 'working' && frame % 2 === 1 ? 1 : 0
  const at = (x: number, y: number) => color(px[y + lift]?.[x])
  const rows: Cell[][] = []
  for (let y = 0; y < H; y += 2) {
    const row: Cell[] = []
    for (let x = 0; x < W; x++) {
      const top = at(x, y)
      const bottom = at(x, y + 1)
      if (top && bottom) row.push(top === bottom ? { ch: '█', fg: top } : { ch: '▀', fg: top, bg: bottom })
      else if (top) row.push({ ch: '▀', fg: top })
      else if (bottom) row.push({ ch: '▄', fg: bottom })
      else row.push({ ch: ' ' })
    }
    rows.push(row)
  }
  return rows
}

/** Which creature a subagent type gets. */
export function roleOf(type: string | undefined): Role {
  const t = (type ?? '').toLowerCase()
  if (t === 'main') return 'main'
  if (t.includes('explore')) return 'explore'
  if (t.includes('guide')) return 'guide'
  if (t.includes('plan') || t.includes('architect')) return 'plan'
  if (/review|critic|audit|lint/.test(t)) return 'reviewer'
  if (/test|qa|verif|check/.test(t)) return 'tester'
  if (/design|\bui\b|ux|style/.test(t)) return 'designer'
  if (/secur|safety|threat/.test(t)) return 'security'
  if (/doc|writ|summar|draft|edit/.test(t)) return 'writer'
  if (/research|analy|bio|science|data/.test(t)) return 'scholar'
  if (/dev|implement|engineer|build|code|fix|setup|config/.test(t)) return 'developer'
  if (t.includes('general')) return 'general'
  return 'other'
}

/** Merge neighbouring cells with the same colors into runs, so a row is a handful of elements instead of twelve. */
export function runsOf(row: Cell[]): Cell[] {
  const out: Cell[] = []
  for (const c of row) {
    const last = out[out.length - 1]
    if (last && last.fg === c.fg && last.bg === c.bg) last.ch += c.ch
    else out.push({ ...c })
  }
  return out
}

export const SPRITE_COLS = W
export const SPRITE_ROWS = H / 2
