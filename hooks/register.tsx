import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Palette, Skin } from '../types'

import { encodeMap } from './map'
import { changesList, emptySession, isMedia, log, reviveSession, startExec, upsertAgent, type Session } from './model'
import { briefTool } from './brief'
import { addPrepped, addWebPage, artifactUrl, htmlArgs, newMediaArgv, newMediaOf, openArgv, type Prepped, prepArgv, previewOf, slug } from './media'
import {
  agentTag, applyChecklist, applyUsage, endExec, endTask, isDocsCreate, parseTitle, prettyModel, recordTool, sendReport, sendTargets, summary, taskOutput, titleArgv,
} from './events'
import {
  archBack, archBaseFrom, archDirLabel, archPress, archPrune, archRebase, archStamp, archUp, isC4File, isSystemMaps, likec4Errors, likec4Label, mermaidDoc, SYSTEM_MAPS,
} from './archdir'
import { archInitAsk, archRule, CHECKLIST_RULE, CHECKLIST_SPEC, DOCS_DENY, OUTPUT_RULE, PLAIN_ASK } from './rules'
import {
  followFile, keepActive, nudge, oOwner, panelOf, resetTree, scrollKeyAt, scrollSign, selectFile, selectTodo, selectTreeFile, toggleAgent, toggleDir, toggleMsg,
} from './viewstate'
import { applySavedView, cleanArgv, serializeSession, SESSIONS_DIR, sessionPath } from './persist'
import { filesVim, treeFind, treeVim, type VimEffect, type VimKey } from './vim'
import { gitQueries, listArgv, parseGit, parseListing, type GitState } from './tree'
import { chatPaletteFor, FALLBACK, formatDuration, paletteFor, sourcesFor } from './palette'
import { DEFAULT_LAYOUT, focusPanel, isShown, type LayoutNode, type Panel, parseLayout, PANELS } from './layout'
import { type ArchNode, parseLikeC4 } from './arch'
import { pngSize } from './image'
import { getLang, langFromLocale, setLang, t } from './i18n'
import { editedLines, LIVE_TOOLS, type LiveEdit, readLive } from './live'
import { cells, headWidth, imageTags, type Location, locationRow, type Picture, TILE_CHROME_ROWS, tiles } from './prompt'
import { type ArchState, dashboard, PANEL_KEY, PANEL_LABEL, panelArea, projectRows, ratioFromDrag, vitalsCompact, vitalsCompactText, type Actions, type UiState, type ViewCtx } from './views'

// asint: a personal Claude Code interface. Every hook that uses $ lives in this file ($ cannot be passed
// into other module files); views are in views.tsx, the Map in map.ts and data in model.ts, all pure functions that never touch $.
// Design: docs/decisions/specs/2026-10-06-asint-design.md

// ── Theme (sub-project D) ──────────────────────────────────────

const palette = atom({ plugin: 'asint', key: 'palette' } as const, FALLBACK as Palette)
// The chat column's colors: phosphor text over the theme's backgrounds, whatever the skin.
const chatPalette = atom({ plugin: 'asint', key: 'chatPalette' } as const, chatPaletteFor(FALLBACK))
const skin = atom({ plugin: 'asint', key: 'skin' } as const, 'omarchy' as Skin)
const turnStartedAt = atom({ plugin: 'asint', key: 'turnStartedAt' } as const, 0)

const THEME_DIR = '.local/state/omarchy/current/theme'
// Follows an Omarchy theme change within 5 s; reading a few KB of config costs next to nothing.
const THEME_POLL_MS = 5000

// Palette derived from the current theme (before the skin is applied) and its source text; skip the atom write when the text is unchanged, so we don't redraw every 5 s.
let themePalette: Palette = FALLBACK
let themeText = ''

async function loadTheme($: EngineInterface) {
  const home = await $.env.get('HOME')
  const term = `${(await $.env.get('TERM_PROGRAM')) ?? ''} ${(await $.env.get('TERM')) ?? ''}`
  for (const [file, parse] of sourcesFor(term)) {
    const text = await $.fs.read(`${home}/${THEME_DIR}/${file}`).catch(() => undefined)
    if (typeof text !== 'string') continue
    if (text === themeText) return
    const p = parse(text)
    if (!p) continue
    themeText = text
    themePalette = p
    await applySkin($)
    return
  }
}

async function applySkin($: EngineInterface) {
  const s = await read($, skin)
  await update($, palette, () => paletteFor(s, themePalette))
  await update($, chatPalette, () => chatPaletteFor(themePalette))
}

async function setSkin($: EngineInterface, next: Skin) {
  await update($, skin, () => next)
  await $.store.set('skin', next)
  await applySkin($)
}

// ── Dashboard (sub-project A) ────────────────────────────────────

const PANE = 'asint'
// Helper scripts shipped in the plugin's bin/ (media-prep, asint-open, asint-tb, asint-likec4-view); set at session start.
let BIN = 'bin'
// One 100 ms tick drives every animation: the Map draws every tick while active (10 fps) and every 5 ticks when idle (2 fps),
// media animations advance one frame per tick, background command output is read every 10 ticks. Nothing off-screen is drawn.
const TICK_MS = 100
const CHECKLIST_TOOL = 'mcp__asint__checklist'
const ACTIVE_MS = 3000

let S: Session = emptySession()
const ui: UiState = {
  tab: 'files', mapView: 'combo', comboSlot: 0, fullFile: false, showReads: true, mediaFilter: 'ALL', scroll: {},
  archTrail: [], archDirs: [], archPanX: 0, hx: {}, splitRatio: {}, treeShut: {}, treeChanged: false, treeFocus: 'tree', filesFocus: 'list', treeOpen: {}, follow: true,
}
const scrollMax = new Map<string, number>()
// Last rendered pane size; wheel events use it to find the card under the pointer. Keyboard scrolling scrolls the card clicked last.
let paneSize = { w: 80, h: 40 }
let lastPanel: Panel = 'files'
// Layout tree and its config file; no redraw when the file is unchanged. In edit mode the whole pane becomes a wireframe editor.
const LAYOUT_FILE = '.config/asint/layout.json'
let layout: LayoutNode = DEFAULT_LAYOUT
let layoutText = ''
let editing = false
/** The layout actually on screen: a single cell in zen. Saving and dragging still operate on `layout`. */
const shown = (): LayoutNode => (ui.zen ? { tabs: [ui.zen], active: 0 } : layout)
// Pane width requested in zen: terminal width minus this many columns, leaving a narrow chat strip on the left.
const ZEN_CHAT_COLS = 50
// Chat column width (bodyColumns reported by the bar above the prompt, plus the 5 columns the engine reserves). The Pane viewport
// only knows its own width, so the terminal width is reconstructed as chat column + pane content + pane border and divider.
let chatCols = 0
const PANE_CHROME = 4
const termCols = () => (chatCols ? chatCols + paneSize.w + PANE_CHROME : 0)
let preZenCols: number | undefined
// Last pane width requested from the engine; pass it again on every re-open (e.g. to take focus) or the pane snaps back to the default width.
let requestedCols: number | undefined
let paneFocused = false
const paneTitle = () => (ui.zen ? `ASINT · ${PANEL_LABEL[ui.zen]}` : 'ASINT')
// Minimized (pane closed, only the status bar above the prompt remains). A new session inherits the last choice; a resumed session uses its own.
let minimized = false
let sid = ''
// Panels with new content that are hidden behind another tab in the same cell.
const fresh = new Set<Panel>()
let act: Actions | undefined
let paneOpen = false
let ticks = 0
let mapSize = { cols: 60, rows: 20 }
let mapCells = ''
let mediaFrame = 0
const bgOutput = new Map<string, string>()
let fileCache: { key: string; text?: string } = { key: '' }
let sessionDir: string | undefined

/** This session's temp dir, <tmp>/<project>/<session id>, holding the scratchpad and background commands' tasks/. */
async function findSessionDir($: EngineInterface) {
  if (sessionDir !== undefined) return sessionDir
  const root = (await $.env.get('CLAUDE_CODE_TMPDIR')) ?? `/tmp/claude-${(await $.process.run(['id', '-u'])).stdout.trim()}`
  const id = await $.session.id()
  for (const project of await $.fs.list(root).catch(() => [])) {
    if (await $.fs.exists(`${root}/${project.name}/${id}`)) return (sessionDir = `${root}/${project.name}/${id}`)
  }
  return undefined
}

async function refreshUsage($: EngineInterface) {
  const u = await $.session.usage().catch(() => undefined)
  if (u) applyUsage(S.vitals, u)
}

const mapVisible = () => paneOpen && !editing && isShown(shown(), 'map')
const mediaVisible = () => paneOpen && !editing && isShown(shown(), 'media')
const orchVisible = () => paneOpen && !editing && isShown(shown(), 'orch')

