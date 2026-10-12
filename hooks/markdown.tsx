import type { ClientElements, RenderElement } from 'claude-code'

import type { Palette } from '../types'

// Parses Claude's markdown reply itself and lays it out like a document: headings with levels and underlines, code blocks with a
// background and highlighting, aligned table columns, quotes with a bar on the left. The engine's Markdown element draws the whole
// block its own way and none of this can be changed.

type El = ClientElements

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; source: string }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'rule' }

type ListItem = { depth: number; marker: string; ordered: boolean; text: string; task?: boolean }

const FENCE = /^\s*(```+|~~~+)\s*([\w+#.-]*)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/

/** A soft line break inside a paragraph: joined directly when both sides are CJK characters, otherwise a space is added. */
const joinLines = (lines: string[]) =>
  lines.reduce((acc, line) => {
    const t = line.trim()
    if (!acc) return t
    return CJK.test(acc.slice(-1)) && CJK.test(t[0] ?? '') ? acc + t : `${acc} ${t}`
  }, '')

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(c => c.trim())

export const parse = (src: string): Block[] => {
  const lines = src.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let i = 0

  const isBlockStart = (l: string, next?: string) =>
    FENCE.test(l) ||
    HEADING.test(l) ||
    RULE.test(l) ||
    LIST.test(l) ||
    /^\s*>/.test(l) ||
    (l.includes('|') && next !== undefined && TABLE_SEP.test(next))

  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const close = fence[1]!
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(close)) body.push(lines[i++]!)
      i++
      blocks.push({ kind: 'code', lang: fence[2] ?? '', source: body.join('\n') })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!))
      blocks.push({ kind: 'table', head, rows })
      continue
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      blocks.push({ kind: 'quote', text: joinLines(body) })
      continue
    }

    if (LIST.test(line)) {
      const items: ListItem[] = []
      while (i < lines.length) {
        const l = lines[i]!
        const m = l.match(LIST)
        if (m) {
          const depth = Math.floor(m[1]!.replace(/\t/g, '    ').length / 2)
          const ordered = /\d/.test(m[2]!)
          // A change of list kind at the top level (bullet to number) starts another list.
          if (depth === 0 && items.length && items[0]!.ordered !== ordered) break
          let text = m[3]!
          let task: boolean | undefined
          const box = text.match(/^\[([ xX])\]\s+(.*)$/)
          if (box) {
            task = box[1] !== ' '
            text = box[2]!
          }
          items.push({
            depth,
            marker: m[2]!,
            ordered,
            text,
            task,
          })
          i++
        } else if (l.trim() && /^\s+/.test(l) && items.length) {
          // An indented continuation line joins the previous item.
          const last = items[items.length - 1]!
          last.text = joinLines([last.text, l])
          i++
        } else if (!l.trim() && i + 1 < lines.length && LIST.test(lines[i + 1]!)) {
          i++
        } else break
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const body: string[] = []
    while (i < lines.length && lines[i]!.trim() && !(body.length && isBlockStart(lines[i]!, lines[i + 1])))
      body.push(lines[i++]!)
    blocks.push({ kind: 'paragraph', text: joinLines(body) })
  }
  return blocks
}

// ---- inline ----

type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean; href?: string }

const INLINE =
  /(`+)(.+?)\1|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)|~~(.+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)>\]]+)/

export const spans = (text: string, inherit: Omit<Span, 'text'> = {}): Span[] => {
  const out: Span[] = []
  let rest = text
  while (rest) {
    const m = rest.match(INLINE)
    if (!m || m.index === undefined) {
      out.push({ ...inherit, text: rest })
      break
    }
    if (m.index > 0) out.push({ ...inherit, text: rest.slice(0, m.index) })
    if (m[2] !== undefined) out.push({ ...inherit, code: true, text: m[2] })
    else if (m[3] !== undefined || m[4] !== undefined) out.push(...spans((m[3] ?? m[4])!, { ...inherit, bold: true }))
    else if (m[5] !== undefined || m[6] !== undefined) out.push(...spans((m[5] ?? m[6])!, { ...inherit, italic: true }))
    else if (m[7] !== undefined) out.push(...spans(m[7], { ...inherit, strike: true }))
    else if (m[8] !== undefined) out.push({ ...inherit, text: m[8], href: m[9] })
    else if (m[10] !== undefined) out.push({ ...inherit, text: m[10], href: m[10] })
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

// Breaks lines itself: a terminal only wraps at spaces, so a long run of Chinese without spaces in mixed text is pushed whole onto the
// next line and leaves a ragged right edge. Here a break is allowed between any two CJK characters, English words are not split
// and punctuation never starts a line.
const NO_LINE_START = /^[，。、；：！？）」』】》〉,.;:!?)\]}%]$/

