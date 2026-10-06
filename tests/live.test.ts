import { test, expect } from 'claude-code/testing'

import { lineOf, partialField, readLive } from '../hooks/live'

test('partialField: reads a string that has not finished streaming, and stops early when an escape sequence is cut in half', () => {
  expect(partialField('{"file_path":"/a/b.ts","new_string":"x\\ny', 'new_string')).toEqual({ value: 'x\ny', done: false })
  expect(partialField('{"file_path":"/a/b.ts"', 'file_path')).toEqual({ value: '/a/b.ts', done: true })
  expect(partialField('{"new_string":"a\\', 'new_string')).toEqual({ value: 'a', done: false })
  expect(partialField('{"new_string":"\\u00e9\\"q\\"', 'new_string')).toEqual({ value: 'é"q"', done: false })
  expect(partialField('{"old_string":"', 'new_string')).toBeUndefined()
})

test('readLive: Edit waits for old_string to finish before locating; Write reads content', () => {
  const e = readLive('Edit', 't1', 'main', '{"file_path":"/p/x.ts","old_string":"foo","new_string":"bar\\nba')
  expect(e).toMatchObject({ path: '/p/x.ts', old: 'foo', new: 'bar\nba', done: false })
  const w = readLive('Write', 't2', 'main', '{"file_path":"/p/y.ts","content":"line1\\nline2"}')
  expect(w).toMatchObject({ path: '/p/y.ts', new: 'line1\nline2', done: true })
  expect(readLive('Edit', 't3', 'main', '{"file_path":"/p/x').path).toBeUndefined()
})

test('lineOf: finds the line a snippet starts on', () => {
  expect(lineOf('a\nb\nfoo\nc', 'foo\nc')).toBe(2)
  expect(lineOf('abc', 'zzz')).toBe(-1)
})
