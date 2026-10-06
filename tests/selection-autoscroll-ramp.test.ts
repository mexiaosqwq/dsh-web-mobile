// 2026-10-07 真宿主取证（390x844 触屏仿真、锚点在消息流内、按住 1.4s）：
// 手机档选区拖拽的自动滚动**速率由「拖点超出滚动区顶边的距离」决定**——
// y=140/100（区内）→ 0 px/s，y=70 → 1018，y=50 → 2225，y=30 → 3329，y=10 → 3232 px/s。
// 而会话滚动区的顶边正好被顶栏压在 y=67 ⇒ 顶栏那 67px 整块都是加速带，手指在顶栏上
// 任何位置都落在 2200-3300 px/s 档（一屏 777px ≈ 0.23s），观感就是「抽帧式跳到上面」。
// 修法：把滚动区盒子铺到顶栏底下（盒子向上长 H、padding-top 补 H，视觉位置等价），
// H 由 reconciler 任务 header-metrics 量出来写进 --mobile-nav-header-h。
// 本文件是源码不变式审计（无 DOM）；行为层读数见
// docs/handover/2026-10-07-mobile-ui-selection-scroll-findings.md §7。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'

const ROOT = new URL('..', import.meta.url).pathname
const CHROME = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')


/** Body of the phone-tier media block (brace-walked, so nested at-rules are kept). */
function phoneBlock(css: string): string {
  const start = css.indexOf('@media (max-width: 1023px) and (pointer: coarse) {')
  assert.ok(start >= 0, 'phone-tier media block present')
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  return css.slice(start)
}

/** Body of the rule whose selector starts at `at` (brace-matched, so a nested
 *  block cannot truncate it). Needed because a substring search for the plain
 *  header selector also matches the longer `html[data-mobile-nav-selecting] ...`
 *  arm — anchor on the rule's own line instead. */
function bodyAt(css: string, at: number): string {
  assert.ok(at >= 0, 'rule not found')
  const open = css.indexOf('{', at)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return ''
}

/** Props declared in a rule body, deduped and sorted. */
function propsOf(body: string): string[] {
  return [...new Set(body.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean))].sort()
}

test('the phone scroll body extends up under the header (compensated geometry)', () => {
  const phone = phoneBlock(LAYOUT_CSS)
  const at = phone.indexOf('\n  [data-mobile-nav="frame"] [data-phase] [class*="_scrollBody"] {')
  const block = bodyAt(phone, at)
  assert.match(block, /margin-top:\s*calc\(-1 \* var\(--mobile-nav-header-h, 0px\)\) !important/)
  assert.match(block, /padding-top:\s*var\(--mobile-nav-header-h, 0px\) !important/)
  // 变量缺席时必须是 no-op（hero / 空顶栏 / 宿主换形态都靠这条 fail-open）。
  assert.ok(!/var\(--mobile-nav-header-h\)/.test(LAYOUT_CSS), '两份声明都要 0px 兜底')
})

test('the header occludes the lifted flow (opaque + raised, under the overlay tier)', () => {
  // 三张无头截图（2026-10-07）：透明 → 消息穿过标题行；不透明但未抬升 → 与透明那版逐字节
  // 相同（背景被画在内容下面）；不透明 + 抬升 → 与未改动的顶栏带像素一致。
  const phone = phoneBlock(LAYOUT_CSS)
  const at = phone.indexOf('\n  [data-mobile-nav="frame"] [data-phase] header {')
  const block = bodyAt(phone, at)
  assert.match(block, /background:\s*var\(--dsw-alias-bg-layer-1, #fff\) !important/)
  const z = block.match(/z-index:\s*(\d+) !important/)
  assert.ok(z !== null, '顶栏必须抬升，否则消息会盖在它上面')
  const value = Number(z[1])
  // 高于流内自带的层（真宿主实测 6-7），低于本插件自己的浮层阶梯（55+）与抽屉/菜单（1000+）。
  assert.ok(value > 7 && value < 55, `z-index ${value} 不在安全段内`)
  assert.match(block, /position:\s*relative !important/, 'z-index 需要有定位才生效')
})

test('the selection marker drops the header out of the hit test', () => {
  // 真机复报（04:2x）：速率修好后仍然「不是滚动选择，直接跳到会话顶上」。机制：原生手柄拖拽
  // 每一步都对把手位置做命中测试来定选区终点，顶栏虽然不可选但仍是命中目标 ⇒ Blink 顺着 DOM
  // 往后找到第一个可选节点（真宿主实测 = 流的第一个条目「Load earlier」）并 reveal 它 ⇒ 视口瞬移。
  const phone = phoneBlock(LAYOUT_CSS)
  const sel = 'html[data-mobile-nav-selecting] [data-mobile-nav="frame"] [data-phase] header {'
  const block = bodyAt(phone, phone.indexOf(sel))
  assert.match(block, /pointer-events:\s*none !important/)
  // 只准动 pointer-events：拖拽中任何布局变化都会打断选区/引起跳动。
  assert.deepEqual(propsOf(block), ['pointer-events'])
})

test('the marker is driven by selectionchange and scoped to the conversation', () => {
  assert.ok(CHROME.includes("const SELECTING_ATTR = 'data-mobile-nav-selecting'"))
  assert.ok(CHROME.includes("document.addEventListener('selectionchange', sync)"))
  assert.ok(CHROME.includes("document.removeEventListener('selectionchange', sync)"))
  // 输入框/抽屉里的选区不算：它们的 chrome 必须保持可点。
  assert.match(CHROME, /if \(element\.closest\('\[data-composer-card\]'\) !== null\) return false/)
  assert.match(CHROME, /return element\.closest\('\[data-phase\]'\) !== null/)
  // 选区收起与卸载都必须摘掉标记，否则顶栏永久点不动。
  assert.ok(CHROME.includes('root.removeAttribute(SELECTING_ATTR)'))
})

test('the offset comes from a measured header, published idempotently', () => {  assert.ok(CHROME.includes("name: 'header-metrics'"), 'reconciler 任务已注册')
  assert.ok(CHROME.includes("const HEADER_HEIGHT_VAR = '--mobile-nav-header-h'"))
  assert.ok(
    CHROME.includes("const HEADER_SELECTOR = '[data-mobile-nav=\"frame\"] [data-phase] header'"),
    '顶栏锚点用后代形态',
  )
  assert.ok(
    !CHROME.includes('[data-phase] > header'),
    '不许退回直接子元素形态（0.2.0-rc.2 在 phase root 与 header 之间插了一层 wrapper）',
  )
  // 变量写回 <html> 的 style 属性本身就是一次 mutation：不比对就会自己把自己弄脏。
  assert.match(CHROME, /if \(root\.style\.getPropertyValue\(HEADER_HEIGHT_VAR\) !== next\)/)
  // 卸载/断点退出必须清变量，否则布局停在铺开态。
  assert.match(CHROME, /removeProperty\(HEADER_HEIGHT_VAR\)/)
  assert.match(CHROME, /header\.offsetHeight === 0/, '顶栏不可量时回落到 0px')
})
