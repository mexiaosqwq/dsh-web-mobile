// 快捷键弹层「抽搐/闪」修复锚（2026-09-25，真机取证）。
//
// 事实：插件的抽屉层叠带（遮罩 z1250 / 抽屉列 z1300）压过宿主弹层 portal 根
// （`body > div { position: fixed; z-index: 1000 }` 包住
// `[role="dialog"][aria-modal="true"]`）。popover band 里那条把根抬到 1400 的
// 兜底规则原本以「抽屉开着」为门，但 marker 与绘制在整个关闭过渡里是不一致的：
// 遮罩淡出 .2s、marker 翻转后 260ms 才移除，列 transform .28s，React 还要
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')
const PHONE = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')
const MENU = readFileSync(join(ROOT, 'src/client/effects/session-menu.ts'), 'utf8')

const bandStart = BASE.indexOf('popover band above the open drawer')
const bandEnd = BASE.indexOf('/* Floating fallback button', bandStart)
const band =
  bandStart !== -1 && bandEnd > bandStart ? BASE.slice(bandStart, bandEnd) : ''

const DRAWER_GATE = 'body:has([data-mobile-nav="frame"]:not([data-sidebar-collapsed]))'
const BACKDROP_GATE = 'body:has([data-mobile-nav="backdrop"])'

test('modal-root raise lives in the mobile popover band at the 1400 value', () => {
  const at = band.indexOf('> div:has(> [role="dialog"][aria-modal="true"])')
  assert.notEqual(at, -1, 'modal-root raise missing from the popover band')
  assert.match(
    band.slice(at, band.indexOf('}', at)),
    /z-index: 1400 !important/,
    'modal-root raise must stay at the 1400 band value',
  )
})

test('modal-root raise is gated on OUR BACKDROP, not on the drawer marker', () => {
  const at = band.indexOf('> div:has(> [role="dialog"][aria-modal="true"])')
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
  // transition (fade .2s + removal 260ms / column .28s / subtree swap ~200ms).
  assert.equal(
    band.lastIndexOf(DRAWER_GATE, at) > band.lastIndexOf(BACKDROP_GATE, at),
    false,
    'modal-root raise must NOT be gated on data-sidebar-collapsed',
  )
})

test('every non-gesture closer shares the one late-commit toggle', () => {
  // phone-chrome owns the shared helper and it must keep the late-commit shape.
  const helperAt = PHONE.indexOf('export function toggleDrawer(')
  assert.notEqual(helperAt, -1, 'toggleDrawer helper missing from phone-chrome.ts')
  assert.match(
    PHONE.slice(helperAt, PHONE.indexOf('\n}', helperAt)),
    /if \(!closeDrawerAnimated\(ctx\)\) ctx\.layout\.toggleSidebar\(\)/,
    'toggleDrawer must animate the close and only fall back to a plain toggle',
  )
  // The FAB's opener callback (createOverlayTask) is a closer once the drawer
  // is open: it must not bypass the helper.
  const overlayAt = PHONE.indexOf('createOverlayTask(t,')
  assert.notEqual(overlayAt, -1, 'createOverlayTask call missing')
  assert.match(
    PHONE.slice(overlayAt, PHONE.indexOf('\n', overlayAt)),
    /toggleDrawer\(ctx\)/,
    'createOverlayTask must receive toggleDrawer, not a raw toggleSidebar',
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
})
