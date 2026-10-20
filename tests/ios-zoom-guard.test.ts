// iOS focus-zoom guard (#45): the engine predicate that gates the CSS floor,
// plus the stylesheet invariants the fix depends on. Both halves matter — the
// floor without the marker never applies, and the marker without pinch-zoom
// leaves a browser-applied zoom impossible to undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectIosWebKit } from '../src/client/platform/device.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'

test('detectIosWebKit: the feature probe alone identifies iOS WebKit', () => {
  const seen: string[] = []
  const supports = (condition: string): boolean => {
    seen.push(condition)
    return true
  }
  // A UA the plugin has never seen still counts when the probe answers yes.
  assert.equal(detectIosWebKit({ userAgent: 'Whatever/1.0', maxTouchPoints: 5 }, supports), true)
  assert.deepEqual(seen, ['(font: -apple-system-body) and (-webkit-touch-callout: none)'])
})

test('detectIosWebKit: UA fallback covers iPhone and Mac-UA iPadOS', () => {
  // Chromium answers false to the probe (measured), so the UA decides.
  const no = (): boolean => false
  assert.equal(detectIosWebKit({ userAgent: IPHONE, maxTouchPoints: 0 }, no), true)
  assert.equal(detectIosWebKit({ userAgent: IPADOS, maxTouchPoints: 5 }, no), true)
  // Desktop Safari sends the same UA as iPadOS 13+ but reports no touch.
  assert.equal(detectIosWebKit({ userAgent: IPADOS, maxTouchPoints: 0 }, no), false)
  assert.equal(detectIosWebKit({ userAgent: ANDROID, maxTouchPoints: 5 }, no), false)
})

test('detectIosWebKit: a missing or throwing CSS.supports never throws', () => {
  assert.equal(detectIosWebKit({ userAgent: ANDROID, maxTouchPoints: 5 }, null), false)
  assert.equal(detectIosWebKit({ userAgent: IPHONE, maxTouchPoints: 5 }, null), true)
  const throwing = (): boolean => {
    throw new Error('unsupported condition')
  }
  assert.equal(detectIosWebKit({ userAgent: ANDROID, maxTouchPoints: 5 }, throwing), false)
  assert.equal(detectIosWebKit({ userAgent: IPHONE, maxTouchPoints: 0 }, throwing), true)
})

