import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createReconcilerCore,
  mutationDirtyKey,
  TEXT_MUTATION_SCOPE,
  TREE_MUTATION_SCOPE,
} from '../src/client/core/reconciler-core.ts'
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

// ---------------------------------------------------------------------------
// Mutation class -> dirty key -> woken tasks (the coverage table of C08).
//
// In-place text rewrites (characterData) now have their own dirty key instead
// of sharing the tree sentinel. The table is ASSERTED AGAINST THE SOURCES, not
// restated: a table restated in the test would keep passing after somebody
// narrowed a scope in src/, which is exactly the regression this is here to
// catch. Adding a task or changing its scopes therefore reddens this file on
// purpose -- update EXPECTED_SCOPES in the same commit.
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_SRC = join(ROOT, 'src', 'client')
const ADAPTER = join(CLIENT_SRC, 'effects', 'reconciler-adapter.ts')

/** The declared coverage table: task name -> the dirty keys it declares. */
const EXPECTED_SCOPES: Record<string, string[]> = {
  'frame-marker': ['*'],
  'header-metrics': ['*'],
  'preview-fullscreen-toggle': ['data-aionui-preview-open', 'data-mobile-preview-full'],
  'preview-close-sync': ['style'],
  'sheet-rise-replay': [
    '*',
    'style',
    'class',
    'data-aionui-explorer-open',
    'data-aionui-preview-open',
    'data-mobile-preview-full',
  ],
  'file-viewer-open-marker': ['*'],
  'drawer-session-log': ['*'],
  'stats-line': ['*', TEXT_MUTATION_SCOPE],
  'overlay-backdrop-fab': ['*', 'data-sidebar-collapsed', 'data-phase'],
  'panel-back-exit': ['*'],
  // 2026-10-20：灯箱缩放层随 portal 挂载/卸载（body 直挂 dialog），故吃树键。
  'image-lightbox-zoom': ['*'],
}

const sorted = (list: string[]): string[] => [...list].sort()

/** Keys a task may name by constant instead of by a string literal. */
const SCOPE_CONSTANTS: Record<string, string> = { TREE_MUTATION_SCOPE, TEXT_MUTATION_SCOPE }

function walkClient(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walkClient(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** name -> declared scopes, read out of the task object literals in src/client. */
function declaredScopes(): Map<string, string[]> {
  const table = new Map<string, string[]>()
  for (const file of walkClient(CLIENT_SRC)) {
    const src = readFileSync(file, 'utf8')
    const marks = [...src.matchAll(/name:\s*'([^']+)'/g)]
    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i]
      const body = src.slice(mark.index, i + 1 < marks.length ? marks[i + 1].index : src.length)
      // name + ensure + dispose is the ReconcilerTask shape; slot and row
      // registrations (name + inject / component) do not match it.
      if (!/ensure\s*[:(]/.test(body) || !/dispose\s*[:(]/.test(body)) continue
      const scopes = body.match(/scopes:\s*\[([^\]]*)\]/)
      assert.ok(scopes !== null, `${relative(ROOT, file)}: ${mark[1]} declares no scopes`)
      // An entry is a string literal or one of the shared key constants; any
      // other spelling fails loudly, so a key cannot slip past this table.
      const keys = [...scopes[1].matchAll(/'([^']+)'|([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => {
        if (match[1] !== undefined) return match[1]
        const known = SCOPE_CONSTANTS[match[2]]
        assert.ok(known !== undefined, `${relative(ROOT, file)}: unknown scope identifier ${match[2]} on ${mark[1]}`)
        return known
      })
      table.set(mark[1], keys)
    }
  }
  return table
}

const attributeKeys = (table: Map<string, string[]>): string[] => {
  const keys = new Set<string>()
  for (const scopes of table.values()) {
    for (const key of scopes) {
      if (key !== TREE_MUTATION_SCOPE && key !== TEXT_MUTATION_SCOPE) keys.add(key)
    }
  }
  return sorted([...keys])
}