async function loadLayout($: EngineInterface) {
  const home = await $.env.get('HOME')
  const text = await $.fs.read(`${home}/${LAYOUT_FILE}`).catch(() => undefined)
  const t = typeof text === 'string' ? text : ''
  if (t === layoutText && layoutText) return false
  layoutText = t
  // When the file changes (editor save, hand edit) switch layouts, but keep this session's active tab in each cell.
  layout = keepActive(parseLayout(t || undefined), layout)
  return true
}

async function saveLayout($: EngineInterface, next: LayoutNode) {
  layout = next
  layoutText = JSON.stringify(next, null, 2)
  // If the write fails (read-only home, test environment) the layout only applies in memory.
  await $.fs.write(`${await $.env.get('HOME')}/${LAYOUT_FILE}`, layoutText).catch(() => undefined)
}

// ── Saving the session ───────────────────────────────────────────────────
// What the dashboard shows is kept in memory; a resumed session has the same id, so it is written to
// ~/.cache/asint/sessions/<session id>.json (data and the view the user left it in) and read back at session start.
let savedText = ''
let sessionsDirReady = false

async function persist($: EngineInterface) {
  if (!sid) return
  const home = await $.env.get('HOME')
  if (!home) return
  const text = serializeSession(S, ui)
  if (text === savedText) return
  savedText = text
  if (!sessionsDirReady) {
    await $.process.run(['mkdir', '-p', `${home}/${SESSIONS_DIR}`]).catch(() => undefined)
    sessionsDirReady = true
  }
  // A failed write (read-only home, test environment) only means nothing is restored later.
  await $.fs.write(sessionPath(home, sid), text).catch(() => undefined)
}

async function restoreSession($: EngineInterface) {
  const home = await $.env.get('HOME')
  if (!home || !sid) return
  const text = await $.fs.read(sessionPath(home, sid)).catch(() => undefined)
  const revived = reviveSession(typeof text === 'string' ? text : undefined)
  if (!revived) return
  S = revived
  savedText = text as string
  applySavedView(ui, text as string)
}

/** Saved sessions older than SAVE_DAYS are not coming back. */
async function cleanSessions($: EngineInterface) {
  const home = await $.env.get('HOME')
  if (!home) return
  await $.process.run(cleanArgv(home)).catch(() => undefined)
}

/** A panel has something new: if its cell is showing another tab, mark it fresh so the tab name lights up. */
function markFresh(panel: Panel) {
  if (!isShown(shown(), panel)) fresh.add(panel)
}
const isActive = (now: number) => now - S.lastEventAt < ACTIVE_MS || S.vitals.turnRunning || [...S.agents.values()].some(a => a.status === 'running')

const renderMap = (p: Palette, now: number) => encodeMap(ui.mapView, mapSize, p, { s: S, now, focus: ui.focusAgent, comboSlot: ui.comboSlot })

async function tick($: EngineInterface) {
  ticks++
  const now = await $.clock.now()
  if (mapVisible() && ui.mapView !== 'board' && (isActive(now) || ticks % 5 === 0)) {
    const cells = renderMap(await read($, palette), now)
    if (cells !== mapCells) {
      mapCells = cells
      await $.ui.blit({ requestId: PANE, key: 'map', cells, columns: mapSize.cols, rows: mapSize.rows }).catch(() => {})
    }
  }
  if (mediaVisible()) {
    const sel = S.media.find(m => m.id === ui.selMedia) ?? S.media.at(-1)
    if (sel && sel.frames.length > 1) {
      mediaFrame = (mediaFrame + 1) % sel.frames.length
      await $.ui.blit({ requestId: PANE, key: 'media-view', source: { file: sel.frames[mediaFrame]!, format: 'png' } }).catch(() => {})
    }
  }
  if (ticks % 20 === 0 && !editing && (await loadLayout($))) $.ui.invalidate('ui.render')
  // The ORCH workers move while anything runs: redraw about three times a second, and once a second at rest for the timers.
  if (orchVisible() && (isActive(now) ? ticks % 3 === 0 : ticks % 10 === 0)) $.ui.invalidate('ui.render')
  if (ticks % 50 === 25) void refreshLocation($)
  if (ticks % 50 === 10) void persist($)
  if (ticks % 40 === 15 && paneOpen && isShown(shown(), 'project')) void refreshGit($)
  if (archInitPending) {
    archInitPending = false
    void $.prompt.submit({ text: archInitAsk(likec4Label(LIKEC4)), asUser: true }).catch(() => undefined)
  }
  if (flash && Date.now() > flash.until) { flash = undefined; $.ui.invalidate('ui.render') }
  if (ticks % 20 === 5 && paneOpen && isShown(shown(), 'arch')) void refreshArch($)
  if (ticks % 10 === 0) {
    let changed = false
    for (const x of S.execs) {
      if (x.status !== 'background' || !x.outputPath) continue
      const text = await $.fs.read(x.outputPath).catch(() => undefined)
      if (typeof text === 'string' && text !== bgOutput.get(x.id)) {
        bgOutput.set(x.id, text.slice(-20_000))
        changed = true
      }
    }
    if (changed) $.ui.invalidate('ui.render')
  }
}

// ── Architecture diagram (viewer part of sub-project F) ─────────────────────────────

const ARCH_CACHE = '/tmp/asint-arch'
// The likec4 CLI: ASINT_LIKEC4, then likec4 on PATH, then a local npm install, then npx. Resolved at session start.
let LIKEC4: string[] = ['npx', '-y', 'likec4@1.59.4']

async function resolveLikec4($: EngineInterface) {
  const env = await $.env.get('ASINT_LIKEC4')
  if (env) return void (LIKEC4 = [env])
  const onPath = await $.process.run(['likec4', '--version'], { timeoutMs: 10_000 }).catch(() => undefined)
  if (onPath?.exitCode === 0) return void (LIKEC4 = ['likec4'])
  const local = `${await $.env.get('HOME')}/.local/share/likec4/node_modules/.bin/likec4`
  if (await $.fs.exists(local).catch(() => false)) LIKEC4 = [local]
}
let arch: ArchState | undefined
// Per-directory export result and "name:mtime" stamp, so switching between system and repo layers doesn't re-export.
const archCache = new Map<string, ArchState>()
const archStamps = new Map<string, string>()
// Starting trail derived from cwd (e.g. "system layer → this repo"); ui.archDirs is reset only when cwd changes.
let archBase = ''
let archBusy = false

const hasC4 = async ($: EngineInterface, dir: string) => (await $.fs.list(dir).catch(() => [])).some(isC4File)

/**
 * Search upward for the system layer: an ancestor directory with a child containing 02-Architecture/system-maps/*.c4 (a team vault),
 * e.g. ~/work/acme/team-vault/02-Architecture/system-maps. At most 4 levels up, never above home.
 */
async function findSystemMaps($: EngineInterface, from: string) {
  const home = (await $.env.get('HOME')) ?? '/home'
  let dir = from
  for (let i = 0; i < 5 && dir.startsWith(home) && dir !== home; i++) {
    for (const child of await $.fs.list(dir).catch(() => [])) {
      if (child.kind !== 'dir' || child.name.startsWith('.')) continue
      const maps = `${dir}/${child.name}/${SYSTEM_MAPS}`
      if (await hasC4($, maps)) return maps
    }
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
  }
  return undefined
}

/** Starting trail for cwd: its repo root (if any) and the system layer above it (see archBaseFrom). */
async function archBaseDirs($: EngineInterface) {
  const cwd = await $.session.cwd()
  const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 5_000 }).catch(() => undefined)
  const root = r && r.exitCode === 0 ? r.stdout.trim() : undefined
  return archBaseFrom(root, await findSystemMaps($, root ? root.slice(0, root.lastIndexOf('/')) : cwd), cwd)
}

/**
 * The system layer lives in a vault and Obsidian can't read .c4, so after each successful export convert it to Mermaid with likec4
 * and write one views/<id>.md per view. The header says the file is generated; edit the .c4 instead.
 */
