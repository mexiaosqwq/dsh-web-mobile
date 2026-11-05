// Soft-keyboard Enter inserts a newline on touch (owner 2026-11-05). The host
// composer's KEY_ENTER_COMMAND handler sends on a bare Enter and only lets
// Shift+Enter through; phone keyboards have no Shift. composer-enter-newline.ts
// registers ahead of the host and turns a bare Enter into INSERT_LINE_BREAK.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findCommand, shouldEnterInsertNewline } from '../src/client/effects/composer-enter-newline.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/effects/composer-enter-newline.ts'), 'utf8')
const ENTRY = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')
const HOST_CONVERSATION = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'

const key = (over: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing', boolean>> = {}) => ({
  shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...over,
})

test('a bare Enter and the IME null-event Enter both become a newline', () => {
  assert.equal(shouldEnterInsertNewline(key(), false), true)
  assert.equal(shouldEnterInsertNewline(null, false), true)
})

test('modifier Enter, composing Enter and an open trigger menu stay with the host', () => {
  for (const mod of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey', 'isComposing'] as const) {
    assert.equal(shouldEnterInsertNewline(key({ [mod]: true }), false), false, mod)
  }
  assert.equal(shouldEnterInsertNewline(key(), true), false)
  assert.equal(shouldEnterInsertNewline(null, true), false)
})

test('commands are recovered by their Lexical type string; a foreign editor yields null', () => {
  const enter = { type: 'KEY_ENTER_COMMAND' }
  const lineBreak = { type: 'INSERT_LINE_BREAK_COMMAND' }
  const editor = { _commands: new Map<object, unknown>([[{ type: 'KEYDOWN_COMMAND' }, []], [enter, []], [lineBreak, []]]) }
  assert.equal(findCommand(editor, 'KEY_ENTER_COMMAND'), enter)
  assert.equal(findCommand(editor, 'INSERT_LINE_BREAK_COMMAND'), lineBreak)
  assert.equal(findCommand({}, 'KEY_ENTER_COMMAND'), null)
  assert.equal(findCommand({ _commands: new Map() }, 'KEY_ENTER_COMMAND'), null)
})

test('the hook registers ahead of the host CRITICAL handler and is armed from the entry', () => {
  assert.match(SRC, /const FRONT_OF_CRITICAL = 4 \| 8/)
  assert.match(SRC, /installMobileEffect\(ctx,/)
  assert.match(ENTRY, /installComposerEnterNewline\(ctx\)/)
})

// Host contract this effect leans on (0.2.2-rc.1). Skipped when the host tree is absent (CI clone).
test('host contract: Lexical addFront on flagged priority, and the composer sends on bare Enter', { skip: !existsHost() }, () => {
  const host = readFileSync(HOST_CONVERSATION, 'utf8')
  assert.match(host, /return s !== o \? l\.addFront\(n\) : l\.addBack\(n\)/)
  assert.match(host, /if \(event\?\.shiftKey === true\) return false;/)
  assert.match(host, /handlers\.submit\(event\?\.ctrlKey === true \|\| event\?\.metaKey === true\)/)
  assert.match(host, /Pe\$2\("KEY_ENTER_COMMAND"\)/)
  assert.match(host, /Pe\$2\("INSERT_LINE_BREAK_COMMAND"\)/)
})

function existsHost(): boolean {
  try { readFileSync(HOST_CONVERSATION, 'utf8'); return true } catch { return false }
}

// 真机 2026-11-05「有概率发送」：宿主换掉编辑器实例后，如果不再触发 focusin
// （键盘一直弹着、焦点没变），新编辑器上就没有我们的处理器。补挂必须挂在
// 所有能引出 KEY_ENTER_COMMAND 的事件上，且都在捕获期（早于 Lexical 的根监听）。
test('the hook is re-armed from keydown and beforeinput, not only focusin', () => {
  for (const type of ['focusin', 'keydown', 'beforeinput']) {
    assert.match(SRC, new RegExp(`document\\.addEventListener\\('${type}', ensure, true\\)`), type)
    assert.match(SRC, new RegExp(`document\\.removeEventListener\\('${type}', ensure, true\\)`), type)
  }
})
