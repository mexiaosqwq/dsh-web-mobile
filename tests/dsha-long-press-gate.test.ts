// #82: the DSHA tap-close exemption (data-dsha-session-select rows close on
// dsha-session-open, not on tap) was added inside shouldCloseOnTapInsideDrawer
// — a predicate that ALSO gates long-press arming (onDrawerPointerDown).
// One predicate, two questions: tap-close callers must skip DSHA rows, the
// arming gate must not, or the host's ⋯ row menu becomes unreachable on touch.
// This test pins the split: arming uses the exemption-free base, tap-close
// callers keep the exempt predicate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LONG_PRESS_FILL_DELAY_MS,
  LONG_PRESS_MOVE_PX,
  LONG_PRESS_MS,
  LONG_PRESS_SYSTEM_MS,
  longPressFillMs,
} from '../src/client/effects/phone-chrome.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')
const BASE = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')
const SWIPE = readFileSync(join(ROOT, 'src/client/effects/sidebar-swipe.ts'), 'utf8')

// Extract a top-level const arrow-function body inside installOverlayInteractions:
// from its declaration up to the next sibling — an exactly-4-space `const ` or
// `//` comment (sibling comments sit at 4 spaces; comments inside a body are
// indented with the body, so they never cut the window short).
const bodyOf = (name: string): string => {
  const start = CHROME.indexOf(`const ${name} = `)
  assert.notEqual(start, -1, `const ${name} not found in phone-chrome.ts`)
  const rest = CHROME.slice(start)
  const ends = ['\n    const ', '\n    // ']
    .map((marker) => rest.indexOf(marker, 1))
    .filter((index) => index !== -1)
  const next = ends.length > 0 ? Math.min(...ends) : -1
  return next === -1 ? rest : rest.slice(0, next)
}

test('#82: long-press arming gate is not routed through the DSHA-exempt predicate', () => {
  const arming = bodyOf('onDrawerPointerDown')
  // Fails on the pre-fix shape: the gate reused shouldCloseOnTapInsideDrawer,
  // whose DSHA early-return starved pressTimer on data-dsha-session-select rows.
  assert.doesNotMatch(arming, /shouldCloseOnTapInsideDrawer/)
  assert.match(arming, /isDrawerNavTarget\(target\)/)
  // The base predicate itself carries no DSHA exemption — if it creeps back
  // in, both callers collapse into the #82 bug again.
  assert.doesNotMatch(bodyOf('isDrawerNavTarget'), /data-dsha-session-select/)
})

test('#82: both tap-close callers keep the DSHA-exempt predicate', () => {
  // click (close on synthesized click) and pointerup (close/nav arming) must
  // still skip DSHA rows — single tap there only selects (DSHA_SESSION_
  // INTERACTION_V1), closing or navigating on it breaks double-tap-open.
  assert.match(bodyOf('onDrawerClick'), /shouldCloseOnTapInsideDrawer\(target\)/)
  assert.match(bodyOf('onDrawerPointerUp'), /shouldCloseOnTapInsideDrawer\(target\)/)
  // The exemption itself lives in exactly that predicate.
  assert.match(bodyOf('shouldCloseOnTapInsideDrawer'), /data-dsha-session-select/)
})

// 2026-10 会话行长按改名：500ms → 2000ms（防误触）→ 900ms + 32px 容差（2026-10-07
// 真浏览器实测：2s 保持期内手指漂移 20px 就被 14px 容差静默取消，且 1.7s 松手什么都不发生
// ⇒「长按没反应」）。钉住：时长与移动阈值常量、进度时长纯函数、进度可见性、
// data-mobile-nav-press 标记与内联时长变量在 clearPress 路径被移除、
// pointercancel / contextmenu 处理、以及 base.css.ts 里只在移动 + hover:none 块内生效的样式。

test('长按改名时长 900ms，移动取消阈值 32px 且高于滑动层 8px 锁轴', () => {
  assert.equal(LONG_PRESS_MS, 900)
  assert.equal(LONG_PRESS_MOVE_PX, 32)
  const lock = SWIPE.match(/const LOCK_PX = (\d+)/)
  assert.ok(lock, 'LOCK_PX not found in sidebar-swipe.ts')
  // The swipe layer must lock (and isStrokeLocked cancel the press) first.
  assert.ok(Number(lock[1]) < LONG_PRESS_MOVE_PX)
  assert.match(bodyOf('onDrawerPointerMove'), /isStrokeLocked\(\)[\s\S]*clearPress\(\)/)
})

test('进度时长 = 剩余按住时间，且从不为负', () => {
  assert.equal(longPressFillMs(LONG_PRESS_MS, LONG_PRESS_FILL_DELAY_MS), 700)
  assert.equal(longPressFillMs(200, 300), 0)
  assert.ok(LONG_PRESS_FILL_DELAY_MS > 0 && LONG_PRESS_FILL_DELAY_MS < LONG_PRESS_MS)
})

