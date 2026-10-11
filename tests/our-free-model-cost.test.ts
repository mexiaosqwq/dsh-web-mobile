import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPAT_CSS } from '../src/client/styles/compat.css.ts'

// dsh-our-free-model renders its settings page through createPortal into
// document.body, so it sits OUTSIDE [data-mobile-nav="frame"]. A
// frame-scoped rule silently misses it; a .ofm_root-scoped rule still
// misses the portaled .ofm_scrim / .ofm_toast. These anchors fail if
// someone re-scopes the block back under either anchor.

// The slice must start at the section COMMENT, not at the first selector:
// anchoring on '.ofm_aurora {' would leave any prefix added in front of that
// selector outside the slice, and the whole point of these anchors is to
// catch a re-scoping back under [data-mobile-nav="frame"] or .ofm_root.
const HEADER = '/* ---------- dsh-our-free-model: mobile cost ceiling ----------'

const block = () => {
  const start = COMPAT_CSS.indexOf(HEADER)
  assert.ok(start > -1, 'the our-free-model cost section header is missing')
  return COMPAT_CSS.slice(start, COMPAT_CSS.indexOf('@media (max-width: 767px)', start))
}

test('our-free-model cost block is mobile-only', () => {
  // It must live inside the top-level mobile media query, not at top level.
  const top = COMPAT_CSS.indexOf('@media (max-width: 1023px) and (pointer: coarse) {')
  assert.ok(top > -1 && top < COMPAT_CSS.indexOf(HEADER))
})

test('our-free-model cost block is not frame- or root-scoped', () => {
  const b = block()
  // Scan only the RULES, not the prose: the comment legitimately names both
  // anchors while explaining why neither can be used.
  const rules = b.slice(b.indexOf('*/'))
  assert.doesNotMatch(rules, /\[data-mobile-nav="frame"\]/)
  assert.doesNotMatch(rules, /\.ofm_root/)
})

test('the fixed full-screen aurora is removed', () => {
  assert.match(block(), /\.ofm_aurora \{\n    display: none !important;\n  \}/)
})

test('decorative ambient animations are stopped, stateful ones are kept', () => {
  const b = block()
  for (const cls of ['ofm_wave', 'ofm_bubble', 'ofm_fish', 'ofm_tankrays', 'ofm_scanline']) {
    // Last entry in the list ends with `{`, the others with `,`.
    assert.match(b, new RegExp(`\\.${cls}[,\\s]`), `${cls} should be in the animation kill list`)
  }
  // ofmpulse / ofm-dot-breathe carry loading + status state; killing them
  // would hide whether the page is busy or healthy.
  assert.doesNotMatch(b, /ofm_skel|ofm_pooldot|ofm_dot\b/)
})

test('blur surfaces go opaque, but the modal mask stays translucent', () => {
  const b = block()
  const surfaces = b.slice(b.indexOf('.ofm_nav,'), b.indexOf('.ofm_scrim {'))
  assert.match(surfaces, /backdrop-filter: none !important;/)
  assert.match(surfaces, /-webkit-backdrop-filter: none !important;/)
  // Dropping the filter alone leaves translucent surfaces the page scrolls
  // through (screenshot-verified ghosting), so an opaque fill is required.
  assert.match(surfaces, /background: var\(--dsw-alias-bg-layer-2\) !important;/)

  const scrim = b.slice(b.indexOf('.ofm_scrim {'))
  assert.match(scrim, /backdrop-filter: none !important;/)
  // A mask must stay translucent — an opaque fill would black out the page.
  assert.doesNotMatch(scrim, /background:/)
})