export const wrapSpans = (input: Span[], width: number): Span[][] => {
  type Unit = { span: Omit<Span, 'text'>; text: string; space: boolean }
  const units: Unit[] = []
  for (const sp of input) {
    const { text, ...style } = sp
    const body = sp.code ? ` ${text} ` : text
    if (sp.code && displayWidth(body) <= width) {
      units.push({ span: style, text: body, space: false })
      continue
    }
    // Each CJK character is one unit, English is cut into words at spaces, and a space is a unit of its own.
    for (const m of body.matchAll(/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]|\s+|[^\s\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]+/g))
      units.push({ span: style, text: m[0], space: /^\s+$/.test(m[0]) && !sp.code })
  }

  const lines: Span[][] = [[]]
  let used = 0
  const push = (u: Unit) => {
    const line = lines[lines.length - 1]!
    const last = line[line.length - 1]
    const same =
      last && last.bold === u.span.bold && last.italic === u.span.italic && last.code === u.span.code &&
      last.strike === u.span.strike && last.href === u.span.href
    if (same) last.text += u.text
    else line.push({ ...u.span, text: u.text })
    used += displayWidth(u.text)
  }
  const newline = () => {
    const line = lines[lines.length - 1]!
    const last = line[line.length - 1]
    if (last && !last.code) last.text = last.text.replace(/\s+$/, '')
    lines.push([])
    used = 0
  }

  for (const u of units) {
    const w = displayWidth(u.text)
    if (u.space) {
      if (used === 0) continue
      if (used + w > width) {
        newline()
        continue
      }
      push(u)
      continue
    }
    if (used + w <= width) {
      push(u)
      continue
    }
    // Punctuation may hang one cell past the edge so it never lands at the start of a line.
    if (NO_LINE_START.test(u.text) && used + w <= width + 2) {
      push(u)
      continue
    }
    if (used > 0) newline()
    if (w <= width) {
      push(u)
      continue
    }
    // A word longer than a whole line (a URL, a long path) has to be cut hard.
    let chunk = ''
    for (const ch of u.text) {
      if (displayWidth(chunk + ch) > width) {
        push({ ...u, text: chunk })
        newline()
        chunk = ''
      }
      chunk += ch
    }
    if (chunk) push({ ...u, text: chunk })
  }
  return lines.filter((l, i) => l.length || i === 0)
}

/** Display width in a terminal: full-width CJK characters count as 2 cells. */
export const displayWidth = (s: string) => {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    w +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)
        ? 2
        : 1
  }
  return w
}

const plain = (text: string) => spans(text).map(s => s.text).join('')

// ---- layout ----

