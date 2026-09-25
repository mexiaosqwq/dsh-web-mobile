// Text anchor for src/client/effects/overlay-backdrop-fab.ts (scout review
// 2026-09-26): the backdrop removal delay is a load-bearing timing carrier —
// the drawer finishes leaving the screen at 280/308*280ms = 254.5ms while the
// backdrop is removed at BACKDROP_FADE_MS + 60 = 260ms, leaving only 5.5ms of
// slack for the #125 modal-raise gate. Anyone retuning either number without
// re-checking the pair would reopen a window where the drawer band covers an
// open modal. This file pins the constant, the 260ms removal expression, and
// the quick close-reopen recovery branch, source-text style.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/effects/overlay-backdrop-fab.ts'), 'utf8')

test('the backdrop fade constant stays at 200ms', () => {
  assert.match(SRC, /const BACKDROP_FADE_MS = 200/, 'BACKDROP_FADE_MS moved without re-checking the #125 timing pair')
})

test('the removal delay stays at BACKDROP_FADE_MS + 60 (the 260ms carrier)', () => {
  assert.match(SRC, /}, BACKDROP_FADE_MS \+ 60\)/, 'backdrop removal delay changed — 260ms is the #125 gate timing carrier (drawer fully out at 254.5ms)')
})

test('a quick close-reopen inside the fade window recovers, not snaps', () => {
  // The pending removal must be cancelled and the dimming eased back in.
  const at = SRC.indexOf('Quick close→reopen inside the fade window')
  assert.notEqual(at, -1, 'the recovery branch comment disappeared')
  const body = SRC.slice(at, SRC.indexOf('}', SRC.indexOf('backdropRemoveTimer = null', at)))
  assert.match(body, /window\.clearTimeout\(backdropRemoveTimer\)/, 'pending removal must be cancelled')
  assert.match(body, /removeProperty\('pointer-events'\)/, 'pointer-events must be restored')
  assert.match(body, /removeProperty\('opacity'\)/, 'opacity must be restored')
  assert.match(body, /faded = false/, 'the fade bookkeeping flag must reset')
})

test('fadeOverlayOut dims through the fadeHook set by ensure()', () => {
  assert.match(SRC, /export function fadeOverlayOut\(\): void \{\s*fadeHook\?\.\(\)/, 'fadeOverlayOut must call the ensure-installed hook')
  assert.match(SRC, /backdrop\.style\.pointerEvents = 'none'/, 'the hook must stop hit-testing the backdrop')
  assert.match(SRC, /backdrop\.style\.opacity = '0'/, 'the hook must fade the dimming out')
})

test('dispose clears the pending removal timer', () => {
  const at = SRC.indexOf('dispose: () => {')
  assert.notEqual(at, -1, 'dispose body missing')
  const body = SRC.slice(at, SRC.indexOf('backdrop?.remove()', at))
  assert.match(body, /window\.clearTimeout\(backdropRemoveTimer\)/, 'dispose must cancel the pending removal timer')
})
