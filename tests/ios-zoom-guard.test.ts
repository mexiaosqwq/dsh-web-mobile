// iOS focus-zoom guard (#45): the engine predicate that gates the CSS floor,
// plus the stylesheet invariants the fix depends on. Both halves matter — the
// floor without the marker never applies, and the marker without pinch-zoom
// leaves a browser-applied zoom impossible to undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectIosWebKit } from '../src/client/effects/phone-chrome.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'

test('detectIosWebKit: the feature probe alone identifies iOS WebKit', () => {
  const seen: string[] = []
  const supports = (condition: string): boolean => {
    seen.push(condition)
    return true
  }
  // A UA the plugin has never seen still counts when the probe answers yes.
  assert.equal(detectIosWebKit({ userAgent: 'Whatever/1.0', maxTouchPoints: 5 }, supports), true)
  assert.deepEqual(seen, ['(font: -apple-system-body) and (-webkit-touch-callout: none)'])
})

test('detectIosWebKit: UA fallback covers iPhone and Mac-UA iPadOS', () => {
  // Chromium answers false to the probe (measured), so the UA decides.
  const no = (): boolean => false
  assert.equal(detectIosWebKit({ userAgent: IPHONE, maxTouchPoints: 0 }, no), true)
  assert.equal(detectIosWebKit({ userAgent: IPADOS, maxTouchPoints: 5 }, no), true)
  // Desktop Safari sends the same UA as iPadOS 13+ but reports no touch.
  assert.equal(detectIosWebKit({ userAgent: IPADOS, maxTouchPoints: 0 }, no), false)
  assert.equal(detectIosWebKit({ userAgent: ANDROID, maxTouchPoints: 5 }, no), false)
})

test('detectIosWebKit: a missing or throwing CSS.supports never throws', () => {
  assert.equal(detectIosWebKit({ userAgent: ANDROID, maxTouchPoints: 5 }, null), false)
  assert.equal(detectIosWebKit({ userAgent: IPHONE, maxTouchPoints: 5 }, null), true)
  const throwing = (): boolean => {
    throw new Error('unsupported condition')
  }
  assert.equal(detectIosWebKit({ userAgent: ANDROID, maxTouchPoints: 5 }, throwing), false)
  assert.equal(detectIosWebKit({ userAgent: IPHONE, maxTouchPoints: 0 }, throwing), true)
})

test('the 16px floor is scoped to the iOS marker and to text-entry fields', () => {
  // Anchored on the declaration line, not on the marker name: the block
  // comment above the rule mentions the marker too.
  const rule = /\n  (html\[data-mobile-nav-ios\] textarea,[^{]*)\{\s*font-size: 16px !important;\s*\}/.exec(
    MISC_CSS,
  )?.[1]
  assert.ok(rule, 'the iOS font-size floor rule must exist')
  // Every selector in the group carries the marker: without it Android would
  // inherit bigger search boxes for no benefit.
  const selectors = rule
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  assert.ok(selectors.length >= 5)
  for (const selector of selectors) assert.match(selector, /^html\[data-mobile-nav-ios\] /)
  // The composer trio must move together or the caret drifts off the text.
  assert.ok(selectors.some((selector) => selector.endsWith('textarea')))
  assert.ok(selectors.some((selector) => selector.endsWith('[data-input-mirror]')))
  assert.ok(selectors.some((selector) => selector.endsWith('[data-input-backdrop]')))
  const inputSelector = selectors.find((selector) => selector.includes('input:not('))
  assert.ok(inputSelector)
  for (const type of ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']) {
    assert.ok(inputSelector.includes(':not([type="' + type + '"])'), 'input floor must skip type=' + type)
  }
  // select keeps its own size on purpose (28px composer access-mode control).
  assert.ok(!selectors.some((selector) => /\bselect\b/.test(selector)))
  // The floor lives inside the mobile branch, like every other mobile rule.
  assert.match(MISC_CSS, /^@media \(max-width: 1023px\) and \(pointer: coarse\) \{/)
  assert.ok(MISC_CSS.indexOf('data-mobile-nav-ios') < MISC_CSS.indexOf('@media (min-width: 1024px)'))
})

test('root and drawer keep pinch-zoom while still refusing horizontal pan', () => {
  const values = [...LAYOUT_CSS.matchAll(/touch-action: ([^;]+);/g)].map((match) => match[1])
  assert.ok(values.length >= 3)
  for (const value of values) {
    if (value.includes('pan-x')) continue // the stats strip opts into horizontal pan on purpose
    assert.match(value, /pinch-zoom/, 'a vertical-pan surface must still allow pinch-zoom')
  }
  const root = /\n  html,\n  body \{([\s\S]*?)\n  \}/.exec(LAYOUT_CSS)?.[1]
  assert.ok(root)
  assert.match(root, /touch-action: pan-y pinch-zoom !important;/)
  assert.match(root, /overscroll-behavior-x: none !important;/)
  // The gesture layer's own rule (the drawer subtree): touch-action intersects
  // down the ancestor chain, so a bare pan-y here would cancel the root grant.
  const drawer = /\[data-mobile-nav="frame"\] > :first-child \{\s*touch-action: ([^;]+);/.exec(LAYOUT_CSS)?.[1]
  assert.equal(drawer, 'pan-y pinch-zoom !important')
})
