// What the engine's events mean for the session data: a finished tool call, a background task's notification, the usage
// figures, the session title, a message sent from the MAP. Pure; register.tsx gets the events and does the rest.

import type { EngineInterface } from 'claude-code'

import type { Panel } from './layout'
import {
  applyTaskCreate, applyTaskUpdate, applyTodoWrite, endAgentFromNotification, type Exec, exitCodeOf, isMedia, log, patchLines, type Session, type TodoStatus,
  touchFile, type Vitals,
} from './model'
import { isOwnScratch } from './media'
import { t } from './i18n'

/** One-line summary of a tool call, for the Log tab and an agent's "doing" field. */
export const summary = (tool: string, input: Record<string, unknown>) => {
  const arg = input.file_path ?? input.path ?? input.pattern ?? input.command ?? input.url ?? input.query ?? input.description ?? ''
  return `${tool} ${String(arg).split('\n')[0]}`.slice(0, 160)
}

/** A call that would create a Claude Docs document; deliverables go in the reply instead. */
export const isDocsCreate = (e: { tool: string }) =>
  e.tool.startsWith('mcp__claude_ai_Claude_Docs__') && (e.tool.endsWith('__create') || JSON.stringify(e).includes('"create"'))

/** asint's own checklist tool: replace the TODO list with the one sent; the reply is the tool's result text, or an error. */
export function applyChecklist(s: Session, todos: unknown, who: string, at: number): { error: string } | { text: string } {
  if (!Array.isArray(todos)) return { error: 'todos must be an array' }
  applyTodoWrite(s, todos as { content: string; status: TodoStatus; activeForm?: string }[], who, at)
  return { text: `checklist ${s.todos.filter(x => x.status === 'completed').length}/${s.todos.length}` }
}

/** A Bash call returned: keep the tail of its output and its exit. A command sent to the background returns its task id, still running. */
export function endExec(x: Exec, result: Record<string, unknown>, text: string | undefined, failed: boolean, end: number): string | undefined {
  x.endedAt = end
  x.stdout = String(result.stdout ?? '').slice(-50_000)
  x.stderr = String(result.stderr ?? text ?? '').slice(-20_000)
  if (typeof result.backgroundTaskId === 'string') {
    x.status = 'background'
    return result.backgroundTaskId
  }
  x.status = failed ? 'error' : 'ok'
  x.exit = failed ? (exitCodeOf(text) ?? 1) : 0
  return undefined
}

/** Where a background command's output goes: <session temp dir>/tasks/<task id>.output. */
export const taskOutput = (dir: string, taskId: string) => `${dir}/tasks/${taskId}.output`

/** What a finished non-Bash tool call asks of the caller: a panel to mark fresh, and a file to list under WEB or convert for MEDIA. */
export type ToolEffect = { fresh?: Panel; web?: string; media?: string }

/**
 * Record a finished tool call: file tools go to Files, checklist tools to Todo, the rest to Log. Bash is handled by the caller
 * (it starts commands and looks for new media), and so is the end of a streaming edit.
 */
export function recordTool(
  s: Session, tool: string, input: Record<string, unknown>, result: Record<string, unknown>,
  r: { failed: boolean; path: string | undefined; who: string; at: number; line: string; brief: string },
): ToolEffect {
  const { failed, path, who, at, line, brief } = r
  switch (tool) {
    case 'Read':
      // Claude's own screenshots (hidden dirs in the scratchpad, e.g. .shots/) stay out of FILES.
      if (path && !failed && !isOwnScratch(path)) {
        touchFile(s, path, 'R', who, at)
        log(s, { at, who, kind: 'tool', text: line, brief, op: 'R', file: path })
        return { fresh: 'files' }
      }
      return {}
    case 'Edit':
    case 'NotebookEdit':
    case 'Write': {
      if (!path || failed) return {}
      const created = tool === 'Write' && result.type === 'create'
      touchFile(s, path, created ? 'A' : 'M', who, at, patchLines(result.structuredPatch as never))
      log(s, { at, who, kind: 'tool', text: line, brief, op: created ? 'W' : 'E', file: path })
      return { fresh: 'files', web: /\.html?$/i.test(path) && !isOwnScratch(path) ? path : undefined, media: isMedia(path) ? path : undefined }
    }
    case 'TodoWrite':
      if (Array.isArray(input.todos)) applyTodoWrite(s, input.todos as { content: string; status: TodoStatus; activeForm?: string }[], who, at)
      return { fresh: 'todo' }
    case 'TaskCreate': {
      const task = (result.task ?? {}) as { id?: string }
      if (task.id) applyTaskCreate(s, task.id, String(input.subject ?? ''), input.activeForm as string | undefined, at)
      return {}
    }
    case 'TaskUpdate':
      if (typeof input.taskId === 'string') applyTaskUpdate(s, input.taskId, input as never, who, at)
      return {}
    default:
      log(s, { at, who, kind: failed ? 'error' : 'tool', text: line, brief })
      return {}
  }
}