async function writeMermaid($: EngineInterface, dir: string, model: NonNullable<ArchState['model']>) {
  const out = `${ARCH_CACHE}/mmd-${slug(dir)}`
  const r = await $.process.run([...LIKEC4, 'gen', 'mermaid', '-o', out, dir], { timeoutMs: 60_000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) return
  await $.process.run(['mkdir', '-p', `${dir}/views`])
  for (const f of await $.fs.list(out).catch(() => [])) {
    if (!f.name.endsWith('.mmd')) continue
    const id = f.name.slice(0, -4)
    const mmd = await $.fs.read(`${out}/${f.name}`).catch(() => undefined)
    if (typeof mmd !== 'string') continue
    await $.fs.write(`${dir}/views/${id}.md`, mermaidDoc(model.views[id]?.title ?? id, mmd)).catch(() => undefined)
  }
}

/** Export a directory's .c4 files to JSON (with layout coordinates) and parse it; reuse the cache when no file changed. */
async function loadArchDir($: EngineInterface, dir: string) {
  const files = (await $.fs.list(dir).catch(() => [])).filter(isC4File)
  if (!files.length) {
    if (!archCache.get(dir)?.missing) archCache.set(dir, { dir, missing: true })
    archStamps.delete(dir)
    return
  }
  const stamp = archStamp(files)
  if (archStamps.get(dir) === stamp && archCache.get(dir)?.model) return
  archStamps.set(dir, stamp)
  const prev = archCache.get(dir)
  const out = `${ARCH_CACHE}/${slug(dir)}.json`
  await $.process.run(['mkdir', '-p', ARCH_CACHE])
  const r = await $.process.run([...LIKEC4, 'export', 'json', '-o', out, dir], { timeoutMs: 60_000 }).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
  const error = likec4Errors(`${r.stdout}\n${r.stderr}`) || (r.exitCode !== 0 ? t('likec4 匯出失敗', 'likec4 export failed') : undefined)
  const text = r.exitCode === 0 ? await $.fs.read(out).catch(() => undefined) : undefined
  const model = typeof text === 'string' ? parseLikeC4(text) : undefined
  archCache.set(dir, model ? { dir, model, at: await $.clock.now(), error } : { dir, model: prev?.model, at: prev?.at, error: error ?? t('讀不到 likec4 的輸出', 'Could not read likec4 output') })
  if (model && isSystemMaps(dir)) await writeMermaid($, dir, model)
}

/** Pick the starting trail from cwd and load the layer being viewed; redraw only on change. */
async function refreshArch($: EngineInterface) {
  if (archBusy) return
  archBusy = true
  try {
    const base = await archBaseDirs($)
    const key = base.join('|')
    if (key !== archBase) {
      // When cwd moves somewhere with no diagram at all (scratchpad, home), keep showing the current one.
      const anyC4 = (await Promise.all(base.map(d => hasC4($, d)))).some(Boolean)
      if (!anyC4 && arch?.model) return
      archBase = key
      archRebase(ui, base)
    }
    const dir = ui.archDirs.at(-1)!
    const before = archCache.get(dir)
    await loadArchDir($, dir)
    const next = archCache.get(dir)
    if (next === arch && next === before) return
    arch = next
    archPrune(ui, arch)
    markFresh('arch')
    $.ui.invalidate('ui.render')
  } finally {
    archBusy = false
  }
}

// ── Around the prompt (sub-project B) ────────────────────────────────

// Set by the "Arch diagram" button and /asint arch; the next tick asks the main conversation (rules.ts has the question).
let archInitPending = false

// Pasting an image doesn't fire prompt.edit, so the draft is polled.
const DRAFT_POLL_MS = 250
// Thumbnail aspect ratio used when the file header can't be read (over the $.fs.read size limit).
const PICTURE_FALLBACK = { width: 16, height: 10 }
let loc: Location | undefined
let locBusy = false
let hadReply = false
const pictures = new Map<number, Picture>()
let draft: number[] = []
let draftBusy = false
// Session name: Claude Code titles sessions with an LLM and writes it to the transcript (`ai-title`); /rename writes `custom-title`, which wins.
// Read the latest entry from the transcript instead of asking a model for a name.
let title: string | undefined
let transcript: string | undefined

async function findTranscript($: EngineInterface) {
  if (transcript) return transcript
  const root = `${await $.env.get('HOME')}/.claude/projects`
  for (const project of await $.fs.list(root).catch(() => [])) {
    const path = `${root}/${project.name}/${sid}.jsonl`
    if (await $.fs.exists(path)) return (transcript = path)
  }
  return undefined
}

async function refreshTitle($: EngineInterface) {
  const path = await findTranscript($)
  if (!path) return
  const r = await $.process.run(titleArgv(path), { timeoutMs: 5_000 }).catch(() => undefined)
  const next = parseTitle(r?.stdout)
  if (next && next !== title) {
    title = next
    $.ui.invalidate('ui.render')
  }
}

/** Git status: get the repo root and branch in one call, then count uncommitted files. Redraw only on change. */
async function refreshLocation($: EngineInterface) {
  if (locBusy) return
  locBusy = true
  try {
    const cwd = await $.session.cwd()
    const home = await $.env.get('HOME')
    const git = (args: string[]) => $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 5_000 }).catch(() => undefined)
    const head = await git(['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'])
    let next: Location = { cwd, home, dirty: 0 }
    if (head && head.exitCode === 0) {
      const [root, ref] = head.stdout.trim().split('\n')
      const sha = ref === 'HEAD' ? (await git(['rev-parse', '--short', 'HEAD']))?.stdout.trim() : undefined
      const status = await git(['status', '--porcelain'])
      next = { cwd, home, root, branch: sha ? `@${sha}` : ref, dirty: status?.stdout.split('\n').filter(Boolean).length ?? 0 }
    }
    if (JSON.stringify(next) !== JSON.stringify(loc)) {
      loc = next
      $.ui.invalidate('ui.render')
    }
  } finally {
    locBusy = false
  }
}

/** Pasted image n: Claude Code stores it at <session temp dir>/images/<n>.png. Returns undefined until the file is written; retry next poll. */
async function picture($: EngineInterface, n: number): Promise<Picture | undefined> {
  const hit = pictures.get(n)
  if (hit) return hit
  const dir = await findSessionDir($)
  const path = `${dir}/images/${n}.png`
  if (!dir || !(await $.fs.exists(path))) return undefined
  const size = await $.fs.read(path, { as: 'bytes' }).then(b => pngSize(b.base64), () => PICTURE_FALLBACK)
  if (!size) return undefined
  pictures.set(n, { n, path, size })
  return pictures.get(n)
}

async function pollDraft($: EngineInterface) {
  if (draftBusy) return
  draftBusy = true
  try {
    const tags = imageTags((await $.prompt.read()).text)
    if (tags.join() === draft.join()) return
    const ready = (await Promise.all(tags.map(n => picture($, n)))).filter(x => x !== undefined).map(x => x.n)
    if (ready.join() === draft.join()) return
    draft = ready
    $.ui.invalidate('ui.render')
  } catch {
    // No prompt (a dialog has it, or a headless session): nothing to show.
  } finally {
    draftBusy = false
  }
}

/** Static pages: open terminal-browser beside kitty; outside kitty, fall back to the default browser (handled by asint-tb). */
async function openExternal($: EngineInterface, path: string) {
  await $.process.run([`${BIN}/asint-tb`, path], { timeoutMs: 60_000 }).catch(() => undefined)
}

/** Open with the system default app (Brave for web pages). Used for anything that needs trackpad zoom and pan: full LikeC4 view, 3D models, claude.ai links. */
async function openDefault($: EngineInterface, target: string) {
  await $.process.run(['setsid', '-f', `${BIN}/asint-open`, target], { timeoutMs: 10_000 }).catch(() => undefined)
}

/** Web pages open beside the terminal, everything else in its own app (see openArgv). */
async function openFile($: EngineInterface, path: string) {
  if (/\.html?$/i.test(path)) return openExternal($, path)
  await $.process.run(openArgv(BIN, path), { timeoutMs: 10_000 }).catch(() => undefined)
}

/** Convert a media file to PNG frames (~/.local/bin/media-prep) and register it; 3D models open in terminal-browser. Returns the media id. */
async function addMedia($: EngineInterface, path: string) {
  const r = await $.process.run(prepArgv(BIN, path), { timeoutMs: 120_000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) return undefined
  const prepped = JSON.parse(r.stdout) as Prepped
  if (prepped.kind === 'model' && prepped.viewer) await openDefault($, prepped.viewer)
  const m = addPrepped(S, path, prepped, await $.clock.now())
  ui.selMedia = m.id
  mediaFrame = 0
  markFresh('media')
  return m.id
}

// ── FILES (project file tree) ──────────────────────────────────

let project: ViewCtx['project']
let projectBusy = false
/** What git says about the project's files, and when the session's first event happened (commits before it do not count as "committed"). */
let gitState: GitState = new Map()
let suggestRoot: string | undefined
/** Keys the tree client sent, handled up to this number; a client instance starts counting again from 1, so each one has its own epoch. */
let treeAck = { epoch: '', n: 0 }
let gitBusy = false
let sessionSince = Date.now()
let treeCache: { key: string; text?: string } = { key: '' }

/** In a git repo, list files with git (tracked plus untracked files not ignored by .gitignore); otherwise use find, skipping hidden dirs and node_modules. */
async function refreshProject($: EngineInterface) {
  if (projectBusy) return
  projectBusy = true
  try {
    const cwd = ui.treeRoot ?? await $.session.cwd()
    const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 5_000 }).catch(() => undefined)
    const root = top && top.exitCode === 0 ? top.stdout.trim() : cwd
    const r = await $.process.run(listArgv(root, !!top && top.exitCode === 0), { timeoutMs: 10_000 }).catch(() => undefined)
    const next = parseListing(r?.stdout ?? '', root)
    if (JSON.stringify(next) !== JSON.stringify(project)) {
      if (project?.root !== root) { ui.treeOpen = {}; ui.treeSel = undefined }
      project = next
      $.ui.invalidate('ui.render')
      void refreshGit($)
    }
  } finally {
    projectBusy = false
  }
}

