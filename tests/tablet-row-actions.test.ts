// 宽屏触屏档（≥1024 + 粗指针）的三颗 40×40 行内按钮在 280px 侧栏里把标题压到
// 约 55px（issue #255，2026-10-31 实测：行尾同时常显时间 + ⋯ + 归档 + 置顶）。
// 修复方向 A：与手机壳 #154 同源，按宿主 aria-label 把归档/置顶收进 ⋯ 菜单，
// 行内只留「时间 + ⋯」。这里钉住三件事：
//   1) 隐藏规则必须在 (min-width: 1024px) and (pointer: coarse) 档里，而不是手机档；
//   2) 名单必须与手机壳逐字一致（zh/en × 归档/置顶/取消）——两档共用宿主字典，
//      换文案时两边应同时静默失效，不能只有一边误伤；
//   3) ⋯ 的常显规则必须保留，否则行内操作入口会一起消失。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'

/** 第一个 prelude 匹配、且正文包含 needle 的 @media 块（大括号配平，含外层）。 */
function mediaBlock(css, prelude, needle) {
  let from = 0
  while (from < css.length) {
    const at = css.indexOf(prelude, from)
    if (at < 0) return null
    const open = css.indexOf('{', at)
    if (open < 0) return null
    let depth = 0
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) {
          const block = css.slice(at, i + 1)
          if (block.includes(needle)) return block
          break
        }
      }
    }
    from = at + prelude.length
  }
  return null
}

const ARIA_LABELS = (text) => [...text.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]).sort()

test('wide touch tablets fold archive/pin into the ⋯ menu (issue #255, 2026-10-31)', () => {
  const tablet = mediaBlock(
    MISC_CSS,
    '@media (min-width: 1024px) and (pointer: coarse) {',
    '归档 / 置顶快捷按钮在宽屏触屏档',
  )
  assert.ok(tablet !== null, 'the wide-touch tablet block must carry the row-action hide rule')

  const hide = tablet.match(
    /\[class\*="sessionRow"\] \[class\*="_rowActions"\] :is\(([\s\S]*?)\)\s*\{([\s\S]*?)\}/,
  )
  assert.ok(hide !== null, 'tablet tier has no _rowActions :is(...) hide rule')
  assert.match(hide[2], /display:\s*none !important/, 'the two quick actions must be hidden, not shrunk')

  // 与手机壳（layout.css 的 frame 规则）共用同一份名单：8 个 zh/en 标签。
  const mobile = LAYOUT_CSS.match(/\[class\*="_rowActions"\] :is\(([\s\S]*?)\)\s*\{/)
  assert.ok(mobile !== null, 'the phone drawer hide rule moved')
  const tabletLabels = ARIA_LABELS(hide[1])
  assert.deepEqual(tabletLabels, ARIA_LABELS(mobile[1]), 'tablet list must mirror the phone drawer (#154)')
  assert.equal(tabletLabels.length, 8, 'zh/en × archive/unarchive/pin/unpin')

  // ⋯ 仍是行内唯一入口：常显规则不能被这次隐藏顺手删掉。
  assert.match(
    tablet,
    /\[class\*="sessionRow"\] \[class\*="_rowActions"\] \{\s*display: inline-flex !important;/,
    'the ⋯ anchor must stay always-visible on wide touch',
  )
})
