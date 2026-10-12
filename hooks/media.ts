// MEDIA bookkeeping: which files count, the commands that convert or open them, and how a converted file or a web page is recorded.
// Pure; register.tsx runs the commands and redraws.

import { isMedia, log, type Media, mediaKind, registerMedia, type Session } from './model'

export const MEDIA_CACHE = '/tmp/asint-media'

/** A path as a flat file name for the caches (last 80 characters). */
export const slug = (path: string) => path.replace(/[^A-Za-z0-9]+/g, '_').slice(-80)

// Claude's own screenshots and asint's scratch files (hidden dirs in the scratchpad, ~/.cache/asint) stay out of CHANGES and MEDIA.
export const isOwnScratch = (path: string) => /\/scratchpad\/\./.test(path) || path.includes('/.cache/asint/')

// Images, video and documents go to the system default app (imv for images, evince for PDF, Brave for web pages, Markdown per xdg-mime); code and config open in nvim in a new terminal.
const RENDERED = /\.(png|jpe?g|gif|webp|bmp|avif|svg|mp4|webm|mkv|mov|mp3|wav|ogg|flac|pdf|html?|md|markdown|txt|csv|docx?|xlsx?|pptx?|odt|ods|odp)$/i

/** The detached command that opens a file that is not a web page. */
export const openArgv = (bin: string, path: string) =>
  ['setsid', '-f', ...(RENDERED.test(path) ? [`${bin}/asint-open`, path] : ['xdg-terminal-exec', 'nvim', path])]

/** /html's arguments: -b opens in the system browser (Brave), -t (or nothing) beside the terminal; the rest is the path or URL. */
export function htmlArgs(args: string): { brave: boolean; raw: string } {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const brave = words[0] === '-b'
  return { brave, raw: (brave || words[0] === '-t' ? words.slice(1) : words).join(' ') }
}

/** What bin/media-prep prints: the PNG frames it made, and for a 3D model the page that views it. */
export type Prepped = { kind: string; width: number; height: number; fps: number; frames: string[]; viewer?: string }

/** The media-prep command for a file; previews (CHANGES and FILES) get their own cache so they never show up in MEDIA. */
export const prepArgv = (bin: string, path: string, preview = false) => [`${bin}/media-prep`, path, `${MEDIA_CACHE}/${preview ? 'preview-' : ''}${slug(path)}`]

/** The first frame of a preview's media-prep output; undefined when there is none or the output is not JSON. */
export function previewOf(stdout: string): { frame: string; width: number; height: number } | undefined {
  try {
    const prepped = JSON.parse(stdout) as Prepped
    return prepped.frames[0] ? { frame: prepped.frames[0], width: prepped.width, height: prepped.height } : undefined
  } catch {
    return undefined
  }
}

/** Media files written after `since` (epoch seconds) in the given folders, 3 levels deep, skipping hidden dirs, node_modules and the cache. */
export const newMediaArgv = (dirs: readonly string[], since: number) =>
  ['find', ...new Set(dirs), '-maxdepth', '3', '(', '-name', '.*', '-o', '-name', 'node_modules', '-o', '-path', `${MEDIA_CACHE}*`, ')', '-prune', '-o',
    '-type', 'f', '-newermt', `@${since}`, '-print']

/** The find output as the media worth adding: at most three, and none of asint's or Claude's own scratch files. */
export const newMediaOf = (stdout: string) => stdout.split('\n').filter(isMedia).slice(0, 3).filter(x => !isOwnScratch(x))

/** Register a converted file in MEDIA and log it. */
export function addPrepped(s: Session, path: string, prepped: Prepped, at: number): Media {
  const m = registerMedia(s, {
    kind: mediaKind(path, prepped.frames.length, prepped.kind === 'model'), path, at,
    width: prepped.width, height: prepped.height, fps: prepped.fps, frames: prepped.frames, viewer: prepped.viewer,
  })
  log(s, { at: m.at, who: 'main', kind: 'media', text: `${m.id} ${path}` })
  return m
}

/** List an .html file under WEB in MEDIA (no frames; clicking opens it in a browser) and log it. */
export function addWebPage(s: Session, path: string, at: number, url?: string): Media {
  const m = registerMedia(s, { kind: 'WEB', path, at, width: 0, height: 0, fps: 0, frames: [], ...(url ? { url } : {}) })
  log(s, { at, who: 'main', kind: 'media', text: `${m.id} ${path}${url ? ` → ${url}` : ''}` })
  return m
}

/** The claude.ai link in an Artifact publish result, wherever the tool put it. */
export const artifactUrl = (text: string | undefined, result: unknown) =>
  /https:\/\/claude\.ai\/[^\s"'<>)]+/.exec(`${text ?? ''} ${JSON.stringify(result ?? '')}`)?.[0]