/** Reads which files git sees as changed, untracked, or committed since this session began; the FILES tree labels them. */
async function refreshGit($: EngineInterface) {
  if (gitBusy || !project) return
  gitBusy = true
  try {
    const root = project.root
    const run = async (args: string[]) => {
      const r = await $.process.run(['git', '-C', root, ...args], { timeoutMs: 8_000 }).catch(() => undefined)
      return r && r.exitCode === 0 ? r.stdout : ''
    }
    const q = gitQueries(sessionSince)
    const [diff, untracked, committed] = await Promise.all([run(q.diff), run(q.untracked), run(q.committed)])
    const next = parseGit(diff, untracked, committed)
    if (JSON.stringify([...next]) !== JSON.stringify([...gitState])) {
      gitState = next
      $.ui.invalidate('ui.render')
    }
  } finally {
    gitBusy = false
  }
}

// ── Vim keys in FILES and CHANGES ─────────────────────────────────────────
// h out, j down, k up, l in. In the tree the cursor walks the rows (a folder opens with l, closes or jumps to its parent with h,
// and l on a file moves into its preview, where j and k scroll and h comes back). CHANGES works the same on its file list.

/** Applies what a vim key asked for: the pure functions in vim.ts change the view state, the rest needs the engine's actions. */
function applyVim(effect: VimEffect | undefined) {
  if (!effect) return
  if (effect.manual) manualAt = Date.now()
  if (effect.vpan) act?.vpan(effect.vpan[0], effect.vpan[1])
  if (effect.toggle) act?.treeToggle(effect.toggle)
}

/** Keys from the tree client, in order, each handled once however many times the client posts its queue. */
function treeKeys(epoch: string, keys: { n: number; key: string }[]) {
  if (!project) return
  if (epoch !== treeAck.epoch) treeAck = { epoch, n: 0 }
  for (const k of [...keys].sort((a, b) => a.n - b.n)) {
    if (k.n <= treeAck.n) continue
    treeAck = { epoch, n: k.n }
    const rows = projectRows(project, S.files, gitState, live?.path, ui).rows
    if (k.key.startsWith('search:')) {
      ui.treeSearch = k.key.slice(7)
      applyVim(treeFind(project.paths, ui, ui.treeSearch, 1))
    } else if (k.key === 'next' || k.key === 'prev') applyVim(treeFind(project.paths, ui, ui.treeSearch ?? '', k.key === 'next' ? 1 : -1))
    else applyVim(treeVim(k.key as VimKey, rows, ui))
  }
  lastPanel = 'project'
}

function treeKey(key: VimKey) {
  if (!project) return
  applyVim(treeVim(key, projectRows(project, S.files, gitState, live?.path, ui).rows, ui))
}

function filesKey(key: VimKey) {
  applyVim(filesVim(key, changesList(S, { showReads: ui.showReads, by: ui.filesBy }), ui))
}

// ── FILES follow mode ────────────────────────────────────

// The file edit currently streaming, and the lines just changed that stay highlighted for a few seconds.
let live: LiveEdit | undefined
let flash: (ViewCtx['flash'] & { until: number }) | undefined
let liveDrawAt = 0
// After the user clicks a file in the tree, don't take over for this long.
const MANUAL_HOLD_MS = 3000
const FLASH_MS = 3000
// Stream chunks can arrive dozens per second; redraw at most every 80 ms.
const LIVE_FRAME_MS = 80
let manualAt = 0

/** An edit landed outside the folder FILES shows: find that file's git folder and offer it as a switch (never switches by itself). */
async function suggestRootFor($: EngineInterface, abs: string) {
  if (!project || abs.startsWith(`${project.root}/`)) return
  const dir = abs.slice(0, abs.lastIndexOf('/'))
  const top = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'], { timeoutMs: 5_000 }).catch(() => undefined)
  const root = top && top.exitCode === 0 ? top.stdout.trim() : undefined
  if (root && root !== project.root && root !== suggestRoot) {
    suggestRoot = root
    $.ui.invalidate('ui.render')
  }
}

/** Jump FILES to this file (see followFile) and switch its cell to the FILES tab; never while the user's own click holds the tree. */
function followTo(abs: string) {
  if (!project || Date.now() - manualAt < MANUAL_HOLD_MS) return
  const f = followFile(ui, project, abs, isShown(shown(), 'project'))
  if (!f) return
  project = f.project
  if (f.focus) layout = focusPanel(layout, 'project')
  if (f.last) lastPanel = 'project'
}

function liveFrame($: EngineInterface, force = false) {
  const now = Date.now()
  if (!force && now - liveDrawAt < LIVE_FRAME_MS) return
  liveDrawAt = now
  $.ui.invalidate('ui.render')
}

/** An edit tool finished: end the streaming view, find which lines hold the new content and highlight them for FLASH_MS. */
async function finishLive($: EngineInterface, id: string, path: string | undefined, ok: boolean) {
  if (!live || live.id !== id) return
  const body = live
  live = undefined
  if (ok && path) {
    const text = await $.fs.read(path).catch(() => undefined)
    if (typeof text === 'string') {
      const { from, to } = editedLines(body, text)
      flash = { path, from, to, until: Date.now() + FLASH_MS }
      // After the highlight, the normal preview should stay on the changed lines, not jump to the top of the file.
      if (project && path === `${project.root}/${ui.treeSel}`) ui.scroll['project:detail'] = Math.max(0, from - 3)
    }
  }
  liveFrame($, true)
}

// A media file selected in CHANGES is previewed on the right: media-prep converts it to PNG (without registering it in MEDIA), cached by path.
const previews = new Map<string, { frame: string; width: number; height: number }>()
const preparing = new Set<string>()

async function prepPreview($: EngineInterface, path: string) {
  if (preparing.has(path)) return
  preparing.add(path)
  const r = await $.process.run(prepArgv(BIN, path, true), { timeoutMs: 120_000 }).catch(() => undefined)
  // If conversion fails, keep the text placeholder.
  const hit = r && r.exitCode === 0 ? previewOf(r.stdout) : undefined
  if (hit) {
    previews.set(path, hit)
    $.ui.invalidate('ui.render')
  }
}

/** Media files written after `since` (epoch seconds) in cwd and the scratchpad, minus asint's and Claude's own scratch files. */
async function newMediaSince($: EngineInterface, since: number) {
  const dir = await findSessionDir($)
  const dirs = [await $.session.cwd(), dir ? `${dir}/scratchpad` : undefined].filter((d): d is string => !!d)
  const r = await $.process.run(newMediaArgv(dirs, since), { timeoutMs: 10_000 }).catch(() => undefined)
  return newMediaOf(r?.stdout ?? '')
}

async function setMinimized($: EngineInterface, v: boolean) {
  minimized = v
  await $.store.set('minimized', v)
  if (sid) await $.store.set(`minimized:${sid}`, v)
}

