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
  RENAME_MENU_WAIT_MS,
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

// 2026-10 会话行长按改名：500ms → 2000ms（防误触）→ 500ms + 32px 容差（2026-10-07
// 真浏览器实测：2s 保持期内手指漂移 20px 就被 14px 容差静默取消，且 1.7s 松手什么都不发生
// ⇒「长按没反应」）。钉住：时长与移动阈值常量、进度时长纯函数、进度可见性、
// data-mobile-nav-press 标记与内联时长变量在 clearPress 路径被移除、
// pointercancel / contextmenu 处理、以及 base.css.ts 里只在移动 + hover:none 块内生效的样式。

test('长按改名时长 500ms（店主验证过能用的值），移动取消阈值 32px 且高于滑动层 8px 锁轴', () => {
  assert.equal(LONG_PRESS_MS, 500)
  assert.equal(LONG_PRESS_MOVE_PX, 32)
  const lock = SWIPE.match(/const LOCK_PX = (\d+)/)
  assert.ok(lock, 'LOCK_PX not found in sidebar-swipe.ts')
  // The swipe layer must lock (and isStrokeLocked cancel the press) first.
  assert.ok(Number(lock[1]) < LONG_PRESS_MOVE_PX)
  assert.match(bodyOf('onDrawerPointerMove'), /isStrokeLocked\(\)[\s\S]*clearPress\(\)/)
})

test('进度时长 = 剩余按住时间，且从不为负', () => {
  assert.equal(longPressFillMs(LONG_PRESS_MS, LONG_PRESS_FILL_DELAY_MS), 300)
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
  // system long-press event — see the test below), and goes through the
  // host's own ⋯ → 「重命名」 entry (see the menu-path tests at the end).
  const fire = bodyOf('firePress')
  assert.match(fire, /unmarkPressRow\(row\)[\s\S]*openRename\(row\)[\s\S]*afterFire\(row\)/)
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

// 2026-10-07 真机定位（DSHA WebView + 宿主 0.2.0-rc.2）：长按改名的主路径改成
// 走宿主自己的入口 —— 点该行的 ⋯ 触发点 → 点门户菜单里的「重命名」。旧实现给
// 标题重放 dblclick，真机上到不了宿主的 onDoubleClick：扫光走满、什么都不弹；
// 而手点同一行 ⋯ → 重命名每次都开（真机逐项验证）。下面把主路径、菜单判别与
// 点击吞击的绕行钉住，重放只剩兜底。

test('长按改名主路径 = 点该行 ⋯ → 点宿主菜单里的「重命名」', () => {
  assert.ok(RENAME_MENU_WAIT_MS > 0 && RENAME_MENU_WAIT_MS <= 1000)
  const open = bodyOf('openRename')
  assert.match(open, /querySelector<HTMLButtonElement>\('\[class\*="_rowActions"\] button'\)/)
  assert.match(open, /clickHost\(button\)/)
  assert.match(open, /sessionRenameItem\(\)/)
  assert.match(open, /clickHost\(item\)/)
  // 门户是异步挂载：等它出现，且有上限。
  assert.match(open, /renameMenuTimer = window\.setTimeout\(settle, RENAME_MENU_POLL_MS\)/)
  assert.match(open, /performance\.now\(\) < deadline/)
  // 行里没有 ⋯、或菜单始终没出现 → 仍退回重放，长按不是死手势。
  assert.match(open, /requestRowRename\(row\)/)
  // 触发链路不再有一次性 openRowMenu。
  assert.equal(CHROME.includes('openRowMenu'), false)
})

test('菜单靠判别三标签认出（rename + fork + archiveSession）：别点错工作区改名', () => {
  const item = bodyOf('sessionRenameItem')
  assert.match(item, /workspaceT\('rename'\)/)
  assert.match(item, /workspaceT\('menu\.fork'\)/)
  assert.match(item, /workspaceT\('menu\.archiveSession'\)/)
  assert.match(item, /!labels\.includes\(rename\) \|\| !labels\.includes\(fork\) \|\| !labels\.includes\(archive\)\) continue/)
  // 跨代际读标签：rc.2 的 _itemLabel，0.1.5 直接读菜单项自身。
  assert.match(bodyOf('itemLabel'), /\[class\*="_itemLabel"\]/)
  // 字典缺席时绝不猜（宁可回退重放，也不点一个可能是别的动作的项）。
  assert.match(item, /if \(rename === '' \|\| fork === '' \|\| archive === ''\) return null/)
})

test('我们自己的点击不被长按吞击吃掉；抬手那一击仍然被吞', () => {
  const click = bodyOf('clickHost')
  assert.match(click, /swallowClickUntil = 0/)
  assert.match(click, /swallowClickRow = null/)
  assert.match(click, /swallowClickAnyTarget = false/)
  assert.match(click, /element\.click\(\)/)
  assert.match(click, /swallowClickAnyTarget = any/)
  // 摘掉是「这一次同步 click」的事：afterFire 仍武装吞击，抬手那一击进不去。
  assert.match(bodyOf('afterFire'), /swallowClickAnyTarget = true/)
  assert.match(bodyOf('onDrawerPointerUp'), /afterFire\(pressedRow\)/)
})

test('等菜单的轮询有生命周期：新手势与效果卸载都清掉', () => {
  assert.match(CHROME, /let renameMenuTimer: number \| null = null/)
  assert.match(bodyOf('onDrawerPointerDown'), /clearTimeout\(renameMenuTimer\)/)
  const disposer = CHROME.slice(CHROME.indexOf('return () => {\n      disarmNav()'))
  assert.match(disposer, /clearTimeout\(renameMenuTimer\)/)
})

test('落地复核不再退回「只开菜单」：有改名框或菜单在场就不重复动作', () => {
  const settle = bodyOf('afterFire')
  assert.match(settle, /querySelector\('\[class\*="_renameInput"\]'\) !== null\) return/)
  assert.match(settle, /querySelector\('\[role="menu"\]'\) !== null\) return/)
  assert.match(settle, /openRename\(row\)/)
})
