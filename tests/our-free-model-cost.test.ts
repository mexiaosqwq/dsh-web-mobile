// dsh-our-free-model 手机档成本上限的锚（2026-10-11 报障：该插件设置页在手机上
// 明显卡顿、滚动掉帧）。
//
// 该插件的设置页经 createPortal 挂到 document.body，所以它**不在**
// [data-mobile-nav="frame"] 里面——frame 后代选择器静默漏掉它。锚 .ofm_root
// 同样不行：.ofm_scrim / .ofm_toast 也 portal 到 body。这两条锚都是本块存在的
// 前提，所以下面专门钉住它们。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPAT_CSS } from '../src/client/styles/compat.css.ts'

// The slice must start at the section COMMENT, not at the first selector:
// anchoring on '.ofm_aurora {' would leave any prefix added in front of that
// selector outside the slice, and the whole point of these anchors is to
// catch a re-scoping back under [data-mobile-nav="frame"] or .ofm_root.
const HEADER = '/* ---------- dsh-our-free-model: mobile cost ceiling ----------'

const block = (): string => {
  const start = COMPAT_CSS.indexOf(HEADER)
  assert.ok(start > -1, 'the our-free-model cost section header is missing')
  return COMPAT_CSS.slice(start, COMPAT_CSS.indexOf('@media (max-width: 767px)', start))
}

/**
 * The RULES of the block, comment stripped.
 *
 * Every assertion below has to read this, never `block()`. The prose above
 * names every class it discusses, so a regex run against the whole slice is
 * satisfied by the comment alone: deleting the entire `animation: none` rule
 * and leaving only the comment kept this file green (verified 2026-10-15).
 * A test that passes with the rule deleted is not a test.
 */
const rules = (): string => {
  const b = block()
  const end = b.indexOf('*/')
  assert.ok(end > -1, 'the our-free-model cost section lost its comment terminator')
  return b.slice(end)
}

test('our-free-model cost block is mobile-only', () => {
  // It must live inside the top-level mobile media query, not at top level.
  const top = COMPAT_CSS.indexOf('@media (max-width: 1023px) and (pointer: coarse) {')
  assert.ok(top > -1 && top < COMPAT_CSS.indexOf(HEADER))
})

test('our-free-model cost block is not frame- or root-scoped', () => {
  assert.doesNotMatch(rules(), /\[data-mobile-nav="frame"\]/)
  assert.doesNotMatch(rules(), /\.ofm_root/)
})

test('the fixed full-screen aurora is removed', () => {
  assert.match(rules(), /\.ofm_aurora \{\n    display: none !important;\n  \}/)
})

test('decorative ambient animations are stopped, stateful ones are kept', () => {
  const r = rules()
  for (const cls of ['ofm_wave', 'ofm_bubble', 'ofm_fish', 'ofm_tankrays']) {
    // Last entry in the list ends with `{`, the others with `,`.
    assert.match(r, new RegExp(`\\.${cls}[,\\s]`), `${cls} should be in the animation kill list`)
  }
  // .ofm_scanline animates the login-wait hint ("waiting for authorization…");
  // it reports state, so it is deliberately NOT killed — same set upstream's
  // own prefers-reduced-motion block stops.
  assert.doesNotMatch(r, /ofm_scanline/)
  // ofmpulse / ofm-dot-breathe carry loading + status state; killing them
  // would hide whether the page is busy or healthy.
  assert.doesNotMatch(r, /ofm_skel|ofm_pooldot|ofm_dot\b/)
})

test('blur surfaces go opaque, but the modal mask stays translucent', () => {
  const r = rules()
  const surfaces = r.slice(r.indexOf('.ofm_nav,'), r.indexOf('.ofm_scrim {'))
  assert.match(surfaces, /backdrop-filter: none !important;/)
  assert.match(surfaces, /-webkit-backdrop-filter: none !important;/)
  // Dropping the filter alone leaves translucent surfaces the page scrolls
  // through (screenshot-verified ghosting), so an opaque fill is required.
  // The fallback is not decoration: this file's 14 other var() uses all carry
  // one, and a missing token would drop the whole declaration, putting the
  // surfaces straight back to translucent — the exact defect this fixes.
  assert.match(surfaces, /background: var\(--dsw-alias-bg-layer-2, #fff\) !important;/)

  const scrim = r.slice(r.indexOf('.ofm_scrim {'))
  assert.match(scrim, /backdrop-filter: none !important;/)
  // A mask must stay translucent — an opaque fill would black out the page.
  assert.doesNotMatch(scrim, /background:/)
})

test('the patch self-declares its four fields', () => {
  // docs/maintenance/patch-registry.md requires every patch to carry an
  // @patch block; the gate only checks blocks that exist, so this is the
  // anchor that keeps this one from silently losing its declaration.
  // Read the WHOLE sheet, not block(): the @patch sits immediately before the
  // section header, so a slice starting at the header misses it.
  const at = COMPAT_CSS.indexOf('@patch')
  assert.ok(at > -1, 'the our-free-model block lost its @patch declaration')
  const open = COMPAT_CSS.lastIndexOf('/*', at)
  const close = COMPAT_CSS.indexOf('*/', at)
  const decl = COMPAT_CSS.slice(open, close)
  for (const field of ['id:', 'for:', 'why:', 'until:', 'test:']) {
    assert.ok(decl.includes(field), `@patch is missing ${field}`)
  }
  // The test pointer must name this file, or the gate's own existence check
  // passes on a stale pointer.
  assert.match(decl, /test: tests\/our-free-model-cost\.test\.ts/)
  // It must sit before the section header, so a reader meets the declaration
  // first and the gate reads the block that follows it.
  assert.ok(open < COMPAT_CSS.indexOf(HEADER))
})
