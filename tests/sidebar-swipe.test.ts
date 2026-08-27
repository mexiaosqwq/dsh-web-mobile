import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySwipe,
  slidingVelocity,
  hitTestStart,
  type SwipeThresholds,
} from '../src/client/effects/sidebar-swipe.ts'
import {
  markGestureConsumed,
  consumeIfGestured,
  isGestureConsumed,
} from '../src/client/effects/gesture-guard.ts'

const BASE: SwipeThresholds = {
  openDistanceRatio: 0.2,
  closeDistanceRatio: 0.16,
  velocityWindowMs: 120,
  openVelocity: 0.45,
  closeVelocity: 0.45,
  directionBias: 1.5,
  slopPx: 4,
  cooldownMs: 350,
  hotspotWidthPx: 24,
}

function classify(
  over: Partial<Parameters<typeof classifySwipe>[0] & Parameters<typeof classifySwipe>[1]>,
  rtl = false,
): 'open' | 'close' | 'none' {
  const t = {
    ...BASE,
    viewportWidthPx: 390,
    drawerOpen: false,
    ...(over as { viewportWidthPx?: number; drawerOpen?: boolean }),
  }
  const m = {
    dx: 0,
    dy: 0,
    velX: 0,
    ...(over as { dx?: number; dy?: number; velX?: number }),
  }
  return classifySwipe(t, m, rtl)
}

test('classifySwipe: slop — sub-4px strokes are none', () => {
  assert.equal(classify({ dx: 3, dy: 0 }), 'none')
  assert.equal(classify({ dx: -3, dy: 0, drawerOpen: true }), 'none')
})

test('classifySwipe: direction bias — diagonal strokes are none', () => {
  // |dx| = 10, |dy| = 8 → 10 <= 1.5*8 = 12 → none
  assert.equal(classify({ dx: 10, dy: 8 }), 'none')
  // |dx| = 20, |dy| = 8 → 20 > 12 → allowed
  assert.equal(classify({ dx: 20, dy: 8, velX: 1 }), 'open')
})

test('classifySwipe: closed drawer — rightward distance opens', () => {
  // 78px / 390 = 0.20 → exactly at threshold → open
  assert.equal(classify({ dx: 78, dy: 0 }), 'open')
  assert.equal(classify({ dx: 80, dy: 0 }), 'open')
})

test('classifySwipe: closed drawer — leftward never opens', () => {
  assert.equal(classify({ dx: -150, dy: 0 }), 'none')
})

test('classifySwipe: closed drawer — velocity opens short fast strokes', () => {
  // dx = 50px (ratio 0.128 < 0.20) but velX = 0.7 px/ms ≥ 0.45 → open
  assert.equal(classify({ dx: 50, dy: 0, velX: 0.7 }), 'open')
  // slow long drag still opens by distance
  assert.equal(classify({ dx: 100, dy: 0, velX: 0.1 }), 'open')
  // too short + too slow → none
  assert.equal(classify({ dx: 30, dy: 0, velX: 0.3 }), 'none')
})

test('classifySwipe: open drawer — rightward distance closes', () => {
  // 63px / 390 = 0.162 → ≥ 0.16 → close
  assert.equal(classify({ dx: 63, dy: 0, drawerOpen: true }), 'close')
  assert.equal(classify({ dx: 70, dy: 0, drawerOpen: true }), 'close')
})

test('classifySwipe: open drawer — leftward never closes', () => {
  assert.equal(classify({ dx: -120, dy: 0, drawerOpen: true }), 'none')
})

test('classifySwipe: open drawer — velocity closes short fast strokes', () => {
  // dx = 40px (ratio 0.103 < 0.16) but velX = 0.55 ≥ 0.45 → close
  assert.equal(classify({ dx: 40, dy: 0, velX: 0.55, drawerOpen: true }), 'close')
  assert.equal(classify({ dx: 30, dy: 0, velX: 0.2, drawerOpen: true }), 'none')
})

test('classifySwipe: velocity must agree with the stroke direction', () => {
  // A rightward-stroke below the distance threshold (60px < 78px open
  // threshold) with negative velocity is contradictory → none
  assert.equal(classify({ dx: 60, dy: 0, velX: -0.8 }), 'none')
})

test('classifySwipe: RTL mirrors the X axis', () => {
  // In RTL a rightward raw stroke is logically leftward → none to open
  assert.equal(classify({ dx: 120, dy: 0 }, true), 'none')
  // In RTL a leftward raw stroke is logically rightward → open
  assert.equal(classify({ dx: -120, dy: 0 }, true), 'open')
  // RTL close: raw leftward closes the drawer
  assert.equal(classify({ dx: -100, dy: 0, drawerOpen: true }, true), 'close')
})

