// 手机档魔数必须锁在 `(max-width: 767px) and (pointer: coarse)` 里。
//
// 本插件的外层作用域是 MOBILE_QUERY = `(max-width: 1023px) and (pointer: coarse)`，
// 里面有手机（≤767px）与平板（768–1023px）两个档。照某台真机（360×754）量出来的
// 像素值一旦漏到平板档，就会把上游平板排布也改了 —— 2026-09-23 店主明确要求
// 「平板端和别的手机都能用」，所以这些数值必须只对真·手机档生效。
//
// 这里用花括号配对找出每个 ≤767px 门覆盖的区间，再断言那些手机专属声明只出现在
// 门内。新增手机专属数值时，往 PHONE_ONLY 里补一条即可（同时它会被这条测试守住）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const GATE = '@media (max-width: 767px) and (pointer: coarse)'

/** 手机档专属声明：只允许出现在 ≤767px 门内。 */
const PHONE_ONLY = [
  'align-self: flex-end !important',
  'min-height: 26px !important',
  'minmax(36px, auto) minmax(26px, auto)',
]

function layoutSource(): string {
  return readFileSync(
    fileURLToPath(new URL('../src/client/styles/layout.css.ts', import.meta.url)),
    'utf8',
  )
}

/** 去掉注释后再做花括号配对：注释里的 `{`/`}` 会骗过朴素扫描。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 每个 GATE 媒体块覆盖的 [开括号, 闭括号] 区间。 */
function gateRanges(css: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let from = 0
  for (;;) {
    const at = css.indexOf(GATE, from)
    if (at === -1) break
    const open = css.indexOf('{', at)
    assert.ok(open > at, 'gate marker without a block')
    let depth = 0
    let end = open
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1
      else if (css[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    assert.ok(depth === 0, 'unbalanced braces after the gate marker')
    ranges.push([open, end])
    from = at + GATE.length
  }
  return ranges
}

test('phone-tuned header numbers stay behind the ≤767px coarse gate', () => {
  const css = stripComments(layoutSource())
  const ranges = gateRanges(css)
  assert.ok(ranges.length >= 2, `expected the phone gate in layout.css.ts, found ${ranges.length}`)
  for (const needle of PHONE_ONLY) {
    const at = css.indexOf(needle)
    assert.ok(at > 0, `${needle} 不在 layout.css.ts 里（改名后记得同步这条测试）`)
    assert.ok(
      ranges.some(([open, close]) => at > open && at < close),
      `${needle} 出现在 ≤767px 门之外（会改到平板档）`,
    )
    // 只允许出现一次：第二次出现往往就是漏到门外的复制品。
    assert.equal(css.indexOf(needle, at + 1), -1, `${needle} 出现了不止一次`)
  }
})

test('the phone gate is narrower than the mobile scope it lives in', () => {
  const css = stripComments(layoutSource())
  // MOBILE_QUERY 覆盖 ≤1023px；手机档必须比它窄，平板档才留得住上游排布。
  assert.ok(css.includes('(max-width: 1023px) and (pointer: coarse)'))
  assert.ok(css.includes(GATE))
  assert.ok(!css.includes('@media (max-width: 1023px) and (pointer: coarse) {\n    @media (max-width: 1023px)'))
})
