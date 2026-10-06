import type { Elements } from 'claude-code'

import type { Palette, Skin } from '../types'

import { type ArchModel, type ArchNode, archScale, archSize, drawEdges, nodeRect, relationsOf } from './arch'
import { type Cell, compute, type LayoutNode, type Panel } from './layout'
import { lineOf, type LiveEdit } from './live'
import { agentSpots, agentsOf, type MapView } from './map'

import { type Exec, type FileEntry, fmtClock, fmtDur, isMedia as isMediaPath, type Media, type MediaKind, type Session, short, whoLabel } from './model'
import { mix } from './palette'
import { getLang, t } from './i18n'

// Dashboard tab views: pure functions over data and callbacks. They never touch $ ($ is only usable in register.tsx).

export type Tab = 'files' | 'exec' | 'map' | 'todo' | 'media' | 'log'
export const TABS: { id: Tab; key: string; label: string }[] = [
  { id: 'files', key: 'f', label: 'FILES' },
  { id: 'exec', key: 'e', label: 'EXEC' },
  { id: 'map', key: 'm', label: 'MAP' },
  { id: 'todo', key: 't', label: 'TODO' },
  { id: 'media', key: 'i', label: 'MEDIA' },
  { id: 'log', key: 'l', label: 'LOG' },
]

export type UiState = {
  tab: Tab
  mapView: MapView
  /** Target of the open message popup on MAP: 'main', a subagent id, or 'all' (every running subagent). */
  msgTo?: string
  msgAt?: string
  comboSlot: 0 | 1
  focusAgent?: string
  selFile?: string
  fullFile: boolean
  showReads: boolean
  selExec?: string
  mediaFilter: 'ALL' | MediaKind
  selMedia?: string
  /** Scroll position per card (or per detail area `<panel>:detail`). The wheel scrolls the card, not the whole pane. */
  scroll: Record<string, number>
  /** Zen mode: show only this panel, filling the pane. Not saved to layout.json. */
  zen?: Panel
  /** FILES (project tree): expanded folders and the selected file, both as relative paths. */
  treeOpen: Record<string, true>
  treeSel?: string
  /** Follow mode: jump to whichever file the model is editing. */
  follow: boolean
  /** ARCH: breadcrumb (visited view ids, last is current), selected node, horizontal pan in cells. Vertical uses scroll.arch. */
  archTrail: string[]
  /** ARCH directories visited (system level → repo level); the last one is being viewed. */
  archDirs: string[]
  archSel?: string
  archPanX: number
}

export type Actions = {
  /** Make the panel the active tab of its cell. */
  focusPanel: (t: Panel) => void
  editLayout: () => void
  /** Leave zen if in it; otherwise let t (default: the most recently used card) fill the pane. */
  zen: (t?: Panel) => void
  /** Collapse the dashboard, leaving only the status bar above the input box. */
  minimize: () => void
  /** FILES: expand/collapse folders, select files. */
  treeToggle: (dir: string) => void
  treeSelect: (path: string) => void
  toggleFollow: () => void
  /** ARCH: press a node (enters it if already selected and drillable), jump to breadcrumb level i, pan horizontally, open the full viewer in a browser. */
  archPress: (node: ArchNode) => void
  archTrail: (i: number) => void
  /** Go back to directory level i (e.g. from a repo to the system level). */
  archUp: (i: number) => void
  archPan: (dx: number) => void
  archOpen: () => void
  mapView: (v: UiState['mapView']) => void
  /** MAP: open/close the popup for messaging an agent, and send the message. */
  /** at: which marker was clicked (radar or graph key); the popup opens next to it. */
  openMsg: (to: string, at?: string) => void
  closeMsg: () => void
  sendMsg: (to: string, text: string) => void
  nextCombo: () => void
  focusAgent: (id?: string) => void
  selFile: (path: string) => void
  toggleFull: () => void
  toggleReads: () => void
  openExternal: (path: string) => void
  selExec: (id: string) => void
  mediaFilter: (f: UiState['mediaFilter']) => void
  selMedia: (id: string) => void
  /** Open a URL in the system default browser. */
  openUrl: (url: string) => void
}

export type ViewCtx = {
  el: Elements['terminal']
  s: Session
  ui: UiState
  p: Palette
  skin: Skin
  now: number
  width: number
  rows: number
  act: Actions
  /** Full contents of the file selected in the Files tab (read ahead by register). */
  fileText?: string
  /** Raster contents and size for the Map tab. */
  map?: { cells: string; cols: number; rows: number }
  /** Output read so far from Exec background commands. */
  bgOutput: Map<string, string>
  /** Frame currently shown by Media animations. */
  mediaFrame: number
  /** Panels with new content that are not their cell's active tab; the tab name gets a • and the card border lights up. */
  fresh: Panel[]
  /** Max position of each scroll area in this render; register uses it to clamp the wheel. */
  scrollMax: Map<string, number>
  /** Architecture diagram for the ARCH tab (exported by register via likec4). */
  arch?: ArchState
  /** Leading ARCH breadcrumb: names of each directory level above the one being viewed. */
  archUpper: string[]
  /** Converted preview (first frame) of the media file selected in CHANGES. */
  filePreview?: { path: string; frame: string; width: number; height: number }
  /** FILES (project tree): root and relative paths of all files; contents or preview of the selected file. */
  project?: { root: string; paths: string[]; truncated: boolean }
  treeText?: string
  treePreview?: { path: string; frame: string; width: number; height: number }
  /** FILES follow mode: the edit call being streamed; the lines just changed (0-based, inclusive), highlighted for a few seconds. */
  live?: LiveEdit
  flash?: { path: string; from: number; to: number }
  /** CHANGES/FILES "open externally" and ARCH "full view" all want o. The most recently used one gets it; the others are mouse-only. */
  oOwner: Panel
}

/** State of one LikeC4 diagram. A failed export keeps the previous model; error holds likec4's message. */
export type ArchState = {
  /** Directory holding the .c4 files. */
  dir: string
  missing?: boolean
  model?: ArchModel
  /** Time of the last successful export. */
  at?: number
  error?: string
}

/** Read a scroll area's position clamped to 0..max, and record max. */
const scrollAt = (c: ViewCtx, key: string, max: number) => {
  const m = Math.max(0, max)
  c.scrollMax.set(key, m)
  return Math.min(m, Math.max(0, c.ui.scroll[key] ?? 0))
}
const pos = (start: number, shown: number, total: number) => (total > shown ? ` ${start + 1}-${Math.min(total, start + shown)}/${total}` : '')

export const bar = (pct: number, n: number) => {
  const k = Math.max(0, Math.min(n, Math.round((pct / 100) * n)))
  return '▮'.repeat(k) + '▯'.repeat(n - k)
}
export const heatColor = (p: Palette, pct: number) => (pct >= 85 ? p.error : pct >= 60 ? p.warn : p.success)
const opColor = (p: Palette, op: string) => (op === 'A' ? p.success : op === 'M' ? p.warn : p.muted)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)
const tail = (s: string | undefined, n: number) => (s ?? '').replace(/\t/g, '  ').split('\n').filter(Boolean).slice(-n)

// ── Top two rows ──────────────────────────────────────────

