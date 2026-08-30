import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPAT_CSS } from '../src/client/styles/compat.css.ts'

test('market gallery uses responsive horizontal image items', () => {
  const containerRule = /\[data-mobile-nav="frame"\] \[class\*="cardShots"\] \{([\s\S]*?)\n\}/.exec(COMPAT_CSS)?.[1]
  const itemRule = /\[data-mobile-nav="frame"\] \[class\*="cardShots"\] > \[class\*="cardShot"\] \{([\s\S]*?)\n\}/.exec(COMPAT_CSS)?.[1]

  assert.match(COMPAT_CSS, /^@media \(max-width: 1023px\) and \(pointer: coarse\) \{/)
  assert.ok(containerRule)
  assert.match(containerRule, /flex-wrap: nowrap !important/)
  assert.match(containerRule, /overflow-x: auto !important/)
  assert.ok(itemRule)
  assert.match(itemRule, /flex: 0 0 min\(100%, 420px\) !important/)
  assert.match(itemRule, /width: min\(100%, 420px\) !important/)
  assert.match(itemRule, /object-fit: contain !important/)
  assert.doesNotMatch(itemRule, /width: 180px !important/)
})

test('settings nav stays visible while the market page is open', () => {
  // dshmarket ≥1.20 hides [role=dialog]:has([data-dsh-market-root]) > nav
  // at ≤560px ("the host keeps its own close button in the content
  // header"). Our host's only close ✕ lives inside that nav, so without a
  // counter-rule the market leaves no categories and no way to close.
  // Mirror upstream's exact media condition and restore the nav.
  const rule = /@media \(max-width: 560px\) \{\n    \[data-mobile-nav="frame"\] \[role="dialog"\]:has\(\[data-dsh-market-root\]\) > nav \{([\s\S]*?)\n  \}/.exec(COMPAT_CSS)?.[1]
  assert.ok(rule, 'counter-rule for the market-open nav hide is missing')
  assert.match(rule, /display: flex !important/)
})
