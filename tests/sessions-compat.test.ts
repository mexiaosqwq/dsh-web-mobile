// Sessions shape on supported hosts (>=0.2.2-rc.1): no SessionListState.current,
// no open/clear; selection lives in per-session retainedBy counters. The rc.2
// `current` read and the open/clear feature probes were removed with the host
// floor; the helper stays structural because the repo type-checks against the
// pinned 0.1.0-rc.6 typings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DELETE_VERIFY_ATTEMPTS,
  DELETE_VERIFY_INTERVAL_MS,
  currentSessionIdOf,
  verifySessionDeleted,
} from '../src/client/core/sessions-compat.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// The footer pill moved into the drawer brand-row task (issue #225).
const LOG = readFileSync(join(ROOT, 'src/client/effects/drawer-session-log.ts'), 'utf8')
const MENU = readFileSync(join(ROOT, 'src/client/effects/session-menu.ts'), 'utf8')
// P1 拆分（2026-10-12）：installOverlayInteractions 搬到 drawer-close.ts；仍读两半，
// 负向断言保持原有覆盖面积。
const CHROME = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')
  + readFileSync(join(ROOT, 'src/client/effects/drawer-close.ts'), 'utf8')

test('currentSessionIdOf ignores the removed rc.2 current field', () => {
  assert.equal(currentSessionIdOf({ current: 's1', byId: {} }), undefined)
})

test('currentSessionIdOf derives from retainedBy.mainView', () => {
  const a2 = {
    byId: {
      a: { id: 'a', retainedBy: { mainView: 0 } },
      b: { id: 'b', retainedBy: { mainView: 2 } },
    },
  }
  assert.equal(currentSessionIdOf(a2), 'b')
})

test('currentSessionIdOf returns undefined on empty, foreign and null shapes', () => {
  assert.equal(currentSessionIdOf({}), undefined)
  assert.equal(currentSessionIdOf({ byId: { a: { id: 'a', retainedBy: { mainView: 0 } } } }), undefined)
  assert.equal(currentSessionIdOf(null), undefined)
  assert.equal(currentSessionIdOf('nope'), undefined)
})

test('every current-session read goes through currentSessionIdOf', () => {
  assert.match(LOG, /currentSessionIdOf\(ctx\.sessions\.list\.getSnapshot\(\)\)/)
  assert.doesNotMatch(LOG, /getSnapshot\(\)\.current/)
  const logReads = LOG.match(/currentSessionIdOf\(ctx\.sessions\.list\.getSnapshot\(\)\)/g) ?? []
  const snapshotReads = MENU.match(/currentSessionIdOf\(ctx\.sessions\.list\.getSnapshot\(\)\)/g) ?? []
  const chromeReads = CHROME.match(/currentSessionIdOf\(ctx\.sessions\.list\.getSnapshot\(\)\)/g) ?? []
  assert.ok(logReads.length >= 1, 'drawer-session-log reads via helper')
  assert.ok(snapshotReads.length >= 1, 'session-menu reads via helper')
  assert.equal(chromeReads.length, 0, 'drawer-close no longer reads the current session (sessions.open path removed)')
  assert.doesNotMatch(CHROME, /getSnapshot\(\)\.current/)
  assert.doesNotMatch(MENU, /getSnapshot\(\)\.current/)
})

test('the removed sessions.open / clear calls stay gone', () => {
  // Hosts >=0.2.2 expose neither; the unselected-row tap closes through the
  // DOM observer only.
  assert.doesNotMatch(MENU, /ctx\.sessions\.clear\(/)
  assert.doesNotMatch(CHROME, /ctx\.sessions\.open\(/)
  assert.doesNotMatch(CHROME, /closeOnNavigation|disarmCloseOnNav/)
  assert.match(CHROME, /\} else \{\n(?:\s*\/\/.*\n)*\s*armNav\(\)\n\s*\}/)
})

// --- Aborted delete request: the list, not the fetch promise, is the judge ----
// The host half deployed on DSHA aborts the reply AFTER the session was moved
// to the trash, so the browser rejects the fetch for a delete that DID land
// (2026-10-07). These cases pin the bounded re-read that decides.

test('verifySessionDeleted accepts a delete that already landed', async () => {
  let listed = true
  const sleeps: number[] = []
  const landed = await verifySessionDeleted({
    listed: () => listed,
    refresh: async () => { listed = false },
    sleep: async (ms) => { sleeps.push(ms) },
  })
  assert.equal(landed, true)
  assert.deepEqual(sleeps, [], 'the first re-read already answered')
})

test('verifySessionDeleted finds a row that disappears after a slow move', async () => {
  let looks = 0
  const sleeps: number[] = []
  const landed = await verifySessionDeleted({
    listed: () => { looks += 1; return looks < 3 },
    sleep: async (ms) => { sleeps.push(ms) },
  })
  assert.equal(landed, true)
  assert.equal(looks, 3)
  assert.equal(sleeps.length, 2)
})

test('verifySessionDeleted only reports failure when the row survives the budget', async () => {
  let reads = 0
  const sleeps: number[] = []
  const landed = await verifySessionDeleted({
    listed: () => true,
    refresh: async () => { reads += 1 },
    sleep: async (ms) => { sleeps.push(ms) },
  })
  assert.equal(landed, false)
  assert.equal(reads, DELETE_VERIFY_ATTEMPTS)
  assert.equal(sleeps.length, DELETE_VERIFY_ATTEMPTS - 1)
  assert.deepEqual([...new Set(sleeps)], [DELETE_VERIFY_INTERVAL_MS])
})

test('verifySessionDeleted judges from the snapshot when the refresh itself throws', async () => {
  let listed = true
  const landed = await verifySessionDeleted({
    listed: () => listed,
    refresh: async () => { throw new Error('refresh offline') },
    sleep: async () => { listed = false },
  })
  assert.equal(landed, true)
})

test('the verification budget is the documented default', () => {
  assert.equal(DELETE_VERIFY_ATTEMPTS, 4)
  assert.equal(DELETE_VERIFY_INTERVAL_MS, 350)
})
