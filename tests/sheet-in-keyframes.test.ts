// #124 fix #2 (2026-09-25): the settings sheet entrance lost its opacity ramp.
// Checker screencast scene 4 (docs/handover/2026-09-25-issue124-checker.md §四)
// caught the 0.22s fade double-exposing the still-open drawer underneath the
// panel (frame a005), so dsh-web-mobile-sheet-in must stay a pure slide-in:
// no opacity keyframe at all, motion only. This pins the source keyframes —
// an opacity ramp sneaking back in would resurrect the double-exposure with
// every gate still green.
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