/** The status row: model, context, quota, cost, turn timer. Shared by the STATUS card and the bar above the input box. */
export function vitalsRow(c: Pick<ViewCtx, 'el' | 's' | 'p' | 'skin' | 'now'>) {
  const { el, s, p, skin, now } = c
  const { Box, Text, Client } = el
  const v = s.vitals
  const sep = <Text color={p.faint}> │ </Text>
  const gauge = (label: string, pct: number | undefined, n: number) =>
    pct === undefined ? null : (
      <Text>
        <Text color={p.muted}>{label} </Text>
        <Text color={heatColor(p, pct)}>{bar(pct, n)}</Text>
        <Text color={p.hi}> {Math.round(pct)}%</Text>
      </Text>
    )
  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text color={p.accent} bold>▓ ASINT</Text>
      {sep}
      <Text color={p.hi}>{v.model ?? '…'}</Text>
      {v.effort ? <Text color={p.muted}> {v.effort}</Text> : null}
      {sep}
      {gauge('ctx', v.ctxPercent, 8)}
      {v.rate5h !== undefined ? sep : null}
      {gauge('5h', v.rate5h, 4)}
      {v.rate7d !== undefined ? sep : null}
      {gauge('7d', v.rate7d, 4)}
      {v.costUsd !== undefined ? sep : null}
      {v.costUsd !== undefined ? <Text color={p.hi}>${v.costUsd.toFixed(2)}</Text> : null}
      {sep}
      {v.turnRunning && v.turnStartedAt
        ? <Client key="turn" module="./shimmer.tsx" props={{ text: 'RUNNING', palette: p, skin, elapsedMs: now - v.turnStartedAt, width: 20, lang: getLang() }} />
        : <Text color={p.muted}>IDLE</Text>}
    </Box>
  )
}

/** Compact numbers for above the input box: model, ctx (short bar), 5h, 7d, cost. Missing numbers are omitted. */
function compactParts(v: Session['vitals']) {
  const parts: { key: string; label?: string; pct?: number; text: string }[] = []
  if (v.model) parts.push({ key: 'model', text: v.model })
  if (v.ctxPercent !== undefined) parts.push({ key: 'ctx', label: 'ctx', pct: v.ctxPercent, text: `${bar(v.ctxPercent, 4)} ${Math.round(v.ctxPercent)}%` })
  if (v.rate5h !== undefined) parts.push({ key: '5h', label: '5h', pct: v.rate5h, text: `${Math.round(v.rate5h)}%` })
  if (v.rate7d !== undefined) parts.push({ key: '7d', label: '7d', pct: v.rate7d, text: `${Math.round(v.rate7d)}%` })
  if (v.costUsd !== undefined) parts.push({ key: 'cost', text: `$${v.costUsd.toFixed(2)}` })
  return parts
}

/** The string vitalsCompact renders, for layout width math. */
export const vitalsCompactText = (v: Session['vitals']) =>
  compactParts(v).map(x => (x.label ? `${x.label} ${x.text}` : x.text)).join(' · ')

export function vitalsCompact(el: Elements['terminal'], p: Palette, v: Session['vitals']) {
  const { Text } = el
  return (
    <Text>
      {compactParts(v).map((x, i) => (
        <Text key={`vc-${x.key}`}>
          {i ? <Text color={p.faint}> · </Text> : null}
          {x.label ? <Text color={p.muted}>{x.label} </Text> : null}
          <Text color={x.pct === undefined ? (x.key === 'model' ? p.hi : p.base) : heatColor(p, x.pct)}>{x.text}</Text>
        </Text>
      ))}
    </Text>
  )
}

export function header(c: ViewCtx) {
  const { el, s, p, skin, now, width } = c
  const { Box, Text, Client } = el
  const todos = s.todos
  const done = todos.filter(t => t.status === 'completed').length
  const current = todos.find(t => t.status === 'in_progress')
  return (
    <Box flexDirection="column">
      {vitalsRow(c)}
      {todos.length > 0 ? (
        <Box flexDirection="row">
          <Text color={p.muted}>TODO </Text>
          <Text color={p.hi}>{done}/{todos.length} </Text>
          <Text color={p.success}>{bar((done / todos.length) * 100, Math.min(12, todos.length))}</Text>
          <Text> </Text>
          {current
            ? <Client key="todo-now" module="./shimmer.tsx" props={{ text: current.activeForm || current.content, palette: p, skin, elapsedMs: current.startedAt ? now - current.startedAt : 0, width: Math.max(20, width - 24), lang: getLang() }} />
            : <Text color={p.muted}>{done === todos.length ? t('全部完成', 'All done') : t('等待下一項', 'Waiting for next item')}</Text>}
        </Box>
      ) : null}
    </Box>
  )
}


// ── Layout: side-by-side or stacked, chosen by width ─────────

/** At WIDE columns or more (about a sidebar dragged to half the screen), list and preview sit side by side; narrower, they stack. */
export const WIDE = 90
export const isWide = (c: ViewCtx) => c.width >= WIDE

/** Horizontal split: left gets ratio, one column for the divider; returns both widths. */
export const splitWidths = (width: number, ratio: number) => {
  const left = Math.max(30, Math.floor((width - 1) * ratio))
  return { left, right: Math.max(20, width - 1 - left) }
}

function split(c: ViewCtx, ratio: number, left: (w: number) => unknown, right: (w: number) => unknown) {
  const { Box } = c.el
  const w = splitWidths(c.width, ratio)
  return (
    <Box flexDirection="row">
      <Box width={w.left} flexDirection="column" flexShrink={0}>{left(w.left) as never}</Box>
      <Box width={1} flexShrink={0} flexDirection="column"><c.el.Text color={c.p.faint}>{'│\n'.repeat(Math.max(1, c.rows - 6)).trimEnd()}</c.el.Text></Box>
      <Box width={w.right} flexDirection="column" flexShrink={0} paddingLeft={1}>{right(w.right - 1) as never}</Box>
    </Box>
  )
}

const rule = (c: ViewCtx) => <c.el.Text color={c.p.faint}>{'─'.repeat(Math.max(4, c.width))}</c.el.Text>

// ── Files ─────────────────────────────────────────────────

const fileRow = (c: ViewCtx, f: FileEntry, i: number) => {
  const { el, s, p, ui, act, width } = c
  const { Box, Text, Button } = el
  const sel = ui.selFile === f.path
  const dir = f.path.split('/').slice(-3, -1).join('/')
  return (
    <Box key={`file-${i}`} flexDirection="row" backgroundColor={sel ? p.surface : undefined}>
      <Text color={opColor(p, f.op)} bold>{sel ? '▸' : ' '}{f.op} </Text>
      <Button key={`fsel-${i}`} plain label={clip(short(f.path), 28)} onPress={() => act.selFile(f.path)} />
      <Box flexGrow={1}><Text color={p.faint} wrap="truncate-start"> {width > 70 ? dir : ''}</Text></Box>
      <Text color={p.muted}> x{f.count} {clip(f.by.map(w => whoLabel(s, w)).join(','), 12)} {fmtClock(f.lastAt)}</Text>
    </Box>
  )
}

