// Issue #60 / thinking-effort 0.3.7 follow-up: a third-party model seat
// (@hytime/dsh-thinking-effort) registered on conversation.input.model replaces
// the official pill, so the trailing lane keeps no aria-haspopup="menu"
// trigger: the pill absorber rule never matches, the meter fallback splits the
// slack with the seat, and in the seat's open state the zero-width root's
// right:0-anchored panel (width min(336px, 100vw - 32px)) sweeps 336px leftward
// off screen - reporter-measured at 393px: root x=106, panel left=-230; with
// our stylesheet disabled root x=339, panel left=+3.
//
// thinking-effort 0.3.7 then added its own narrow-screen clamp, which writes an
// INLINE left on the panel (390px phone, new chat: root x=122, inline
// left=-106px, i.e. the intended 16px margin). The old repair 2 recipe
// (left:50% + translateX(-50%)) left its left arm dead under that inline value
// while its transform kept firing, so the panel landed at
// 122 + (-106) + (-168) = -152px - off screen by 152px.
//
// This pins the current class fix: the seat root must stretch across the
// trailing lane (chip pushed right, free space consumed so the meter
// fallback's auto margin zeroes out) and the open panel must be card-anchored
// (left:0/right:0 + auto margins, transform:none to neutralise the stray
// translateX, !important to beat the plugin's inline left), with three
// viewport guards for the short-screen listbox, the keyboard-shrunk phone and
// landscape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LAYOUT = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')

const sectionStart = LAYOUT.indexOf('/* --- Composer bottom row on mobile ---')
const sectionEnd = LAYOUT.indexOf('/* --- Composer file entry', sectionStart)
const section =
  sectionStart !== -1 && sectionEnd > sectionStart
    ? LAYOUT.slice(sectionStart, sectionEnd)
    : ''

const PANEL_SELECTOR =
  '[data-phase] [class*="_card"]:has(textarea, [data-composer-input]) [class*="_row"]:has([class*="_trailing"]) > [class*="_trailing"] [data-seat-root] > [data-seat-panel]'

test('model-seat rules live inside the mobile composer row section', () => {
  assert.notEqual(sectionStart, -1, 'composer row section marker not found')
  assert.ok(sectionEnd > sectionStart, 'composer file entry marker not found')
  // The section sits mid-block, so "nearest @media" is a nested query (e.g.
  // hover:none). Find the MOBILE query opening before the section and prove
  // its block is still open at the section by counting braces (comments
  // stripped - they may quote braces).
  const MOBILE_MEDIA = '@media (max-width: 1023px) and (pointer: coarse)'
  const mediaAt = LAYOUT.indexOf(MOBILE_MEDIA)
  assert.notEqual(mediaAt, -1, 'mobile media query not found')
  assert.ok(mediaAt < sectionStart, 'mobile block must open before the section')
  const code = LAYOUT.slice(mediaAt, sectionStart).replace(/\/\*[\s\S]*?\*\//g, '')
  let depth = 0
  for (const ch of code) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  assert.ok(depth > 0, 'composer section must sit inside the mobile media block')
})

test('seat root stretches the trailing lane, content right, anchored to the card', () => {
  const at = section.indexOf('[data-seat-root] {')
  assert.notEqual(at, -1, 'seat root stretch rule missing')
  const block = section.slice(at, section.indexOf('}', at))
  assert.match(block, /flex: 1 1 auto/)
  assert.match(block, /justify-content: flex-end/)
  // The panel below anchors to the composer card, not to this root: the root
  // is 0-width while the panel is open, so it must not establish the
  // containing block.
  assert.match(block, /position: static !important/)
  // Cascade guard: the lane's generic flex:none root rule shares the
  // stretch rule's specificity, so the stretch must be written after it.
  const flexNone = section.indexOf('[class*="_trailing"] > [class*="_root"] {')
  assert.ok(flexNone !== -1, 'generic lane-root flex:none rule not found')
  assert.ok(flexNone < at, 'seat stretch rule must follow the flex:none rule')
})

test('open panel is card-anchored and beats the plugin inline left', () => {
  const at = section.indexOf(PANEL_SELECTOR + ' {')
  assert.notEqual(at, -1, 'open-panel re-anchor rule missing')
  const block = section.slice(at, section.indexOf('}', at))
  // left:0/right:0 against the card's padding box; the auto margins centre the
  // plugin's own width (336px, capped at 100%) inside it.
  assert.match(block, /left: 0 !important/)
  assert.match(block, /right: 0 !important/)
  assert.match(block, /max-width: min\(100%, 420px\) !important/)
  assert.match(block, /margin-left: auto !important/)
  assert.match(block, /margin-right: auto !important/)
  // transform:none neutralises the old recipe's stray translateX; both
  // !important values must beat the plugin's inline left.
  assert.match(block, /transform: none !important/)
})

test('three guards keep the panel and its listbox inside short/landscape viewports', () => {
  // Guard 1: the inner model listbox opens upward inside the panel and its
  // 100vh-based ceiling exceeds the room above the panel on short screens.
  const g1 = section.indexOf('@media (max-height: 700px) {')
  assert.notEqual(g1, -1, 'short-screen listbox guard missing')
  const g1block = section.slice(g1, section.indexOf('}', g1))
  assert.match(g1block, /\[data-seat-model-menu\]/)
  assert.match(g1block, /max-height: min\(220px, calc\(50vh - 110px\)\) !important/)

  // Guard 2: keyboard-shrunk portrait viewport - the panel scrolls inside
  // itself, children keep their natural height (the slider must not squash).
  const g2 = section.indexOf('@media (orientation: portrait) and (max-height: 505px) {')
  assert.notEqual(g2, -1, 'keyboard-shrunk portrait guard missing')
  const g2block = section.slice(g2, section.indexOf('@media (orientation: landscape)', g2))
  assert.match(g2block, /max-height: calc\(50dvh - 45px\) !important/)
  assert.match(g2block, /overflow-y: auto !important/)
  assert.match(g2block, /overscroll-behavior: contain !important/)
  assert.match(g2block, /flex: 0 0 auto !important/)

  // Guard 3: landscape has less room above the card than the panel needs, so
  // it detaches into a bottom-docked sheet.
  const g3 = section.indexOf('@media (orientation: landscape) {')
  assert.notEqual(g3, -1, 'landscape guard missing')
  const g3block = section.slice(g3, section.indexOf('}', g3))
  assert.match(g3block, /position: fixed !important/)
  assert.match(g3block, /bottom: 12px !important/)
  assert.match(g3block, /top: auto !important/)
})

test('seat rules never touch the official pill (no trigger predicates dropped)', () => {
  // The official pill absorber rule and the meter fallback must survive
  // verbatim: third-party seats are the only targets of the new rules.
  assert.match(
    section,
    /\[class\*="_trailing"\] \[class\*="_root"\]:has\(> \[class\*="_trigger"\]\[aria-haspopup="menu"\]\) \{\s*margin-left: auto;\s*margin-right: -4px;/,
  )
  assert.match(
    section,
    /\[class\*="_trailing"\]:not\(:has\(\[class\*="_trigger"\]\[aria-haspopup="menu"\]\)\) > \[class\*="_root"\]:has\(> \[class\*="_trigger"\]\[aria-haspopup="dialog"\]\) \{\s*margin-left: auto;/,
  )
})
