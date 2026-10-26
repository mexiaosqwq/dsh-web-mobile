// Ask-question card, owner report 2026-10-25 (真机 360×792 竖屏 / 792×360 横屏,
// DSHA WebView 0.2.1-rc.3 — three items, these tests cover the card itself):
//
//   ① 卡片正文能左右滑（文字被横向滚过、左侧被截断）—— 宿主 Mbwy4a_body 只写了
//     overflow-y:auto，另一轴被计算成 auto，任何比卡宽的子节点都能把它撑成横向
//     滚动容器；宿主只给自定义回答框补了 overflow-wrap。
//   ② 长问题 + 键盘弹起后答案框看不见字（「收起键盘才看到」），内容上下猛跳 ——
//     宿主卡片 max-height: min(60vh, 520px)，而 adjustResize 的 WebView 上 vh 跟
//     键盘一起缩（754 → 471），卡片高度预算 452 → 283，body 里最后一块的回答框
//     被滚出可视区；浏览器只在聚焦那一刻替它滚过一次。
//   ③ 滚卡片掉帧 —— 归因在 docs/maintenance/pitfalls.md §提问卡全屏，本文件只把
//     「插件侧唯一的横轴源被收掉」钉住（A 的 overflow-x）。
//
// 实测读数用在下面：卡宽 293 / 屏 360（_frame 左右各 clearance 16 + 16，_header
// 再来 18/12 ⇒ 正文列 ≈263（桌面档 24/16 是 owner 报的 253）；顶栏压缩后 67；
// 竖屏键盘弹起可见带 ≈492；横屏键盘
// 不收时布局视口 ≈112（issue #245 同一台机器）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ANSWER_FIELD_MARGIN_PX,
  HOST_CARD_HEIGHT_CAP_PX,
  HOST_CARD_HEIGHT_RATIO,
  answerFieldScrollTop,
  hostCardHeightPx,
  nextQuestionFull,
  questionBandPx,
} from '../src/client/core/question-fullscreen.ts'
import type { AnswerFieldView, QuestionBandInput } from '../src/client/core/question-fullscreen.ts'
import { findRuleBlocks } from '../src/client/core/css-rules.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'
import { BASE_CSS } from '../src/client/styles/base.css.ts'
import { COMPAT_CSS } from '../src/client/styles/compat.css.ts'
import { en, zh } from '../src/client/i18n/locales.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = readFileSync(join(ROOT, 'src/client/core/question-fullscreen.ts'), 'utf8')
const EFFECT = readFileSync(join(ROOT, 'src/client/effects/question-fullscreen.ts'), 'utf8')
const INDEX = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')

/** Portrait, keyboard up: 492 visible, seat pinned to its bottom, the card frame
 *  carries only its own 6+10 padding under it (the host composer is elected out
 *  while the question card is up). */
const PORTRAIT: QuestionBandInput = {
  visibleHeight: 492,
  headerHeight: 67,
  frameBottom: 492,
  seatBottom: 492,
  framePadding: 16,
}

const VIEW = (over: Partial<AnswerFieldView> = {}): AnswerFieldView => ({
  fieldTop: 400,
  fieldBottom: 496,
  bodyTop: 300,
  bodyBottom: 600,
  scrollTop: 0,
  scrollHeight: 500,
  clientHeight: 300,
  ...over,
})

test('fullscreen gives the answer box 114px more than the host 60vh ceiling', () => {
  // band = 492 - 67 - 16 = 409; host ceiling = min(0.6 * 492, 520) = 295.2.
  const band = questionBandPx(PORTRAIT)
  assert.equal(band.reservePx, 16)
  assert.equal(band.bandPx, 409)
  assert.ok(band.bandPx - hostCardHeightPx(PORTRAIT.visibleHeight) > 110)
  // …and that is what the button asks: entering needs proof it adds room.
  assert.equal(
    nextQuestionFull(false, true, band.bandPx, hostCardHeightPx(PORTRAIT.visibleHeight)),
    true,
  )
})

test('the reserve accounts for everything under the card, not just the padding', () => {
  // A dock row under the question frame (26px) plus a 4px gap between the seat's
  // bottom and the band's: both are room the card must give back.
  const band = questionBandPx({ ...PORTRAIT, frameBottom: 466, visibleHeight: 496, seatBottom: 492 })
  assert.equal(band.reservePx, (496 - 492) + (492 - 466) + 16)
  assert.equal(band.bandPx, 496 - 67 - (4 + 26 + 16))
})

