// The dashboard's data model: plain data and update functions that never touch $, so they are easy to test.
// Held in a module variable (register.tsx owns one Session) and cleared on reload; acceptable within a session.

export const KEEP = 500

export type Who = string // 'main' or a subagent's agentId

export type FileOp = 'R' | 'M' | 'A'
export type FileEntry = {
  path: string
  op: FileOp // the strongest operation seen: A > M > R
  count: number
  lastAt: number
  lastOp: FileOp
  by: Who[]
  /** Unified diff lines merged from the structuredPatch of every Edit/Write in this session. */
  diff: string[]
}

export type Exec = {
  id: string
  who: Who
  command: string
  description?: string
  cwd?: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'ok' | 'error' | 'background'
  exit?: number
  stdout?: string
  stderr?: string
  /** Output file of a background command. */
  outputPath?: string
}

export type Agent = {
  id: Who
  label: string
  type: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'error'
  /** What it is doing now (a one-line summary of the latest tool call). */
  doing?: string
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type Todo = {
  key: string
  content: string
  activeForm?: string
  status: TodoStatus
  startedAt?: number
  doneAt?: number
  by?: Who
}

export type LogKind = 'tool' | 'check' | 'agent' | 'turn' | 'media' | 'error'
export type LogEntry = { at: number; who: Who; kind: LogKind; text: string; op?: 'R' | 'E' | 'W' | 'B' | 'X'; file?: string }

// WEB: an .html file Claude wrote or an Artifact it published; no frames, opens in the browser when clicked.
export type MediaKind = 'IMG' | 'GIF' | 'VID' | '3D' | 'WEB'
export type Media = {
  id: string // IMG-01
  kind: MediaKind
  path: string
  at: number
  width: number
  height: number
  fps: number
  frames: string[]
  viewer?: string
  /** WEB: the claude.ai link after publishing. */
  url?: string
}

export type Vitals = {
  model?: string
  effort?: string
  ctxPercent?: number
  ctxTokens?: number
  ctxWindow?: number
  rate5h?: number
  rate7d?: number
  costUsd?: number
  turnStartedAt?: number
  turnRunning: boolean
}

export type Session = {
  files: Map<string, FileEntry>
  execs: Exec[]
  agents: Map<Who, Agent>
  todos: Todo[]
  log: LogEntry[]
  media: Media[]
  vitals: Vitals
  /** Time of the latest event of any kind; sets the Map frame rate. */
  lastEventAt: number
}

export const emptySession = (): Session => ({
  files: new Map(),
  execs: [],
  agents: new Map(),
  todos: [],
  log: [],
  media: [],
  vitals: { turnRunning: false },
  lastEventAt: 0,
})

const STRENGTH: Record<FileOp, number> = { R: 0, M: 1, A: 2 }

const cap = <T>(xs: T[]) => (xs.length > KEEP ? xs.splice(0, xs.length - KEEP) : undefined)

export function touchFile(s: Session, path: string, op: FileOp, who: Who, at: number, patch?: string[]) {
  const f = s.files.get(path) ?? { path, op, count: 0, lastAt: at, lastOp: op, by: [], diff: [] }
  if (STRENGTH[op] > STRENGTH[f.op]) f.op = op
  f.count++
  f.lastAt = at
  f.lastOp = op
  if (!f.by.includes(who)) f.by.push(who)
  if (patch?.length) f.diff.push(...patch)
  s.files.set(path, f)
  if (s.files.size > KEEP) {
    const oldest = [...s.files.values()].sort((a, b) => a.lastAt - b.lastAt)[0]
    if (oldest) s.files.delete(oldest.path)
  }
  s.lastEventAt = at
}

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
/** Converts the structuredPatch of an Edit/Write result into unified diff lines (with @@ headers). */
export const patchLines = (hunks: readonly Hunk[] | undefined) =>
  (hunks ?? []).flatMap(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines])

export function log(s: Session, e: LogEntry) {
  s.log.push(e)
  cap(s.log)
  s.lastEventAt = e.at
}

export function startExec(s: Session, x: Exec) {
  s.execs.push(x)
  cap(s.execs)
  s.lastEventAt = x.startedAt
}

/** Bash error text usually starts with "Exit code N". */
export const exitCodeOf = (text: string | undefined) => {
  const m = /Exit code (\d+)/.exec(text ?? '')
  return m ? Number(m[1]) : undefined
}

export function upsertAgent(s: Session, a: Agent) {
  s.agents.set(a.id, { ...s.agents.get(a.id), ...a })
}

/** TodoWrite sends the whole list every time; content is the key, keeping each item's start and finish times. */
export function applyTodoWrite(s: Session, todos: readonly { content: string; status: TodoStatus; activeForm?: string }[], who: Who, at: number) {
  const prev = new Map(s.todos.map(t => [t.key, t]))
  s.todos = todos.map(t => {
    const old = prev.get(t.content)
    const next: Todo = { key: t.content, content: t.content, activeForm: t.activeForm, status: t.status, startedAt: old?.startedAt, doneAt: old?.doneAt, by: old?.by }
    if (t.status === 'in_progress' && !next.startedAt) next.startedAt = at
    if (t.status === 'completed' && !next.doneAt) {
      next.doneAt = at
      next.by = who
      next.startedAt ??= at
    }
    return next
  })
  s.lastEventAt = at
}

export function applyTaskCreate(s: Session, id: string, subject: string, activeForm: string | undefined, at: number) {
  s.todos.push({ key: id, content: subject, activeForm, status: 'pending' })
  s.lastEventAt = at
}

export function applyTaskUpdate(s: Session, id: string, patch: { status?: string; subject?: string; activeForm?: string }, who: Who, at: number) {
  const t = s.todos.find(x => x.key === id)
  if (!t) return
  if (patch.status === 'deleted') {
    s.todos = s.todos.filter(x => x !== t)
    return
  }
  if (patch.subject) t.content = patch.subject
  if (patch.activeForm) t.activeForm = patch.activeForm
  if (patch.status === 'in_progress' || patch.status === 'pending' || patch.status === 'completed') t.status = patch.status
  if (t.status === 'in_progress') t.startedAt ??= at
  if (t.status === 'completed' && !t.doneAt) {
    t.doneAt = at
    t.by = who
    t.startedAt ??= at
  }
  s.lastEventAt = at
}

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|tiff?|apng|mp4|mov|webm|mkv|avi|m4v|glb|gltf|stl|obj|ply)$/i
export const isMedia = (path: string) => MEDIA_EXT.test(path)

export const mediaKind = (path: string, frames: number, isModel: boolean): MediaKind =>
  isModel ? '3D' : /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(path) ? 'VID' : frames > 1 ? 'GIF' : 'IMG'

/** The same file keeps its number; new files are numbered sequentially per type. */
export function registerMedia(s: Session, m: Omit<Media, 'id'>) {
  const old = s.media.find(x => x.path === m.path)
  if (old) {
    Object.assign(old, m, { id: old.id })
    return old
  }
  const n = s.media.filter(x => x.kind === m.kind).length + 1
  const entry = { ...m, id: `${m.kind}-${String(n).padStart(2, '0')}` }
  s.media.push(entry)
  return entry
}

export const short = (path: string) => path.split('/').pop() ?? path
export const whoLabel = (s: Session, who: Who) => (who === 'main' ? 'main' : s.agents.get(who)?.label ?? who.slice(0, 6))

export const fmtDur = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s`
}
export const fmtClock = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}
