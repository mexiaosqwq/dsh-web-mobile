// Issue #245 (owner, 2026-10-25): 「当输入时屏幕变为横屏时，输入框可能会错位甚至
// 消失,目前只能进行刷新」. Mechanism pinned by these tests: the host composer seat
// is pure-CSS `position: sticky; bottom: 0`, this plugin paints the conversation
// header opaque and above the flow at z-index 30, and in a keyboard-shrunken
// landscape band (792x360 device, IME still up) the seat is taller than the band
// minus the header — so its top half (the Lexical editing row) is laid out inside
// the header's box and the header paints over it. sticky cannot be scrolled out;
// reloading closes the keyboard, hence "only a refresh helps".
//
// The quantifiable half (core/composer-clearance.ts) is pure geometry and a
// hysteresis state machine, tested here without a DOM; the active path is a
// measurement of real host rects, so real-device acceptance stays pending
// (docs §待真机验收 in the PR body).
//
// Device readings used below (vivo V2463A, CSS viewport 792x360 in landscape):
//   status bar ~24, IME ~224 in landscape  -> layout viewport 112
//   header 67 (plugin-compressed, layout.css.ts 「头部留白收紧」 measured 77 -> 67)
//   seat 102 = card 70 (recon: composer card 356x70) + stack gap 6 + dock 26
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCROLL_CHANNEL_TOLERANCE_PX,
  TIGHT_ENTER_PX,
  composerOccludedPx,
  nextComposerTight,
} from '../src/client/core/composer-clearance.ts'
import { findRuleBlocks } from '../src/client/core/css-rules.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = readFileSync(join(ROOT, 'src/client/core/composer-clearance.ts'), 'utf8')
const EFFECT = readFileSync(join(ROOT, 'src/client/effects/composer-clearance.ts'), 'utf8')
const INDEX = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')

const BAND = {
  visibleHeight: 112,
  headerBottom: 67,
  seatHeight: 102,
  seatBottom: 112,
  scrollY: 0,
  offsetTop: 0,
}

test('the reporter geometry: the editing row sits 57px inside the header band', () => {
  // seat top = 112 - 102 = 10; the header owns 0..67, so 57px of the seat (the
  // editing row plus its padding) is painted under the opaque header.
  assert.equal(composerOccludedPx(BAND), 57)
})

test('a partially covered seat is the 「错位」 half of the report', () => {
  // A shorter IME leaves 160px: seat top 58, only 9px under the header — the
  // top of the input line is clipped instead of the whole row disappearing.
  assert.equal(composerOccludedPx({ ...BAND, visibleHeight: 160, seatBottom: 160 }), 9)
  // Portrait with the keyboard up (792 - ~300) leaves the seat far below the
  // header: no marker, the status quo is correct there.
  assert.equal(composerOccludedPx({ ...BAND, visibleHeight: 480, seatBottom: 480 }), 0)
})

test('a seat taller than the band starts at 0, never at a negative top', () => {
  // 60px of visible band, 102px seat: top clamps to 0, so the whole header is
  // covered (57 -> 67) and the below-band term stays 0 while sticky holds.
  assert.equal(composerOccludedPx({ ...BAND, visibleHeight: 60, seatBottom: 60 }), 67)
})

test('a stale layout viewport adds the below-band term', () => {
  // The other failure shape: the seat's bottom is below the visible band (the
  // layout viewport did not follow the IME). Same marker, both terms add up.
  assert.equal(composerOccludedPx({ ...BAND, seatBottom: 150 }), 95)
})

test('the model fails open: disagreeing scroll channels mean rect coords are not screen coords', () => {
  // A visual-viewport pan (or an engine that changed its keyboard model)
  // separates offsetTop from scrollY; then no occlusion number is trustworthy.
  assert.equal(composerOccludedPx({ ...BAND, offsetTop: 200 }), 0)
  // The documented tolerance is inclusive, one px more bails.
  assert.equal(
    composerOccludedPx({ ...BAND, scrollY: 0, offsetTop: SCROLL_CHANNEL_TOLERANCE_PX }),
    57,
  )
  assert.equal(
    composerOccludedPx({ ...BAND, scrollY: 0, offsetTop: SCROLL_CHANNEL_TOLERANCE_PX + 1 }),
    0,
  )
})

test('garbage readings rest at zero', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(composerOccludedPx({ ...BAND, visibleHeight: bad }), 0)
    assert.equal(composerOccludedPx({ ...BAND, headerBottom: bad }), 0)
    assert.equal(composerOccludedPx({ ...BAND, seatHeight: bad }), 0)
    assert.equal(composerOccludedPx({ ...BAND, seatBottom: bad }), 0)
    assert.equal(composerOccludedPx({ ...BAND, scrollY: bad }), 0)
    assert.equal(composerOccludedPx({ ...BAND, offsetTop: bad }), 0)
    assert.equal(nextComposerTight(false, bad), false)
  }
})

test('the marker is a hysteresis state machine, not a threshold compare', () => {
  // Enter only on a real (>= 1px) overlap…
  assert.equal(nextComposerTight(false, 0), false)
  assert.equal(nextComposerTight(false, TIGHT_ENTER_PX - 0.5), false)
  assert.equal(nextComposerTight(false, TIGHT_ENTER_PX), true)
  // …stay while any overlap remains (an IME animation frame must not toggle the
  // layout back on)…
  assert.equal(nextComposerTight(true, 1), true)
  assert.equal(nextComposerTight(true, 0.5), true)
  // …and leave only when the occlusion is gone.
  assert.equal(nextComposerTight(true, 0), false)
})

