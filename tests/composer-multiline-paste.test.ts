import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeNewlines, shouldRerouteToPaste } from '../src/client/effects/composer-multiline-paste-core.ts'

// 判定纯核：只在「单次 insertText 且文本确实多行、且不在组合期」时改投 paste 通道。
// 这是宿主有损路径（CONTROLLED_TEXT_INSERTION_COMMAND 吞换行）的唯一兜底入口，
// 所以两个方向都要钉死：该拦的必须拦，不该拦的必须放行（误拦会打断正常打字）。

test('multi-line insertText is rerouted (the reported repro)', () => {
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: 'a\nb' }), true)
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: 'first\nsecond\nthird' }), true)
})

test('CRLF counts as multi-line', () => {
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: 'a\r\nb' }), true)
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: 'a\rb' }), true)
})

test('single-line insertText passes through untouched', () => {
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: 'hello' }), false)
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: '中文输入' }), false)
})

test('IME composition in flight is never rerouted', () => {
  // 组合期中间态改道会打断中文输入法。
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: 'a\nb', isComposing: true }), false)
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: 'hello', isComposing: true }), false)
})

test('pure newline input is left to the host line-break branch', () => {
  // 宿主对 data === '\n' 有专门分支（INSERT_LINE_BREAK）；软键盘的换行键发这个，
  // 改道会把它从「软换行」变成「新段落」——必须放行。
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: '\n' }), false)
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: '\r\n' }), false)
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: '\n\n' }), false)
  // 但夹了实字符就是真多行内容，要拦。
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: '\na' }), true)
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: 'a\n' }), true)
})

test('non-insertText input types pass through', () => {
  for (const inputType of ['deleteContentBackward', 'insertFromPaste', 'insertCompositionText', 'insertLineBreak', 'insertParagraph']) {
    assert.equal(shouldRerouteToPaste({ inputType, data: 'a\nb' }), false, inputType)
  }
})

test('null data is not rerouted', () => {
  assert.equal(shouldRerouteToPaste({ inputType: 'insertText', data: null }), false)
})

test('normalizeNewlines collapses CRLF so no blank paragraph appears', () => {
  assert.equal(normalizeNewlines('a\r\nb'), 'a\nb')
  assert.equal(normalizeNewlines('a\rb'), 'a\nb')
  // 契约：不得把 \r\n 变成 \n\n（凭空多出空段）。
  assert.equal(normalizeNewlines('a\r\nb').includes('\n\n'), false)
  assert.equal(normalizeNewlines('a\nb'), 'a\nb')
  assert.equal(normalizeNewlines('plain'), 'plain')
})
