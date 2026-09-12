/**
 * Session id recovery from a drawer row's React fiber chain — the DOM-free
 * core of the touch-tap navigation fallback.
 *
 * Why it exists: the host's session row is
 * `<div class="YDXeBa_sessionRow" role="treeitem" aria-selected=… onClick={() => onOpen(node.id)}>`
 * — the DOM carries NO session id (no `data-*`, no `id`), and on the reference
 * iPhone the browser's synthesized `click` is not reliably delivered for a row
 * tap (measured: identical taps, one with a click and one with none at all, no
 * preventDefault/cancel/hit change anywhere). Navigation therefore cannot hinge
 * on the click: the tap path resolves the id itself and calls the host's own
 * `sessions.open(id)`.
 *
 * The id lives one fiber hop up: the row `div`'s props only hold
 * className/role/aria-selected/onClick, but the parent function component
 * (`SessionNodeItem`) memoizes `node`, so `props.node.id` is the session id.
 * Confirmed on the reference iPhone before this module existed: an instrumented
 * tap read the session id straight out of the fiber chain.
 *
 * Zero imports on purpose (effects-directory bundler constraint) so the walk is
 * unit-testable without a DOM.
 */

/** The slice of a React fiber this walk needs. */
export interface FiberNodeLike {
  memoizedProps?: Record<string, unknown> | null
  return?: FiberNodeLike | null
}

/** How many fiber hops to walk before giving up (row → item → list → …). */
export const FIBER_WALK_LIMIT = 60

/** Props keys that carry a session id directly, in preference order. */
const ID_KEYS = ['sessionId', 'id'] as const

/** Props keys that carry a session-ish object whose `id` is the session id. */
const OBJECT_KEYS = ['node', 'session', 'summary', 'result'] as const

/**
 * Find the session id of the row whose fiber chain starts at `fiber`.
 *
 * Known-id membership wins over shape: the first ancestor props value that is a
 * *known* id (present in the host session list) is returned, so an unrelated
 * `id` prop (a menu item id, a DOM-ish key) can never be mistaken for a session.
 * A plausible-looking unknown id is kept only as a fallback for hosts whose list
 * has not materialized the session yet.
 *
 * @param fiber - the row element's React fiber (`__reactFiber$…`).
 * @param isKnownId - membership test against the host session list.
 * @param limit - hop limit, defaults to FIBER_WALK_LIMIT.
 * @returns the session id, or null when nothing plausible was found.
 */
export function findSessionIdInFiber(
  fiber: FiberNodeLike | null | undefined,
  isKnownId: (id: string) => boolean,
  limit: number = FIBER_WALK_LIMIT,
): string | null {
  let node: FiberNodeLike | null | undefined = fiber
  let fallback: string | null = null
  let hops = 0
  while (node !== null && node !== undefined && hops < limit) {
    const props = node.memoizedProps
    if (props !== null && props !== undefined) {
      for (const key of OBJECT_KEYS) {
        const value = props[key]
        if (typeof value !== 'object' || value === null) continue
        const candidate = (value as Record<string, unknown>)['id']
        const hit = classify(candidate, isKnownId)
        if (hit === 'known') return candidate as string
        if (hit === 'plausible' && fallback === null) fallback = candidate as string
      }
      for (const key of ID_KEYS) {
        const candidate = props[key]
        const hit = classify(candidate, isKnownId)
        if (hit === 'known') return candidate as string
        if (hit === 'plausible' && fallback === null) fallback = candidate as string
      }
    }
    node = node.return
    hops += 1
  }
  return fallback
}

/** 'known' beats 'plausible'; anything else is not an id. */
function classify(value: unknown, isKnownId: (id: string) => boolean): 'known' | 'plausible' | 'no' {
  if (typeof value !== 'string' || value === '') return 'no'
  if (isKnownId(value)) return 'known'
  return /^session[-_]/i.test(value) ? 'plausible' : 'no'
}

/**
 * The React fiber attached to a host element, found by the `__reactFiber$…`
 * key React puts on every host instance it creates. DOM-free: it works on any
 * object, so the unit tests hand it plain fixtures.
 *
 * @param instance - a DOM element (or a test fixture object).
 * @returns the fiber, or null when the instance is not React-managed.
 */
export function reactFiberOf(instance: object | null | undefined): FiberNodeLike | null {
  if (instance === null || instance === undefined) return null
  const record = instance as unknown as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      const fiber = record[key]
      return typeof fiber === 'object' && fiber !== null ? (fiber as FiberNodeLike) : null
    }
  }
  return null
}

/**
 * True when a pointerup is still a tap: the finger stayed within `slopPx` of
 * where it went down.
 *
 * Load-bearing for the fallback: without it a vertical scroll inside the drawer
 * list (which also ends with the finger over a row) would navigate.
 */
export function isTapWithinSlop(from: { x: number; y: number }, to: { x: number; y: number }, slopPx: number): boolean {
  return Math.abs(to.x - from.x) <= slopPx && Math.abs(to.y - from.y) <= slopPx
}
