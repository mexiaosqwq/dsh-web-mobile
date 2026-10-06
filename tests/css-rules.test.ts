import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findRuleBlocks, matchesSelectorText, fontSizeFor } from '../src/client/core/css-rules.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'

const MESSAGE_P: any = {
  tag: 'p',
  ancestors: [{ tag: 'div', classes: ['abc_scroll'] }],
}

test('findRuleBlocks descends into at-rules and keeps selector/body pairs', () => {
  const css = '@keyframes spin { from { opacity: 0 } to { opacity: 1 } }\n@media (max-width: 700px) { .x:has(p) { font-size: 15px !important; } }'
  const blocks = findRuleBlocks(css)
  assert.equal(blocks.length, 1)
  assert.match(blocks[0].selector, /:has\(p\)/)
  assert.match(blocks[0].body, /15px/)
})

test('matchesSelectorText handles plain, class-substring and :has() arms', () => {
  assert.equal(matchesSelectorText('[class*="_scroll"]:has(p)', MESSAGE_P), true)
  assert.equal(matchesSelectorText('[class*="_scrollBody"]:has(p)', MESSAGE_P), false)
  // The wrapped spelling this repo writes for long arms (layout.css.ts:327-329)
  // must stay readable, or a px rule whose only subject arm is wrapped is invisible.
  assert.equal(matchesSelectorText('[ class*="abc_scroll" ]', MESSAGE_P), true)
  assert.equal(matchesSelectorText('p', MESSAGE_P), true)
  assert.equal(matchesSelectorText('li', MESSAGE_P), false)
})

test('the message text family carries no hardcoded px font-size', () => {
  const hit = fontSizeFor(LAYOUT_CSS, MESSAGE_P)
  assert.ok(hit !== null, 'expected a message text rule to match the fixture')
  assert.doesNotMatch(hit.value, /^\s*[\d.]+px/, `hardcoded size in: ${hit.selector}`)
  assert.match(hit.value, /var\(/)
})

test('long-conversation message blocks skip off-screen layout (2026-10-07 实测)', () => {
  // 真宿主取证：点抽屉在长会话上 236ms longtask、短会话 0ms；profile 显示代价在宿主渲染
  // （(program) 1216ms + 宿主 getAnimations 75ms），插件 JS 仅 ~8ms。
  // 靠给会话滚动区里的直接子块 content-visibility:auto 削掉（A/B：247/62/143ms → 57/61/70ms）。
  const selector = '[data-mobile-nav="frame"] [class*="scrollBody"] [class*="_scroll"]:not([class*="scrollBody"]) > *'
  assert.ok(LAYOUT_CSS.includes(selector), '窄选择器（只打滚动区的直接子块）在位')
  assert.ok(LAYOUT_CSS.includes('content-visibility: auto'), 'content-visibility 在位')
  assert.ok(LAYOUT_CSS.includes('contain-intrinsic-size: auto 320px'), '记住真实高度、只给未渲染块兜底')
  // 滚动容器自身绝不能被设成 content-visibility（那会把整段会话藏掉）。
  assert.ok(!LAYOUT_CSS.includes('[class*="scrollBody"] {'), '没有把 scrollBody 自身当选择器')
})