test('a keyboard-shrunken landscape band is not worth arming', () => {
  // 792x360 with the IME still up leaves ~112px; header 67 + padding 16 leaves
  // 29px, far below the host's own min(60vh, 520px) = 67.2. Arming would only
  // redraw the card smaller — the #245 tight state owns that screen instead.
  const band = questionBandPx({ ...PORTRAIT, visibleHeight: 112, seatBottom: 112, frameBottom: 112 })
  assert.equal(band.bandPx, 29)
  assert.ok(band.bandPx < hostCardHeightPx(112))
  assert.equal(nextQuestionFull(false, true, band.bandPx, hostCardHeightPx(112)), false)
})

test('fail-open: an unreadable measurement keeps the host default', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(questionBandPx({ ...PORTRAIT, visibleHeight: bad }), { reservePx: 0, bandPx: 0 })
    assert.deepEqual(questionBandPx({ ...PORTRAIT, headerHeight: bad }), { reservePx: 0, bandPx: 0 })
    assert.deepEqual(questionBandPx({ ...PORTRAIT, frameBottom: bad }), { reservePx: 0, bandPx: 0 })
    assert.deepEqual(questionBandPx({ ...PORTRAIT, seatBottom: bad }), { reservePx: 0, bandPx: 0 })
    assert.deepEqual(questionBandPx({ ...PORTRAIT, framePadding: bad }), { reservePx: 0, bandPx: 0 })
    // band 0 means "no marker": the CSS then falls back to the host ceiling.
    assert.equal(nextQuestionFull(false, true, 0, hostCardHeightPx(bad)), false)
  }
  // A zero-height viewport (panel takeover, unmounted composer) is unreadable too.
  assert.deepEqual(questionBandPx({ ...PORTRAIT, visibleHeight: 0 }), { reservePx: 0, bandPx: 0 })
})

test('hostCardHeightPx is the host formula, not a copied number', () => {
  assert.equal(hostCardHeightPx(492), 492 * HOST_CARD_HEIGHT_RATIO)
  assert.equal(hostCardHeightPx(2000), HOST_CARD_HEIGHT_CAP_PX)
  assert.equal(hostCardHeightPx(0), 0)
  assert.equal(hostCardHeightPx(Number.NaN), 0)
})

test('the marker never arms itself and survives the keyboard shrinking the band', () => {
  // Not requested => off, whatever the measurement says.
  assert.equal(nextQuestionFull(true, false, 409, 295), false)
  // Entering needs the band to beat the host's own ceiling…
  assert.equal(nextQuestionFull(false, true, 295, 295), false)
  assert.equal(nextQuestionFull(false, true, 296, 295), true)
  // …but an armed card stays armed while the IME shrinks the band: dropping out
  // mid-typing is the 「上下猛跳」 this feature exists to remove.
  assert.equal(nextQuestionFull(true, true, 29, 67), true)
  // Only an unreadable measurement drops it.
  assert.equal(nextQuestionFull(true, true, 0, 67), false)
  // A missing host baseline leaves the decision to the measurement.
  assert.equal(nextQuestionFull(false, true, 409, Number.NaN), true)
})

test('the answer field is scrolled back only when it left the body box', () => {
  // Fully visible: nothing moves.
  assert.equal(answerFieldScrollTop(VIEW()), 0)
  // Bottom out of the box (the keyboard shrank it): scroll down by exactly the
  // covered part plus the 8px margin.
  const covered = answerFieldScrollTop(VIEW({ bodyBottom: 480, scrollHeight: 900 }))
  assert.equal(covered, 496 - (480 - ANSWER_FIELD_MARGIN_PX))
  // Top out of the box: scroll up the same way (300 + 8 - 280 = 28).
  assert.equal(answerFieldScrollTop(VIEW({ fieldTop: 280, fieldBottom: 380, scrollTop: 120 })), 92)
  // Clamped to the scrollable range, never negative, never past the end.
  assert.equal(answerFieldScrollTop(VIEW({ fieldTop: 0, fieldBottom: 40, scrollTop: 2 })), 0)
  assert.equal(
    answerFieldScrollTop(VIEW({ fieldBottom: 900, bodyBottom: 600, scrollTop: 200, scrollHeight: 900 })),
    508,
  )
})