export function filesTab(c: ViewCtx, maxRows: number) {
  const { el, s, p, ui, act } = c
  const { Box, Text, Button, Code, Image } = el
  const list = [...s.files.values()].filter(f => ui.showReads || f.op !== 'R').sort((a, b) => b.lastAt - a.lastAt)
  const sel = list.find(f => f.path === ui.selFile) ?? list[0]
  const wide = isWide(c)
  const listRows = Math.max(3, Math.min(list.length, Math.floor(maxRows * 0.4)))
  const preview = (width: number) => {
    if (!sel) return <Text color={p.muted}>{t('這個 session 還沒有動過檔案。', 'No files touched in this session yet.')}</Text>
    const showDiff = sel.diff.length > 0 && !ui.fullFile
    const text = showDiff ? sel.diff.join('\n') : c.fileText
    const lines = (text ?? '').split('\n')
    const visible = Math.max(3, (wide ? maxRows : maxRows - listRows - 1) - 3)
    const start = scrollAt(c, 'files:detail', lines.length - visible)
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" columnGap={1}>
          <Text color={p.accent} bold>{short(sel.path)}</Text>
          <Text color={p.muted}>{showDiff ? t('DIFF（本 session）', 'DIFF (this session)') : t('完整內容', 'Full file')}{pos(start, visible, lines.length)}</Text>
          {sel.diff.length ? <Button key="full" hotkey="d" plain dimColor label={ui.fullFile ? t('看 diff', 'Show diff') : t('看完整檔', 'Show full file')} onPress={act.toggleFull} /> : null}
          <Button key="open" hotkey={c.oOwner === 'files' ? 'o' : undefined} plain dimColor label={t('外開', 'Open')} onPress={() => act.openExternal(sel.path)} />
        </Box>
        <Text color={p.faint} wrap="truncate-start">{sel.path}</Text>
        {isMediaPath(sel.path)
          ? c.filePreview?.path === sel.path
            ? <Image key="file-preview" source={{ file: c.filePreview.frame, format: 'png' }}
                {...fit(c.filePreview.width, c.filePreview.height, width, Math.max(4, (wide ? maxRows : maxRows - listRows - 1) - 2))} alt={short(sel.path)} />
            : <Text color={p.muted}>{t('轉換預覽中…', 'Converting preview…')}</Text>
          : text === undefined
          ? <Text color={p.muted}>{t('讀取中…', 'Loading…')}</Text>
          : <Code source={lines.slice(start, start + visible).join('\n')} format={showDiff ? 'diff' : 'source'} path={sel.path} startLine={start + 1} wrap="truncate-end" />}
      </Box>
    )
  }
  const listView = (width: number, rows: number) => {
    const cc = { ...c, width }
    const lstart = scrollAt(c, 'files', list.length - rows)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text color={p.muted}>{t(`${list.length} 個檔案`, `${list.length} files`)}</Text>
          <Button key="reads" hotkey="r" plain dimColor label={ui.showReads ? t('藏起只讀的', 'Hide reads') : t('顯示只讀的', 'Show reads')} onPress={act.toggleReads} />
        </Box>
        {list.slice(lstart, lstart + rows).map((f, i) => fileRow(cc, f, i))}
        {list.length > rows ? <Text color={p.faint}>{pos(lstart, rows, list.length).trim()} · {t('滾輪捲動', 'scroll to see more')}</Text> : null}
      </Box>
    )
  }
  if (wide) return split(c, 0.38, w => listView(w, maxRows - 2), w => preview(w))
  return (
    <Box flexDirection="column">
      {listView(c.width, listRows)}
      {rule(c)}
      {preview(c.width)}
    </Box>
  )
}

// ── Exec ──────────────────────────────────────────────────

const execRow = (c: ViewCtx, x: Exec, i: number) => {
  const { el, s, p, skin, ui, act, now, width } = c
  const { Box, Text, Button, Client } = el
  const who = whoLabel(s, x.who)
  const sel = ui.selExec === x.id
  if (x.status === 'running' || x.status === 'background') {
    return (
      <Box key={`exec-${i}`} flexDirection="column">
        <Box flexDirection="row" backgroundColor={mix(p.bg, p.accent, 0.12)}>
          <Button key={`xsel-${i}`} plain label={sel ? '▸' : ' '} onPress={() => act.selExec(x.id)} />
          <Client key={`run-${x.id}`} module="./shimmer.tsx"
            props={{ text: `$ ${x.command.split('\n')[0]}`, palette: p, skin, elapsedMs: now - x.startedAt, suffix: `${x.status === 'background' ? 'BG ' : ''}${who}`, width: width - 2, lang: getLang() }} />
        </Box>
        {x.status === 'background' && c.bgOutput.get(x.id)
          ? <Text color={p.muted} wrap="truncate-end">   └ {tail(c.bgOutput.get(x.id), 1)[0] ?? ''}</Text>
          : null}
      </Box>
    )
  }
  const ok = x.status === 'ok'
  const dur = x.endedAt ? fmtDur(x.endedAt - x.startedAt) : ''
  return (
    <Box key={`exec-${i}`} flexDirection="column">
      <Box flexDirection="row" backgroundColor={sel ? p.surface : undefined}>
        <Text color={ok ? p.success : p.error} bold>{sel ? '▸' : ' '}{ok ? '✓' : '✗'} </Text>
        <Box flexGrow={1}><Button key={`xsel-${i}`} plain label={clip(`$ ${x.command.split('\n')[0]}`, Math.max(10, width - 30))} onPress={() => act.selExec(x.id)} /></Box>
        <Text color={p.muted}> {clip(who, 8)} {dur.padStart(6)} </Text>
        <Text color={ok ? p.muted : p.error}>exit {x.exit ?? (ok ? 0 : '?')}</Text>
      </Box>
      {!ok ? <Text color={p.error} wrap="truncate-end">   └ {tail(x.stderr || x.stdout, 1)[0] ?? ''}</Text> : null}
    </Box>
  )
}

export function execTab(c: ViewCtx, maxRows: number) {
  const { el, s, p, ui } = c
  const { Box, Text, Code } = el
  const list = [...s.execs].reverse()
  if (!list.length) return <Text color={p.muted}>{t('還沒有跑過指令。', 'No commands run yet.')}</Text>
  const wide = isWide(c)
  // When wide, the right side always shows details: the newest command if none is selected.
  const sel = list.find(x => x.id === ui.selExec) ?? (wide ? list[0] : undefined)
  const listRows = sel && !wide ? Math.max(3, Math.floor(maxRows * 0.4)) : maxRows
  const detail = (width: number) => {
    if (!sel) return null
    const out = sel.status === 'background' ? c.bgOutput.get(sel.id) : [sel.stdout, sel.stderr].filter(Boolean).join('\n')
    return (
      <Box flexDirection="column" width={width}>
        <Code source={sel.command} language="bash" wrap="wrap" />
        {sel.description ? <Text color={p.muted}># {sel.description}</Text> : null}
        <Text color={p.faint} wrap="truncate-start">cwd {sel.cwd ?? '?'} · {whoLabel(s, sel.who)} · {fmtClock(sel.startedAt)}</Text>
        {(() => {
          // Output shows the end by default; scroll up for earlier lines.
          const all = (out ?? '').replace(/\t/g, '  ').split('\n')
          const visible = Math.max(3, (wide ? maxRows : maxRows - listRows - 1) - 5)
          const back = scrollAt(c, 'exec:detail', all.length - visible)
          const end = all.length - back
          return <Text color={p.hi} wrap="truncate-end">{all.slice(Math.max(0, end - visible), end).join('\n') || t('（沒有輸出）', '(no output)')}</Text>
        })()}
      </Box>
    )
  }
  const rows = (width: number, n: number) => {
    const cc = { ...c, width }
    const start = scrollAt(c, 'exec', list.length - n)
    return <Box flexDirection="column">{list.slice(start, start + n).map((x, i) => execRow(cc, x, i))}</Box>
  }
  if (wide) return split(c, 0.5, w => rows(w, maxRows), w => detail(w))
  return (
    <Box flexDirection="column">
      {rows(c.width, listRows)}
      {sel ? rule(c) : null}
      {detail(c.width)}
    </Box>
  )
}

// ── Map ───────────────────────────────────────────────────

export function mapTab(c: ViewCtx) {
  const { el, s, p, ui, act } = c
  const { Box, Text, Button, Raster } = el
  const views: [UiState['mapView'], string][] = [['radar', t('雷達', 'Radar')], ['graph', t('關係圖', 'Graph')], ['heat', t('熱度', 'Heat')], ['combo', t('綜合', 'Combo')], ['board', t('看板', 'Board')]]
  const agents = agentsOf(s)
  const running = agents.filter(a => a.id !== 'main' && a.running).length
  const spots = c.map ? agentSpots(ui.mapView, c.map.cols, c.map.rows, s, ui.comboSlot) : []
  const spot = spots.find(x => x.key === ui.msgAt) ?? spots.find(x => x.id === ui.msgTo)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {views.map(([v, label], i) => (
          <Button key={`mv-${v}`} hotkey={String(i + 1)} plain dimColor={ui.mapView !== v} label={label} onPress={() => act.mapView(v)} />
        ))}
        {ui.mapView === 'combo' ? <Button key="mv-next" hotkey="n" plain dimColor label={t('輪替', 'Cycle')} onPress={act.nextCombo} /> : null}
        <Text color={p.faint}>│ {t('只看：', 'Focus:')}</Text>
        {agents.map((a, i) => (
          <Button key={`fa-${i}`} plain dimColor={ui.focusAgent !== a.id} label={i === 0 ? 'MAIN' : `${a.label} ${s.agents.get(a.id)?.type ?? ''}`} onPress={() => act.focusAgent(ui.focusAgent === a.id ? undefined : a.id)} />
        ))}
        <Box flexGrow={1} />
        {running > 1 ? <Button key="msg-all" plain dimColor={ui.msgTo !== 'all'} label={t('✉ 全部', '✉ All')} onPress={() => act.openMsg('all')} /> : null}
      </Box>
      {ui.mapView === 'board'
        ? boardView(c)
        : c.map ? (
          <Box width={c.map.cols} height={c.map.rows} position="relative">
            <Raster key="map" columns={c.map.cols} rows={c.map.rows} cells={c.map.cells} />
            {spots.map(x => (
              <Box key={`box-${x.key}`} position="absolute" left={Math.max(0, x.col)} top={x.row}>
                <Button key={x.key} plain dimColor={ui.msgTo !== x.id} label={x.tag} onPress={() => act.openMsg(x.id, x.key)} />
              </Box>
            ))}
            {ui.msgTo && ui.msgTo !== 'all' && spot ? msgBox(c, ui.msgTo, spot.col + 4, spot.row - 1, c.map.cols, c.map.rows) : null}
            {ui.msgTo === 'all' ? msgBox(c, 'all', Math.floor(c.map.cols / 2) - 22, 2, c.map.cols, c.map.rows) : null}
          </Box>
        ) : null}
    </Box>
  )
}

