import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReconcilerCore } from '../src/client/core/reconciler-core.ts'
import type { FrameRequest, ReconcilerCore, ReconcilerTask } from '../src/client/core/reconciler-core.ts'
import { createPreviewCloseTask } from '../src/client/effects/aionui-compat.ts'

interface Harness {
  core: ReconcilerCore
  readonly frame: (() => void) | null
  flushFrame(): void
}

function makeHarness(): Harness {
  let frame: (() => void) | null = null
  const requestFrame: FrameRequest = (flush) => {
    frame = flush
    return () => {
      if (frame === flush) frame = null
    }
  }
  return {
    core: createReconcilerCore({ requestFrame }),
    get frame() {
      return frame
    },
    flushFrame: () => {
      const next = frame
      frame = null
      next?.()
    },
  }
}

interface CountingTask extends ReconcilerTask {
  ensures: number
  disposes: number
}

function makeTask(name: string, scopes?: readonly string[]): CountingTask {
  const task: CountingTask = {
    name,
    ensures: 0,
    disposes: 0,
    ensure: () => {
      task.ensures += 1
    },
    dispose: () => {
      task.disposes += 1
    },
  }
  if (scopes !== undefined) task.scopes = scopes
  return task
}

test('lifecycle: register / activate / unregister / deactivate / reactivate', () => {
  const { core } = makeHarness()
  const a = makeTask('a')
  const b = makeTask('b')
  const removeA = core.register(a)
  const removeB = core.register(b)
  assert.equal(core.size, 2)
  assert.equal(a.ensures, 0, 'inactive tasks must not run')

  core.activate()
  assert.equal(a.ensures, 1)
  assert.equal(b.ensures, 1)
  core.activate()
  assert.equal(a.ensures, 1, 'double activate is a no-op')

  const c = makeTask('c')
  const removeC = core.register(c)
  assert.equal(c.ensures, 1, 'register while active ensures immediately')
  assert.equal(core.size, 3)

  removeA()
  assert.equal(a.disposes, 1)
  assert.equal(core.size, 2)

  core.deactivate()
  assert.equal(b.disposes, 1)
  assert.equal(c.disposes, 1)
  assert.equal(b.disposes, 1, 'deactivate must not dispose twice')

  core.activate()
  assert.equal(b.ensures, 2)
  assert.equal(a.ensures, 1, 'unregistered task must not run again')

  removeB()
  removeC()
})

test('dirty routing: only tasks whose scopes intersect the dirty keys run', () => {
  const { core, flushFrame } = makeHarness()
  const x = makeTask('x', ['x-key'])
  const y = makeTask('y', ['y-key'])
  const any = makeTask('any')
  core.register(x)
  core.register(y)
  core.register(any)
  core.activate()
  assert.deepEqual([x.ensures, y.ensures, any.ensures], [1, 1, 1])

  core.note(['x-key'])
  flushFrame()
  assert.deepEqual([x.ensures, y.ensures, any.ensures], [2, 1, 2], 'x-key wakes x + unscoped')

  core.note(['y-key'])
  flushFrame()
  assert.deepEqual([x.ensures, y.ensures, any.ensures], [2, 2, 3], 'y-key wakes y + unscoped')

  core.note(['unwatched'])
  flushFrame()
  assert.deepEqual([x.ensures, y.ensures, any.ensures], [2, 2, 4], 'unwatched key wakes only unscoped')
})

test('coalescing: one flush per scheduled frame, dirty cleared after flush', () => {
  const h = makeHarness()
  const x = makeTask('x', ['x-key'])
  h.core.register(x)
  h.core.activate()
  assert.equal(x.ensures, 1)

  h.core.note(['x-key'])
  h.core.note(['x-key'])
  h.core.note(['y-key'])
  assert.ok(h.frame !== null, 'note schedules a frame')
  h.flushFrame()
  assert.equal(x.ensures, 2, 'a burst coalesces into a single flush (not 3)')
  assert.equal(h.frame, null, 'pending frame is consumed')

  h.flushFrame()
  assert.equal(x.ensures, 2, 'flush with no pending frame is a no-op')
})

