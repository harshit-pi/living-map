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

import { lookup, sourceOf, summaryText } from './ledger'

const sample = () => applyOps({}, [
  { op: 'add', id: 'merge-rule', thread: 'Working rules', title: 'PR merges', value: 'Never wait for a merge; branch from the last PR', status: 'decided', turn: 4, kind: 'rule' },
  { op: 'add', id: 'datastore', thread: 'Infra', title: 'Datastore', value: 'DynamoDB plus S3 vectors', status: 'decided', turn: 9, kind: 'decision' },
  { op: 'add', id: 'app-store', thread: 'Release', title: 'App Store setup', value: 'Register bundle id and API key', status: 'waiting', turn: 11, kind: 'task' },
], { 9: sourceOf({ idx: 9, human: 'Go with Dynamo, not Aurora', ai: 'Switching to DynamoDB.' }) }).items

test('the summary Claude gets leads with what waits on the user and names the lookup tool', () => {
  const s = summaryText(sample(), 'mcp__living-map__map_lookup')
  expect(s).toContain('Waiting on the user')
  expect(s).toContain('Standing rules')
  expect(s).toContain('mcp__living-map__map_lookup')
})

test('a pinned item is always in the summary; a dropped one never is', () => {
  const items = sample()
  items['datastore']!.pinned = true
  items['app-store']!.userDropped = true
  const s = summaryText(items, 't')
  expect(s).toContain('[pinned]')
  expect(s).not.toContain('App Store setup')
})

test('lookup finds by topic words and shows where it came from', () => {
  const r = lookup(sample(), 'which datastore')
  expect(r).toContain('DynamoDB')
  expect(r).toContain('Go with Dynamo')
  expect(lookup(sample(), 'kubernetes cluster')).toContain('Nothing in the ledger matches')
})
