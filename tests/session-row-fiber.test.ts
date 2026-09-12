// Drawer-tap navigation fallback core: the host's session row carries no
// session id in the DOM, so the tap path reads it from the row's React fiber
// chain. The id source was confirmed on the reference iPhone before this module
// existed; these tests pin the walk, the known-id preference and the tap/drag
// boundary that keeps a vertical scroll from navigating.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIBER_WALK_LIMIT,
  findSessionIdInFiber,
  isTapWithinSlop,
  reactFiberOf,
  type FiberNodeLike,
} from '../src/client/effects/session-row-fiber.ts'

const KNOWN = new Set(['session-cad7-1', 'session-2e6a-2'])
const isKnown = (id: string): boolean => KNOWN.has(id)

/** Build a fiber chain from outermost to innermost props (row div last). */
function chain(...propsList: Array<Record<string, unknown>>): FiberNodeLike {
  let node: FiberNodeLike | null = null
  for (const props of propsList) {
    node = { memoizedProps: props, return: node }
  }
  return node as FiberNodeLike
}

test('the session id is read from the row item fiber (props.node.id)', () => {
  const fiber = chain(
    { children: 'list' },
    { node: { id: 'session-cad7-1', displayTitle: '会话' }, currentId: 'session-2e6a-2' },
    { className: 'YDXeBa_sessionRow', role: 'treeitem', onClick: () => {} },
  )
  assert.equal(findSessionIdInFiber(fiber, isKnown), 'session-cad7-1')
})

test('the nearest known id wins over an outer unrelated one', () => {
  const fiber = chain(
    { node: { id: 'session-2e6a-2' } },
    { node: { id: 'session-cad7-1' } },
    { className: 'YDXeBa_sessionRow' },
  )
  assert.equal(findSessionIdInFiber(fiber, isKnown), 'session-cad7-1')
})

test('a session id may also arrive as sessionId / session.id', () => {
  assert.equal(findSessionIdInFiber(chain({ sessionId: 'session-cad7-1' }), isKnown), 'session-cad7-1')
  assert.equal(
    findSessionIdInFiber(chain({ session: { id: 'session-2e6a-2' } }), isKnown),
    'session-2e6a-2',
  )
})

test('unrelated id props are never mistaken for a session id', () => {
  const fiber = chain(
    { id: 'rename', label: 'Rename' },
    { id: 'fork' },
    { className: 'YDXeBa_sessionRow' },
  )
  assert.equal(findSessionIdInFiber(fiber, isKnown), null)
})

test('a session-shaped but not-yet-listed id survives as a fallback', () => {
  assert.equal(findSessionIdInFiber(chain({ id: 'session-fresh-9' }), isKnown), 'session-fresh-9')
  assert.equal(findSessionIdInFiber(chain({ id: 'not-a-session' }), isKnown), null)
})

test('the walk is bounded and tolerates a missing fiber', () => {
  let node: FiberNodeLike | null = { memoizedProps: { node: { id: 'session-cad7-1' } }, return: null }
  for (let i = 0; i < FIBER_WALK_LIMIT + 5; i += 1) node = { memoizedProps: { children: i }, return: node }
  assert.equal(findSessionIdInFiber(node, isKnown), null)
  assert.equal(findSessionIdInFiber(null, isKnown), null)
  assert.equal(findSessionIdInFiber(undefined, isKnown), null)
})

test('reactFiberOf reads the fiber key React attaches to host instances', () => {
  const fiber: FiberNodeLike = { memoizedProps: { node: { id: 'session-cad7-1' } }, return: null }
  assert.equal(reactFiberOf({ ['__reactFiber$abc123']: fiber }), fiber)
  assert.equal(reactFiberOf({ ['__reactInternalInstance$xyz']: fiber }), fiber)
  assert.equal(reactFiberOf({ className: 'x' }), null)
  assert.equal(reactFiberOf(null), null)
  assert.equal(reactFiberOf({ ['__reactFiber$abc']: 'not-an-object' }), null)
})

test('only a release within the slop counts as a tap', () => {
  assert.equal(isTapWithinSlop({ x: 100, y: 200 }, { x: 100, y: 200 }, 12), true)
  assert.equal(isTapWithinSlop({ x: 100, y: 200 }, { x: 112, y: 212 }, 12), true)
  assert.equal(isTapWithinSlop({ x: 100, y: 200 }, { x: 113, y: 200 }, 12), false)
  // A vertical scroll inside the drawer list also ends over a row: it must not
  // navigate, which is what this boundary is for.
  assert.equal(isTapWithinSlop({ x: 100, y: 200 }, { x: 104, y: 260 }, 12), false)
})
