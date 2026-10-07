// FILES follow mode: reads the file being edited and its content from tool arguments still streaming from the model (incomplete JSON). Pure functions.

/** Tools that change files and are worth following; FILES jumps to the file as soon as one of these names its path. */
export const LIVE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/** A file-changing call that is still streaming. new is the new content received so far (for Write, the whole content). */
export type LiveEdit = {
  id: string
  tool: string
  who: string
  path?: string
  old?: string
  new: string
  /** Whether new has been fully received (its closing quote arrived). */
  done: boolean
}

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }

/**
 * Reads the value of string field key from incomplete JSON text: up to the closing quote, or whatever has arrived so far.
 * Returns undefined if the field has not appeared yet. Handles only top-level `"key": "..."`, which is the shape of all tool arguments.
 */
export function partialField(json: string, key: string): { value: string; done: boolean } | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(json)
  if (!m) return undefined
  let i = m.index + m[0].length
  let out = ''
  while (i < json.length) {
    const ch = json[i]!
    if (ch === '"') return { value: out, done: true }
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
    // An escape sequence split across two chunks: stop here and wait for the next one.
    if (i + 1 >= json.length) break
    const e = json[i + 1]!
    if (e === 'u') {
      if (i + 6 > json.length) break
      out += String.fromCharCode(parseInt(json.slice(i + 2, i + 6), 16))
      i += 6
    } else {
      out += ESC[e] ?? e
      i += 2
    }
  }
  return { value: out, done: false }
}

/** Update a LiveEdit from the JSON received so far. */
export function readLive(tool: string, id: string, who: string, json: string): LiveEdit {
  const path = partialField(json, tool === 'NotebookEdit' ? 'notebook_path' : 'file_path')
  const body = partialField(json, tool === 'Write' ? 'content' : tool === 'NotebookEdit' ? 'new_source' : 'new_string')
  const old = tool === 'Edit' ? partialField(json, 'old_string') : undefined
  return {
    id, tool, who,
    path: path?.done ? path.value : undefined,
    old: old?.done ? old.value : undefined,
    new: body?.value ?? '',
    done: !!body?.done,
  }
}

/**
 * The line (0-based) where a piece of text starts in a file; -1 if not found.
 * While Edit streams, old_string locates the section being replaced; after the tool finishes, new_string locates the lines to highlight.
 * When the text occurs several times the first wins, matching the Edit tool's requirement that old_string be unique.
 */
export function lineOf(text: string, needle: string) {
  if (!needle) return -1
  const at = text.indexOf(needle)
  return at < 0 ? -1 : text.slice(0, at).split('\n').length - 1
}