test('mapping: text records get their own key, tree records keep the sentinel', () => {
  assert.equal(TREE_MUTATION_SCOPE, '*', 'the tree sentinel spelling is part of the scopes vocabulary')
  assert.equal(TEXT_MUTATION_SCOPE, 'characterData', 'the text key spells the record type it comes from')
  assert.equal(mutationDirtyKey({ type: 'attributes', attributeName: 'style' }), 'style')
  assert.equal(mutationDirtyKey({ type: 'characterData', attributeName: null }), TEXT_MUTATION_SCOPE)
  assert.equal(mutationDirtyKey({ type: 'childList', attributeName: null }), TREE_MUTATION_SCOPE)
  // Fail-open: the two shapes the mapping cannot name widen to the tree
  // sentinel, so a mapping gap costs extra wakeups, never a missed one.
  assert.equal(mutationDirtyKey({ type: 'attributes', attributeName: null }), TREE_MUTATION_SCOPE)
  assert.equal(mutationDirtyKey({ type: 'future-record', attributeName: null }), TREE_MUTATION_SCOPE)
})

test('wiring: the observer observes text changes and drops body records first', () => {
  const adapter = readFileSync(ADAPTER, 'utf8')
  assert.match(adapter, /characterData:\s*true/,
    'without this flag no text record reaches note(), so the text key could never fire')
  assert.match(adapter, /keys\.add\(mutationDirtyKey\(record\)\)/,
    'the observer must map records with the shared mapping, not with its own inline ternary')
  const filterAt = adapter.indexOf("closest('[data-chat-flow]')")
  const mapAt = adapter.indexOf('keys.add(mutationDirtyKey(record))')
  assert.ok(filterAt !== -1 && mapAt !== -1, 'the body filter and the mapping must both exist')
  assert.ok(filterAt < mapAt, 'the body filter runs first, so body records are dropped for every key')
  assert.match(adapter, /closest\('\[data-chat-flow\]'\)\)\s*continue/,
    'a body record must be skipped, not merely inspected')
})

test('the observed attribute filter covers exactly the attribute keys tasks declare', () => {
  const declared = attributeKeys(declaredScopes())
  const block = readFileSync(ADAPTER, 'utf8').match(/attributeFilter:\s*\[([^\]]*)\]/)
  assert.ok(block !== null, 'the observer must keep an explicit attributeFilter')
  const observed = sorted([...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]))
  assert.deepEqual(sorted(observed), declared,
    'every attribute key a task declares must be observed, and every observed attribute needs a declared consumer')
})

test('coverage table: the declared scopes are the ones this suite protects', () => {
  const table = declaredScopes()
  assert.deepEqual(sorted([...table.keys()]), sorted(Object.keys(EXPECTED_SCOPES)),
    'a reconciler task appeared or disappeared: register its mutation classes in EXPECTED_SCOPES in the same commit')
  for (const [name, scopes] of Object.entries(EXPECTED_SCOPES)) {
    assert.deepEqual(sorted(table.get(name) ?? []), sorted(scopes), `${name} scope drift`)
  }
})

test('coverage routing: a text-only burst still wakes every text reader', () => {
  const table = declaredScopes()
  const h = makeHarness()
  const woken: string[] = []
  for (const [name, scopes] of table) {
    h.core.register({
      name,
      scopes,
      ensure: () => {
        woken.push(name)
      },
      dispose: () => {},
    })
  }
  h.core.activate()

  const burst = (key: string): string[] => {
    woken.length = 0
    h.core.note([key])
    h.flushFrame()
    return sorted(woken)
  }
  const tasksDeclaring = (key: string): string[] =>
    sorted([...table].filter(([, scopes]) => scopes.includes(key)).map(([name]) => name))

  const textReaders = tasksDeclaring(TEXT_MUTATION_SCOPE)
  assert.deepEqual(textReaders, ['stats-line'], 'stats-line is the text reader (the TPS readout)')
  assert.deepEqual(burst(TEXT_MUTATION_SCOPE), textReaders,
    'a characterData-only burst must wake the text readers, or the readout stops being re-folded')
  assert.deepEqual(burst(TREE_MUTATION_SCOPE), tasksDeclaring(TREE_MUTATION_SCOPE),
    'a childList burst wakes every tree-key task')
  assert.ok(burst(TREE_MUTATION_SCOPE).includes('stats-line'), 'stats-line stays woken on tree changes too')
  assert.ok(!burst(TEXT_MUTATION_SCOPE).includes('header-metrics'),
    'header-metrics reads structure (its geometry runs on ResizeObserver), so a text burst must not wake it')
  for (const key of attributeKeys(table)) {
    assert.deepEqual(burst(key), tasksDeclaring(key), `${key} must wake exactly its declared tasks`)
  }
})
