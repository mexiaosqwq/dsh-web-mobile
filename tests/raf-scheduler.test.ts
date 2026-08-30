import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRafScheduler } from '../src/client/core/raf-scheduler.ts'

test('coalesces same-frame schedules into one callback', () => {
  const cbs: FrameRequestCallback[] = []
  const raf = (cb: FrameRequestCallback): number => (cbs.push(cb), cbs.length)
  const caf = (): void => {}
  const s = createRafScheduler(raf, caf)
  let runs = 0
  s.schedule(() => { runs += 1 })
  s.schedule(() => { runs += 1 })
  assert.equal(cbs.length, 1)
  cbs[0](0)
  assert.equal(runs, 1)
  s.schedule(() => { runs += 1 })
  assert.equal(cbs.length, 2)
  cbs[1](0)
  assert.equal(runs, 2)
})

test('cancel drops the pending callback', () => {
  const cbs: FrameRequestCallback[] = []
  const raf = (cb: FrameRequestCallback): number => (cbs.push(cb), cbs.length)
  const caf = (id: number): void => { cbs.splice(id - 1, 1) }
  const s = createRafScheduler(raf, caf)
  let runs = 0
  s.schedule(() => { runs += 1 })
  s.cancel()
  for (const cb of [...cbs]) cb(0)
  assert.equal(runs, 0)
})
