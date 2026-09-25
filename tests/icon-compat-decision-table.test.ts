// Anchor for src/client/core/icon-compat.ts (scout review 2026-09-26): the host
// primitives package ships two icon naming generations whose exports are
// disjoint (rc.6 `IconXxxOutline16`, 0.1.7 `IconXxxOutlineRegular`), so the
// module resolves each icon from a candidate list at runtime and falls back to
// a null icon instead of crashing the tree. Behavior-level import is not
// possible here: the module pulls the real primitives package whose dependency
// chain (katex .css) cannot load under plain Node — so this pins the decision
// table itself, source-text style, matching the repo's read-source anchor idiom.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/core/icon-compat.ts'), 'utf8')

test('every exported icon resolves from both naming generations', () => {
  const picks = [...SRC.matchAll(/export const (\w+): HostIcon = pickIcon\(\[('([^']+)', ?'([^']+)')\]\)/g)]
  assert.equal(picks.length, 4, 'expected exactly the four exported icons')
  for (const [, name, , first, second] of picks) {
    assert.match(first, /^Icon\w+OutlineRegular$/, `${name}: first candidate must be the 0.1.7 Regular name`)
    assert.match(second, /^Icon\w+Outline16$/, `${name}: second candidate must be the rc.6 16 name`)
  }
})

test('the Regular name is tried first so the current host generation wins', () => {
  for (const m of SRC.matchAll(/pickIcon\(\[\s*'([^']+)',\s*'([^']+)'\s*\]\)/g)) {
    assert.match(m[1], /OutlineRegular$/, 'the 0.1.7 generation must stay the first candidate')
  }
})

test('a name missing in both generations falls back to a null icon, not a throw', () => {
  assert.match(SRC, /return missingIcon/, 'pickIcon must fall back instead of returning undefined')
  assert.match(SRC, /const missingIcon: HostIcon = \(\) => null/, 'the fallback must render nothing')
})