test('the effect measures the host seat/header under the plugin frame and publishes a marker', () => {
  assert.match(EFFECT, /\[class\*="_composerSeat"\]/)
  // The header must be anchored on the host header class: a bare header would
  // also match the ask-question card's own header inside the seat
  // (pitfalls §提问卡顶栏误伤).
  assert.match(EFFECT, /header:has\(\[class\*="_headerLeading"\]\)/)
  assert.ok(!/'header'/.test(EFFECT), 'no bare header selector string')
  // The marker contract the stylesheet keys on.
  assert.match(EFFECT, /const TIGHT_MARKER = 'data-mobile-nav-composer-tight'/)
  assert.match(EFFECT, /setAttribute\(TIGHT_MARKER, ''\)/)
  assert.match(EFFECT, /removeAttribute\(TIGHT_MARKER\)/)
  // Every viewport episode that relayouts the composer without a DOM mutation
  // must re-measure; the WebView also fires orientationchange before the final
  // resize, and a composer mounting under an already-shrunk band only sees
  // focusin.
  for (const wiring of [
    /addEventListener\('resize', schedule\)/,
    /addEventListener\('orientationchange', schedule\)/,
    /visualViewport\?\.addEventListener\('resize', schedule\)/,
    /visualViewport\?\.addEventListener\('scroll', schedule\)/,
    /addEventListener\('focusin', schedule, true\)/,
  ]) {
    assert.match(EFFECT, wiring)
  }
  // One measurement per frame (the resize storm is the animation itself).
  assert.match(EFFECT, /requestAnimationFrame\(measure\)/)
  // The unmitigated height is cached while the marker is off: feeding the
  // shrunk height back would make the state machine oscillate.
  assert.match(EFFECT, /if \(!tight\) fullHeight = rect\.height/)
  assert.match(EFFECT, /seatHeight: fullHeight > 0 \? fullHeight : rect\.height/)
  // Not laid out (hero phase, panel takeover, host unmount) => marker dropped.
  assert.match(EFFECT, /rect\.width === 0 \|\| rect\.height === 0/)
  // Teardown cancels the pending frame, removes every listener and the marker.
  assert.match(EFFECT, /cancelAnimationFrame\(frame\)/)
  assert.match(EFFECT, /window\.removeEventListener\('resize', schedule\)/)
  assert.match(EFFECT, /document\.removeEventListener\('focusout', schedule, true\)/)
})

test('the installer is registered next to the composer guards', () => {
  assert.match(INDEX, /import \{ installComposerClearance \} from '\.\/effects\/composer-clearance\.ts'/)
  assert.match(INDEX, /installComposerClearance\(ctx\)/)
})

test('the CSS lets the seat outrank the header only while the marker is set', () => {
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const headerRule = blocks.find(
    (rule) => rule.selector === '[data-mobile-nav="frame"] [data-phase] header:has([class*="_headerLeading"])',
  )
  const seatRule = blocks.find((rule) =>
    rule.selector.includes('[data-mobile-nav-composer-tight] [class*="_composerSeat"]'),
  )
  assert.ok(headerRule !== undefined, 'the opaque/raised header rule is the stacking baseline')
  assert.ok(seatRule !== undefined, 'the tight-state seat rule is missing')
  // Numbers, not vibes: the seat must win the same stacking context the header
  // owns (both are children of the frame's context).
  const headerZ = Number(headerRule.body.match(/z-index:\s*(\d+)/)?.[1])
  const seatZ = Number(seatRule.body.match(/z-index:\s*(\d+)/)?.[1])
  assert.ok(Number.isFinite(headerZ) && Number.isFinite(seatZ), 'both rules state a numeric z-index')
  assert.ok(
    seatZ > headerZ,
    `composer seat z-index ${seatZ} must clear the header's ${headerZ}`,
  )
  // Gated on the plugin frame AND the measured marker, never on a device query.
  assert.match(seatRule.selector, /^\[data-mobile-nav="frame"\]\[data-mobile-nav-composer-tight\]/)
  // The secondary row the tight state drops: the host's 0.2.1 InputBar dock row
  // (stable data attribute; absent on older hosts => rule inert).
  const dockRule = blocks.find((rule) =>
    rule.selector.includes('[data-mobile-nav-composer-tight]') && rule.selector.includes('[data-composer-dock]'),
  )
  assert.ok(dockRule !== undefined, 'the tight state must drop the dock row')
  assert.match(dockRule.body, /display:\s*none/)
  // Portrait keeps the full composer: the dock/stats rows are only given up in
  // landscape, where the band cannot fit header + seat. Portrait evidence
  // 2026-10-30 (402x684): tight=T coincided with seatH 76 against 106 without
  // the marker — a 30px shrink, i.e. the owner's 「输入框缩下去」.
  const landscapeAt = LAYOUT_CSS.indexOf('@media (orientation: landscape)')
  const dockAt = LAYOUT_CSS.indexOf('[data-composer-dock]')
  assert.ok(landscapeAt >= 0, 'the dock/stats yield must be gated on landscape')
  assert.ok(landscapeAt < dockAt, 'the landscape gate must wrap the dock rule')
})

test('the patch is registered (four fields + registry row)', () => {
  // The CSS block self-declares for/why/until/test (@patch four elements); the
  // registry table is generated from it by scripts/patch-registry-check.mjs.
  assert.match(LAYOUT_CSS, /@patch[\s\S]*?id: composer-seat-above-header/)
  assert.match(LAYOUT_CSS, /for: [^\n]+/)
  assert.match(LAYOUT_CSS, /why: [^\n]+/)
  assert.match(LAYOUT_CSS, /until: [^\n]+/)
  assert.match(LAYOUT_CSS, /test: tests\/composer-clearance\.test\.ts/)
  // The pure core must stay DOM-free (architecture R4): no document/window.
  assert.doesNotMatch(CORE, /\b(document|window|HTMLElement)\b/)
})
