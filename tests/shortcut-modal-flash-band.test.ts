// 快捷键弹层「抽搐/闪」修复锚（2026-09-25，真机取证）。
//
// 事实：插件的抽屉层叠带（遮罩 z1250 / 抽屉列 z1300）压过宿主弹层 portal 根
// （`body > div { position: fixed; z-index: 1000 }` 包住
// `[role="dialog"][aria-modal="true"]`）。popover band 里那条把根抬到 1400 的
// 兜底规则原本以「抽屉开着」为门，但 marker 与绘制在整个关闭过渡里是不一致的：
// 遮罩淡出 .28s、marker 翻转后 340ms 才移除，列 transform .28s，React 还要
// ~200ms 才换 pane 子树。于是那一整个窗口里抬升失效、抽屉带盖住弹层。
//
// 真机实测（Android 16 WebView，快捷键弹层开着）：人为加上
// data-sidebar-collapsed 后，根计算 z 1400 -> 1000，且
// elementsFromPoint(0.85w, .30h) 命中的最顶层元素变成
// [data-mobile-nav="backdrop"]；rgba(0,0,0,.45) 压在白底上 = 亮度 141，与报障
// 人录屏里量到的 140（抽屉右缘 280px 之后）一致。这就是「抽搐/闪」，不是合成撕裂。
//
// 本文件钉住修复的两半，任一半回退都红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sliceBand, ruleBodyAt, POPOVER_BAND_START, POPOVER_BAND_END } from './lib/css.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')
// P1 拆分（2026-10-12）：toggleDrawer 搬到 drawer-close.ts；createDrawerLayerTask 的
// 装配（registerReconcileTasks）第四片搬到 reconciler-adapter.ts，
// 所以三条断言各读各的文件（逐条钉住它真正所在的那一份）。
const ADAPTER = readFileSync(join(ROOT, 'src/client/effects/reconciler-adapter.ts'), 'utf8')
const DRAWER_CLOSE = readFileSync(join(ROOT, 'src/client/effects/drawer-close.ts'), 'utf8')
const MENU = readFileSync(join(ROOT, 'src/client/effects/session-menu.ts'), 'utf8')

const { start: bandStart, end: bandEnd, text: band } = sliceBand(
  BASE,
  POPOVER_BAND_START,
  POPOVER_BAND_END,
)

const DRAWER_GATE = 'body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed]))'
// 2026-11-08: the backdrop element is now a persistent, always-mounted hit
// target, so presence alone no longer means "on screen"; the gate keys on
// [data-active], which is set exactly while the dim is painted.
const BACKDROP_GATE = 'body:has([data-mobile-nav="backdrop"][data-active])'
const MODAL_ROOT = '> div:has(> [role="dialog"][aria-modal="true"])'

test('modal-root raise lives in the mobile popover band at the 1400 value', () => {
  assert.notEqual(bandStart, -1, 'popover band marker not found in base.css.ts')
  assert.ok(bandEnd > bandStart, 'popover band end marker not found')
  const at = band.indexOf(MODAL_ROOT)
  assert.notEqual(at, -1, 'modal-root raise missing from the popover band')
  assert.match(
    ruleBodyAt(band, MODAL_ROOT, at),
    /z-index: 1400 !important/,
    'modal-root raise must stay at the 1400 band value',
  )
})

test('modal-root raise is gated on the dim being active, not on the drawer marker', () => {
  const at = band.indexOf(MODAL_ROOT)
  assert.notEqual(at, -1, 'modal-root raise missing from the popover band')
  // The gate must belong to THIS rule: nothing may close a block between the
  // gate and the selector.
  assert.ok(
    band.lastIndexOf(BACKDROP_GATE, at) !== -1,
    'modal-root raise must be gated on the backdrop being on screen',
  )
  assert.doesNotMatch(
    band.slice(band.lastIndexOf(BACKDROP_GATE, at), at),
    /\}/,
    'backdrop gate must belong to the modal-root rule itself',
  )
  // The old marker gate is the regression: it goes dark for the whole close
  // transition (fade .28s + removal 340ms / column .28s / subtree swap ~200ms).
  assert.equal(
    band.lastIndexOf(DRAWER_GATE, at) > band.lastIndexOf(BACKDROP_GATE, at),
    false,
    'modal-root raise must NOT be gated on data-sidebar-collapsed',
  )
})

test('every non-gesture closer shares the one late-commit toggle', () => {
  // drawer-close.ts owns the shared helper (P1 拆分前在 phone-chrome.ts) and it
  // must keep the late-commit shape.
  const helperAt = DRAWER_CLOSE.indexOf('export function toggleDrawer(')
  assert.notEqual(helperAt, -1, 'toggleDrawer helper missing from drawer-close.ts')
  const helper = DRAWER_CLOSE.slice(helperAt, DRAWER_CLOSE.indexOf('\n}', helperAt))
  // Close first (animated, late commit); only when that declines does it open
  // (via the shared keyboard-release entry, drawer-jank R2) or plain-toggle.
  assert.match(helper, /^[^]*?if \(closeDrawerAnimated\(ctx\)\) return/, 'toggleDrawer must try the animated close first')
  assert.match(helper, /openDrawerAfterKeyboard\(\(\) => \{[^}]*ctx\.layout\.toggleSidebar\(\)/, 'the open branch must go through openDrawerAfterKeyboard')
  assert.ok(helper.indexOf('closeDrawerAnimated(ctx)') < helper.indexOf('openDrawerAfterKeyboard'), 'close decision precedes the open branch')
  // The FAB's opener callback (createDrawerLayerTask) is a closer once the drawer
  // is open: it must not bypass the helper.
  const layerAt = ADAPTER.indexOf('createDrawerLayerTask(t,')
  assert.notEqual(layerAt, -1, 'createDrawerLayerTask call missing')
  assert.match(
    ADAPTER.slice(layerAt, ADAPTER.indexOf('\n', layerAt)),
    /toggleDrawer\(ctx\)/,
    'createDrawerLayerTask must receive toggleDrawer, not a raw toggleSidebar',
  )
  // The session-delete follow-up is a closer on the mobile branch.
  assert.match(
    MENU,
    /if \(wasCurrent && window\.matchMedia\(MOBILE_QUERY\)\.matches\) toggleDrawer\(ctx\)/,
    'session-menu delete follow-up must route through toggleDrawer',
  )
  assert.doesNotMatch(
    MENU,
    /ctx\.layout\.toggleSidebar\(\)/,
    'session-menu must not toggle the drawer raw',
  )
  // The backdrop tap (drawer-close.ts capture handler) is a closer too: it must
  // go through the shared late-commit helper, never the raw host toggle.
  const tapAt = DRAWER_CLOSE.indexOf("target.closest('[data-mobile-nav=\"backdrop\"]')")
  assert.notEqual(tapAt, -1, 'backdrop tap path missing from drawer-close.ts')
  const tap = DRAWER_CLOSE.slice(tapAt, tapAt + 600)
  assert.match(tap, /if \(drawerOpen\(\)\) toggleSidebar\(\)/, 'backdrop tap must use the shared closer')
  assert.doesNotMatch(tap, /ctx\.layout\.toggleSidebar\(\)/, 'backdrop tap must not bypass toggleDrawer')
})
