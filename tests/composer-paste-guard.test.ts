// Multi-line paste after an IME commit keeps only the first line (host Lexical:
// Android's paste menu / IME commitText arrive as beforeinput insertText, which
// routes multi-line text through CONTROLLED_TEXT_INSERTION_COMMAND instead of
// PASTE_COMMAND). composer-paste-guard.ts re-dispatches those as a paste event.
// These tests pin the routing predicate and the effect's wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldRerouteInsertText } from '../src/client/effects/composer-paste-guard.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/effects/composer-paste-guard.ts'), 'utf8')

const ev = (over: Partial<{ inputType: string, data: string | null, isTrusted: boolean, defaultPrevented: boolean }>) => ({
  inputType: 'insertText', data: 'a\nb', isTrusted: true, defaultPrevented: false, ...over,
})

test('multi-line trusted insertText is rerouted', () => {
  assert.equal(shouldRerouteInsertText(ev({})), true)
  assert.equal(shouldRerouteInsertText(ev({ data: '第一行\r\n第二行' })), true)
  assert.equal(shouldRerouteInsertText(ev({ data: 'x\ry' })), true)
})

test('single newline stays on the host line-break command (Shift+Enter / IME newline)', () => {
  assert.equal(shouldRerouteInsertText(ev({ data: '\n' })), false)
})

test('a lone CR is a single line break too; CRLF keeps rerouting', () => {
  // 孤立 '\r'（老式 Mac 换行）与单个 '\n' 同等对待：改投合成 paste 会把字面的 CR
  // 插进草稿，而宿主只把 data === '\n' 认作换行命令。
  assert.equal(shouldRerouteInsertText(ev({ data: '\r' })), false)
  // '\r\n' 是两个字符，宿主的换行命令不认它 ⇒ 仍走改投，断行不丢（既有意图）。
  assert.equal(shouldRerouteInsertText(ev({ data: '\r\n' })), true)
})

test('single-line text, other input types, null data are untouched', () => {
  assert.equal(shouldRerouteInsertText(ev({ data: 'a'.repeat(20000) })), false)
  assert.equal(shouldRerouteInsertText(ev({ inputType: 'insertFromPaste' })), false)
  assert.equal(shouldRerouteInsertText(ev({ inputType: 'insertCompositionText' })), false)
  assert.equal(shouldRerouteInsertText(ev({ data: null })), false)
})

test('untrusted or already-prevented events are never intercepted', () => {
  assert.equal(shouldRerouteInsertText(ev({ isTrusted: false })), false)
  assert.equal(shouldRerouteInsertText(ev({ defaultPrevented: true })), false)
})

test('effect is mobile-gated, capture-phase, composer-scoped, and disposes its listener', () => {
  assert.match(SRC, /installMobileEffect\(ctx, 'dsh-web-mobile: composer paste guard'/)
  assert.match(SRC, /addEventListener\('beforeinput', onBeforeInput, true\)/)
  assert.match(SRC, /removeEventListener\('beforeinput', onBeforeInput, true\)/)
  assert.match(SRC, /closest<HTMLElement>\(COMPOSER_INPUT_SELECTOR\)/)
  // The interception must come after a successfully built paste event, so an
  // engine without DataTransfer/ClipboardEvent falls back to the host path.
  const body = SRC.slice(SRC.indexOf('const onBeforeInput'))
  assert.ok(body.indexOf('if (paste === null) return') < body.indexOf('event.preventDefault()'))
})