test('a field taller than the body aligns to the bottom edge (where the caret is)', () => {
  // room 100, field 190 tall: the bottom arm wins (the top is already inside the
  // margin), so the body scrolls by exactly the covered part below the box.
  assert.equal(
    answerFieldScrollTop(VIEW({ fieldTop: 310, fieldBottom: 500, bodyTop: 300, bodyBottom: 400, scrollHeight: 900, clientHeight: 100 })),
    108,
  )
  // A box shorter than two margins halves the margin instead of letting the two
  // arms fight each other frame after frame: a field exactly covering the box
  // stays put.
  assert.equal(
    answerFieldScrollTop(VIEW({ fieldTop: 300, fieldBottom: 310, bodyTop: 300, bodyBottom: 310, scrollHeight: 900, clientHeight: 100 })),
    0,
  )
})

test('the field is kept inside the visual viewport, not just the body box', () => {
  // 2026-10-25 残余报障：平台若只平移视觉视口（layout 视口不缩），body 盒仍探到
  // 屏幕下缘之外；只按 bodyBottom 判断会认为「字段已在框内」，于是继续盲打。
  // 可见盒 = body 盒 ∩ 视觉视口（[offsetTop, offsetTop + height]）。
  const panned = VIEW({
    bodyTop: 300,
    bodyBottom: 700,
    fieldTop: 620,
    fieldBottom: 680,
    scrollTop: 0,
    scrollHeight: 900,
    clientHeight: 400,
    visibleTop: 0,
    visibleBottom: 492,
  })
  // 680 − (492 − 8) = 196：按可见底边回滚，而不是按 body 底边（那是 0）。
  assert.equal(answerFieldScrollTop(panned), 196)
  // adjustResize 模型（offsetTop=0、body 底边已经等于可见底边）：同一结果，不退化。
  assert.equal(answerFieldScrollTop({ ...panned, bodyBottom: 492, visibleBottom: 492 }), 196)
  // 可见顶边下移时，上方越界也按可见顶边算：400 − ((300 + 8) − 120) = 212。
  assert.equal(
    answerFieldScrollTop(
      VIEW({
        fieldTop: 120,
        fieldBottom: 200,
        bodyTop: 100,
        bodyBottom: 600,
        scrollTop: 400,
        scrollHeight: 900,
        clientHeight: 400,
        visibleTop: 300,
        visibleBottom: 700,
      }),
    ),
    212,
  )
  // 没有交集（body 整个在屏幕之外）：滚动治不了，保持原样。
  assert.equal(answerFieldScrollTop(VIEW({ bodyTop: 600, bodyBottom: 700, visibleTop: 0, visibleBottom: 492 })), 0)
  // 未提供（老引擎 / 读不到）时退回 body 盒，行为与改动前一致。
  assert.equal(answerFieldScrollTop(VIEW({ visibleTop: undefined, visibleBottom: undefined, fieldBottom: 590 })), 0)
})

test('garbage scroll readings leave the card body alone', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(answerFieldScrollTop(VIEW({ fieldTop: bad })), 0)
    assert.equal(answerFieldScrollTop(VIEW({ scrollHeight: bad, scrollTop: 42 })), 42)
    assert.equal(answerFieldScrollTop(VIEW({ bodyBottom: bad, scrollTop: 42 })), 42)
  }
})