test('the 16px floor is scoped to the iOS marker and to text-entry fields', () => {
  // Anchored on the declaration line, not on the marker name: the block
  // comment above the rule mentions the marker too.
  const rule = /\n  (html\[data-mobile-nav-ios\] textarea,[^{]*)\{\s*font-size: 16px !important;\s*\}/.exec(
    MISC_CSS,
  )?.[1]
  assert.ok(rule, 'the iOS font-size floor rule must exist')
  // Every selector in the group carries the marker: without it Android would
  // inherit bigger search boxes for no benefit.
  const selectors = rule
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  assert.ok(selectors.length >= 5)
  for (const selector of selectors) assert.match(selector, /^html\[data-mobile-nav-ios\] /)
  // The composer trio must move together or the caret drifts off the text.
  assert.ok(selectors.some((selector) => selector.endsWith('textarea')))
  assert.ok(selectors.some((selector) => selector.endsWith('[data-input-mirror]')))
  assert.ok(selectors.some((selector) => selector.endsWith('[data-input-backdrop]')))
  const inputSelector = selectors.find((selector) => selector.includes('input:not('))
  assert.ok(inputSelector)
  for (const type of ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']) {
    assert.ok(inputSelector.includes(':not([type="' + type + '"])'), 'input floor must skip type=' + type)
  }
  // select keeps its own size on purpose (28px composer access-mode control).
  assert.ok(!selectors.some((selector) => /\bselect\b/.test(selector)))
  // The editable branch must match the attribute, not the value "true": the
  // 0.1.2-rc.1 Lexical composer is a 14px contenteditable, and other hosts
  // ship plaintext-only or the bare attribute. Decorator nodes marked
  // contenteditable="false" stay excluded.
  const editable = selectors.find((selector) => selector.includes('[contenteditable'))
  assert.ok(editable)
  assert.equal(editable, 'html[data-mobile-nav-ios] [contenteditable]:not([contenteditable="false"])')
  // The floor lives inside the mobile branch, like every other mobile rule.
  assert.match(MISC_CSS, /^@media \(max-width: 1023px\) and \(pointer: coarse\) \{/)
  assert.ok(MISC_CSS.indexOf('data-mobile-nav-ios') < MISC_CSS.indexOf('@media (min-width: 1024px)'))
})

test('root and drawer keep pinch-zoom while still refusing horizontal pan', () => {
  const values = [...LAYOUT_CSS.matchAll(/touch-action: ([^;]+);/g)].map((match) => match[1])
  assert.ok(values.length >= 3)
  // The image lightbox is the ONE surface that deliberately opts out of browser
  // pan/zoom (its own gesture layer in effects/image-lightbox-zoom.ts owns the
  // image transform, and the dialog would otherwise pass the pinch on to the
  // page). Pin that value positively AND count it: any other touch-action:none
  // in the sheet would still break the #45 contract, so it is red.
  const lightboxBody = /\n  div\[role="dialog"\]\[aria-modal="true"\]:has\(> :first-child > img\) \{([\s\S]*?)\n  \}/.exec(LAYOUT_CSS)?.[1]
  assert.ok(lightboxBody, 'the image-lightbox full-bleed rule must exist')
  assert.match(lightboxBody, /touch-action: none !important;/, 'the lightbox layer must own its gestures')
  const noneValue = /^\s*none(?:\s*!important)?\s*$/
  const noneValues = values.filter((value) => noneValue.test(value))
  const lightboxNone = [...lightboxBody.matchAll(/touch-action: none !important;/g)].length
  assert.ok(lightboxNone >= 1, 'the lightbox rule must declare a deliberate touch-action:none')
  assert.equal(
    noneValues.length,
    lightboxNone,
    'touch-action:none is only allowed in the image-lightbox rule',
  )
  for (const value of values) {
    if (value.includes('pan-x')) continue // the stats strip opts into horizontal pan on purpose
    if (noneValue.test(value)) continue // the image lightbox, pinned above
    assert.match(value, /pinch-zoom/, 'a vertical-pan surface must still allow pinch-zoom')
  }
  const root = /\n  html,\n  body \{([\s\S]*?)\n  \}/.exec(LAYOUT_CSS)?.[1]
  assert.ok(root)
  assert.match(root, /touch-action: pan-y pinch-zoom !important;/)
  assert.match(root, /overscroll-behavior-x: none !important;/)
  // The gesture layer's own rule (the drawer subtree): touch-action intersects
  // down the ancestor chain, so a bare pan-y here would cancel the root grant.
  // Read whole and take the last declaration, the way a single rule resolves a
  // repeated property: the declaration stopped being the rule's first line when
  // the split rules were merged (2026-09-16), and asserting on that position
  // would make this guard fail on a pure reordering.
  const drawerBody = /\[data-mobile-nav="frame"\] > :first-child \{([\s\S]*?)\n  \}/.exec(LAYOUT_CSS)?.[1]
  assert.ok(drawerBody, 'the drawer column rule must exist')
  const drawer = [...drawerBody.matchAll(/touch-action: ([^;]+);/g)].at(-1)?.[1]
  assert.equal(drawer, 'pan-y pinch-zoom !important')
})

test('the iOS-gated 16px floor is never asserted from a non-iOS scene', () => {
  // C14（2026-10-13）：scripts/probes/file-viewer-probe.mjs 曾在 Chromium UA 下断言
  // dsfv-search-input === 16px，而那条 16px 是 html[data-mobile-nav-ios] 门控的
  // （misc.css.ts）—— 非 iOS 场景里它要么必红、要么只能被改成恒真。这里把边界钉住：
  // 断言这个门控值的探针必须自己带 iPhone UA 覆盖，否则就不该断言它。
  //
  // 判据一律读**去掉注释后的源码**：探针注释里专门写了「覆盖搬到 cdp-zoom-probe 去了，
  // 那边用 setUserAgentOverride」—— 按原文本判会让这条护栏恒真（返向变异时实测撞到过：
  // 把断言放回去仍然绿）。只剔除整行注释，不用「// 到行尾」的粗暴法，免得截断字符串里的
  // http:// 之类。
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const probe = stripComments(readFileSync(join(ROOT, 'scripts/probes/file-viewer-probe.mjs'), 'utf8'))
  const hasIosScene = /setUserAgentOverride/.test(probe)
  assert.ok(
    hasIosScene || !/search-input-16px/.test(probe),
    'iOS 门控的 16px 下限不能在非 iOS 场景断言：给该档补 iPhone UA，或删掉这条断言',
  )
  // 覆盖必须真的落在带 iPhone UA 的那支探针上（同一形状、同一门控）。
  const zoom = stripComments(readFileSync(join(ROOT, 'scripts/cdp-zoom-probe.mjs'), 'utf8'))
  assert.match(zoom, /setUserAgentOverride/, 'iOS 场景必须来自 UA 覆盖')
  assert.match(zoom, /dsfv-search-input/, 'iOS 档必须注入 dsfv 搜索框这个形状')
  assert.match(zoom, /B7 iOS 下同三个字段仍 >=16px/, '并真的断言 >=16px（否则覆盖是空的）')
  // 门控本身：16px 那条规则的每个选择器都带 iOS 标记（非 iOS 场景恒不命中）。
  // 必须锚在该规则自己的行首，否则切片从选择器中段开始（第一个元素变成半截
  // `dsfv-search-input"]`，这一步就退化成在测自己的切片）。
  const gatedRule = /\n  (html\[data-mobile-nav-ios\][^{]*dsfv[^{]*)\{/.exec(MISC_CSS)?.[1]
  assert.ok(gatedRule, 'dsfv 三件套的 iOS 门控规则必须存在')
  const selectors = gatedRule.split(',').map((part) => part.trim()).filter(Boolean)
  assert.ok(selectors.length >= 3, 'dsfv 三件套都要在门控规则里')
  for (const selector of selectors) assert.match(selector, /^html\[data-mobile-nav-ios\] /)
})
