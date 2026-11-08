import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPAT_CSS } from '../src/client/styles/compat.css.ts'

/** Declarations of the rule that starts at `selector`, delimited by the rule's
 * own braces. A `[\s\S]*?\n}` lazy slice runs past this block: this sheet's
 * closing braces are indented, so the first column-0 `}` sits three rules
 * later and the container slice swallowed the item + scrollbar rules. */
function ruleBody(selector: string): string {
  // Require the selector to be followed by its opening brace: the container
  // selector is a prefix of the item selector, so a bare indexOf could slice
  // the wrong rule if the two were ever reordered.
  const at = COMPAT_CSS.indexOf(`${selector} {`)
  assert.ok(at > -1, `rule not found: ${selector}`)
  const open = at + selector.length + 1
  let depth = 0
  for (let i = open; i < COMPAT_CSS.length; i += 1) {
    if (COMPAT_CSS[i] === '{') depth += 1
    else if (COMPAT_CSS[i] === '}') {
      depth -= 1
      if (depth === 0) return COMPAT_CSS.slice(open + 1, i)
    }
  }
  return assert.fail(`unbalanced declaration block: ${selector}`)
}

test('market gallery uses responsive horizontal image items', () => {
  const containerRule = ruleBody('[data-mobile-nav="frame"] [class*="cardShots"]')
  const itemRule = ruleBody('[data-mobile-nav="frame"] [class*="cardShots"] > [class*="cardShot"]')

  assert.match(COMPAT_CSS, /^@media \(max-width: 1023px\) and \(pointer: coarse\) \{/)
  assert.match(containerRule, /flex-wrap: nowrap !important/)
  assert.match(containerRule, /overflow-x: auto !important/)
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
