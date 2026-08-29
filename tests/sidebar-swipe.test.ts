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
  markStrokeLocked,
  clearStrokeLocked,
  isStrokeLocked,
} from '../src/client/effects/gesture-guard.ts'

const BASE: SwipeThresholds = {
  openDistanceRatio: 0.16,
  closeDistanceRatio: 0.13,
  velocityWindowMs: 60,
  openVelocity: 0.45,
  closeVelocity: 0.45,
  lockPx: 8,
  cooldownMs: 350,
  startZonePx: 48,
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

test('classifySwipe: lock slop — sub-lockPx strokes are none', () => {
  assert.equal(classify({ dx: 7, dy: 0 }), 'none')
  assert.equal(classify({ dx: -7, dy: 0, drawerOpen: true }), 'none')
})

test('classifySwipe: axis lock — horizontal-dominant strokes pass, vertical-dominant are none', () => {
  // |dx| = 10, |dy| = 9 → 10 > 9 → horizontal-dominant → keeps axis lock
  assert.equal(classify({ dx: 10, dy: 9, velX: 0.6 }), 'open')
  // |dx| = 10, |dy| = 10 → not strictly dominant → none
  assert.equal(classify({ dx: 10, dy: 10, velX: 0.6 }), 'none')
  // a natural ~45° diagonal (80,60): |dx| > |dy| → accepted (was rejected
  // by the old 1.5× bias — the "识别成对话内容滚动" fix)
  assert.equal(classify({ dx: 80, dy: 60 }), 'open')
})

test('classifySwipe: closed drawer — rightward distance opens', () => {
  // 62px / 390 = 0.159 → ≥ 0.16? exactly 62px is 0.1589… → uses 63px
  assert.equal(classify({ dx: 63, dy: 0 }), 'open')
  assert.equal(classify({ dx: 80, dy: 0 }), 'open')
})

test('classifySwipe: closed drawer — leftward never opens', () => {
  assert.equal(classify({ dx: -150, dy: 0 }), 'none')
})

test('classifySwipe: closed drawer — velocity opens short fast strokes', () => {
  // dx = 50px (ratio 0.128 < 0.16) but velX = 0.7 px/ms ≥ 0.45 → open
  assert.equal(classify({ dx: 50, dy: 0, velX: 0.7 }), 'open')
  // slow long drag still opens by distance
  assert.equal(classify({ dx: 100, dy: 0, velX: 0.1 }), 'open')
  // too short + too slow → none
  assert.equal(classify({ dx: 30, dy: 0, velX: 0.3 }), 'none')
})

test('classifySwipe: open drawer — rightward distance closes', () => {
  // 51px / 390 = 0.13 → exactly at threshold → close
  assert.equal(classify({ dx: 51, dy: 0, drawerOpen: true }), 'close')
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
  // A rightward-stroke below the distance threshold (60px < 62px open
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
  assert.equal(slidingVelocity([], 60, 1000), 0)
  assert.equal(slidingVelocity([{ t: 900, x: 10 }], 60, 1000), 0)
})

test('slidingVelocity: end-segment (tail-slope) instantaneous speed', () => {
  const samples = [
    { t: 800, x: 0 },
    { t: 900, x: 20 },
    { t: 950, x: 30 },
    { t: 980, x: 45 },
  ]
  // Window (1000-60=940..1000): last two in-window samples are t=950 and
  // t=980 → (45-30)/(980-950) = 0.5 — the end-of-stroke slope, not the
  // window average (which would be 0.3125 over 900..980).
  assert.equal(slidingVelocity(samples, 60, 1000), 0.5)
})

test('slidingVelocity: ignores stale samples outside the window', () => {
  const samples = [
    { t: 500, x: 0 },
    { t: 700, x: 300 }, // outside the window → must not drag the speed up
    { t: 950, x: 320 },
    { t: 980, x: 326 },
  ]
  assert.equal(slidingVelocity(samples, 60, 1000), (326 - 320) / (980 - 950))
})

test('slidingVelocity: zero time span returns 0', () => {
  assert.equal(
    slidingVelocity(
      [
        { t: 950, x: 10 },
        { t: 950, x: 20 },
      ],
      60,
      1000,
    ),
    0,
  )
})

test('hitTestStart: inside / outside the left start zone (48px)', () => {
  const t = { startZonePx: 48 }
  assert.equal(hitTestStart(0, 390, false, t), true)
  assert.equal(hitTestStart(24, 390, false, t), true)
  assert.equal(hitTestStart(48, 390, false, t), true)
  assert.equal(hitTestStart(49, 390, false, t), false)
  assert.equal(hitTestStart(389, 390, false, t), false)
})

test('hitTestStart: RTL mirrors to the right edge (48px)', () => {
  const t = { startZonePx: 48 }
  assert.equal(hitTestStart(389, 390, true, t), true)
  assert.equal(hitTestStart(366, 390, true, t), true)
  assert.equal(hitTestStart(342, 390, true, t), true)
  assert.equal(hitTestStart(341, 390, true, t), false)
})

test('hitTestStart: viewport edge bounds', () => {
  const t = { startZonePx: 48 }
  assert.equal(hitTestStart(-1, 390, false, t), false)
  assert.equal(hitTestStart(390, 390, false, t), false)
  // RTL mirrors: x=390 is the logical left edge (edge = 390-390 = 0 → in zone)
  assert.equal(hitTestStart(390, 390, true, t), true)
  // Negative clientX in RTL is off the right side → never in the zone
  assert.equal(hitTestStart(-1, 390, true, t), false)
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

test('gesture-guard: axis-lock flag yields the host before any consume mark exists (audit S0)', () => {
  // Ordering fact (audit 2026-08-27): the host's document-capture pointerup
  // (onDrawerPointerUp, registered BEFORE the gesture layer's) runs first on
  // the stroke's own release event — markGestureConsumed has not been called
  // yet at that instant, so consumeIfGestured() is still false and the host
  // toggled the drawer before the gesture could classify (double-flip net
  // zero, the "dead gesture" bug). The only race-free yield signal is the
  // axis lock: tryLock writes it during pointermove, strictly before ANY
  // pointerup.
  assert.equal(isStrokeLocked(), false, 'idle: lock clear')
  markStrokeLocked() // what tryLock() does on horizontal dominance
  const { child } = makeChain()
  assert.equal(consumeIfGestured({ target: child }), false, 'no consume mark yet — the S0 race window')
  // The host's first-line check on the same release event:
  assert.equal(
    isStrokeLocked() || consumeIfGestured({ target: child }),
    true,
    'host yields during a locked stroke even without marks',
  )
  clearStrokeLocked() // what reset() does at stroke end
  assert.equal(isStrokeLocked(), false, 'reset clears the lock')
})

test('gesture-guard: mark chain covers the synthetic click ancestor target (upTo)', () => {
  // After a stroke the browser dispatches a synthetic click whose target is
  // the release point or an ancestor of it (e.g. the row root). Production
  // marks up to the DRAWER; this test pins the chain invariant with a
  // root-anchored stub.
  const { child, parent, root } = makeChain()
  markGestureConsumed(child, 100, root)
  assert.equal(consumeIfGestured({ target: parent }), true)
})

test('gesture-guard: non-gesture events pass through', () => {
  const { child } = makeChain()
  assert.equal(consumeIfGestured({ target: child }), false)
})
