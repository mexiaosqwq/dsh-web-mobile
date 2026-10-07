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

test('the phone stats row keeps its tightened spacing (2026-10-07)', () => {
  // 宿主三层叠出来的空隙：root gap 12 + sep margin 6/6 + pill padding 8/8。
  // 手机档收成 6 / 2 / 6 —— 三条都必须带 stats 标记作用域，换代后只会惰性化。
  const scope = '[data-mobile-nav="frame"] [data-phase] [data-mobile-nav="stats"]'
  const blocks = findRuleBlocks(LAYOUT_CSS).filter((block) => block.selector.includes(scope))
  const row = blocks.find((block) => block.body.includes('gap:'))
  assert.ok(row !== undefined, 'stats 行的手机规则块在位')
  assert.match(row.body, /gap: 6px !important/)
  const sep = blocks.find((block) => block.selector.includes('[class*="_sep"]'))
  assert.ok(sep !== undefined, '分隔符规则块在位')
  assert.match(sep.body, /margin: 0 2px !important/)
  const pill = blocks.find((block) => block.selector.includes('[class*="_pill"]'))
  assert.ok(pill !== undefined, '指标胶囊规则块在位')
  assert.match(pill.body, /padding-left: 6px !important/)
  assert.match(pill.body, /padding-right: 6px !important/)
})

test('the composer file button paints one pill, not two (2026-10-07 店主报障)', () => {
  // 真机实测（按下瞬间像素剖面）：外圈 130 设备px 的 233（宿主按钮盒底色，圆角 8）
  // + 内圈 108 设备px 的 222（我们 ::before 胶囊）—— 半透明叠半透明，重叠区更深。
  // 压层叠（!important）在真机上压不住那一层，于是改成**结构上只有一层**：
  // 可见胶囊 = 按钮盒本身（28x28、全圆），::before 永久透明。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const box = blocks.find((block) =>
    !block.selector.includes('::before') && !block.selector.includes(':hover')
    && block.selector.includes('[data-mobile-nav="file-upload"]') && /width:\s*28px !important/.test(block.body))
  assert.ok(box !== undefined, '盒子必须是可见胶囊尺寸 28x28')
  assert.match(box.body, /border-radius:\s*999px/, '盒子本身要是全圆（与加号同尺寸的圆胶囊）')
  assert.match(box.body, /margin:\s*0 0 0 -8px !important/, '盒宽 34→28 后 margin 要跟着收，图标中心不动')
  const before = blocks.find((block) => block.selector.includes('[data-mobile-nav="file-upload"]::before') && block.selector.includes(':hover'))
  assert.equal(before, undefined, '胶囊不再由 ::before 画（否则又是两层）')
  const painted = blocks.find((block) =>
    block.selector.includes('[data-mobile-nav="file-upload"]:hover')
    && block.selector.includes('file-upload"]:focus-visible'))
  assert.ok(painted !== undefined, '盒子的按下反馈规则在位')
  assert.match(painted.body, /background:\s*var\(--dsw-alias-interactive-bg-hover/)
  assert.match(painted.body, /box-shadow:\s*none !important/, '万一那一层是 inset shadow 画的，一并压掉')
  const hit = blocks.find((block) => block.selector.includes('[data-mobile-nav="file-upload"]::after'))
  assert.match(hit.body, /inset:\s*-7px/, '命中区仍外扩（28 盒 ⇒ -7 保持约 42）')
})

test('plugin-manager cards and rows are tappable as a whole on mobile (2026-10-07 店主报障)', () => {
  // 宿主只把标题做成 <button>（cardOpen / rowOpen），图标、徽标、描述、留白都不响应；
  // 整卡/整行可点靠给那颗按钮铺一层绝对定位覆盖层，因此根节点必须自身定位（否则覆盖层
  // 会以更外层的定位祖先为包含块，落成「点哪都开第一个插件的详情」）。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const cardOverlay = blocks.find((block) => block.selector.includes('button[class*="_cardOpen"]::after'))
  assert.ok(cardOverlay !== undefined, '卡片标题按钮的覆盖层在位')
  assert.match(cardOverlay.body, /position:\s*absolute/)
  assert.match(cardOverlay.body, /inset:\s*0/)
  const rowOverlay = blocks.find((block) => block.selector.includes('button[class*="_rowOpen"]::after'))
  assert.ok(rowOverlay !== undefined, '行式条目的覆盖层在位')
  assert.match(rowOverlay.body, /inset:\s*0/)
  const anchored = blocks.find((block) =>
    block.selector.includes('li[data-plugin-package]')
    && block.selector.includes('li[data-plugin-row]')
    && /position:\s*relative\s*!important/.test(block.body))
  assert.ok(anchored !== undefined, '两种根节点都必须钉住定位')
  // 宿主已经铺了覆盖层，但描述盒子（-webkit-box）在 DOM 里排在按钮之后、绘制更晚，
  // 会把点击整块吃掉 —— 所以覆盖层必须自带 z-index，交互件再高一档。
  assert.match(cardOverlay.body, /z-index:\s*1/, '覆盖层要抬到描述之上，否则点了没反应')
  assert.match(rowOverlay.body, /z-index:\s*1/, '行式覆盖层同理')
  const lifted = blocks.filter((block) =>
    block.selector.includes('button:not([class*="_cardOpen"])')
    && block.selector.includes('button:not([class*="_rowOpen"])'))
  assert.ok(lifted.some((block) => /z-index:\s*2/.test(block.body)), '开关等交互件要比覆盖层再高一档')
})
