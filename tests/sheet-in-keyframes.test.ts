// #124 fix #2 (2026-09-25): the settings sheet entrance lost its opacity ramp.
// Checker screencast scene 4 (docs/handover/2026-09-25-issue124-checker.md §四)
// caught the 0.22s fade double-exposing the still-open drawer underneath the
// panel (frame a005), so dsh-web-mobile-sheet-in must stay a pure slide-in:
// no opacity keyframe at all, motion only. This pins the source keyframes —
// an opacity ramp sneaking back in would resurrect the double-exposure with
// every gate still green.
//
// The #124 review pass (2026-09-26) added two robustness pins on the same
// rule family, asserted here too: the shortcuts paper max-height carries the
// vh-then-dvh fallback pair (dvh needs Chromium 108, :has only 105 — the 105-107
// window would otherwise drop max-height entirely), and the sheet family's
// reduced-motion block kills the two max-height transitions as well.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')
const LAYOUT = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')

// Top-level closing braces sit at column zero; from/to arms are indented,
// so this slice ends exactly at the keyframes' own closing brace.
const slice = /@keyframes dsh-web-mobile-sheet-in \{[\s\S]*?\n\}/.exec(BASE)
const keyframes = slice?.[0] ?? ''

test('the sheet-in keyframes exist in base.css.ts', () => {
  assert.notEqual(slice, null, 'dsh-web-mobile-sheet-in keyframes not found in base.css.ts')
})

test('sheet-in carries no opacity ramp (pure slide-in, #124 fix #2)', () => {
  assert.doesNotMatch(keyframes, /opacity/, 'opacity must stay out of the sheet-in keyframes')
})

test('sheet-in keeps its motion arms', () => {
  assert.match(keyframes, /translateY\(14px\) scale\(\.98\)/, 'from arm lost its rise/scale')
  assert.match(keyframes, /transform: none/, 'to arm lost its resting transform')
})

test('the family consumer keeps the .22s duration it was tuned at', () => {
  assert.match(LAYOUT, /animation: dsh-web-mobile-sheet-in \.22s /, 'sheet-in duration moved without a matching decision')
})

// The shortcuts paper rule body: the selector string also appears as a member
// of the reduced-motion group, so pick the match whose body is the real rule.
const card = [...LAYOUT.matchAll(/\[aria-modal="true"\]\[data-shortcut-modal="shortcuts"\] \{([^}]*)\}/g)]
  .map((m) => m[1])
  .find((body) => body.includes('position: absolute'))

test('the shortcuts paper max-height keeps the vh fallback ahead of the stable-vh cap (#124 review P2-1, #128 rebase)', () => {
  assert.ok(card, 'shortcuts paper rule body not found in layout.css.ts')
  const vh = card.indexOf('calc(100vh - 24px')
  const stable = card.indexOf('calc(var(--dsh-web-mobile-vh, 100dvh) - 24px')
  assert.notEqual(vh, -1, 'missing the 100vh fallback for Chromium 105-107 WebViews (var absent → 100dvh fallback would void the whole declaration)')
  assert.notEqual(stable, -1, 'missing the stable-viewport cap (#128 keyboard fix)')
  assert.ok(vh < stable, 'the vh fallback must come first so var-capable browsers override it')
})

test('the sheet family reduced-motion block kills the max-height transitions too (#124 review P2-2)', () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}/.exec(LAYOUT.slice(LAYOUT.indexOf('[aria-modal="true"]:has(> :first-child')))
  assert.ok(block, 'sheet family reduced-motion block not found')
  assert.match(block[0], /transition: none !important/, 'max-height transitions must join the reduced-motion kill list')
  assert.ok(block[0].includes('[aria-modal="true"][data-shortcut-modal="shortcuts"]'), 'the shortcuts paper must be covered by the kill list')
})
