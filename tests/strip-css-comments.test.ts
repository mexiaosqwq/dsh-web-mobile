// Build-time CSS comment stripping must not change a single rule (2026-11-03).
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error plain .mjs helper without type declarations
import { stripCssComments, stripEmittedCssModule } from '../scripts/lib/strip-css-comments.mjs'
import { findRuleBlocks } from '../src/client/core/css-rules.ts'
import { MOBILE_CSS } from '../src/client/styles/index.ts'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const rules = (css: string) => findRuleBlocks(css).map((b) => `${norm(b.selector)}{${norm(b.body)}}`)

test('no string literal or url() in the stylesheet contains a comment opener', () => {
  assert.doesNotMatch(MOBILE_CSS, /"[^"\n]*\/\*[^"\n]*"|'[^'\n]*\/\*[^'\n]*'|url\([^)]*\/\*/)
})

test('stripping keeps the parsed rule list identical and removes every comment', () => {
  const stripped = stripCssComments(MOBILE_CSS)
  assert.ok(!stripped.includes('/*'))
  assert.deepEqual(rules(stripped), rules(MOBILE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')))
  assert.equal(findRuleBlocks(stripped).length, findRuleBlocks(MOBILE_CSS).length)
  assert.ok(stripped.length < MOBILE_CSS.length * 0.6, 'comments are the bulk of the sheet')
})

test('only the exported CSS template is rewritten in an emitted module', () => {
  const src = '"use strict";\n// keep me\nexports.BASE_CSS = `\n/* gone */\n.a { color: red; }\n`;\n'
  const out = stripEmittedCssModule(src)
  assert.match(out, /\/\/ keep me/)
  assert.doesNotMatch(out, /gone/)
  assert.match(out, /\.a \{ color: red; \}/)
  assert.throws(() => stripEmittedCssModule('exports.X_CSS = `${a}`;'))
})