/**
 * A <task-notification> message Claude Code appends when a background command or agent ends: end that agent, or mark the
 * command done with its exit code and the output read so far. True when anything changed.
 */
export function endTask(s: Session, text: string, bgOutput: ReadonlyMap<string, string>, now: number): boolean {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]
  let changed = endAgentFromNotification(s, text, now)
  const x = id ? s.execs.find(y => y.outputPath?.endsWith(`/${id}.output`)) : undefined
  if (x && x.status === 'background') {
    x.status = status === 'completed' ? 'ok' : 'error'
    x.exit = Number(/exit code (\d+)/.exec(text)?.[1] ?? (status === 'completed' ? 0 : 1))
    x.endedAt = now
    x.stdout = bgOutput.get(x.id) ?? x.stdout
    changed = true
  }
  return changed
}

/** Copy the engine's usage figures (context, the 5-hour and weekly limits, cost) into the vitals. */
export function applyUsage(v: Vitals, u: Awaited<ReturnType<EngineInterface['session']['usage']>>) {
  v.ctxPercent = u.context.percent ?? (u.context.tokens !== undefined ? (u.context.tokens / u.context.window) * 100 : undefined)
  v.ctxTokens = u.context.tokens
  v.ctxWindow = u.context.window
  for (const r of u.rateLimits) {
    if (/5|five|hour/i.test(r.kind) && !/week|7|seven/i.test(r.kind)) v.rate5h = r.percentUsed
    else if (/week|7|seven/i.test(r.kind)) v.rate7d = r.percentUsed
  }
  if (u.cost) v.costUsd = u.cost.usd
}

/** The model id as the vitals show it: claude-opus-4-5 → opus-4.5. */
export const prettyModel = (m: string) => m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, '-$1.$2').replace(/\[.*\]$/, '')

// Session name: Claude Code titles sessions with an LLM and writes it to the transcript (`ai-title`); /rename writes `custom-title`, which wins.
/** The grep that picks the title entries out of a transcript, which can be several MB. */
export const titleArgv = (path: string) => ['grep', '-o', '-E', '"(customTitle|aiTitle)":"[^"]*"', path]

/** The grep output as the session name: the last custom title wins over the last generated one. */
export function parseTitle(stdout: string | undefined): string | undefined {
  const lines = stdout?.split('\n').filter(Boolean) ?? []
  const line = lines.findLast(l => l.startsWith('"customTitle"')) ?? lines.findLast(l => l.startsWith('"aiTitle"'))
  try {
    return line ? Object.values(JSON.parse(`{${line}}`) as Record<string, string>)[0] : undefined
  } catch {
    return undefined
  }
}

/** How the MAP names an agent in messages: [M] for main, [n] by start order for subagents. */
export const agentTag = (s: Session, id: string) =>
  id === 'main' ? '[M]' : `[${[...s.agents.values()].sort((a, b) => a.startedAt - b.startedAt).findIndex(a => a.id === id) + 1}]`

/** Who a MAP message goes to: one agent, or every running subagent for "all". */
export const sendTargets = (s: Session, to: string) => (to === 'all' ? [...s.agents.values()].filter(a => a.status === 'running').map(a => a.id) : [to])

/** The Log line and the toast after sending a MAP message; `failed` lists the agents it did not reach, with why. */
export function sendReport(s: Session, to: string, body: string, ids: readonly string[], failed: readonly string[]) {
  const who = to === 'all' ? null : agentTag(s, to)
  return {
    log: t(`你 → ${who ?? '全部'}：${body}`, `You → ${who ?? 'all'}: ${body}`).slice(0, 160),
    toast: failed.length
      ? t(`沒送到：${failed.join('；')}`, `Not delivered: ${failed.join('; ')}`)
      : t(`已送給 ${who ?? `${ids.length} 個 subagent`}`, `Sent to ${who ?? `${ids.length} subagent${ids.length === 1 ? '' : 's'}`}`),
  }
}