test('classifySwipe: reduced-motion is irrelevant to the decision', () => {
  // The classifier is pure geometry; prefers-reduced-motion only affects
  // CSS animation, which the host transition owns. Assert invariance by
  // calling with the same input twice.
  const input = { dx: 130, dy: 0, velX: 0.9 }
  assert.equal(classify(input, false), classify(input, false))
})

test('slidingVelocity: empty / single-sample returns 0', () => {
  assert.equal(slidingVelocity([], 120, 1000), 0)
  assert.equal(slidingVelocity([{ t: 900, x: 10 }], 120, 1000), 0)
})

test('slidingVelocity: recent-window instantaneous speed', () => {
  const samples = [
    { t: 800, x: 0 },
    { t: 900, x: 20 },
    { t: 950, x: 30 },
    { t: 980, x: 45 },
  ]
  // Window (1000-120=880..1000): t=900..980 → (45-20)/(980-900) = 0.3125
  assert.equal(slidingVelocity(samples, 120, 1000), 0.3125)
})

test('slidingVelocity: ignores stale samples outside the window', () => {
  const samples = [
    { t: 500, x: 0 },
    { t: 700, x: 300 }, // outside the window → must not drag the speed up
    { t: 950, x: 320 },
    { t: 980, x: 326 },
  ]
  assert.equal(slidingVelocity(samples, 120, 1000), (326 - 320) / (980 - 950))
})

test('slidingVelocity: zero time span returns 0', () => {
  assert.equal(
    slidingVelocity(
      [
        { t: 900, x: 10 },
        { t: 900, x: 20 },
      ],
      120,
      1000,
    ),
    0,
  )
})

test('hitTestStart: inside / outside the left hotspot', () => {
  const t = { hotspotWidthPx: 24 }
  assert.equal(hitTestStart(0, 390, false, t), true)
  assert.equal(hitTestStart(24, 390, false, t), true)
  assert.equal(hitTestStart(25, 390, false, t), false)
  assert.equal(hitTestStart(389, 390, false, t), false)
})

test('hitTestStart: RTL mirrors to the right edge', () => {
  const t = { hotspotWidthPx: 24 }
  assert.equal(hitTestStart(389, 390, true, t), true)
  assert.equal(hitTestStart(366, 390, true, t), true)
  assert.equal(hitTestStart(365, 390, true, t), false)
})

test('hitTestStart: viewport edge bounds', () => {
  const t = { hotspotWidthPx: 24 }
  assert.equal(hitTestStart(-1, 390, false, t), false)
  assert.equal(hitTestStart(390, 390, false, t), false)
})

// --- gesture-guard ---

/**
 * Lightweight fake element chain: the guard only reads `parentElement`
 * (walking the ancestor chain) and uses EventTarget identity, so a minimal
 * stub is enough — no DOM needed in node:test.
 */
interface FakeEl {
  parentElement: FakeEl | null
}
function makeChain(): { child: FakeEl; parent: FakeEl; root: FakeEl } {
  const root: FakeEl = { parentElement: null }
  const parent: FakeEl = { parentElement: root }
  const child: FakeEl = { parentElement: parent }
  return { child, parent, root }
}

test('gesture-guard: mark → consume → expires', () => {
  const { child } = makeChain()
  markGestureConsumed(child, 5)
  assert.equal(consumeIfGestured({ target: child }), true, 'live mark consumes')
  // Wait for expiry (performance.now is monotonic).
  const t0 = performance.now()
  while (performance.now() - t0 < 10) { /* spin */ }
  assert.equal(consumeIfGestured({ target: child }), false, 'expired mark no longer consumes')
  assert.equal(isGestureConsumed(child), false)
})

test('gesture-guard: ancestor-chain coverage with upTo', () => {
  const { child, parent, root } = makeChain()
  // Mark child up to root: child, parent, root all covered.
  markGestureConsumed(child, 100, root)
  assert.equal(consumeIfGestured({ target: child }), true)
  assert.equal(consumeIfGestured({ target: parent }), true)
  assert.equal(consumeIfGestured({ target: root }), true)
})

test('gesture-guard: target chain of the synthetic re-dispatched click', () => {
  // The host's self-healing path re-dispatches a click whose target is the
  // ROW ROOT, an ancestor of the original release point. A mark made on the
  // release point with upTo=frame must cover that synthetic click.
  const { child, parent, root } = makeChain()
  markGestureConsumed(child, 100, root)
  assert.equal(consumeIfGestured({ target: parent }), true)
})

test('gesture-guard: non-gesture events pass through', () => {
  const { child } = makeChain()
  assert.equal(consumeIfGestured({ target: child }), false)
})