test('the effect injects our control into the card header actions, idempotently', () => {
  // The host card family, anchored by hash substring (never a suffix selector).
  assert.match(EFFECT, /const CARD_FRAME_SELECTOR = '\[class\*="Mbwy4a_frame"\]'/)
  assert.match(EFFECT, /const HEADER_ACTIONS_SELECTOR = '\[class\*="Mbwy4a_headerActions"\]'/)
  assert.match(EFFECT, /const BUTTON_MARKER = 'question-expand'/)
  assert.match(EFFECT, /element\.dataset\.mobileNav = BUTTON_MARKER/)
  // Inserted into the host row (not absolutely positioned over it) and only when
  // it is not already there: appending per flush would be a mutation loop.
  assert.match(EFFECT, /actions\.insertBefore\(button, actions\.lastElementChild\)/)
  assert.match(EFFECT, /if \(button\.parentElement !== actions\)/)
  // A single button node survives host re-renders; disposal removes it.
  assert.match(EFFECT, /if \(button === null\) \{/)
  assert.match(EFFECT, /button\.removeEventListener\('click', onClick\)/)
  assert.match(EFFECT, /button\.remove\(\)/)
  assert.ok(!/position:\s*fixed/.test(EFFECT), 'no overlay fallback: the injection route is the chosen one')
  // Only an answerable card gets the control: the host drops the body when the
  // card is minimized and the review panel never renders one (the header row
  // survives both), so a header-only injection would offer a dead toggle.
  assert.match(EFFECT, /if \(card\.querySelector\(CARD_BODY_SELECTOR\) === null\)/)
  assert.match(EFFECT, /button\?\.remove\(\)\n          clear\(\)/)
  assert.ok(!EFFECT.includes("style.position"), 'the control is not positioned by JS')
})

test('the marker, the reserve and the labels are published from one measured pass', () => {
  assert.match(EFFECT, /const FULL_MARKER = 'data-mobile-nav-question-full'/)
  assert.match(EFFECT, /host\.setAttribute\(FULL_MARKER, ''\)/)
  assert.match(EFFECT, /host\.removeAttribute\(FULL_MARKER\)/)
  assert.match(EFFECT, /const RESERVE_VAR = '--dsha-mobile-question-reserve'/)
  assert.match(EFFECT, /card\.style\.setProperty\(RESERVE_VAR, nextReserve\)/)
  assert.match(EFFECT, /published\?\.style\.removeProperty\(RESERVE_VAR\)/)
  // Write-on-change only: style/class are in the full-tree reconciler's
  // attributeFilter, so an unconditional write would wake this task forever.
  assert.match(EFFECT, /if \(reserveText !== nextReserve\)/)
  assert.match(EFFECT, /if \(next !== host\.hasAttribute\(FULL_MARKER\)\)/)
  // aria-expanded tracks the marker (and the label follows it).
  assert.match(EFFECT, /button\.setAttribute\('aria-expanded', expanded\)/)
  assert.match(EFFECT, /t\(armed \? 'questionCollapse' : 'questionExpand'\)/)
})

test('fullscreen is manual: only a tap sets the intent', () => {
  // The click path is the single place that raises the intent, and it toggles
  // what is on screen rather than the intent itself.
  assert.match(EFFECT, /requested = !armed/)
  assert.match(EFFECT, /if \(!armed\) requested = false/)
  // ensure() only re-schedules an existing intent; it never raises one.
  assert.match(EFFECT, /if \(requested\) schedule\(\)/)
  assert.ok(!/requested = true/.test(EFFECT), 'no code path arms fullscreen without a tap')
  // The card going away forgets the intent (a new question starts collapsed).
  assert.match(EFFECT, /const clear = \(\): void => \{\n      requested = false/)
})

test('the effect re-measures on viewport episodes without reading layout per mutation', () => {
  for (const wiring of [
    /addEventListener\('resize', schedule\)/,
    /addEventListener\('orientationchange', schedule\)/,
    /visualViewport\?\.addEventListener\('resize', schedule\)/,
    /addEventListener\('focusin', schedule, true\)/,
    /addEventListener\('focusout', schedule, true\)/,
  ]) {
    assert.match(EFFECT, wiring)
  }
  // One coalesced measurement per frame; the IME animation is a resize storm.
  assert.match(EFFECT, /frame = requestAnimationFrame\(\(\) => \{/)
  // The measured facts come from the two published inline variables, so the CSS
  // and the decision cannot disagree about the band.
  assert.match(EFFECT, /const VISIBLE_VH_VAR = '--dsha-mobile-visible-vh'/)
  assert.match(EFFECT, /const HEADER_H_VAR = '--mobile-nav-header-h'/)
  assert.match(EFFECT, /document\.documentElement\.style\.getPropertyValue/)
  // The reconciler task re-injects after a host re-render and cleans up on dispose.
  assert.match(EFFECT, /name: 'question-fullscreen'/)
  assert.match(EFFECT, /scopes: \['\*'\]/)
  assert.match(EFFECT, /const removeTask = addReconcilerTask\(task\)/)
  // The answer field is scrolled by the card body only — never scrollIntoView
  // (that walks the conversation behind the card too). The doc blocks may NAME
  // the rejected API, so the assertion is on calls, not on the string.
  assert.ok(!/\.scrollIntoView\s*\(/.test(EFFECT))
  assert.ok(!/\.scrollIntoView\s*\(/.test(CORE))
  assert.match(EFFECT, /body\.scrollTop = next/)
  // The installer is registered next to the composer guards.
  assert.match(INDEX, /import \{ installQuestionFullscreen \} from '\.\/effects\/question-fullscreen\.ts'/)
  assert.match(INDEX, /installQuestionFullscreen\(ctx\)/)
})

test('the labels come from the plugin namespace, zh first and en mirrored', () => {
  assert.equal(zh.questionExpand, '展开回答')
  assert.equal(zh.questionCollapse, '收起回答')
  assert.equal(en.questionExpand, 'Expand answer')
  assert.equal(en.questionCollapse, 'Collapse answer')
})

test('the card body never scrolls sideways and the five text families can wrap', () => {
  // ① 真机截图里文字被横向滚过、左侧被截断：host 的 overflow-y:auto 把另一轴算成
  // auto，收掉横轴才是「不能左右滑」的唯一手段（不是把子节点一个个裁掉）。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const body = blocks.find(
    (block) => block.selector === '[data-mobile-nav="frame"] [class*="Mbwy4a_body"]',
  )
  assert.ok(body !== undefined, 'the card body rule is missing')
  assert.match(body.body, /overflow-x:\s*hidden !important/)
  assert.doesNotMatch(body.body, /overflow-x:\s*(auto|scroll)/)
  // The host only wraps the answer field; these five families had no fallback and
  // a long token / long English word pushed the body wider than the card.
  for (const fragment of ['Mbwy4a_title', 'Mbwy4a_detail', 'Mbwy4a_reviewNote', 'Mbwy4a_optionLabel', 'Mbwy4a_description']) {
    const rule = blocks.find(
      (block) => block.selector.includes(`[class*="${fragment}"]`) && block.body.includes('overflow-wrap: anywhere'),
    )
    assert.ok(rule !== undefined, `${fragment} has no overflow-wrap fallback`)
    assert.ok(rule.selector.includes('[data-mobile-nav="frame"]'), `${fragment} rule left the frame scope`)
  }
  // The two flex items inside _optionLine must be able to shrink to content.
  const shrinkable = blocks.find(
    (block) => block.selector.includes('[class*="Mbwy4a_optionLabel"]') &&
      block.selector.includes('[class*="Mbwy4a_description"]'),
  )
  assert.ok(shrinkable !== undefined)
  assert.match(shrinkable.body, /min-width:\s*0/)
  // Hash anchors are substring anchors only (pitfalls §哈希子串).
  const questionBlocks = blocks.filter((block) => block.selector.includes('Mbwy4a_'))
  assert.ok(questionBlocks.length >= 8)
  for (const block of questionBlocks) {
    assert.ok(!/\[class\$=/.test(block.selector), `attribute-suffix anchor: ${block.selector}`)
  }
})

/** Body of the first `@media` block whose prelude starts with `prelude` and whose
 *  own text contains `needle`; null when there is no such block. Brace-matching
 *  instead of a regex: the rules inside these blocks move around, and a guard
 *  that depends on "this rule happens to be first" rots on the next insertion. */
function mediaBlock(css: string, prelude: string, needle: string): string | null {
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
          const body = css.slice(open + 1, i)
          if (body.includes(needle)) return body
          break
        }
      }
    }
    from = at + prelude.length
  }
  return null
}

test('the phone column widths follow the host clearance token, not a second gutter', () => {
  // ② 实测：卡宽 293 / 屏 360，正文列 253~263（≈70%）。手机档把 _frame 多吃的
  // 16px 还回去（对齐 composer 卡：宿主 uV2eYG_root 的 padding 就是 clearance），
  // header 收到 12/8。
  const phone = mediaBlock(LAYOUT_CSS, '@media (max-width: 767px) and (pointer: coarse) {', 'Mbwy4a_frame')
  assert.ok(phone !== null, 'the phone-width block must carry the question card rules')
  const frameBody = /\[data-mobile-nav="frame"\] \[class\*="Mbwy4a_frame"\] \{([^}]*)\}/.exec(phone)?.[1] ?? ''
  assert.match(frameBody, /padding-left:\s*var\(--dsh-composer-side-clearance, 16px\)/)
  assert.match(frameBody, /padding-right:\s*var\(--dsh-composer-side-clearance, 16px\)/)
  // No magic second gutter, and never below the host clearance (the top-bar
  // corner buttons and the drawer columns live in that gutter).
  assert.doesNotMatch(frameBody, /\+\s*16px/)

  const headerBody = /\[data-mobile-nav="frame"\] \[class\*="Mbwy4a_header"\]:not\(\[class\*="Mbwy4a_headerActions"\]\) \{([^}]*)\}/.exec(phone)?.[1] ?? ''
  assert.match(headerBody, /padding:\s*10px 8px 0 12px !important/)
  // "Mbwy4a_header" is a prefix of "Mbwy4a_headerActions": without the :not guard
  // the action row would take the header's padding too (pitfalls §哈希子串).
  // Every rule that anchors on the bare _header fragment must carry the guard —
  // including rules a later author adds.
  const guarded = findRuleBlocks(LAYOUT_CSS).filter((block) =>
    block.selector.includes('[class*="Mbwy4a_header"]:not([class*="Mbwy4a_headerActions"])'),
  )
  assert.ok(guarded.length >= 1, 'the guarded header rule is missing')
  const offenders = findRuleBlocks(LAYOUT_CSS).filter((block) =>
    /\[class\*="Mbwy4a_header"\](?!:not\(\[class\*="Mbwy4a_headerActions"\]\))/.test(block.selector),
  )
  assert.deepEqual(offenders.map((block) => block.selector), [], 'a bare _header anchor would hit _headerActions')
})

