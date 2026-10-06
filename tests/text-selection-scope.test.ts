// B1 (2026-10-04): a selection-handle drag over the session header used to turn
// into a whole-page selection. The fix makes the non-content chrome
// unselectable on the phone tier and keeps message text plus the composer
// editing surface selectable. Source-invariant audit (no DOM): the behavioral
// half was measured headless (drag-select from a message into the header /
// composer row: the extent now ends in message text, not in the chrome).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'

/** Rule blocks inside the phone-tier media block only. */
function phoneTierRules(): { selectors: string[]; body: string }[] {
  const start = MISC_CSS.indexOf('@media (max-width: 1023px) and (pointer: coarse) {')
  assert.ok(start >= 0, 'phone-tier media block present')
  // Walk braces from the media block to its matching close.
  let depth = 0
  let end = -1
  for (let i = MISC_CSS.indexOf('{', start); i < MISC_CSS.length; i++) {
    if (MISC_CSS[i] === '{') depth++
    else if (MISC_CSS[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const inner = MISC_CSS.slice(MISC_CSS.indexOf('{', start) + 1, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: { selectors: string[]; body: string }[] = []
  for (const m of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), body: m[2] })
  }
  return rules
}

const rules = phoneTierRules()
const noneRule = rules.find((r) => /user-select:\s*none/.test(r.body))
const textRule = rules.find((r) => /(^|[^-])user-select:\s*text/.test(r.body))

test('chrome surfaces are unselectable on the phone tier (both spellings)', () => {
  assert.ok(noneRule, 'a user-select:none rule exists in the phone-tier block')
  assert.match(noneRule.body, /-webkit-user-select:\s*none !important/)
  for (const sel of [
    '[data-mobile-nav="frame"] > :first-child', // drawer
    '[data-mobile-nav="frame"] [data-phase] header', // conversation header
    '[data-mobile-nav="frame"] [data-composer-card]', // composer button rows
    '[data-mobile-nav="stats"]',
    '[data-mobile-nav="fab"]',
    '[data-mobile-nav="backdrop"]',
  ]) {
    assert.ok(noneRule.selectors.includes(sel), `missing chrome selector: ${sel}`)
  }
})

test('the conversation header anchor survives a host wrapper (no child combinator)', () => {
  // 0.2.0-rc.2 renders <div class="wSkVaW_root" data-phase> > <div> > <header
  // class="wSkVaW_header">. The child-combinator form this rule used to carry
  // matched 0 elements there, so the title bar kept user-select:auto and a
  // drag-select up over it ended in the header title span again (live-host
  // probe 2026-10-07: 4391 selected chars, opening with the title / mode / tab
  // labels). The descendant form matches the same header on both generations.
  assert.doesNotMatch(MISC_CSS, /\[data-phase\]\s*>\s*header/)
  assert.ok(noneRule!.selectors.includes('[data-mobile-nav="frame"] [data-phase] header'))
  assert.ok(textRule!.selectors.includes('[data-mobile-nav="frame"] [data-phase] header input'))
})

test('content stays selectable: no message-flow or scrollport selector is disabled', () => {
  for (const r of rules.filter((r) => /user-select:\s*none/.test(r.body))) {
    for (const sel of r.selectors) {
      assert.doesNotMatch(sel, /data-chat-flow|data-conversation-scroll|_scrollBody|data-conversation-content|data-composer-seat|_composerSeat/, sel)
      // A bare frame selector would disable the whole app, messages included.
      assert.notEqual(sel, '[data-mobile-nav="frame"]')
    }
  }
})

test('the composer editing surface and drawer fields are re-enabled explicitly', () => {
  assert.ok(textRule, 'a user-select:text rule exists in the phone-tier block')
  assert.match(textRule.body, /-webkit-user-select:\s*text !important/)
  for (const sel of [
    '[data-mobile-nav="frame"] [data-composer-input]',
    '[data-mobile-nav="frame"] > :first-child [role="dialog"]',
    '[data-mobile-nav="frame"] > :first-child input',
    '[data-mobile-nav="frame"] > :first-child textarea',
  ]) {
    assert.ok(textRule.selectors.includes(sel), `missing re-enable selector: ${sel}`)
  }
  // The re-enable must come after the disable so equal-importance ties resolve to text.
  assert.ok(MISC_CSS.indexOf('user-select: text') > MISC_CSS.indexOf('user-select: none'))
})

test('the selection rules never touch layout (no geometry declarations)', () => {
  for (const r of [noneRule, textRule]) {
    const props = r!.body.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean)
    assert.deepEqual([...new Set(props)].sort(), ['-webkit-user-select', 'user-select'])
  }
})

test('desktop is untouched: user-select appears only inside the phone-tier block', () => {
  const desktop = MISC_CSS.slice(MISC_CSS.indexOf('@media (min-width: 1024px), (pointer: fine), (pointer: none)'))
  assert.doesNotMatch(desktop, /user-select/)
})