test('error isolation: throwing tasks do not stop others; onError receives details', () => {
  const errors: Array<[string, unknown, string]> = []
  let frame: (() => void) | null = null
  const core = createReconcilerCore({
    requestFrame: (flush) => {
      frame = flush
      return () => {
        if (frame === flush) frame = null
      }
    },
    onError: (taskName, error, phase) => {
      errors.push([taskName, error, phase])
    },
  })
  const boomEnsure: ReconcilerTask = {
    name: 'boom-ensure',
    ensure: () => {
      throw new Error('ensure boom')
    },
    dispose: () => {},
  }
  const boomDispose: ReconcilerTask = {
    name: 'boom-dispose',
    ensure: () => {},
    dispose: () => {
      throw new Error('dispose boom')
    },
  }
  const ok = makeTask('ok')
  core.register(boomEnsure)
  core.register(boomDispose)
  core.register(ok)

  core.activate()
  assert.equal(ok.ensures, 1, 'a throwing task must not stop the others')
  assert.equal(errors.length, 1)
  assert.equal(errors[0][0], 'boom-ensure')
  assert.equal(errors[0][2], 'ensure')
  assert.ok(errors[0][1] instanceof Error)
  assert.equal((errors[0][1] as Error).message, 'ensure boom')

  core.deactivate()
  assert.equal(ok.disposes, 1)
  assert.equal(errors.length, 2)
  assert.equal(errors[1][0], 'boom-dispose')
  assert.equal(errors[1][2], 'dispose')
  assert.equal((errors[1][1] as Error).message, 'dispose boom')
})

test('flush semantics: empty dirty runs nothing; activation forces all; deactivate cancels pending', () => {
  const h = makeHarness()
  const x = makeTask('x', ['x-key'])
  h.core.register(x)

  h.core.flush()
  assert.equal(x.ensures, 0, 'flush before activate has no active snapshot')

  h.core.activate()
  assert.equal(x.ensures, 1, 'activation forces a full pass')

  h.core.note([])
  h.flushFrame()
  assert.equal(x.ensures, 1, 'empty-dirty flush runs nothing for scoped tasks')

  h.core.note(['x-key'])
  assert.ok(h.frame !== null)
  h.core.deactivate()
  assert.equal(h.frame, null, 'deactivate cancels the pending frame')
  h.flushFrame()
  assert.equal(x.ensures, 1, 'cancelled frame must not flush')
  assert.equal(x.disposes, 1)
})

test('a disposer is idempotent and only disposes a task it owns (issue #86)', () => {
  const { core } = makeHarness()
  const a = makeTask('a')
  const removeA = core.register(a)
  core.activate()
  assert.equal(a.ensures, 1)
  removeA()
  assert.equal(a.disposes, 1)
  // Calling the same disposer again must not run dispose() a second time.
  removeA()
  assert.equal(a.disposes, 1, 'dispose must not outnumber ensure')
  // A disposer for a task that never entered the registry's active set is a
  // no-op, not a way to dispose somebody else's task.
  const b = makeTask('b')
  const removeStale = core.register(b)
  core.deactivate()
  assert.equal(b.disposes, 1)
  removeStale()
  assert.equal(b.disposes, 1, 'stale disposer after deactivate is a no-op')
})

test('a note() issued while flush is running survives to the next pass (issue #86)', () => {
  const h = makeHarness()
  const observed: number[] = []
  let noted = false
  const task: ReconcilerTask = {
    name: 'self-noting',
    scopes: ['k'],
    ensure: () => {
      observed.push(observed.length)
      if (!noted) {
        // A task that discovers more work must be able to schedule itself
        // again; the old flush cleared dirty at the end and swallowed this.
        noted = true
        h.core.note(['k'])
      }
    },
    dispose: () => {},
  }
  h.core.register(task)
  h.core.activate()
  assert.equal(observed.length, 1, 'activation pass')
  assert.ok(h.frame !== null, 'the self-note must schedule a frame')
  h.flushFrame()
  assert.equal(observed.length, 2, 'the dirty key noted during the flush must produce a second pass')
  h.flushFrame()
  assert.equal(observed.length, 2, 'and then it settles')
})

test('preview-close-sync: own open marker must not be treated as a suite close', () => {
  const frameAttrs = new Set(['data-aionui-preview-open'])
  const frame = {
    hasAttribute: (name: string) => frameAttrs.has(name),
    removeAttribute: (name: string) => {
      frameAttrs.delete(name)
    },
  }
  const preview = { style: { visibility: 'hidden' } }
  const originalDocument = (globalThis as { document?: unknown }).document
  ;(globalThis as { document?: unknown }).document = {
    querySelector: (selector: string) => {
      if (selector === '[data-mobile-nav="frame"]') return frame
      if (selector === '[data-aionui-preview-col]') return preview
      return null
    },
  }
  const h = makeHarness()
  h.core.register(createPreviewCloseTask())
  h.core.activate()
  // Activation already ran ensure once; re-add the marker to simulate a
  // fresh file-row tap before dirtying the open marker itself.
  frameAttrs.add('data-aionui-preview-open')
  h.core.note(['data-aionui-preview-open'])
  h.flushFrame()
  assert.equal(
    frameAttrs.has('data-aionui-preview-open'),
    true,
    'setting our own open marker must not immediately close the preview',
  )
  // A real suite hide via inline style must still clear the marker.
  h.core.note(['style'])
  h.flushFrame()
  assert.equal(frameAttrs.has('data-aionui-preview-open'), false, 'inline style hidden must close the preview')
  ;(globalThis as { document?: unknown }).document = originalDocument
})
