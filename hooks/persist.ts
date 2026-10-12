// Where a session is saved and what of the view goes with it. Pure; the reading and writing stay in register.tsx.

import { saveSession, type Session } from './model'
import type { UiState } from './views'

export const SESSIONS_DIR = '.cache/asint/sessions'
export const SAVE_DAYS = 14

/** The parts of the view worth coming back to. Anything not listed (open message boxes, the ARCH trail) starts fresh. */
export const SAVED_UI = ['tab', 'mapView', 'comboSlot', 'fullFile', 'showReads', 'mediaFilter', 'selFile', 'selExec', 'selMedia', 'selTodo', 'selStep', 'selAgent', 'filesBy', 'treeSel', 'treeRoot', 'treeSearch', 'treeCur', 'treeFocus', 'filesFocus', 'treeOpen', 'treeShut', 'treeChanged', 'follow', 'scroll', 'hx'] as const

export const sessionPath = (home: string, sid: string) => `${home}/${SESSIONS_DIR}/${sid}.json`

/** The text written for a session: its data and the view it was left in. */
export function serializeSession(s: Session, ui: UiState): string {
  const view: Record<string, unknown> = {}
  for (const k of SAVED_UI) view[k] = ui[k]
  return JSON.stringify({ ...saveSession(s), view })
}

/** Copies the saved view onto the live one. A value of another type than the field holds now (an old file, a hand edit) is left out. */
export function applySavedView(ui: UiState, text: string): void {
  try {
    const view = (JSON.parse(text) as { view?: Record<string, unknown> }).view ?? {}
    const target = ui as Record<string, unknown>
    for (const k of SAVED_UI) {
      if (view[k] !== undefined && (target[k] === undefined || typeof target[k] === typeof view[k])) target[k] = view[k]
    }
  } catch {
    // A damaged view part leaves the defaults.
  }
}

/** The command that deletes saved sessions nobody has touched for SAVE_DAYS days. */
export const cleanArgv = (home: string) => ['find', `${home}/${SESSIONS_DIR}`, '-name', '*.json', '-mtime', `+${SAVE_DAYS}`, '-delete']
