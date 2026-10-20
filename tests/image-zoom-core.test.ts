// Pure-core geometry for the image lightbox zoom. Every assertion is a
// property the effect relies on, so a regression here is a real gesture bug
// (drift, image escaping the viewport, pinch inverted, double-tap stuck).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  clampTranslation,
  doubleTapTarget,
  identityZoom,
  pinchFactor,
  zoomAround,
} from '../src/client/core/image-zoom-core.ts'
import type { ZoomState } from '../src/client/core/image-zoom-core.ts'

const EPSILON = 1e-9

/** Where a centre-relative local point lands for a given state. */
function screenOf(state: ZoomState, local: { x: number; y: number }): { x: number; y: number } {
  return { x: state.x + state.scale * local.x, y: state.y + state.scale * local.y }
}

/**
 * Pin the anchor as a LOCAL point of the state before the zoom, then check the
 * state after the zoom still paints that point at the same screen position.
 * (Reading the local point back out of the same state would be tautological.)
 */
function anchorStayedPut(before: ZoomState, after: ZoomState, anchor: { x: number; y: number }): void {
  const local = { x: (anchor.x - before.x) / before.scale, y: (anchor.y - before.y) / before.scale }
  const painted = screenOf(after, local)
  assert.ok(Math.abs(painted.x - anchor.x) < EPSILON, 'anchor x drifted: ' + painted.x)
  assert.ok(Math.abs(painted.y - anchor.y) < EPSILON, 'anchor y drifted: ' + painted.y)
}

test('clampScale: bounds and non-finite input', () => {
  assert.equal(clampScale(0.25), MIN_SCALE)
  assert.equal(clampScale(MIN_SCALE), MIN_SCALE)
  assert.equal(clampScale(2.5), 2.5)
  assert.equal(clampScale(MAX_SCALE), MAX_SCALE)
  assert.equal(clampScale(99), MAX_SCALE)
  assert.equal(clampScale(Number.NaN), MIN_SCALE)
  assert.equal(clampScale(Number.POSITIVE_INFINITY), MAX_SCALE)
  assert.equal(clampScale(Number.NEGATIVE_INFINITY), MIN_SCALE)
})

test('identityZoom is neutral and fresh per call', () => {
  const first = identityZoom()
  const second = identityZoom()
  assert.deepEqual(first, { scale: MIN_SCALE, x: 0, y: 0 })
  assert.notEqual(first, second)
})

test('zoomAround: the anchor point stays put while scaling', () => {
  const before: ZoomState = { scale: 1.5, x: 12, y: -8 }
  const anchor = { x: 40, y: -24 }
  const after = zoomAround(before, 1.6, anchor)
  assert.ok(Math.abs(after.scale - 2.4) < EPSILON)
  anchorStayedPut(before, after, anchor)
})

test('zoomAround: shrinking back to 1x recentres the image', () => {
  const zoomed: ZoomState = { scale: 1.2, x: 30, y: -20 }
  const after = zoomAround(zoomed, 0.1, { x: 55, y: 10 })
  assert.deepEqual(after, identityZoom())
})

test('zoomAround: clamps to MAX_SCALE and keeps the anchor relation', () => {
  const before: ZoomState = { scale: 2, x: -30, y: 12 }
  const anchor = { x: -60, y: 40 }
  const after = zoomAround(before, 100, anchor)
  assert.equal(after.scale, MAX_SCALE)
  anchorStayedPut(before, after, anchor)
})

test('pinchFactor: ratio of the two spans, never divides by zero', () => {
  assert.equal(pinchFactor({ x: 0, y: 0 }, { x: 10, y: 0 }), 1)
  assert.equal(pinchFactor({ x: 10, y: 0 }, { x: 20, y: 0 }), 2)
  assert.equal(pinchFactor({ x: 0, y: 10 }, { x: 0, y: 5 }), 0.5)
  // Diagonal spans: ratio is of lengths, not of either component.
  const ratio = pinchFactor({ x: 3, y: 4 }, { x: 6, y: 8 })
  assert.ok(Math.abs(ratio - 2) < EPSILON)
  assert.equal(pinchFactor({ x: Number.NaN, y: 0 }, { x: 10, y: 0 }), 1)
})

test('doubleTapTarget: 1x to 2.5x, anything else back to identity', () => {
  assert.deepEqual(doubleTapTarget(identityZoom()), { scale: DOUBLE_TAP_SCALE, x: 0, y: 0 })
  assert.deepEqual(doubleTapTarget({ scale: 2.5, x: 12, y: -9 }), identityZoom())
  assert.deepEqual(doubleTapTarget({ scale: 4, x: -100, y: 80 }), identityZoom())
})

test('clampTranslation: an image cannot be dragged out of its viewport', () => {
  const viewport = { width: 400, height: 300 }
  // At 2x the overflow per side is 200 / 150: those are the hard stops.
  const far = clampTranslation({ scale: 2, x: 1000, y: -1000 }, viewport)
  assert.equal(far.x, 200)
  assert.equal(far.y, -150)
  const inside = clampTranslation({ scale: 2, x: 80, y: -40 }, viewport)
  assert.deepEqual(inside, { scale: 2, x: 80, y: -40 })
  // 1x has no overflow at all, so any residual translation collapses.
  assert.deepEqual(clampTranslation({ scale: 1, x: 50, y: 50 }, viewport), identityZoom())
  // Degenerate viewport cannot produce NaN bounds.
  assert.deepEqual(clampTranslation({ scale: 2, x: 10, y: 10 }, { width: 0, height: 0 }), {
    scale: 2,
    x: 0,
    y: 0,
  })
})
