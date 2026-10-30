// #248: dsh-pet 0.3.x renamed its root. The shipped 0.3.7 bundle carries
// `.dsh-pet-root` / `.dsh-pet-hit` and ZERO `_float` / `_sprite` / role=button
// nodes, so the 0.2-era selector had been dead for the whole 0.3 line — the pet
// stayed visible over modal dialogs and over the fullscreen right panel, where
// its pointer-events:auto hit box (measured 173x206 at the default 462px stage)
// swallows taps. The old mobile scale rule is deleted with it: it never matched
// 0.3.x and the pet's own size setting owns that decision (user call
// 2026-10-29).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const compat = await readFile(new URL('../src/client/styles/compat.css.ts', import.meta.url), 'utf8')

test('pet: the 0.3.x root is hidden under a modal dialog', () => {
  assert.match(compat, /body:has\(\[aria-modal="true"\]\) \.dsh-pet-root,/)
  // The selector list is worthless without the declaration: prove the block that
  // starts with the pet root actually ends in a hide, not some other property.
  assert.match(compat, /\.dsh-pet-root,[\s\S]{0,500}?display: none !important;/)
})

test('pet: the 0.3.x root is hidden under the fullscreen right panel', () => {
  assert.match(
    compat,
    /body:has\(\[data-sidebar-right-open\]\[data-sidebar-right-panel="fullscreen"\]\) \.dsh-pet-root,/,
  )
})

test('pet: the older generation selector is still supported', () => {
  assert.match(
    compat,
    /body:has\(\[aria-modal="true"\]\) > \[class\*="_float"\]:has\(\[class\*="_sprite"\]\[role="button"\]\)/,
  )
})

test('pet: the dead mobile scale rule is gone', () => {
  assert.doesNotMatch(compat, /transform: scale\(\.66\)/)
})
