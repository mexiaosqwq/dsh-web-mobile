import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'

test('drawer session tree skips off-screen rendering on mobile only', () => {
  const block = MISC_CSS.match(/@media \(max-width: 1023px\) \{[\s\S]*?\n\}/)
  assert.ok(block, 'mobile media block exists')
  assert.match(block[0], /\[data-mobile-nav="frame"\] > :first-child \[role="tree"\] \{[\s\S]*?content-visibility: auto;/)
  assert.match(block[0], /\[data-mobile-nav="frame"\] > :first-child \[role="tree"\] \{[\s\S]*?contain-intrinsic-size: auto 600px;/)
  // The rule must not leak outside the mobile media query (desktop no-op).
  const outside = MISC_CSS.replace(block[0], '')
  assert.doesNotMatch(outside, /content-visibility/)
})
