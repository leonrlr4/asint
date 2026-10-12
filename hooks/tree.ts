// FILES tree helpers: what kind of file a name is, what is going on with it, and which folders hold something worth showing.
// Pure data; never touches $.

import type { FileEntry } from './model'

/** What git says about a file: M changed since HEAD, ? not tracked, C committed during this session. */
export type GitMark = 'M' | '?' | 'C'
export type GitState = Map<string, GitMark>

/** Colors a badge or chip may ask for; views.tsx maps them onto the palette. */
export type Tone = 'accent' | 'success' | 'warn' | 'error' | 'muted' | 'faint'

const lines = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean)

/** Output of `git diff --name-only HEAD`, `git ls-files -o --exclude-standard` and `git log --name-only --pretty=format: --since=…`, all relative to the repository root. */
export function parseGit(diff: string, untracked: string, committed: string): GitState {
  const out: GitState = new Map()
  for (const p of lines(untracked)) out.set(p, '?')
  for (const p of lines(diff)) out.set(p, 'M')
  // A file changed again after it was committed still shows as changed (M wins over C).
  for (const p of lines(committed)) if (!out.has(p)) out.set(p, 'C')
  return out
}

const BADGES: Record<string, [string, Tone]> = {
  ts: ['TS', 'accent'], tsx: ['TX', 'accent'], mts: ['TS', 'accent'], cts: ['TS', 'accent'],
  js: ['JS', 'warn'], jsx: ['JX', 'warn'], mjs: ['JS', 'warn'], cjs: ['JS', 'warn'],
  py: ['PY', 'success'], rb: ['RB', 'error'], go: ['GO', 'accent'], rs: ['RS', 'warn'], java: ['JV', 'warn'], php: ['PH', 'accent'],
  c: ['C ', 'accent'], h: ['H ', 'accent'], cpp: ['C+', 'accent'], cs: ['C#', 'success'],
  sh: ['SH', 'success'], bash: ['SH', 'success'], zsh: ['SH', 'success'],
  json: ['{}', 'success'], yaml: ['YM', 'warn'], yml: ['YM', 'warn'], toml: ['TM', 'warn'], xml: ['XM', 'warn'], lock: ['LK', 'faint'],
  md: ['MD', 'muted'], txt: ['TX', 'muted'], csv: ['CS', 'success'], tsv: ['TS', 'success'], sql: ['SQ', 'accent'],
  html: ['HT', 'error'], css: ['CS', 'accent'], scss: ['SC', 'accent'], svg: ['SV', 'warn'],
  png: ['IM', 'warn'], jpg: ['IM', 'warn'], jpeg: ['IM', 'warn'], gif: ['IM', 'warn'], webp: ['IM', 'warn'], avif: ['IM', 'warn'],
  mp4: ['VD', 'error'], webm: ['VD', 'error'], mov: ['VD', 'error'], pdf: ['PD', 'error'], c4: ['C4', 'accent'],
}

/** A two-character badge for a file name, like the type chips in an editor's file list. */
export function badgeOf(name: string): { text: string; tone: Tone } {
  if (name.startsWith('.git')) return { text: 'GT', tone: 'faint' }
  if (name === 'Dockerfile' || name.startsWith('Dockerfile.')) return { text: 'DK', tone: 'accent' }
  if (name === 'Makefile' || name === 'justfile') return { text: 'MK', tone: 'success' }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  const hit = BADGES[ext]
  if (hit) return { text: hit[0], tone: hit[1] }
  return { text: ext ? ext.slice(0, 2).toUpperCase() : '  ', tone: 'faint' }
}

export type StatusKind = 'editing' | 'new' | 'edited' | 'read' | 'committed' | 'modified' | 'untracked'

/**
 * The one label a file row shows. What the agent is doing now beats what it did in this session, which beats what git
 * says; a commit made in this session beats the edits it contains.
 */
export function statusOf(touched: FileEntry | undefined, git: GitMark | undefined, editing: boolean): { kind: StatusKind; tone: Tone } | undefined {
  if (editing) return { kind: 'editing', tone: 'accent' }
  if (git === 'C') return { kind: 'committed', tone: 'success' }
  if (touched) {
    if (touched.op === 'A') return { kind: 'new', tone: 'success' }
    if (touched.op === 'M') return { kind: 'edited', tone: 'warn' }
    if (git === 'M') return { kind: 'modified', tone: 'warn' }
    return { kind: 'read', tone: 'faint' }
  }
  if (git === 'M') return { kind: 'modified', tone: 'warn' }
  if (git === '?') return { kind: 'untracked', tone: 'muted' }
  return undefined
}

/** A file counts as "hot" (worth showing) when the agent changed it or git sees it as changed; reading alone does not. */
export const isHot = (touched: FileEntry | undefined, git: GitMark | undefined, editing: boolean) =>
  editing || git !== undefined || (touched !== undefined && touched.op !== 'R')

/** Every folder that holds a hot file, with how many: the tree opens these and shows the count. */
export function hotDirs(hotFiles: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>()
  for (const path of hotFiles) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      out.set(dir, (out.get(dir) ?? 0) + 1)
    }
  }
  return out
}

/** The project's files (root-relative) that are hot: touched by the agent in a way that changes something, changed in git, or being edited right now. */
export function hotFilesOf(paths: readonly string[], root: string, files: Map<string, FileEntry>, git: GitState, livePath: string | undefined): string[] {
  return paths.filter(rel => {
    const abs = `${root}/${rel}`
    return isHot(files.get(abs), git.get(rel), livePath === abs)
  })
}

/** The three questions put to git for the tree's labels, as argument lists (run in the project root): changed, untracked, committed since `since`. */
export const gitQueries = (since: number): { diff: string[]; untracked: string[]; committed: string[] } => ({
  diff: ['diff', '--name-only', 'HEAD'],
  untracked: ['ls-files', '-o', '--exclude-standard'],
  committed: ['log', '--name-only', '--pretty=format:', `--since=${new Date(since).toISOString()}`],
})

/** Most files the tree lists; a bigger project is cut here and says so. */
export const TREE_MAX = 4000

/** The command that lists a project's files: from git when it is a repository, otherwise the first four levels without hidden folders. */
export const listArgv = (root: string, isRepo: boolean): string[] =>
  isRepo
    ? ['git', '-C', root, 'ls-files', '-co', '--exclude-standard']
    : ['find', root, '-maxdepth', '4', '(', '-name', '.*', '-o', '-name', 'node_modules', ')', '-prune', '-o', '-type', 'f', '-print']

/** The listing's output as the tree's project: paths relative to the root, cut at TREE_MAX. */
export function parseListing(stdout: string, root: string): { root: string; paths: string[]; truncated: boolean } {
  const all = stdout.split('\n').filter(Boolean).map(x => (x.startsWith(`${root}/`) ? x.slice(root.length + 1) : x))
  return { root, paths: all.slice(0, TREE_MAX), truncated: all.length > TREE_MAX }
}
