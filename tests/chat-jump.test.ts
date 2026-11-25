// 会话侧边四键（issue #299）：逐条前后跳用户消息的选取规则，以及它与源码/样式的接线。
//
// 断掉的后果各是什么：
// - 选取规则用 `<=` 而不是 `<` ⇒ 刚落在某条提问上时再点「上一条」原地不动；
// - 取第一个而不是最后一个候选 ⇒ 「上一条」跳到自己下方那条；
// - 四键没有挂在移动档/没有滚动显隐 ⇒ 手机上看不见或常驻挡内容。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STEP_TOLERANCE_PX, landingScrollTop, pickStepRow } from '../src/client/core/chat-jump.ts'
import { en, zh } from '../src/client/i18n/locales.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

// offsets = 每条用户消息的顶边相对「可视带顶边」的像素偏移（DOM 顺序，从小到大）。
// 落在某条提问上时它就等于 0，于是「上一条」必须是它上方那条，「下一条」是下方那条。
const CASES: ReadonlyArray<{ name: string; offsets: readonly number[]; prev: number; next: number }> = [
  { name: 'mid-list walk both ways', offsets: [0, 200, 400], prev: -1, next: 1 },
  { name: 'landed on a prompt steps to its neighbours', offsets: [-200, 0, 400], prev: 0, next: 2 },
  { name: 'top-most prompt has nothing above', offsets: [0, 200], prev: -1, next: 1 },
  { name: 'bottom-most prompt has nothing below', offsets: [-600, -400, 0], prev: 1, next: -1 },
  { name: 'empty transcript', offsets: [], prev: -1, next: -1 },
]

for (const item of CASES) {
  test('pickStepRow: ' + item.name, () => {
    assert.equal(pickStepRow(item.offsets, 'prev'), item.prev, 'prev index')
    assert.equal(pickStepRow(item.offsets, 'next'), item.next, 'next index')
  })
}

// 8px is still the current row; offsets outside that band are candidates.
test('pickStepRow: sub-tolerance offsets count as the band top', () => {
  assert.equal(STEP_TOLERANCE_PX, 8)
  assert.equal(pickStepRow([4, 200], 'prev'), -1)
  assert.equal(pickStepRow([4, 200], 'next'), 1)
  assert.equal(pickStepRow([-4, -200], 'next'), -1, 'nothing below the band top')
})

test('pickStepRow: the tolerance boundary is exclusive', () => {
  assert.equal(pickStepRow([-8, 100], 'prev'), -1, '-8 is still the band top')
  assert.equal(pickStepRow([-9, 100], 'prev'), 0, '-9 is above it')
  assert.equal(pickStepRow([8, 100], 'next'), 1, '+8 is still the band top, skip it')
  assert.equal(pickStepRow([9, 100], 'next'), 0, '+9 is the first row below the band top')
})

test('pickStepRow: the nearest neighbour wins, not the first candidate', () => {
  assert.equal(pickStepRow([-900, -500, -120, 0, 300], 'prev'), 2)
  assert.equal(pickStepRow([0, 120, 500, 900], 'next'), 1)
})

// The four buttons are the issue's UI contract; a missing dictionary key shows
// up as a raw key on screen, and a missing marker leaves the CSS inert.
test('chat-jump dictionaries cover both locales', () => {
  const keys = ['chatJumpTop', 'chatJumpPrev', 'chatJumpNext', 'chatJumpBottom'] as const
  for (const key of keys) {
    assert.equal(typeof zh[key], 'string', 'zh is missing ' + key)
    assert.equal(typeof en[key], 'string', 'en is missing ' + key)
    assert.ok((zh[key] as string).length > 0, 'zh ' + key + ' is empty')
    assert.ok((en[key] as string).length > 0, 'en ' + key + ' is empty')
  }
})

test('the effect arms on the mobile breakpoint and follows the host scroller', () => {
  const effect = read('src/client/effects/chat-jump.ts')
  assert.match(effect, /installMobileEffect\(/, 'a width change must tear the control down')
  assert.match(effect, /'\[data-conversation-scroll\]'/, 'the host scroller marker is the anchor')
  assert.match(effect, /scopes: \['\*'\]/, 'a host rebuild must re-mount the control')
  // 宿主的 toBottomSlot 这个**盒子**也命中 `[class*="_toBottom"]`，且先于按钮出现在
  // DOM 里；选择器漏掉 `button` 就会点到一个没有 click 行为的 div，按钮看似活着却
  // 毫无反应。这条断言锁的就是那半个选择器。
  assert.match(effect, /button\[class\*="_toBottom"\]/, 'the bottom key must target the button, not its slot')
  const entry = read('src/client/index.tsx')
  assert.match(entry, /installChatJump\(ctx\)/, 'the entry must install the feature')
})

test('landingScrollTop clamps at the top of the transcript', () => {
  assert.equal(landingScrollTop(500, 300, 40, 12), 500 + 300 - 40 - 12, 'row top aligns under the band top')
  assert.equal(landingScrollTop(0, 10, 40, 12), 0, 'a row above the band top must not scroll negative')
})

test('native tail parking is keyed on availability, not transient visibility', () => {
  const css = read('src/client/styles/base.css.ts')
  const parking = css.slice(css.indexOf('id: chat-jump-native-tail-parking'))
  assert.match(parking, /\[data-mobile-nav="chat-jump"\]\[data-mobile-nav-available\][^\n]*button\[class\*="_toBottom"\][^}]*display: none !important/)
  assert.doesNotMatch(parking.split('display: none !important', 1)[0] ?? '', /data-mobile-nav-shown/)
})

test('desktop CSS hides the cluster before the mobile effect disposes it', () => {
  const css = read('src/client/styles/misc.css.ts')
  const desktop = /@media \(min-width: 1024px\), \(pointer: fine\), \(pointer: none\) \{([\s\S]*?)\n\}/.exec(css)
  assert.match(desktop?.[1] ?? '', /\[data-mobile-nav="chat-jump"\][\s\S]*?display: none !important/)
})

test('the control is hidden until the reader scrolls', () => {
  const base = read('src/client/styles/base.css.ts')
  const rule = base.slice(base.indexOf('data-mobile-nav="chat-jump"'))
  assert.ok(rule.length > 0, 'base.css.ts must carry the chat-jump block')
  assert.match(rule, /pointer-events: none/, 'a hidden cluster must not eat taps')
  assert.match(rule, /\[data-mobile-nav-shown="1"\]/, 'the shown state is a DOM marker')
  const css = read('src/client/core/css-rules.ts')
  assert.ok(!css.includes('chat-jump'), 'styles belong in styles/, not core')
})