async function minimize($: EngineInterface) {
  await setMinimized($, true)
  paneOpen = false
  await $.ui.close({ id: PANE }).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

async function restore($: EngineInterface) {
  await setMinimized($, false)
  const opened = await $.ui.open({ id: PANE, title: 'ASINT' }).catch(() => undefined)
  // Below 144 columns the engine queues the pane and draws nothing; say so instead of looking broken.
  if (opened && opened.isPlaced === false) $.ui.toast(t('終端機寬度不夠，加寬到 144 欄後儀表板會自動出現', 'The terminal is too narrow for the dashboard; it appears once the terminal is 144 columns wide'))
  $.ui.invalidate('ui.render')
}

/** Entering zen asks the engine to widen the pane (a width the user dragged wins); leaving restores the previous width. */
// Zen is always a press in the pane. Re-opening to resize without focus hands the keyboard back to the prompt, so the next shortcut letter would land there.
async function toggleZen($: EngineInterface, t?: Panel) {
  if (ui.zen) {
    ui.zen = undefined
    const columns = preZenCols
    preZenCols = undefined
    requestedCols = columns
    await $.ui.open({ id: PANE, title: 'ASINT', focus: true, ...(columns ? { columns } : {}) }).catch(() => undefined)
  } else {
    const target = t ?? (lastPanel === 'status' ? 'files' : lastPanel)
    ui.zen = target
    lastPanel = target
    preZenCols = paneSize.w
    const columns = termCols() ? Math.max(paneSize.w, termCols() - ZEN_CHAT_COLS) : undefined
    requestedCols = columns
    await $.ui.open({ id: PANE, title: `ASINT · ${PANEL_LABEL[target]}`, focus: true, ...(columns ? { columns } : {}) }).catch(() => undefined)
  }
  $.ui.invalidate('ui.render')
}

/**
 * Messages sent to agents from the MAP: main goes through prompt.submit (same as the user typing; queued while a turn runs),
 * subagents through session.send (a finished one is woken up), and "all" goes to every running subagent.
 */
async function sendTo($: EngineInterface, to: string, text: string) {
  const body = text.trim()
  if (!body) return
  ui.msgTo = undefined
  $.ui.invalidate('ui.render')
  const ids = sendTargets(S, to)
  const failed: string[] = []
  for (const id of ids) {
    try {
      if (id === 'main') await $.prompt.submit({ text: body, asUser: true })
      else {
        const r = await $.session.send({ to: { agentId: id }, text: body })
        if (!r.isDelivered) failed.push(`${agentTag(S, id)} ${r.reason}`)
      }
    } catch (err) {
      failed.push(`${agentTag(S, id)} ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const at = await $.clock.now()
  const report = sendReport(S, to, body, ids, failed)
  log(S, { at, who: 'main', kind: failed.length ? 'error' : 'tool', text: report.log })
  $.ui.toast(report.toast)
  $.ui.invalidate('ui.render')
}

// ── Output handling (sub-project C, replaces terminal-only) ──────────────────

/** List an .html file under WEB in MEDIA and select it. */
function addWeb(path: string, at: number, url?: string) {
  ui.selMedia = addWebPage(S, path, at, url).id
  markFresh('media')
}

/** Dashboard button callbacks; everything that needs $ (saving settings, opening externally, redrawing) is wired up here. */
function makeActions($: EngineInterface): Actions {
  const redraw = () => $.ui.invalidate('ui.render')
  return {
    focusPanel: t => {
      lastPanel = t
      if (ui.zen) ui.zen = t
      // Switching tabs only changes this session's view and is not written to layout.json: several sessions share
      // that file, and writing it would make the others switch tabs on their next 2 s reload.
      layout = focusPanel(layout, t)
      fresh.delete(t)
      redraw()
    },
    editLayout: () => { editing = true; redraw() },
    zen: t => void toggleZen($, t),
    archPress: (n: ArchNode) => {
      lastPanel = 'arch'
      if (archPress(ui, n, arch)) void refreshArch($)
      redraw()
    },
    archUp: i => { lastPanel = 'arch'; archUp(ui, i); void refreshArch($); redraw() },
    archTrail: i => { lastPanel = 'arch'; archBack(ui, i); redraw() },
    treeToggle: dir => {
      lastPanel = 'project'
      toggleDir(ui, dir, project ? projectRows(project, S.files, gitState, live?.path, ui).hot : new Map<string, number>())
      redraw()
    },
    vim: (panel, key) => {
      lastPanel = panel
      if (panel === 'project') treeKey(key)
      else filesKey(key)
      redraw()
    },
    setRoot: dir => {
      lastPanel = 'project'
      resetTree(ui, dir)
      suggestRoot = undefined
      project = undefined
      gitState = new Map()
      redraw()
      void refreshProject($)
    },
    toggleChanged: () => { lastPanel = 'project'; ui.treeChanged = !ui.treeChanged; redraw() },
    toggleFollow: () => { ui.follow = !ui.follow; redraw() },
    treeSelect: path => { manualAt = Date.now(); lastPanel = 'project'; selectTreeFile(ui, path); redraw() },
    hpan: (key, dx, max) => { lastPanel = panelOf(key); nudge(ui.hx, key, dx, max); redraw() },
    vpan: (key, dy) => { lastPanel = panelOf(key); nudge(ui.scroll, key, scrollSign(key) * dy, scrollMax.get(key) ?? 0); redraw() },
    archPan: dx => { lastPanel = 'arch'; ui.archPanX = Math.max(0, ui.archPanX + dx); redraw() },
    archOpen: () => {
      if (!arch?.model) return
      const view = ui.archTrail.at(-1) ?? arch.model.first
      void $.process.run([`${BIN}/asint-likec4-view`, arch.dir, view], { timeoutMs: 60_000 }).catch(() => undefined)
    },
    minimize: () => void minimize($),
    mapView: v => { ui.mapView = v; mapCells = ''; redraw() },
    openMsg: (to, at) => { lastPanel = 'map'; toggleMsg(ui, to, at); redraw() },
    closeMsg: () => { ui.msgTo = undefined; redraw() },
    sendMsg: (to, text) => void sendTo($, to, text),
    nextCombo: () => { ui.comboSlot = ui.comboSlot === 0 ? 1 : 0; redraw() },
    focusAgent: id => { ui.focusAgent = id; redraw() },
    selFile: path => { lastPanel = 'files'; selectFile(ui, path); redraw() },
    toggleFull: () => { ui.fullFile = !ui.fullFile; redraw() },
    toggleReads: () => { ui.showReads = !ui.showReads; redraw() },
    openExternal: path => void openFile($, path),
    openUrl: url => void openDefault($, url),
    selExec: id => { ui.selExec = ui.selExec === id ? undefined : id; redraw() },
    selAgent: id => { lastPanel = 'orch'; toggleAgent(ui, S, id); redraw() },
    clearFilesBy: () => { ui.filesBy = undefined; redraw() },
    selTodo: key => { lastPanel = 'todo'; selectTodo(ui, key); redraw() },
    selStep: id => { ui.selStep = ui.selStep === id ? undefined : id; redraw() },
    gotoExec: id => { ui.selExec = id; act.focusPanel('exec') },
    mediaFilter: f => { ui.mediaFilter = f; redraw() },
    selMedia: id => {
      ui.selMedia = id
      mediaFrame = 0
      const m = S.media.find(x => x.id === id)
      if (m?.kind === 'WEB') void openExternal($, m.path)
      else if (m?.viewer) void openDefault($, m.viewer)
      redraw()
    },
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    BIN = `${$.plugin.root}/bin`
    void resolveLikec4($)
    const savedLang = await $.store.get('lang')
    const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
    setLang(savedLang === 'zh' || savedLang === 'en' ? savedLang : langFromLocale(locale))
    const saved = await $.store.get('skin')
    if (saved === 'hacker' || saved === 'omarchy') await update($, skin, () => saved)
    const savedSplit = await $.store.get('splitRatio')
    if (savedSplit && typeof savedSplit === 'object') ui.splitRatio = { ...(savedSplit as Record<string, number>) }
    await loadLayout($)
    await loadTheme($)
    await applySkin($)
    $.clock.every(THEME_POLL_MS, () => void loadTheme($))
    $.clock.every(TICK_MS, () => void tick($))
    await $.command.register({ name: 'skin', description: t('儀表板配色：/skin hacker 磷光、/skin omarchy 跟主題；聊天欄一律磷光', 'Dashboard colors: /skin hacker for phosphor, /skin omarchy to follow the theme; the chat column is always phosphor') })
    // The checklist tool stands in for TodoWrite/TaskCreate, which this Claude Code version lacks (rules.ts).
    await $.tool.register(CHECKLIST_SPEC).catch(() => undefined)
    await $.command.register({ name: 'asint', description: t('打開 asint 儀表板；/asint edit 編輯版面、/asint root <資料夾> 換 FILES 的資料夾、/asint reset 還原、/asint arch 檢查或建立架構圖', 'Open the asint dashboard; /asint edit to edit the layout, /asint reset to restore it, /asint arch to check or create the architecture diagram') })
    await $.command.register({ name: 'html', description: t('打開網頁：/html <路徑或網址> 在終端機旁邊；/html -b <…> 用 Brave', 'Open a web page: /html <path or URL> beside the terminal; /html -b <…> in Brave') })

    S = emptySession()
    act = makeActions($)
    sid = await $.session.id()
    savedText = ''
    sessionSince = Date.now()
    gitState = new Map()
    await restoreSession($)
    sessionSince = Math.min(sessionSince, ...S.log.map(x => x.at), ...S.execs.map(x => x.startedAt))
    void cleanSessions($)
    ui.zen = undefined
    const own = await $.store.get(`minimized:${sid}`)
    minimized = typeof own === 'boolean' ? own : (await $.store.get('minimized')) === true
    // Opens by default; below 144 terminal columns the engine queues it and it appears once the terminal is wide enough.
    if (!minimized) void $.ui.open({ id: PANE, title: 'ASINT' })
    void refreshUsage($)
    loc = undefined
    hadReply = false
    title = undefined
    transcript = undefined
    void refreshTitle($)
    pictures.clear()
    draft = []
    void refreshLocation($); void refreshProject($)
    $.clock.every(DRAFT_POLL_MS, () => void pollDraft($))
    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const arg = e.args.trim()
    const now = await read($, skin)
    const target: Skin = arg === 'hacker' || arg === 'omarchy' ? arg : now === 'hacker' ? 'omarchy' : 'hacker'
    await setSkin($, target)
    return { text: target === 'hacker' ? t('儀表板也改成磷光配色', 'Dashboard in phosphor colors too') : t('儀表板跟著 Omarchy 主題', 'Dashboard follows the Omarchy theme') }
  })

  on('command.run', { command: 'asint' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'edit') {
      editing = true
      await setMinimized($, false)
      await $.ui.open({ id: PANE, title: 'ASINT', focus: true })
      $.ui.invalidate('ui.render')
      return { text: t('版面編輯：拖邊界調大小、拖標題搬面板，按「完成」存檔', 'Layout editor: drag borders to resize, drag titles to move panels, press Done to save') }
    }
    if (arg === 'lang' || arg.startsWith('lang ')) {
      const want = arg.slice(4).trim()
      if (want !== 'zh' && want !== 'en' && want !== 'auto') return { text: t('用法：/asint lang zh|en|auto', 'Usage: /asint lang zh|en|auto') }
      await $.store.set('lang', want)
      const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
      setLang(want === 'auto' ? langFromLocale(locale) : want)
      $.ui.invalidate('ui.render')
      return { text: t('介面語言已切換', 'Interface language updated') }
    }
    if (arg === 'arch') {
      // A slash-command hook can't call prompt.submit (it would wait on the turn it is holding); the next tick sends it.
      archInitPending = true
      return { text: t('已請 agent 檢查架構圖：沒有就建立，有就對照程式碼補齊', 'Asked the agent to check the architecture diagram: create it if missing, bring it in line with the code otherwise') }
    }
    if (arg === 'root' || arg.startsWith('root ')) {
      const want = arg.slice(4).trim()
      const home = (await $.env.get('HOME')) ?? ''
      act?.setRoot(want ? want.replace(/^~(?=\/|$)/, home) : undefined)
      return { text: want ? t(`FILES 改看 ${want}`, `FILES now shows ${want}`) : t('FILES 回到 session 的資料夾', 'FILES is back on the session folder') }
    }
    if (arg === 'reset') {
      await saveLayout($, DEFAULT_LAYOUT)
      $.ui.invalidate('ui.render')
      return { text: t(`版面已還原成預設（${LAYOUT_FILE}）`, `Layout reset to default (${LAYOUT_FILE})`) }
    }
    await setMinimized($, false)
    await $.ui.open({ id: PANE, title: 'ASINT', focus: true })
    const keys = Object.entries(PANEL_KEY).map(([k, v]) => `${v} ${PANEL_LABEL[k as Panel]}`)
    return { text: t(`儀表板已打開：ctrl+x tab 進入後 ${keys.join('、')}，g 編輯版面`, `Dashboard open: press ctrl+x tab to enter, then ${keys.join(', ')}, g to edit the layout`) }
  })

  // The wheel scrolls the card under the pointer (or its detail region), not the whole pane: the pane is always exactly one screen tall.
  // The agent decides itself whether the architecture diagram needs updating: when the project has a LikeC4 diagram, a rule goes into
  // the system prompt instead of a background model call. Only file existence is checked, not contents, so each request costs one git call and one directory listing.
  // Two system prompt rules: deliverables stay in the terminal (always), and the agent decides on diagram updates (when the project has .c4 files).
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const sections = [...r.sections, { id: 'asint:output', text: OUTPUT_RULE, scope: 'session' as const }, { id: 'asint:checklist', text: CHECKLIST_RULE, scope: 'session' as const }]
    const dirs = await archBaseDirs($).catch(() => [] as string[])
    const paths: string[] = []
    for (const d of dirs) for (const f of await $.fs.list(d).catch(() => [])) if (isC4File(f)) paths.push(`${d}/${f.name}`)
    if (paths.length) sections.push({ id: 'asint:arch', scope: 'session' as const, text: archRule(paths, likec4Label(LIKEC4)) })
    return { ...r, sections }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'html' }, async ($, e) => {
    const { brave, raw } = htmlArgs(e.args)
    if (!raw) return { text: t('用法：/html <路徑或網址>（終端機旁邊的瀏覽器）；/html -b <路徑或網址>（Brave，要觸控板手勢時用）', 'Usage: /html <path or URL> (browser beside the terminal); /html -b <path or URL> (Brave, for trackpad gestures)') }
    const home = await $.env.get('HOME')
    const target = raw.replace(/^~(?=\/)/, home ?? '~')
    if (brave) await openDefault($, target)
    else await openExternal($, target)
    return { text: brave ? t(`已在 Brave 打開 ${target}`, `Opened ${target} in Brave`) : t(`已在終端機旁邊打開 ${target}`, `Opened ${target} beside the terminal`) }
  })

  // Artifacts publish as usual; when the published file is .html, also open the local copy in a browser and record the link in MEDIA.
  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const r = await next(e)
    try {
      const input = e as { action?: string; file_path?: string }
      if ((input.action ?? 'publish') === 'publish' && r.deny === undefined && !r.isError && input.file_path?.endsWith('.html')) {
        addWeb(input.file_path, await $.clock.now(), artifactUrl(r.text, r.result))
        await openExternal($, input.file_path)
        $.ui.invalidate('ui.render')
      }
    } catch {
      // A failed browser launch doesn't affect the publish.
    }
    return r
  }).catch(($, e, next) => next(e))

  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    const key = scrollKeyAt(shown(), paneSize, e.pointer, lastPanel, ui.splitRatio)
    if (!key) return { deny: t('asint：這裡沒有可捲動的內容', 'asint: nothing to scroll here') }
    lastPanel = panelOf(key)
    nudge(ui.scroll, key, scrollSign(key) * e.by * 3, scrollMax.get(key) ?? 0)
    $.ui.invalidate('ui.render')
    return { deny: t('asint：捲動的是卡片內容', 'asint: scrolling the card contents') }
  }).catch(() => ({ deny: t('asint：捲動失敗', 'asint: scroll failed') }))

  // The editor sends the new layout on mouse release: validate and save it.
  on('ui.message', { requestId: PANE }, async ($, e, next) => {
    const data = e.data as { layout?: unknown; epoch?: string; keys?: { n: number; key: string }[]; pick?: string; split?: { panel: string; left: number; total: number; final: boolean } }
    if (Array.isArray(data?.keys) && typeof data.epoch === 'string') {
      treeKeys(data.epoch, data.keys)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    // A click on a row drawn by a Client module (the running command and the running checklist item): it reports what it stands for.
    if (typeof data?.pick === 'string') {
      const [kind, ...rest] = data.pick.split(':')
      const id = rest.join(':')
      if (kind === 'exec') { lastPanel = 'exec'; ui.selExec = id }
      else if (kind === 'file') act.treeSelect(id)
      else if (kind === 'dir') act.treeToggle(id)
      else if (kind === 'todo') { lastPanel = 'todo'; selectTodo(ui, id) }
      $.ui.invalidate('ui.render')
      if (!paneFocused) void $.ui.open({ id: PANE, title: paneTitle(), focus: true, ...(requestedCols ? { columns: requestedCols } : {}) }).catch(() => undefined)
      return next(e)
    }
    if (data?.split) {
      const d = data.split
      if (Number.isFinite(d.left) && Number.isFinite(d.total) && typeof d.panel === 'string') {
        ui.splitRatio[d.panel] = ratioFromDrag(d.left, d.total)
        $.ui.invalidate('ui.render')
        if (d.final) await $.store.set('splitRatio', ui.splitRatio)
      }
      return next(e)
    }
    if (data && data.layout) {
      const next2 = parseLayout(JSON.stringify(data.layout))
      await saveLayout($, next2)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Clicking a button in the pane also gives the pane keyboard focus, so later shortcuts (z, g, panel letters) don't land in the prompt.
  // The engine only grants this when the prompt is empty; otherwise focus stays where it is.
  on('ui.press', { requestId: PANE }, async ($, e, next) => {
    const r = await next(e)
    if (!paneFocused) void $.ui.open({ id: PANE, title: paneTitle(), focus: true, ...(requestedCols ? { columns: requestedCols } : {}) }).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    paneOpen = false
    // Closing with ✕ counts as minimizing.
    if (e.origin.kind === 'person') await setMinimized($, true)
    ui.zen = undefined
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, turnStartedAt, () => now)
    S.vitals.turnRunning = true
    S.vitals.turnStartedAt = now
    S.lastEventAt = now
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // turn.step is a streaming event: the hook must be a generator that passes the stream through unchanged.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      S.vitals.model = prettyModel(e.model)
      S.vitals.effort = typeof e.effort === 'string' ? e.effort : undefined
    }
    // Watch tool calls in the stream: follow an edit tool as soon as its file_path appears, and draw new_string/content as it arrives.
    const stream = next(e)
    const calls = new Map<number, { name: string; id: string; json: string }>()
    for await (const chunk of stream) {
      try {
        if (chunk.kind === 'tool') calls.set(chunk.index, { name: chunk.name, id: chunk.id, json: '' })
        else if (chunk.kind === 'input') {
          const call = calls.get(chunk.index)
          if (call && LIVE_TOOLS.has(call.name)) {
            call.json += chunk.json
            const next2 = readLive(call.name, call.id, e.agentId ?? 'main', call.json)
            const isNewPath = next2.path && live?.path !== next2.path
            live = next2
            if (isNewPath && next2.path) { followTo(next2.path); void suggestRootFor($, next2.path) }
            liveFrame($, !!isNewPath)
          }
        }
      } catch {
        // A parse failure only affects the view; the stream passes through as usual.
      }
      yield chunk
    }
    return await stream.result
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId) {
      const a = S.agents.get(e.agentId)
      if (a) upsertAgent(S, { ...a, status: e.reason === 'error' ? 'error' : 'done', endedAt: now, doing: undefined })
      log(S, { at: now, who: e.agentId, kind: 'agent', text: t(`完成 ${formatDuration(e.durationMs)}`, `Done ${formatDuration(e.durationMs)}`) })
    } else {
      S.vitals.turnRunning = false
      hadReply = true
      void persist($)
      // A denied or interrupted tool never finishes its tool.call, so clear the live edit when the turn ends.
      live = undefined
      await refreshUsage($)
      void refreshTitle($)
      void refreshLocation($); void refreshProject($)
    }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const now = await $.clock.now()
      upsertAgent(S, { id: r.agentId, label: e.name ?? e.description ?? e.subagentType, type: e.subagentType, startedAt: now, status: 'running', model: e.model })
      log(S, { at: now, who: e.parentAgentId ?? 'main', kind: 'agent', text: t(`派出 ${e.subagentType}：${e.description}`, `Spawned ${e.subagentType}: ${e.description}`) })
      $.ui.invalidate('ui.render')
    }
    return r
  }).catch(($, e, next) => next(e))

  // When a background command ends, Claude Code appends a <task-notification> message to the conversation; read the task id and status from it.
  on('session.append', ($, e, next) => {
    for (const b of e.message.content) {
      if (b.type !== 'text' || typeof b.text !== 'string' || !b.text.includes('<task-notification>')) continue
      if (endTask(S, b.text, bgOutput, Date.now())) $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Every tool call: Bash goes to Exec, file tools to Files, checklist tools to Todo, the rest to Log; afterwards look for new media.
  on('tool.call', async ($, e, next) => {
    // Never create Claude Docs documents: deliverables go in the reply.
    if (isDocsCreate(e)) return { deny: DOCS_DENY }
    const at = await $.clock.now()
    const who = e.agentId ?? 'main'
    const input = e as unknown as Record<string, unknown> & { tool: string; tool_use_id: string }
    if ((e.tool as string) === CHECKLIST_TOOL) {
      const r = applyChecklist(S, input.todos, who, at)
      if ('error' in r) return { isError: true, result: r.error, text: r.error }
      markFresh('todo')
      $.ui.invalidate('ui.render')
      return { result: r.text, text: r.text } as never
    }
    const line = summary(e.tool, input)
    const brief = briefTool(e.tool, input)
    const agent = S.agents.get(who)
    if (agent) upsertAgent(S, { ...agent, doing: brief })
    if (e.tool === 'Bash') {
      startExec(S, {
        id: input.tool_use_id, who, command: String(input.command ?? ''), description: input.description as string | undefined,
        cwd: await $.session.cwd(), startedAt: at, status: 'running',
      })
      $.ui.invalidate('ui.render')
    }
    const ran = await next(e)
    const end = await $.clock.now()
    const notes: string[] = []
    try {
      const result = (ran.result ?? {}) as Record<string, unknown>
      const failed = ran.deny !== undefined || ran.isError === true
      const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined
      if (e.tool === 'Bash') {
        const x = S.execs.find(y => y.id === input.tool_use_id)
        const taskId = x ? endExec(x, result, ran.text, failed, end) : undefined
        if (x && taskId) {
          const dir = await findSessionDir($)
          if (dir) x.outputPath = taskOutput(dir, taskId)
        }
        log(S, { at: end, who, kind: failed ? 'error' : 'tool', text: line, brief, op: failed ? 'X' : 'B' })
        markFresh('exec')
        void refreshLocation($); void refreshProject($)
        if (!failed) for (const m of await newMediaSince($, Math.floor(at / 1000) - 1)) {
          const id = await addMedia($, m)
          if (id) notes.push(`asint: ${id} = ${m}`)
        }
      } else {
        if (e.tool === 'Edit' || e.tool === 'NotebookEdit' || e.tool === 'Write') void finishLive($, input.tool_use_id, path, !failed)
        const fx = recordTool(S, e.tool, input, result, { failed, path, who, at: end, line, brief })
        if (fx.fresh) markFresh(fx.fresh)
        if (fx.web) addWeb(fx.web, end)
        if (fx.media) {
          const id = await addMedia($, fx.media)
          if (id) notes.push(`asint: ${id} = ${fx.media}`)
        }
      }
    } catch {
      // A logging failure doesn't affect the tool's result.
    }
    $.ui.invalidate('ui.render')
    if (notes.length && ran.deny === undefined) return { ...ran, context: [...(ran.context ?? []), ...notes] } as typeof ran
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>{t('asint 儀表板只畫在終端機。', 'The asint dashboard only renders in the terminal.')}</Text>
    }
    paneOpen = true
    paneFocused = e.props.isFocused
    const el = $.ui.resolve(e as typeof e & { surface: 'terminal' })
    const [p, sk, now] = await Promise.all([read($, palette), read($, skin), $.clock.now()])
    const width = Math.max(30, e.props.bodyColumns)
    const rows = Math.max(12, e.props.scroll.bodyRows)
    paneSize = { w: width, h: rows }

    // Files: read the selected file up front when it has no diff or the full content is requested.
    let fileText: string | undefined
    let filePreview: ViewCtx['filePreview']
    if (isShown(shown(), 'files')) {
      const list = changesList(S, { showReads: ui.showReads, by: ui.filesBy })
      const sel = list.find(f => f.path === ui.selFile) ?? list[0]
      if (sel && (ui.fullFile || !sel.diff.length) && !isMedia(sel.path)) {
        const key = `${sel.path}@${sel.lastAt}`
        if (fileCache.key !== key) {
          const text = await $.fs.read(sel.path).catch(() => t('（讀不到這個檔案）', '(cannot read this file)'))
          fileCache = { key, text: typeof text === 'string' ? text : t('（二進位檔）', '(binary file)') }
        }
        fileText = fileCache.text
      }
      if (sel && isMedia(sel.path)) {
        const hit = previews.get(sel.path)
        if (hit) filePreview = { path: sel.path, ...hit }
        else void prepPreview($, sel.path)
      }
    }

    let treeText: string | undefined
    let treePreview: ViewCtx['treePreview']
    if (isShown(shown(), 'project')) {
      if (!project) void refreshProject($)
      else if (ui.treeSel) {
        const abs = `${project.root}/${ui.treeSel}`
        if (isMedia(abs)) {
          const hit = previews.get(abs)
          if (hit) treePreview = { path: abs, ...hit }
          else void prepPreview($, abs)
        } else {
          // Re-read after an edit (lastAt changed); a streaming Edit needs the pre-edit content, so don't re-read every time.
          const key = `${abs}@${S.files.get(abs)?.lastAt ?? 0}`
          if (treeCache.key !== key) {
            const text = await $.fs.read(abs).catch(() => t('（讀不到這個檔案）', '(cannot read this file)'))
            treeCache = { key, text: typeof text === 'string' ? text : t('（二進位檔）', '(binary file)') }
          }
          treeText = treeCache.text
        }
      }
    }

    act ??= makeActions($)
    // Don't wait for the next tick the first time ARCH is shown.
    if (!arch && isShown(shown(), 'arch')) void refreshArch($)
    if (editing) {
      const { Box, Button, Text } = el
      const labels = Object.fromEntries(PANELS.map(t => [t, t === 'status' ? 'STATUS' : PANEL_LABEL[t]]))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={2}>
            <Text color={p.accent} bold>{t('編輯版面', 'Edit layout')}</Text>
            <Text color={p.muted}>{t('拖邊界調大小 · 拖標題到別格的上下左右切開、中間疊成分頁', 'Drag borders to resize · drag a title onto an edge of another cell to split it, or its center to stack as a tab')}</Text>
            <Box flexGrow={1} />
            <Button key="layout-reset" plain dimColor label={t('還原預設', 'Reset to default')} onPress={() => { void saveLayout($, DEFAULT_LAYOUT).then(() => $.ui.invalidate('ui.render')) }} />
            <Button key="layout-done" hotkey="g" label={t('完成', 'Done')} onPress={() => { editing = false; $.ui.invalidate('ui.render') }} />
          </Box>
          {/* A Client's props may not hold undefined anywhere (the engine refuses the whole pane), so the layout goes through JSON. */}
          <el.Client key={`editor-${layoutText.length}`} module="./editor.tsx"
            props={{ layout: JSON.parse(JSON.stringify(layout)) as never, width, height: rows - 1, palette: p, labels, lang: getLang() } as never} />
        </Box>
      )
    }

    // The Map canvas and media image sizes come from the cell each gets in the layout.
    let map: ViewCtx['map']
    const mapArea = panelArea(shown(), 'map', width, rows)
    if (mapVisible() && mapArea) {
      mapSize = { cols: mapArea.cols, rows: Math.max(4, mapArea.rows - 1) }
      mapCells = renderMap(p, now)
      map = { cells: mapCells, ...mapSize }
    }
    for (const t of PANELS) if (isShown(shown(), t)) fresh.delete(t)

    const ctx: ViewCtx = { el, s: S, ui, p, skin: sk, now, width, rows, act, fileText, map, bgOutput, mediaFrame, fresh: [...fresh], scrollMax, arch, archUpper: ui.archDirs.slice(0, -1).map(archDirLabel), filePreview, project, git: gitState, suggestRoot, treeAck, treeText, treePreview, live, flash,
      oOwner: oOwner(ui.zen, lastPanel, shown()), current: paneFocused ? (ui.zen ?? (isShown(shown(), lastPanel) ? lastPanel : undefined)) : undefined }
    try {
      return dashboard(ctx, shown())
    } catch (err) {
      // When a hook throws, the engine draws an empty pane with no clue why: render the error and log it to a file (latest only).
      const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
      void $.fs.write(`${await $.env.get('HOME')}/.cache/asint/last-error.log`, `${new Date(now).toISOString()} Pane\n${text}\n`).catch(() => undefined)
      return (
        <el.Box flexDirection="column">
          <el.Text color={p.error} bold>{t('asint 畫面出錯（已記到 ~/.cache/asint/last-error.log）', 'asint view error (logged to ~/.cache/asint/last-error.log)')}</el.Text>
          <el.Text color={p.muted}>{text.slice(0, 2000)}</el.Text>
          <el.Button key="error-reset" label={t('回到預設畫面', 'Back to default view')} onPress={() => { ui.zen = undefined; ui.archTrail = []; ui.archSel = undefined; $.ui.invalidate('ui.render') }} />
        </el.Box>
      )
    }
  })

  // ── Themed UI components ──

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const el = $.ui.resolve(e)
    const [p, s, startedAt, now] = await Promise.all([read($, chatPalette), read($, skin), read($, turnStartedAt), $.clock.now()])
    const text = e.props.message ?? e.props.word
    const suffix = text.endsWith('…') ? '' : e.props.suffix
    return (
      <el.Client
        key="spinner"
        module="./spinner.tsx"
        props={{ text: text + suffix, mode: e.props.mode, palette: p, skin: s, elapsedMs: startedAt ? now - startedAt : 0, lang: getLang() }}
      />
    )
  })

  // End of turn: a closing line plus a faint rule, so turns are visibly separated.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = await read($, chatPalette)
    const columns = e.viewport?.columns ?? 80
    const time = formatDuration(e.props.durationMs)
    const head = `[ OK ] ${e.props.word.toUpperCase()} T+${time} `
    const rule = '═'.repeat(Math.max(0, columns - head.length - 4))
    return (
      <Box flexDirection="row">
        <Text color={p.success}>{head.slice(0, 6)}</Text>
        <Text color={p.muted}>{head.slice(6)}</Text>
        <Text color={p.faint}>{rule}</Text>
      </Box>
    )
  })

  // Claude's replies: the first block of a reply gets an accent-colored ◆, the text goes to reply.tsx, which lays it out like a document
  // at the width the block really has. Anything that goes wrong falls back to the engine's own drawing, so a reply never disappears.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    try {
      const { Box, Text, Client } = $.ui.resolve(e as typeof e & { surface: 'terminal' })
      const p = await read($, chatPalette)
      return (
        <Box flexDirection="row">
          <Box width={2} flexShrink={0}>
            <Text color={p.accent}>{e.props.isFirstOfReply ? '◆' : ' '}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} flexDirection="column">
            <Client key="reply" module="./reply.tsx" width="100%" props={{ text: e.props.text, palette: p }} />
          </Box>
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  // The user's own messages: a block one step lighter than the background, an accent-colored prompt, and pasted images shown enlarged below.
  // Only messages from the composer; task notifications and other agents' messages are left to the engine (it handles collapsing).
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer') return next(e)
    const el = $.ui.resolve(e as typeof e & { surface: 'terminal' })
    const { Box, Text } = el
    const p = await read($, chatPalette)
    const list = (await Promise.all(imageTags(e.props.text).map(n => picture($, n)))).filter(x => x !== undefined)
    const { columns = 80, rows = 24 } = e.viewport ?? {}
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" backgroundColor={p.surface} paddingX={1} width="100%">
          <Text color={p.accent} bold>root@asint:~# </Text>
          <Box flexGrow={1}>
            <Text color={p.hi}>{e.props.text}</Text>
          </Box>
        </Box>
        {list.length ? tiles(el, p, list, Math.min(120, columns - 4), Math.min(20, Math.floor(rows / 2))) : null}
      </Box>
    )
  })

  // The bar above the prompt: images pasted in the draft, plus a row with session name, location, compact stats and buttons.
  // The turn timer lives only in the spinner line; when too narrow, stats and buttons wrap to a right-aligned second row and cwd stays on the first.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return below
    const el = $.ui.resolve(e as typeof e & { surface: 'terminal' })
    const { Box, Button } = el
    const p = await read($, chatPalette)
    const width = e.props.bodyColumns
    chatCols = width + 5
    const list = draft.map(n => pictures.get(n)).filter(x => x !== undefined)
    // Thumbnails take at most 6 rows and leave two rows for the location row.
    const imageRows = Math.min(6, e.props.maxRows - TILE_CHROME_ROWS - 2)
    const expandLabel = t('▣ 儀表板', '▣ Dashboard')
    const plainLabel = t('白話', 'Plain')
    const archLabel = t('架構圖', 'Arch diagram')
    const showExpand = minimized || !paneOpen
    const buttons = [
      // Not only after Minimize: the engine also drops or queues the pane on a narrow terminal, which leaves no way back in.
      showExpand ? <Button key="expand" plain dimColor label={expandLabel} onPress={() => void restore($)} /> : null,
      hadReply ? <Button key="plain" plain dimColor label={plainLabel} onPress={() => { void $.command.run({ command: 'btw', args: PLAIN_ASK } as never) }} /> : null,
      <Button key="arch-init" plain dimColor label={archLabel} onPress={() => { archInitPending = true }} />,
    ].filter(x => x !== null)
    // Each button takes its label width plus the 3-column gap.
    const rightWidth = cells(vitalsCompactText(S.vitals)) + (showExpand ? cells(expandLabel) + 3 : 0) + (hadReply ? cells(plainLabel) + 3 : 0) + cells(archLabel) + 3
    // Share a row with the stats only if the location row still fits the name, repo and 16 columns of cwd.
    const oneRow = !loc || headWidth(loc, title) + 16 + 3 + rightWidth <= width
    const right = (
      <Box flexDirection="row" columnGap={3} flexShrink={0}>
        {vitalsCompact(el, p, S.vitals)}
        {buttons}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {list.length && imageRows >= 1 ? tiles(el, p, list, width, imageRows) : null}
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1}>{loc ? locationRow(el, p, loc, oneRow ? width - rightWidth - 3 : width, title) : null}</Box>
          {oneRow ? <Box width={3} /> : null}
          {oneRow ? right : null}
        </Box>
        {oneRow ? null : <Box flexDirection="row"><Box flexGrow={1} />{right}</Box>}
        {below}
      </Box>
    )
  })
}