const MSG_W = 46

/**
 * Popup for messaging an agent: status, current activity, input box.
 * With left/top it floats over the radar (clamped to the view); without, it sits below the board.
 */
function msgBox(c: ViewCtx, to: string, left?: number, top?: number, cols = c.width, rows = 99) {
  const { el, s, p, act, now } = c
  const { Box, Text, Button, Input } = el
  const floating = left !== undefined && top !== undefined
  const w = Math.min(floating ? MSG_W : MSG_W * 2, cols - 2)
  const x = Math.max(0, Math.min(left ?? 0, cols - w))
  const y = Math.max(0, Math.min(top ?? 0, rows - 5))
  const agents = agentsOf(s)
  const a = s.agents.get(to)
  const tag = to === 'all' ? t('全部', 'All') : to === 'main' ? '[M] MAIN' : `[${agents.findIndex(z => z.id === to)}] ${a?.type ?? ''}`
  const state = to === 'all'
    ? t(`執行中的 subagent ${agents.filter(z => z.id !== 'main' && z.running).length} 個`, `${agents.filter(z => z.id !== 'main' && z.running).length} subagents running`)
    : to === 'main' ? (s.vitals.turnRunning ? t('執行中，會排在目前這輪後面', 'Running; queued after this turn') : t('閒置', 'Idle')) : a?.status === 'running' ? t(`執行中 · ${fmtDur(now - a.startedAt)}`, `Running · ${fmtDur(now - a.startedAt)}`) : t('已結束，送出會叫醒它', 'Finished; sending wakes it up')
  const doing = to === 'main' || to === 'all' ? undefined : a?.doing
  return (
    <Box key={`msg-${to}`} position={floating ? 'absolute' : undefined} left={floating ? x : undefined} top={floating ? y : undefined} width={w} flexDirection="column" borderStyle="round" borderColor={p.accent} backgroundColor={p.bg} paddingX={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text color={p.accent} bold>{tag}</Text>
        <Box flexShrink={1}><Text color={p.muted} wrap="truncate-end">{state}</Text></Box>
        <Box flexGrow={1} />
        <Button key="msg-close" plain dimColor label="✕" onPress={act.closeMsg} />
      </Box>
      {doing ? <Text color={p.faint} wrap="truncate-end">{t('正在：', 'Doing: ')}{doing}</Text> : null}
      <Input key={`msg-input-${to}`} autoFocus placeholder={to === 'all' ? t('給所有執行中 subagent 的指令…', 'Message all running subagents…') : t('給這個 agent 的指令…', 'Message this agent…')} submitLabel={t('送出', 'Send')}
        onSubmit={v => act.sendMsg(to, v)} />
    </Box>
  )
}

/** Board: MAIN on top, subagents in three columns by status (running/done/failed); narrow widths fall back to a one-per-line list. */
function boardView(c: ViewCtx) {
  const { el, s, p, act, now, width, ui } = c
  const { Box, Text, Button } = el
  const agents = agentsOf(s)
  const subs = agents.slice(1).map((x, i) => ({ ...x, n: i + 1, a: s.agents.get(x.id)! })).filter(x => x.a)
  const filesOf = (id: string) => [...s.files.values()].filter(f => f.by.includes(id)).length
  const age = (x: (typeof subs)[number]) => fmtDur((x.a.endedAt ?? now) - x.a.startedAt)
  const msgBtn = (id: string) => <Button key={`bm-${id}`} plain dimColor={ui.msgTo !== id} label="✉" onPress={() => act.openMsg(id)} />
  const main = (
    <Box flexDirection="row" columnGap={1}>
      <Text color={p.accent} bold>[M] MAIN</Text>
      <Text color={s.vitals.turnRunning ? p.success : p.muted}>{s.vitals.turnRunning ? t('執行中', 'Running') : t('閒置', 'Idle')}</Text>
      <Box flexGrow={1} flexShrink={1}><Text color={p.faint} wrap="truncate-end">{s.vitals.model ?? ''}</Text></Box>
      {msgBtn('main')}
    </Box>
  )
  const stateColor = (st: string) => (st === 'running' ? p.success : st === 'error' ? p.error : p.muted)
  const msg = ui.msgTo ? (
    <Box flexDirection="column" marginTop={1}>
      {msgBox(c, ui.msgTo)}
    </Box>
  ) : null
  if (width < 90 || !subs.length) return (
    <Box flexDirection="column">
      {main}
      {!subs.length ? <Text color={p.muted}>{t('還沒有 subagent。', 'No subagents yet.')}</Text> : null}
      {[...subs].sort((x, y) => Number(y.a.status === 'running') - Number(x.a.status === 'running')).map(x => (
        <Box key={`bl-${x.id}`} flexDirection="row" columnGap={1}>
          <Text color={stateColor(x.a.status)} bold>[{x.n}]</Text>
          <Text color={p.hi}>{clip(x.a.label, 24)}</Text>
          <Text color={p.muted}>{x.a.type}</Text>
          <Box flexGrow={1} flexShrink={1}><Text color={p.faint} wrap="truncate-end">{x.a.doing ?? ''}</Text></Box>
          <Text color={p.muted}>{age(x)} · {t(`${filesOf(x.id)} 檔`, `${filesOf(x.id)} files`)}</Text>
          {msgBtn(x.id)}
        </Box>
      ))}
      {msg}
    </Box>
  )
  const colW = Math.floor((width - 2) / 3)
  const column = (title: string, list: typeof subs, color: string) => (
    <Box key={`bc-${title}`} flexDirection="column" width={colW} flexShrink={0}>
      <Text color={color} bold>{title} {list.length}</Text>
      {list.map(x => (
        <Box key={`bk-${x.id}`} flexDirection="column" borderStyle="round" borderColor={ui.msgTo === x.id ? p.accent : mix(p.faint, color, 0.4)} paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            <Text color={color} bold>[{x.n}]</Text>
            <Box flexGrow={1} flexShrink={1}><Text color={p.hi} wrap="truncate-end">{x.a.type}</Text></Box>
            {msgBtn(x.id)}
          </Box>
          <Text color={p.base} wrap="truncate-end">{x.a.label}</Text>
          {x.a.doing && x.a.status === 'running' ? <Text color={p.faint} wrap="truncate-end">⏵ {x.a.doing}</Text> : null}
          <Text color={p.muted}>{age(x)} · {t(`${filesOf(x.id)} 檔`, `${filesOf(x.id)} files`)}</Text>
        </Box>
      ))}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {main}
      <Box flexDirection="row" columnGap={1}>
        {column(t('執行中', 'Running'), subs.filter(x => x.a.status === 'running'), p.success)}
        {column(t('完成', 'Done'), subs.filter(x => x.a.status === 'done'), p.muted)}
        {column(t('失敗', 'Failed'), subs.filter(x => x.a.status === 'error'), p.error)}
      </Box>
      {msg}
    </Box>
  )
}


// ── Todo ──────────────────────────────────────────────────

export function todoTab(c: ViewCtx, maxRows: number) {
  const { el, s, p, skin, now, width } = c
  const { Box, Text, Client } = el
  if (!s.todos.length) return <Text color={p.muted}>{t('這個 session 目前沒有 checklist；agent 開清單時會出現在這裡。', 'No checklist in this session. It appears here when the agent starts one.')}</Text>
  return (
    <Box flexDirection="column">
      {s.todos.slice(scrollAt(c, 'todo', s.todos.length - maxRows), scrollAt(c, 'todo', s.todos.length - maxRows) + maxRows).map((t, i) => {
        if (t.status === 'in_progress')
          return <Client key={`todo-${i}`} module="./shimmer.tsx" props={{ text: t.content, palette: p, skin, elapsedMs: t.startedAt ? now - t.startedAt : 0, width, lang: getLang() }} />
        const done = t.status === 'completed'
        const fresh = done && t.doneAt && now - t.doneAt < 3000
        return (
          <Box key={`todo-${i}`} flexDirection="row">
            <Text color={done ? p.success : p.faint}>{done ? '✓ ' : '○ '}</Text>
            <Box flexGrow={1}><Text color={fresh ? p.hi : done ? p.muted : p.base} bold={!!fresh}>{t.content}</Text></Box>
            {done && t.doneAt ? <Text color={p.faint}> {t.startedAt ? fmtDur(t.doneAt - t.startedAt) : ''} {whoLabel(s, t.by ?? 'main')} {fmtClock(t.doneAt)}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

// ── Files (project tree) ─────────────────────────────────

type TreeRow = { path: string; name: string; depth: number; dir: boolean; open: boolean }

/** Relative paths → visible rows: folders first, sorted by name; collapsed folders are not expanded. */
export function treeRows(paths: readonly string[], open: Record<string, true>): TreeRow[] {
  type Node = { dirs: Map<string, Node>; files: string[] }
  const root: Node = { dirs: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let n = root
    for (const part of parts.slice(0, -1)) {
      if (!n.dirs.has(part)) n.dirs.set(part, { dirs: new Map(), files: [] })
      n = n.dirs.get(part)!
    }
    n.files.push(parts.at(-1)!)
  }
  const rows: TreeRow[] = []
  const walk = (n: Node, prefix: string, depth: number) => {
    for (const name of [...n.dirs.keys()].sort()) {
      const path = prefix + name
      const isOpen = !!open[path]
      rows.push({ path, name, depth, dir: true, open: isOpen })
      if (isOpen) walk(n.dirs.get(name)!, `${path}/`, depth + 1)
    }
    for (const name of n.files.sort()) rows.push({ path: prefix + name, name, depth, dir: false, open: false })
  }
  walk(root, '', 0)
  return rows
}

/** FILES: the whole project tree. Click a folder to expand, a file to preview on the right; files touched this session are marked M/A/R. */
export function projectTab(c: ViewCtx, maxRows: number) {
  const { el, s, p, ui, act, project } = c
  const { Box, Text, Button, Code, Image } = el
  if (!project) return <Text color={p.muted}>{t('讀取專案檔案中…', 'Reading project files…')}</Text>
  const wide = isWide(c)
  const rows = treeRows(project.paths, ui.treeOpen)
  const listRows = Math.max(3, (wide ? maxRows : Math.floor(maxRows * 0.45)) - 2)
  const touched = (rel: string) => s.files.get(`${project.root}/${rel}`)
  const tree = (width: number) => {
    const start = scrollAt(c, 'project', rows.length - listRows)
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" columnGap={1}>
          <Box flexShrink={1}><Text color={p.muted} wrap="truncate-start">{short(project.root)}</Text></Box>
          <Text color={p.faint}>· {t(`${project.paths.length}${project.truncated ? '+' : ''} 個檔案`, `${project.paths.length}${project.truncated ? '+' : ''} files`)}</Text>
          <Box flexGrow={1} />
          <Button key="follow" plain dimColor={!ui.follow} label={ui.follow ? t('● 跟隨', '● Follow') : t('○ 跟隨', '○ Follow')} onPress={act.toggleFollow} />
        </Box>
        {rows.slice(start, start + listRows).map(r => {
          const f = r.dir ? undefined : touched(r.path)
          const isSel = !r.dir && r.path === ui.treeSel
          return (
            <Box key={`tr-${r.path}`} flexDirection="row" backgroundColor={isSel ? p.surface : undefined}>
              <Text>{'  '.repeat(r.depth)}</Text>
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`tb-${r.path}`} plain dimColor={!r.dir && !f && !isSel}
                  label={clip(r.dir ? `${r.open ? '▾' : '▸'} ${r.name}/` : `  ${r.name}`, Math.max(4, width - r.depth * 2 - 3))}
                  onPress={() => (r.dir ? act.treeToggle(r.path) : act.treeSelect(r.path))} />
              </Box>
              {c.live?.path === `${project.root}/${r.path}`
                ? <Text color={p.accent} bold> ✎</Text>
                : f ? <Text color={opColor(p, f.op)}> {f.op}</Text> : null}
            </Box>
          )
        })}
        {rows.length > listRows ? <Text color={p.faint}>{pos(start, listRows, rows.length).trim()} · {t('滾輪捲動', 'scroll to see more')}</Text> : null}
      </Box>
    )
  }
  const preview = (width: number, height: number) => {
    const rel = ui.treeSel
    if (!rel) return <Text color={p.muted}>{t('點左邊的檔案在這裡預覽；資料夾點一下展開。', 'Click a file on the left to preview it here. Click a folder to expand it.')}</Text>
    const abs = `${project.root}/${rel}`
    const lines = (c.treeText ?? '').split('\n')
    const visible = Math.max(3, height - 2)
    const start = scrollAt(c, 'project:detail', lines.length - visible)
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" columnGap={1}>
          <Text color={p.accent} bold>{rel}</Text>
          {isMediaPath(rel) ? null : <Text color={p.muted}>{pos(start, visible, lines.length)}</Text>}
          <Button key="tree-open" hotkey={c.oOwner === 'project' ? 'o' : undefined} plain dimColor label={t('外開', 'Open')} onPress={() => act.openExternal(abs)} />
        </Box>
        {c.live?.path === abs
          ? livePreview(c, c.live, width, Math.max(3, height - 2))
          : c.flash?.path === abs && c.treeText !== undefined
          ? flashPreview(c, c.treeText, c.flash, width, Math.max(3, height - 2))
          : isMediaPath(rel)
          ? c.treePreview?.path === abs
            ? <Image key="tree-preview" source={{ file: c.treePreview.frame, format: 'png' }}
                {...fit(c.treePreview.width, c.treePreview.height, width, Math.max(4, height - 1))} alt={rel} />
            : <Text color={p.muted}>{t('轉換預覽中…', 'Converting preview…')}</Text>
          : c.treeText === undefined
          ? <Text color={p.muted}>{t('讀取中…', 'Loading…')}</Text>
          : <Code source={lines.slice(start, start + visible).join('\n')} format="source" path={abs} startLine={start + 1} wrap="truncate-end" />}
      </Box>
    )
  }
  if (wide) return split(c, 0.38, w => tree(w), w => preview(w, maxRows))
  return (
    <Box flexDirection="column">
      {tree(c.width)}
      {rule(c)}
      {preview(c.width, maxRows - listRows - 3)}
    </Box>
  )
}

// Live edit: the old block in red strikethrough, new content growing on green, a block cursor at the end; the view follows the cursor.
function livePreview(c: ViewCtx, live: LiveEdit, width: number, height: number) {
  const { el, p, now, treeText } = c
  const { Box, Text } = el
  type Row = { no?: number; text: string; kind: 'ctx' | 'old' | 'new' }
  const rows: Row[] = []
  const newLines = live.new.split('\n')
  if (live.tool === 'Edit') {
    const lines = (treeText ?? '').split('\n')
    const at = live.old !== undefined ? lineOf(treeText ?? '', live.old) : -1
    if (at < 0) rows.push({ text: live.old === undefined ? t('讀取要換掉的段落…', 'Reading the text to replace…') : t('在目前的檔案裡找不到要換掉的段落', 'Text to replace not found in the current file'), kind: 'ctx' })
    else {
      const oldLines = live.old!.split('\n')
      for (let i = Math.max(0, at - 3); i < at; i++) rows.push({ no: i + 1, text: lines[i]!, kind: 'ctx' })
      oldLines.forEach((t, i) => rows.push({ no: at + i + 1, text: t, kind: 'old' }))
      newLines.forEach((t, i) => rows.push({ no: at + i + 1, text: t, kind: 'new' }))
      if (live.done) for (let i = at + oldLines.length; i < Math.min(lines.length, at + oldLines.length + 3); i++) rows.push({ no: i - oldLines.length + newLines.length + 1, text: lines[i]!, kind: 'ctx' })
    }
  } else newLines.forEach((t, i) => rows.push({ no: i + 1, text: t, kind: 'new' }))
  // Keep the cursor row (the last new row) about two thirds down the window.
  const cursor = rows.map(r => r.kind).lastIndexOf('new')
  const start = Math.max(0, Math.min(rows.length - height, cursor - Math.floor(height * 0.66)))
  const blink = Math.floor(now / 500) % 2 === 0
  const gutter = String(Math.max(...rows.map(r => r.no ?? 0), 1)).length
  return (
    <Box flexDirection="column" width={width}>
      <Text color={p.accent}>{live.tool === 'Write' ? t('寫入中', 'Writing') : t('修改中', 'Editing')}{live.done ? t('，等工具執行', ', waiting for the tool to run') : '…'}</Text>
      {rows.slice(start, start + height - 1).map((r, i) => {
        const isCursor = start + i === cursor && !live.done
        const sign = r.kind === 'old' ? '-' : r.kind === 'new' ? '+' : ' '
        return (
          <Box key={`lv-${start + i}`} flexDirection="row">
            <Text color={p.faint}>{String(r.no ?? '').padStart(gutter)} {sign} </Text>
            <Box flexShrink={1}>
              <Text wrap="truncate-end" color={r.kind === 'old' ? p.error : r.kind === 'new' ? p.hi : p.base}
                backgroundColor={r.kind === 'new' ? mix(p.bg, p.success, 0.22) : undefined} strikethrough={r.kind === 'old'}>
                {r.text}{isCursor ? (blink ? '█' : ' ') : ''}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

// Just edited: show the file normally with the changed lines on green; reverts to the plain code preview after a few seconds.
function flashPreview(c: ViewCtx, text: string, flash: { from: number; to: number }, width: number, height: number) {
  const { el, p } = c
  const { Box, Text } = el
  const lines = text.split('\n')
  const start = Math.max(0, Math.min(lines.length - height, flash.from - 3))
  const gutter = String(Math.min(lines.length, start + height)).length
  return (
    <Box flexDirection="column" width={width}>
      {lines.slice(start, start + height).map((t, i) => {
        const n = start + i
        const hot = n >= flash.from && n <= flash.to
        return (
          <Box key={`fl-${n}`} flexDirection="row">
            <Text color={hot ? p.success : p.faint}>{String(n + 1).padStart(gutter)} {hot ? '▎' : ' '}</Text>
            <Box flexShrink={1}><Text wrap="truncate-end" color={hot ? p.hi : p.base} backgroundColor={hot ? mix(p.bg, p.success, 0.22) : undefined}>{t}</Text></Box>
          </Box>
        )
      })}
    </Box>
  )
}

// ── Arch ─────────────────────────────────────────────────

/** ARCH: LikeC4 diagram. Click a node to see its relations, click again (if it has ▸) to drill down; wheel scrolls vertically, [ ] horizontally. */
export function archTab(c: ViewCtx, rows: number) {
  const { el, p, act, arch, ui } = c
  const { Box, Text, Button, Raster } = el
  if (!arch) return <Text color={p.muted}>{t('找專案的架構圖中…', 'Looking for the project diagram…')}</Text>
  if (arch.missing) return (
    <Box flexDirection="column">
      <Text color={p.muted}>{t('這個專案還沒有架構圖。', 'This project has no architecture diagram yet.')}</Text>
      <Text color={p.faint}>{t(`在 ${short(arch.dir)} 寫一份 LikeC4（*.c4），存檔後會出現在這裡。`, `Write a LikeC4 file (*.c4) in ${short(arch.dir)}; it appears here once saved.`)}</Text>
    </Box>
  )
  const model = arch.model
  const errorLines = arch.error ? arch.error.split('\n').filter(Boolean).slice(0, 2) : []
  if (!model) return (
    <Box flexDirection="column">
      {errorLines.length ? errorLines.map((l, i) => <Text key={`arch-err-${i}`} color={p.error} wrap="truncate-end">{l}</Text>) : <Text color={p.muted}>{t('匯出中…', 'Exporting…')}</Text>}
    </Box>
  )
  const trail = ui.archTrail.filter(id => model.views[id])
  const view = model.views[trail.at(-1) ?? model.first]!
  const sel = view.nodes.find(n => n.id === ui.archSel)
  const detailRows = sel ? 3 : 1
  const winRows = Math.max(3, rows - 1 - errorLines.length - detailRows)
  const winCols = c.width
  const s = archScale(view, winCols)
  const size = archSize(view, s)
  const panX = Math.max(0, Math.min(ui.archPanX, size.cols - winCols))
  const panY = scrollAt(c, 'arch', Math.max(0, size.rows - winRows))
  const crumbs = trail.length ? trail : [model.first]
  const drill = (n: ArchNode) => !!(n.navigateTo || n.repo)
  const rel = sel ? relationsOf(view, sel.id) : undefined
  const list = (xs: string[]) => xs.join(t('、', ', ')) || t('（無）', '(none)')
  // Draw containers first (frames underneath), then regular nodes on top of the edges.
  const ordered = [...view.nodes].sort((a, b) => Number(b.isGroup) - Number(a.isGroup))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        {c.archUpper.map((label, i) => (
          <Box key={`dcrumb-${i}`} flexDirection="row">
            <Button key={`arch-up-${i}`} plain dimColor label={label} onPress={() => act.archUp(i)} />
            <Text color={p.faint}> ›</Text>
          </Box>
        ))}
        {crumbs.map((id, i) => (
          <Box key={`crumb-${i}`} flexDirection="row">
            {i ? <Text color={p.faint}>› </Text> : null}
            <Button key={`arch-crumb-${i}`} plain dimColor={i < crumbs.length - 1} label={model.views[id]?.title ?? id} onPress={() => act.archTrail(i)} />
          </Box>
        ))}
        <Box flexGrow={1} />
        {size.cols > winCols ? <Button key="arch-left" hotkey="b" plain dimColor label="◀" onPress={() => act.archPan(-Math.max(8, Math.floor(winCols / 2)))} /> : null}
        {size.cols > winCols ? <Button key="arch-right" hotkey="w" plain dimColor label="▶" onPress={() => act.archPan(Math.max(8, Math.floor(winCols / 2)))} /> : null}
        {arch.at ? <Text color={p.faint}>{fmtClock(arch.at)}</Text> : null}
        <Button key="arch-open" hotkey={c.oOwner === 'arch' ? 'o' : undefined} plain dimColor label={t('完整檢視', 'Full view')} onPress={act.archOpen} />
      </Box>
      {errorLines.map((l, i) => <Text key={`arch-err-${i}`} color={p.error} wrap="truncate-end">{l}</Text>)}
      <Box key={`arch-win-${view.id}`} width={winCols} height={winRows} position="relative" overflow="hidden">
        <Raster key={`arch-edges-${view.id}`} columns={winCols} rows={winRows} cells={drawEdges(view, s, p, panX, panY, winCols, winRows, sel?.id)} />
        {ordered.map(n => {
          const r = nodeRect(n, s)
          const x = r.x - panX, y = r.y - panY
          if (x + r.w <= 0 || y + r.h <= 0 || x >= winCols || y >= winRows) return null
          const isSel = n.id === sel?.id
          const label = clip(`${n.title}${drill(n) ? ' ▸' : ''}`, Math.max(3, r.w - 2))
          if (n.isGroup) return (
            <Box key={`an-${n.id}`} position="absolute" left={x} top={y} width={r.w} height={r.h}
              borderStyle="round" borderColor={isSel ? p.accent : p.faint} paddingX={1}>
              <Button key={`anb-${n.id}`} plain dimColor={!isSel} label={label} onPress={() => act.archPress(n)} />
            </Box>
          )
          return (
            <Box key={`an-${n.id}`} position="absolute" left={x} top={y} width={r.w} height={r.h} flexDirection="column"
              borderStyle="round" borderColor={isSel ? p.accent : drill(n) ? p.hi : p.muted} backgroundColor={p.bg} paddingX={1} overflow="hidden">
              <Button key={`anb-${n.id}`} plain label={label} onPress={() => act.archPress(n)} />
              {r.h >= 4 && n.description ? <Text color={p.muted} wrap="truncate-end">{n.description}</Text> : null}
            </Box>
          )
        })}
      </Box>
      {sel && rel ? (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            <Text color={p.accent} bold>{sel.title}</Text>
            <Box flexShrink={1}><Text color={p.muted} wrap="truncate-end">{sel.description ?? ''}</Text></Box>
            <Box flexGrow={1} />
            {drill(sel) ? <Button key="arch-enter" hotkey="v" plain label={sel.navigateTo ? t('▸ 進入', '▸ Enter') : t('▸ 打開 repo 的圖', '▸ Open repo diagram')} onPress={() => act.archPress(sel)} /> : null}
          </Box>
          <Text color={p.base} wrap="truncate-end">→ {list(rel.out.map(x => (x.label ? t(`${x.to}（${x.label}）`, `${x.to} (${x.label})`) : x.to)))}</Text>
          <Text color={p.base} wrap="truncate-end">← {list(rel.in.map(x => (x.label ? t(`${x.from}（${x.label}）`, `${x.from} (${x.label})`) : x.from)))}</Text>
        </Box>
      ) : (
        <Text color={p.faint} wrap="truncate-end">{t('點方塊看關係，有 ▸ 的再點一次進入下一層；滾輪上下、b w 左右、o 用瀏覽器開完整檢視', 'Click a box to see its relations; click again on ▸ to go a level down. Wheel scrolls up/down, b w pan left/right, o opens the full view in a browser')}</Text>
      )}
    </Box>
  )
}

// ── Media ─────────────────────────────────────────────────

/** A character cell is about twice as tall as wide; compute the largest aspect-preserving box within columns×rows. */
export const fit = (w: number, h: number, columns: number, rows: number) => {
  const clamp = (n: number) => Math.max(1, Math.min(255, Math.round(n)))
  const across = Math.min(columns, (rows * 2 * w) / Math.max(1, h))
  return { columns: clamp(across), rows: clamp((across * h) / Math.max(1, w) / 2) }
}

export function mediaTab(c: ViewCtx, maxRows: number) {
  const { el, s, p, ui, act } = c
  const { Box, Text, Button, Image } = el
  const kinds: UiState['mediaFilter'][] = ['ALL', 'IMG', 'GIF', 'VID', '3D', 'WEB']
  const list = s.media.filter(m => ui.mediaFilter === 'ALL' || m.kind === ui.mediaFilter).slice().reverse()
  const sel: Media | undefined = list.find(m => m.id === ui.selMedia) ?? list[0]
  const wide = isWide(c)
  const listView = (n: number) => (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {kinds.map(k => (
          <Button key={`mk-${k}`} plain dimColor={ui.mediaFilter !== k} label={`${k === 'ALL' ? t('全部', 'All') : k} ${k === 'ALL' ? s.media.length : s.media.filter(m => m.kind === k).length}`} onPress={() => act.mediaFilter(k)} />
        ))}
      </Box>
      {!list.length ? <Text color={p.muted}>{t('還沒有媒體。產生圖片、GIF、影片或 3D 模型時會自動出現。', 'No media yet. Images, GIFs, videos and 3D models show up here as they are created.')}</Text> : null}
      {list.slice(0, n).map((m, i) => (
        <Box key={`m-${i}`} flexDirection="row" backgroundColor={sel?.id === m.id ? p.surface : undefined}>
          <Text color={p.accent} bold>{sel?.id === m.id ? '▸' : ' '}{m.id.padEnd(7)}</Text>
          <Button key={`ms-${i}`} plain label={clip(short(m.path), 24)} onPress={() => act.selMedia(m.id)} />
          <Text color={p.muted}> {m.kind === 'VID' || m.kind === 'GIF' ? t(`${m.frames.length} 幀`, `${m.frames.length} frames`) : m.kind === '3D' || m.kind === 'WEB' ? (m.url ? t('→ Brave · 已發佈', '→ Brave · published') : '→ Brave') : `${m.width}×${m.height}`}</Text>
        </Box>
      ))}
    </Box>
  )
  const view = (width: number, rows: number) =>
    sel && sel.kind !== '3D' && sel.kind !== 'WEB' && sel.frames.length
      ? <Image key="media-view" source={{ file: sel.frames[sel.frames.length > 1 ? c.mediaFrame % sel.frames.length : 0]!, format: 'png' }}
          {...fit(sel.width, sel.height, width, rows)} alt={sel.id} />
      : sel ? (
        <Box flexDirection="column">
          <Text color={p.muted}>{sel.kind === '3D' ? t(`${sel.id} 在瀏覽器裡看（拖曳旋轉、滾輪縮放）。`, `View ${sel.id} in the browser (drag to rotate, scroll to zoom).`) : t(`${sel.id} 在瀏覽器裡看（點下面打開）。`, `View ${sel.id} in the browser (open it below).`)}</Text>
          <Text color={p.faint} wrap="truncate-start">{sel.path}</Text>
          <Box flexDirection="row" columnGap={2}>
            <Button key="media-open" plain label={t('開本機檔案', 'Open local file')} onPress={() => act.selMedia(sel.id)} />
            {sel.url ? <Button key="media-url" plain dimColor label={t('開 claude.ai 連結', 'Open claude.ai link')} onPress={() => act.openUrl(sel.url!)} /> : null}
          </Box>
          {sel.url ? <Text color={p.faint} wrap="truncate-end">{sel.url}</Text> : null}
        </Box>
      ) : null
  if (wide) return split(c, 0.32, () => listView(maxRows - 2), w => view(w, Math.max(6, maxRows - 1)))
  const shown = Math.min(list.length, 6)
  return (
    <Box flexDirection="column">
      {listView(6)}
      {view(c.width, Math.max(6, maxRows - shown - 3))}
    </Box>
  )
}

// ── Log ───────────────────────────────────────────────────

export function logTab(c: ViewCtx, maxRows: number) {
  const { el, s, p } = c
  const { Box, Text } = el
  const color = (k: string) => (k === 'error' ? p.error : k === 'check' ? p.warn : k === 'agent' ? p.accent : k === 'media' ? p.success : p.base)
  return (
    <Box flexDirection="column">
      {[...s.log].reverse().slice(scrollAt(c, 'log', s.log.length - maxRows), scrollAt(c, 'log', s.log.length - maxRows) + maxRows).map((e, i) => (
        <Box key={`log-${i}`} flexDirection="row">
          <Text color={p.faint}>{fmtClock(e.at)} </Text>
          <Text color={p.muted}>{clip(whoLabel(s, e.who), 8).padEnd(8)} </Text>
          <Box flexGrow={1}><Text color={color(e.kind)} wrap="truncate-end">{e.text}</Text></Box>
        </Box>
      ))}
    </Box>
  )
}

// ── Composition ───────────────────────────────────────────

export function body(c: ViewCtx, tab: Tab, maxRows: number) {
  if (tab === 'files') return filesTab(c, maxRows)
  if (tab === 'exec') return execTab(c, maxRows)
  if (tab === 'map') return mapTab(c)
  if (tab === 'todo') return todoTab(c, maxRows)
  if (tab === 'media') return mediaTab(c, maxRows)
  return logTab(c, maxRows)
}

/** Layout C: all sections stacked in one column, each collapsible; Map uses a fixed height here. */
// ── Dashboard: render each cell of the layout tree (layout.ts) as a card ──

export const PANEL_LABEL: Record<Panel, string> = {
  status: 'STATUS', todo: 'TODO', exec: 'EXEC', files: 'CHANGES', project: 'FILES', arch: 'ARCH', map: 'MAP', media: 'MEDIA', log: 'LOG',
}
export const PANEL_KEY: Partial<Record<Panel, string>> = { todo: 't', exec: 'e', files: 'c', project: 'f', arch: 'a', map: 'm', media: 'i', log: 'l' }

const panelCount = (s: Session, panel: Panel) =>
  panel === 'todo' ? (s.todos.length ? `${s.todos.filter(x => x.status === 'completed').length}/${s.todos.length}` : '')
    : panel === 'exec' ? (s.execs.length ? t(`${s.execs.filter(x => x.status === 'running' || x.status === 'background').length} 跑 · ${s.execs.length}`, `${s.execs.filter(x => x.status === 'running' || x.status === 'background').length} running · ${s.execs.length}`) : '')
      : panel === 'files' ? (s.files.size ? String(s.files.size) : '') : panel === 'project' ? '' : panel === 'media' ? (s.media.length ? String(s.media.length) : '')
        : panel === 'log' ? (s.log.length ? String(s.log.length) : '') : ''

/** Card contents; width and height already exclude border, padding and title row. */
function panelBody(c: ViewCtx, panel: Panel, rows: number) {
  const { el, p } = c
  if (panel === 'status') return statusBody(c)
  if (panel === 'arch') return archTab(c, rows)
  if (panel === 'project') return projectTab(c, rows)
  return body(c, panel, rows)
}

/** STATUS: model, quota, checklist progress, plus the hotkey legend. */
function statusBody(c: ViewCtx) {
  const { el, p, act } = c
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {header(c)}
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color={p.faint}>{Object.entries(PANEL_KEY).map(([k, v]) => `${v} ${PANEL_LABEL[k as Panel]}`).join('  ')}</Text>
        <Text color={p.faint}>│</Text>
        <Button key="edit-layout" hotkey="g" plain dimColor label={t('編輯版面', 'Edit layout')} onPress={act.editLayout} />
        <Button key="zen" hotkey="z" plain dimColor label={t('專注', 'Zen')} onPress={() => act.zen()} />
        <Box flexGrow={1} />
        <Button key="minimize" plain dimColor label={t('▁ 縮小', '▁ Minimize')} onPress={act.minimize} />
      </Box>
    </Box>
  )
}

/** One cell: a rounded card whose title row lists its stacked tabs (click to switch), with the active tab's count on the right. */
function cellCard(c: ViewCtx, cell: Cell, k: number) {
  const { el, s, p, act } = c
  const { Box, Text, Button } = el
  const { rect, leaf } = cell
  const active = leaf.tabs[leaf.active ?? 0]!
  const innerW = Math.max(4, rect.w - 4)
  const innerH = Math.max(1, rect.h - 3)
  const lit = leaf.tabs.some(t => c.fresh.includes(t))
  // STATUS is already a status row, so it skips the title row and gives that line to the hotkey legend.
  if (leaf.tabs.length === 1 && active === 'status') return (
    <Box key={`cell-${k}`} position="absolute" left={rect.x} top={rect.y} width={rect.w} height={rect.h}
      flexDirection="column" borderStyle="round" borderColor={mix(p.faint, p.accent, 0.25)} paddingX={1} overflow="hidden">
      {panelBody({ ...c, width: innerW, rows: rect.h - 2 }, 'status', rect.h - 2)}
    </Box>
  )
  return (
    <Box key={`cell-${k}`} position="absolute" left={rect.x} top={rect.y} width={rect.w} height={rect.h}
      flexDirection="column" borderStyle="round" borderColor={lit ? p.accent : mix(p.faint, p.accent, 0.25)} paddingX={1} overflow="hidden">
      <Box flexDirection="row" columnGap={1}>
        {leaf.tabs.map(t => (
          <Button key={`ct-${t}`} plain dimColor={t !== active}
            label={`${t === active ? '▣' : '▢'} ${PANEL_LABEL[t]}${c.fresh.includes(t) && t !== active ? ' •' : ''}`}
            onPress={() => act.focusPanel(t)} />
        ))}
        <Box flexGrow={1} />
        <Text color={p.muted}>{panelCount(s, active)}</Text>
        {c.ui.zen
          ? <Button key="unzen" hotkey="z" plain label={t(' ⛶ 還原', ' ⛶ Restore')} onPress={() => act.zen()} />
          : <Button key={`zen-${active}`} plain dimColor label=" ⛶" onPress={() => act.zen(active)} />}
      </Box>
      <Box flexDirection="column" height={innerH} overflow="hidden">
        {panelBody({ ...c, width: innerW, rows: innerH }, active, innerH)}
      </Box>
    </Box>
  )
}

export function dashboard(c: ViewCtx, layout: LayoutNode) {
  const { cells } = compute(layout, { x: 0, y: 0, w: c.width, h: c.rows })
  return (
    <c.el.Box width={c.width} height={c.rows} position="relative">
      {cells.map((cell, k) => cellCard(c, cell, k))}
    </c.el.Box>
  )
}

/** Content area size assigned to a panel (needed by the Map canvas and media images); undefined if not shown. */
export function panelArea(layout: LayoutNode, panel: Panel, width: number, rows: number) {
  const cell = compute(layout, { x: 0, y: 0, w: width, h: rows }).cells.find(x => x.leaf.tabs[x.leaf.active ?? 0] === panel)
  return cell ? { cols: Math.max(4, cell.rect.w - 4), rows: Math.max(1, cell.rect.h - 3) } : undefined
}