test('进度反馈必须看得见：currentColor 24%（不是宿主的 10% 底）', () => {
  const rule = BASE.slice(BASE.indexOf('[data-mobile-nav="frame"] [class*="_sessionRow"][data-mobile-nav-press="fill"]:not'))
  const filled = rule.slice(0, rule.indexOf('}'))
  assert.match(filled, /background: color-mix\(in srgb, currentColor 2[0-9]%, transparent\);/)
  assert.doesNotMatch(filled, /var\(--dsw-alias-interactive-bg-active/)
})

test('clearPress 移除行标记与内联时长变量，并清掉两个计时器', () => {
  const unmark = bodyOf('unmarkPressRow')
  assert.match(unmark, /removeAttribute\(PRESS_ATTR\)/)
  assert.match(unmark, /style\.removeProperty\(PRESS_MS_VAR\)/)
  const clear = bodyOf('clearPress')
  assert.match(clear, /clearTimeout\(pressTimer\)/)
  assert.match(clear, /clearTimeout\(pressFillTimer\)/)
  assert.match(clear, /unmarkPressRow\(pressRow\)/)
  assert.match(CHROME, /const PRESS_ATTR = 'data-mobile-nav-press'/)
})

test('武装、填充、触发三处写/删标记', () => {
  const down = bodyOf('onDrawerPointerDown')
  assert.match(down, /setAttribute\(PRESS_ATTR, 'armed'\)/)
  assert.match(down, /setProperty\(PRESS_MS_VAR/)
  assert.match(down, /setAttribute\(PRESS_ATTR, 'fill'\)/)
  assert.match(down, /LONG_PRESS_FILL_DELAY_MS\)/)
  assert.match(down, /pressTimer = window\.setTimeout\(firePress, LONG_PRESS_MS\)/)
  // Fire path unmarks before opening rename (now shared by the timer and the
  // system long-press event — see the test below).
  const fire = bodyOf('firePress')
  assert.match(fire, /unmarkPressRow\(row\)[\s\S]*requestRowRename\(row\)[\s\S]*openRowMenu\(row\)/)
})

test('系统长按（contextmenu）也能触发改名，而不是只等计时器', () => {
  // 真机实测：进度条走了却什么都没发生（最可能是系统随后接管手势取消计时器）。
  // Android 自己的长按事件（约 500ms）必须能直接触发同一条 firePress 路径。
  assert.equal(LONG_PRESS_SYSTEM_MS, 300)
  assert.ok(LONG_PRESS_SYSTEM_MS < LONG_PRESS_MS)
  const menu = bodyOf('onDrawerContextMenu')
  assert.match(menu, /performance\.now\(\) - pressStartedAt >= LONG_PRESS_SYSTEM_MS\) firePress\(\)/)
  assert.match(bodyOf('onDrawerPointerDown'), /pressStartedAt = performance\.now\(\)/)
  // contextmenu 仍然只在「计时中 + 按住的那一行」上拦截。
  assert.match(menu, /pressTimer === null \|\| pressRow === null\) return/)
  assert.match(menu, /pressRow\.contains\(target\)/)
})


test('pointercancel 与让位的 pointerup 都 clearPress；contextmenu 只在计时中、只在按住行上拦截', () => {
  assert.match(bodyOf('onDrawerPointerCancel'), /clearPress\(\)/)
  assert.match(CHROME, /addEventListener\('pointercancel', onDrawerPointerCancel, true\)/)
  assert.match(CHROME, /removeEventListener\('pointercancel', onDrawerPointerCancel, true\)/)
  const up = bodyOf('onDrawerPointerUp')
  assert.match(up, /consumeIfGestured\(event\)\) \{\s*(\/\/[^\n]*\s*)*clearPress\(\)\s*return/)
  const menu = bodyOf('onDrawerContextMenu')
  assert.match(menu, /pressTimer === null \|\| pressRow === null\) return/)
  assert.match(menu, /pressRow\.contains\(target\)/)
  assert.match(menu, /preventDefault\(\)/)
  assert.match(CHROME, /addEventListener\('contextmenu', onDrawerContextMenu, true\)/)
  assert.match(CHROME, /removeEventListener\('contextmenu', onDrawerContextMenu, true\)/)
})

test('base.css：触感与进度样式只在移动 + hover:none 块内，进度只动 transform', () => {
  const start = BASE.indexOf('/* ---------- touch press feedback')
  assert.notEqual(start, -1)
  const block = BASE.slice(start, BASE.indexOf('@keyframes dsh-web-mobile-press-fill', start))
  assert.match(block, /@media \(max-width: 1023px\) and \(pointer: coarse\) \{\n {2}@media \(hover: none\) \{/)
  assert.match(block, /-webkit-tap-highlight-color: transparent/)
  assert.match(block, /:where\(button, \[role="button"\]/)
  assert.match(block, /\[aria-selected="true"\], \[aria-pressed="true"\]/)
  assert.match(block, /\[data-mobile-nav-press\] \{\s*-webkit-touch-callout: none;\s*-webkit-user-select: none;\s*user-select: none;/)
  assert.match(block, /animation: dsh-web-mobile-press-fill var\(--mobile-nav-press-ms/)
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(BASE, /@keyframes dsh-web-mobile-press-fill \{\s*from \{ transform: scaleX\(0\); \}\s*to \{ transform: scaleX\(1\); \}/)
  // No pseudo-element/selector outside the mobile block touches the marker.
  assert.equal(BASE.slice(0, start).includes('data-mobile-nav-press'), false)
})
