// Anchor for src/client/i18n/locales.ts (scout review 2026-09-26): the repo
// convention is "add the key to zh first, then mirror it in typed en". The en
// type is Record<MobileNavKey, string>, so a missing key fails typecheck — but
// an extra en-only key (or a zh key removed without its en twin) is invisible
// to the gates. Pin the key sets equal in both directions, by direct import.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { en, zh } from '../src/client/i18n/locales.ts'

test('en mirrors zh exactly (no missing, no extra keys)', () => {
  const zhKeys = new Set(Object.keys(zh))
  const enKeys = new Set(Object.keys(en))
  assert.deepEqual(
    [...zhKeys].filter((k) => !enKeys.has(k)),
    [],
    'keys in zh without an en mirror (users would see raw keys in English)',
  )
  assert.deepEqual(
    [...enKeys].filter((k) => !zhKeys.has(k)),
    [],
    'en-only keys (dead translations; the zh key was probably renamed)',
  )
})

test('both dictionaries are non-empty', () => {
  assert.ok(Object.keys(zh).length >= 10, 'zh dictionary unexpectedly small')
  assert.equal(Object.keys(en).length, Object.keys(zh).length)
})
