// A plain-language line for a tool call: "Reading register.tsx" instead of "Read /home/me/Projects/asint/hooks/register.tsx".
// The LOG keeps the exact call; the ORCH cards and the agents' "doing" use this. Pure; never touches $.

import { t } from './i18n'

const base = (p: unknown) => String(p ?? '').split('/').filter(Boolean).at(-1) ?? ''
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const host = (u: unknown) => {
  try { return new URL(String(u)).host } catch { return String(u ?? '') }
}

/** What a tool call is doing, in a few words. Unknown tools fall back to their name. */
export function briefTool(tool: string, input: Record<string, unknown>): string {
  const file = base(input.file_path ?? input.path ?? input.notebook_path)
  switch (tool) {
    case 'Read': return t(`讀 ${file}`, `Reading ${file}`)
    case 'Edit': case 'MultiEdit': return t(`改 ${file}`, `Editing ${file}`)
    case 'Write': return t(`寫 ${file}`, `Writing ${file}`)
    case 'NotebookEdit': return t(`改 ${file}`, `Editing ${file}`)
    case 'Grep': return t(`搜尋「${clip(String(input.pattern ?? ''), 24)}」`, `Searching "${clip(String(input.pattern ?? ''), 24)}"`)
    case 'Glob': return t(`找檔案 ${clip(String(input.pattern ?? ''), 24)}`, `Finding ${clip(String(input.pattern ?? ''), 24)}`)
    case 'WebFetch': return t(`讀網頁 ${host(input.url)}`, `Reading ${host(input.url)}`)
    case 'WebSearch': return t(`查資料「${clip(String(input.query ?? ''), 24)}」`, `Searching the web "${clip(String(input.query ?? ''), 24)}"`)
    case 'Agent': case 'Task': return t(`派出 ${String(input.subagent_type ?? 'subagent')}`, `Starting ${String(input.subagent_type ?? 'a subagent')}`)
    case 'Bash': {
      // Claude writes a short description for every command; that is the summary. Without one, name the program.
      const d = String(input.description ?? '').trim()
      if (d) return clip(d, 60)
      const prog = String(input.command ?? '').trim().split(/\s+/).find(w => !w.includes('=') && w !== 'cd' && w !== '&&' && !w.startsWith('~') && !w.startsWith('/')) ?? 'shell'
      return t(`跑指令 ${prog}`, `Running ${prog}`)
    }
    default: return tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' · ') : tool
  }
}
