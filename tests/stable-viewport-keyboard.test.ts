// 快捷键弹层「抽搐/闪」第二锚：卡片不许随软键盘改大小（2026-09-25，真机取证）。
//
// 真机实测（Android 16 WebView / adjustResize）：软键盘一唤起，布局视口 754 → 471，
// 而且 vh / svh / lvh / dvh 四个单位**一起吃这个变化**（四个都量到 471）——这台引擎上
// 没有任何 CSS 单位能躲开键盘。于是设置面板与快捷键弹层各随键盘缩一截：报障人在
// 「编辑快捷键」里点搜索框时看到的就是那一步（「又闪一下」）；上一版给 max-height 加
// .2s 过渡，只是把这一步变成 150ms 的慢动作抽搐（实测 600px → 447px 连续 6 档）。
//
// 破法：键盘只改高度不改宽度 ⇒ 维护一个「不含软键盘的视口高度」变量
// （--dsh-web-mobile-vh，只在高度变大或宽度变化时更新），两层卡片用它定高 →
// 键盘出现时卡片一动不动；够不着的内容用列表的键盘内边距补齐（改滚动内容、不改外框）。
//
// 本文件钉住这三半，任一半回退都红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LAYOUT = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')
const PHONE = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')

const VAR = 'var(--dsh-web-mobile-vh, 100dvh)'


test('phone-chrome maintains the keyboard-less viewport height', () => {
  // The exported name is the cross-file contract with layout.css.ts.
  assert.match(
    PHONE,
    /export const STABLE_VIEWPORT_VAR = '--dsh-web-mobile-vh'/,
    'STABLE_VIEWPORT_VAR must stay the single source of the property name',
  )
  assert.match(PHONE, /setProperty\(STABLE_VIEWPORT_VAR/, 'the variable must be written on the root')
  assert.match(PHONE, /removeProperty\(STABLE_VIEWPORT_VAR\)/, 'dispose must clear the variable')
  // Monotonic height + width-change rule: the keyboard only changes height, so a
  // plain "on resize, write innerHeight" would follow the keyboard and undo the fix.
  const at = PHONE.indexOf('const syncStableViewport')
  assert.notEqual(at, -1, 'syncStableViewport missing')
  const body = PHONE.slice(at, PHONE.indexOf('\n    }', at))
  assert.match(
    body,
    /stableVh === 0 \|\| height > stableVh \|\| width !== stableWidth/,
    'the update must be gated on growth or a width change',
  )
  assert.match(PHONE, /addEventListener\('resize', syncStableViewport\)/, 'must re-measure on resize')
  assert.match(PHONE, /removeEventListener\('resize', syncStableViewport\)/, 'dispose must unbind')
})

test('the two keyboard-facing cards size themselves off that variable', () => {
  // Settings sheet: its dvh line was the second of the two collapsing layers.
  const sheet = LAYOUT.indexOf('max-height: min(800px, calc(' + VAR + ' - 24px - env(safe-area-inset-top, 0px)));')
  assert.notEqual(sheet, -1, 'settings sheet must cap on the stable viewport height')
  // Shortcut modal card.
  const card = LAYOUT.indexOf('max-height: min(760px, calc(' + VAR + ' - 24px - env(safe-area-inset-top, 0px))) !important;')
  assert.notEqual(card, -1, 'shortcut card must cap on the stable viewport height')
  // No card may go back to a bare dvh cap: that reintroduces the collapse.
  assert.doesNotMatch(
    LAYOUT,
    /max-height: min\((?:800|760)px, calc\(100dvh/,
    'a bare 100dvh cap would collapse with the keyboard again',
  )
})

test('opening the shortcut modal never changes full-screen luminance', () => {
  // It opens only from the settings sheet, whose own mask already dims the page; a
  // second 0.24 scrim made the whole screen step 0.24 -> 0.42 on open — the reporter's
  // 「全屏闪」. Both the fade and the extra dim are gone.
  const at = LAYOUT.indexOf(':has(> [aria-modal="true"][data-shortcut-modal="shortcuts"]) > [class*="_mask"]::after')
  assert.notEqual(at, -1, 'the shortcut mask override is missing')
  const body = LAYOUT.slice(at, LAYOUT.indexOf('}', at))
  assert.match(body, /animation: none !important/, 'no opacity fade on the scrim')
  assert.match(body, /background: transparent !important/, 'no second dim layer')
})