export const renderMarkdown = (el: El, p: Palette, text: string, width: number): RenderElement => {
  const { Box, Text, Code, Link } = el

  const piece = (s: Span, base: { color?: string; bold?: boolean; italic?: boolean }) =>
    s.href ? (
      <Link href={s.href}>
        <Text color={p.accent} underline>
          {s.text}
        </Text>
      </Link>
    ) : s.code ? (
      // Inline code: a colored block with one cell of padding on each side (wrapSpans already adds it), not told apart by backticks.
      <Text color={p.accent} backgroundColor={p.surface}>
        {s.text}
      </Text>
    ) : (
      <Text
        bold={s.bold || base.bold}
        italic={s.italic || base.italic}
        strikethrough={s.strike}
        color={s.bold ? p.hi : s.italic ? p.base : (base.color ?? p.hi)}
      >
        {s.text}
      </Text>
    )

  const inline = (
    src: string,
    base: { color?: string; bold?: boolean; italic?: boolean } = {},
    room = width,
  ) => (
    <Box flexDirection="column">
      {wrapSpans(spans(src), Math.max(8, room)).map(line => (
        <Text color={base.color ?? p.hi} bold={base.bold} italic={base.italic} wrap="truncate-end">
          {line.length ? line.map(s => piece(s, base)) : ' '}
        </Text>
      ))}
    </Box>
  )

  const block = (b: Block) => {
    switch (b.kind) {
      case 'heading':
        if (b.level === 1)
          return (
            <Box flexDirection="column">
              {inline(b.text, { color: p.accent, bold: true })}
              <Text color={p.accent}>{'━'.repeat(Math.min(width, displayWidth(plain(b.text)) + 2))}</Text>
            </Box>
          )
        if (b.level === 2)
          return (
            <Box flexDirection="column">
              {inline(b.text, { color: p.hi, bold: true })}
              <Text color={p.faint}>{'─'.repeat(Math.min(width, displayWidth(plain(b.text)) + 2))}</Text>
            </Box>
          )
        return (
          <Box flexDirection="row">
            <Text color={p.accent}>{'▸ '}</Text>
            {inline(b.text, { color: p.hi, bold: true })}
          </Box>
        )

      case 'paragraph':
        return inline(b.text)

      case 'code':
        return (
          <Box flexDirection="column" backgroundColor={p.surface} paddingX={1} width="100%">
            <Text color={p.muted} italic>{b.lang || 'code'}</Text>
            <Code source={b.source.slice(0, 10000)} language={b.lang || undefined} />
          </Box>
        )

      case 'quote':
        return (
          <Box flexDirection="row">
            <Box width={2} flexShrink={0}>
              <Text color={p.accent}>▎</Text>
            </Box>
            {inline(b.text, { color: p.base, italic: true }, width - 2)}
          </Box>
        )

      case 'rule':
        return <Text color={p.faint}>{'─'.repeat(Math.max(0, width))}</Text>

      case 'list': {
        let n = 0
        // If any item is long enough to wrap, top-level items get a blank line between them; a list of short items stays tight.
        const spaced = b.items.some(item => displayWidth(plain(item.text)) > width - 4)
        return (
          <Box flexDirection="column">
            {b.items.map((item, idx) => {
              n = item.depth === 0 ? n + 1 : n
              const mark =
                item.task !== undefined
                  ? item.task
                    ? '☑'
                    : '☐'
                  : item.ordered
                    ? item.marker.replace(')', '.')
                    : item.depth === 0
                      ? '•'
                      : '◦'
              const markWidth = Math.max(2, displayWidth(mark) + 1)
              return (
                <Box flexDirection="row" paddingLeft={item.depth * 2} marginTop={spaced && idx > 0 && item.depth === 0 ? 1 : 0}>
                  <Box width={markWidth} flexShrink={0}>
                    <Text color={item.ordered ? p.muted : p.accent}>{mark}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    {inline(item.text, item.task ? { color: p.muted } : {}, width - item.depth * 2 - markWidth)}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )
      }

      case 'table': {
        const cols = Math.max(b.head.length, ...b.rows.map(r => r.length))
        const gap = 3
        const natural = Array.from({ length: cols }, (_, c) =>
          Math.max(3, ...[b.head, ...b.rows].map(r => displayWidth(plain(r[c] ?? '')))),
        )
        const room = Math.max(cols * 4, width - gap * (cols - 1))
        const total = natural.reduce((a, x) => a + x, 0)
        // If it fits, columns take their content width; if not, they shrink in proportion and long cells wrap.
        const widths = total <= room ? natural : natural.map(w => Math.max(4, Math.floor((w / total) * room)))
        const row = (r: string[], head: boolean) => (
          <Box flexDirection="row">
            {widths.map((w, c) => (
              <Box width={w} flexShrink={0} marginRight={c < cols - 1 ? gap : 0}>
                {inline(r[c] ?? '', head ? { color: p.accent, bold: true } : {}, w)}
              </Box>
            ))}
          </Box>
        )
        const ruleWidth = widths.reduce((a, x) => a + x, 0) + gap * (cols - 1)
        return (
          <Box flexDirection="column">
            {row(b.head, true)}
            <Text color={p.faint}>{'─'.repeat(Math.min(width, ruleWidth))}</Text>
            {b.rows.map(r => row(r, false))}
          </Box>
        )
      }
    }
  }

  // A blank line between blocks, like paragraph spacing in a document; marginTop rather than gap, because a terminal Box does not draw gap.
  const blocks = parse(text)
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => (
        <Box flexDirection="column" marginTop={i ? 1 : 0}>
          {block(b)}
        </Box>
      ))}
    </Box>
  )
}
