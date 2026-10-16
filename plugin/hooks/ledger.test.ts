import { test, expect } from 'claude-code/testing'
import { applyOps, parseOps, priorValues, toText, threads } from './ledger'

test('a change of mind keeps the old value in history', () => {
  let { items } = applyOps({}, [
    { op: 'add', id: 'extraction-model', thread: 'Pipeline', title: 'Extraction model', value: 'Claude', status: 'decided', turn: 3, kind: 'decision' },
  ])
  ;({ items } = applyOps(items, [{ op: 'update', id: 'extraction-model', value: 'Qwen3 locally', status: 'decided', turn: 9 }]))
  expect(items['extraction-model'].value).toBe('Qwen3 locally')
  expect(priorValues(items['extraction-model'])).toEqual(['Claude'])
  expect(toText(items)).toContain('(was: Claude)')
})

test('ops without a valid status or turn are ignored', () => {
  const { items, changed } = applyOps({}, [{ op: 'add', id: 'x', title: 'X', value: 'y', status: 'maybe', turn: 1 }])
  expect(changed).toBe(0)
  expect(Object.keys(items)).toEqual([])
})

test('the model reply is parsed even with prose or fences around it', () => {
  const ops = parseOps('Here you go:\n```json\n{"ops":[{"op":"add","id":"a","title":"A","value":"b","status":"open","turn":0}]}\n```')
  expect(ops.length).toBe(1)
  expect(parseOps('no json here')).toBeNull()
  expect(parseOps('{"ops":[]}')).toEqual([])
})

test('threads are ordered by most recent activity', () => {
  const { items } = applyOps({}, [
    { op: 'add', id: 'a', thread: 'Old', title: 'A', value: 'v', status: 'done', turn: 1 },
    { op: 'add', id: 'b', thread: 'New', title: 'B', value: 'v', status: 'open', turn: 7 },
  ])
  expect(threads(items)).toEqual(['New', 'Old'])
})