test('the question column owns the whole card width, the action row floats above it', () => {
  // 2026-10-25 owner 二次反馈（「你提的问题右边有一大片留白」）：动作行原本是 flex
  // 同排项，三颗 24px 图标 + gap 合计 ≈96px 从每一行正文里永久扣掉；改成动作行
  // 绝对定位、headingBlock 吃满整行后，正文列不再被图标列挤窄。二批把 gap 从 6
  // 放到 20（44px 热区要求中心距 ≥44），整排变 112px —— 仍然只占卡头第一行。
  const phone = mediaBlock(LAYOUT_CSS, '@media (max-width: 767px) and (pointer: coarse) {', 'Mbwy4a_frame')
  assert.ok(phone !== null, 'the phone-width block must carry the question card rules')

  const actions = findRuleBlocks(phone).find(
    (block) => block.selector.includes('Mbwy4a_headerActions') && !block.selector.includes(':not('),
  )
  assert.ok(actions !== undefined, 'the floating action row rule is missing')
  assert.match(actions.body, /position:\s*absolute/)
  assert.match(actions.body, /top:\s*10px/)
  assert.match(actions.body, /right:\s*6px/)
  assert.match(actions.body, /gap:\s*20px !important/)

  // 三颗图标（宿主收起 / 宿主关闭 / 注入的展开）统一 44×44 命中盒：24px 可见
  // 图标 + 两侧各 10px 透明 ::after；相邻中心距 = 24 + 20 = 44，热区刚好相接。
  // 动作行 top:10 让热区顶边落在卡内（_card 是 overflow:hidden，6 − 10 会被裁）。
  const hostHit = findRuleBlocks(phone).find(
    (block) => block.selector.includes('Mbwy4a_iconButton') && block.selector.includes('::after'),
  )
  assert.ok(hostHit !== undefined, 'the 44px hit area for the host icon buttons is missing')
  assert.match(hostHit.body, /inset:\s*-10px/)
  assert.ok(hostHit.selector.includes('Mbwy4a_headerActions'), 'the hit area must be scoped to the action row')
  const expandHit = findRuleBlocks(LAYOUT_CSS).find(
    (block) => block.selector.includes('[data-mobile-nav="question-expand"]') && block.selector.includes('::after'),
  )
  assert.ok(expandHit !== undefined, 'the 44px hit area for the injected expand button is missing')
  assert.match(expandHit.body, /inset:\s*-10px/)

  const heading = findRuleBlocks(phone).find((block) => block.selector.includes('Mbwy4a_headingBlock'))
  assert.ok(heading !== undefined, 'the full-width heading rule is missing')
  assert.match(heading.body, /flex:\s*1 1 100%/)
  assert.match(heading.body, /min-width:\s*0/)

  // The eyebrow is the only row that still has to dodge the icons; the question
  // body starts below them (padding-top) and is never narrowed.
  const divider = findRuleBlocks(phone).find(
    (block) =>
      block.selector.includes('Mbwy4a_header') &&
      block.selector.includes('::after') &&
      block.selector.includes(':not([class*="Mbwy4a_headerActions"])'),
  )
  assert.ok(divider !== undefined, 'the question/options divider is missing')
  assert.match(divider.body, /height:\s*0\.5px/)
  assert.match(divider.body, /background:\s*var\(--dsw-alias-border-l2/)
  assert.match(divider.body, /opacity:\s*0\.55/)
  assert.ok(divider.selector.includes('::after'), 'the hairline must be a pseudo element, not a border')
  assert.ok(divider.selector.includes(':not([class*="Mbwy4a_headerActions"])'), 'the divider must not hit the action row')

  const eyebrow = findRuleBlocks(phone).find((block) => block.selector.includes('Mbwy4a_eyebrow'))
  assert.ok(eyebrow !== undefined, 'the eyebrow dodge rule is missing')
  assert.match(eyebrow.body, /margin-right:\s*116px/)

  const title = findRuleBlocks(phone).find((block) => block.selector.includes('Mbwy4a_title'))
  assert.ok(title !== undefined, 'the body typography rule is missing')
  assert.match(title.body, /font-size:\s*15px/)
  assert.match(title.body, /line-height:\s*23px/)
  assert.match(title.body, /padding-top:\s*2px/)
  // 超长问题不得把卡头撑满整张卡：正文自己封顶并内部滚动（与选项区同族）。
  assert.match(title.body, /max-height:\s*min\(23vh, 155px\)/)
  assert.match(title.body, /overflow-y:\s*auto/)
  assert.match(title.body, /overscroll-behavior:\s*contain/)
  assert.match(title.body, /touch-action:\s*pan-y pinch-zoom/)

  // Markdown paragraphs get a real paragraph gap, and the last one does not
  // leave a tail gap above the options.
  const detailPara = findRuleBlocks(phone).find((block) => block.selector.includes('Mbwy4a_detail') && block.selector.includes(' p'))
  assert.ok(detailPara !== undefined, 'the paragraph spacing rule is missing')
  assert.match(detailPara.body, /margin:\s*0 0 8px/)
  const lastPara = findRuleBlocks(phone).find((block) => block.selector.includes('Mbwy4a_detail') && block.selector.includes(':last-child'))
  assert.ok(lastPara !== undefined, 'the last-paragraph reset is missing')
  assert.match(lastPara.body, /margin-bottom:\s*0/)
})

test('the fullscreen band is derived from the two published variables and fails open', () => {
  // ③ 全屏态：可见带（键盘会缩）+ 顶栏底 + 实测 reserve，三个量都不写死 px。
  const bandRule = findRuleBlocks(LAYOUT_CSS).find((block) =>
    block.selector.includes('--dsha-mobile-question-band') ||
    (block.selector.includes('[data-mobile-nav-question-full]') && block.body.includes('--dsha-mobile-question-band')),
  )
  assert.ok(bandRule !== undefined, 'the band variable rule is missing')
  assert.ok(bandRule.body.includes('var(--dsha-mobile-visible-vh)'))
  assert.ok(bandRule.body.includes('var(--mobile-nav-header-h)'))
  assert.ok(bandRule.body.includes('var(--dsha-mobile-question-reserve, 0px)'))
  // Never the keyboard-less card variable: that one must NOT shrink with the IME.
  assert.ok(!LAYOUT_CSS.includes('--dsh-web-mobile-vh) - var(--mobile-nav-header-h)'))

  const cardRule = findRuleBlocks(LAYOUT_CSS).find(
    (block) => block.selector.includes('Mbwy4a_card') && block.selector.includes('[data-mobile-nav-question-full]'),
  )
  assert.ok(cardRule !== undefined, 'the fullscreen card rule is missing')
  assert.match(cardRule.body, /height:\s*var\(--dsha-mobile-question-band, auto\)/)
  assert.match(cardRule.body, /max-height:\s*var\(--dsha-mobile-question-band, min\(60vh, 520px\)\)/)
  // The host's own minimized state keeps winning: the chevron still folds the card.
  assert.match(cardRule.selector, /:not\(\[class\*="Mbwy4a_cardMinimized"\]\)/)
  // Gated on the plugin frame AND our marker, not on a device query.
  assert.match(cardRule.selector, /^\[data-mobile-nav="frame"\]\[data-mobile-nav-question-full\]/)
  // The layers stay orthogonal: fullscreen never touches stacking.
  assert.ok(!/z-index/.test(cardRule.body))
  assert.ok(!cardRule.selector.includes('composer-tight'))
})

test('fullscreen and the #245 tight state can be on at the same time', () => {
  // 两条规则都挂在同一个 frame 上、各读自己的标记：没有任何一条 :not 掉对方。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const full = blocks.filter((block) => block.selector.includes('data-mobile-nav-question-full'))
  const tight = blocks.filter((block) => block.selector.includes('data-mobile-nav-composer-tight'))
  assert.ok(full.length >= 2 && tight.length >= 2)
  for (const block of full) assert.ok(!block.selector.includes('composer-tight'))
  for (const block of tight) assert.ok(!block.selector.includes('question-full'))
  // The tight state's stacking contract is untouched by this feature: the seat
  // still outranks the opaque header (its z-index 30 lives in the shared block).
  const header = blocks.find((block) => block.selector === '[data-mobile-nav="frame"] [data-phase] header.wSkVaW_header')
  const seat = blocks.find((block) => block.selector.includes('[data-mobile-nav-composer-tight] [class*="_composerSeat"]'))
  assert.ok(header !== undefined && seat !== undefined)
  const headerZ = Number(header.body.match(/z-index:\s*(\d+)/)?.[1])
  const seatZ = Number(seat.body.match(/z-index:\s*(\d+)/)?.[1])
  assert.ok(Number.isFinite(headerZ) && Number.isFinite(seatZ))
  assert.ok(seatZ > headerZ, `the tight seat (${seatZ}) must clear the header (${headerZ})`)
  // …and the tight block never resizes the question card (that is this feature's
  // job, from the visible band).
  for (const block of tight) {
    assert.ok(!block.selector.includes('Mbwy4a_card'), 'the tight block must not size the card')
  }
})

test('the injected control is hidden outside the mobile branch', () => {
  // pitfalls §断点与设备: every data-mobile-nav control must be in the desktop
  // hide block, as the last line of defence for a dispose race.
  assert.ok(MISC_CSS.includes('[data-mobile-nav="question-expand"]'))
  const hide = /@media \(min-width: 1024px\), \(pointer: fine\), \(pointer: none\) \{([\s\S]*?)\n\}/.exec(MISC_CSS)
  assert.ok(hide !== null)
  assert.match(hide[1] ?? '', /\[data-mobile-nav="question-expand"\]/)
})

test('the patch is registered (four fields + a real test file)', () => {
  assert.match(LAYOUT_CSS, /@patch[\s\S]*?id: ask-question-card-phone/)
  assert.match(LAYOUT_CSS, /for: [^\n]+/)
  assert.match(LAYOUT_CSS, /why: [^\n]+/)
  assert.match(LAYOUT_CSS, /until: [^\n]+/)
  assert.match(LAYOUT_CSS, /test: tests\/question-fullscreen\.test\.ts/)
  // The pure core must stay DOM-free (architecture R4): no document/window.
  assert.doesNotMatch(CORE, /\b(document|window|HTMLElement)\b/)
})

test('the effect stays inside the architecture line budget', () => {
  // tests/architecture.test.ts enforces the same 400-line ceiling; failing here
  // points at the module that has to be split instead of at the whole ledger.
  assert.ok(EFFECT.split('\n').length <= 400)
})

// ---- ③ 滚动掉帧的插件侧归因（docs/maintenance/pitfalls.md §提问卡全屏） ----
// 逐条证实/证伪的结论都写在那边；这里钉住两条能静态证明的部分，避免以后有人
// 往卡片/座位上补一个模糊层或一个滚动监听，把「归因在宿主/平台」的结论悄悄推翻。

test('no plugin rule puts a paint-heavy layer on the card or the composer seat', () => {
  // 卡片自己滚的是 Mbwy4a_body，任何落在它或它的祖先（座位）上的
  // backdrop-filter / filter / will-change 都会让每一帧滚动重新裁剪/重绘。
  // 真机掉帧归因要求「不许猜」，所以这条是**可证伪**的：本插件四张样式表里能
  // 命中 Mbwy4a_ 家族或 _composerSeat 的规则，一条都不许声明这些属性。
  const HEAVY = /(?:^|;)\s*(?:-webkit-)?(?:backdrop-filter|filter|will-change|box-shadow)\s*:/
  const blocks = [LAYOUT_CSS, BASE_CSS, MISC_CSS, COMPAT_CSS].flatMap(findRuleBlocks)
  const cardAndSeat = blocks.filter((block) => /Mbwy4a_|composerSeat/.test(block.selector))
  assert.ok(cardAndSeat.length >= 5, 'expected the measured card/seat rule family')
  const offenders = cardAndSeat.filter((block) => HEAVY.test(block.body)).map((block) => block.selector)
  assert.deepEqual(offenders, [], 'a paint-heavy layer on the scrolling card was added')
})

test('the fullscreen effect adds no scroll listener and no per-frame work', () => {
  // 滚动本身不产生 MutationRecord，所以全树 reconciler 不会被卡片滚动唤醒；
  // 本效果也不许自己挂滚动监听（量只在视口事件/聚焦/点击这几个 episode 上跑）。
  assert.ok(!/addEventListener\('scroll'/.test(EFFECT), 'the effect must not listen to scroll')
  assert.ok(!/visualViewport\?\.addEventListener\('scroll'/.test(EFFECT))
  // 唯一允许在滚动路径上的插件代码是 model-menu-anchor 的 document 捕获监听，
  // 且它在菜单关着时零查询（见该文件头「成本」两轮优化）。
  assert.ok(!/addEventListener\('touchmove'/.test(EFFECT))
})
