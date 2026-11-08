// Drawer dim layer architecture (2026-11-08 真机「点空白关闭右侧变亮闪」).
//
// 设备合成器只在真机上闪：插件停用不闪；带 tasks 的 overlay 恢复闪；把暗层
// 交给 frame 伪元素 + 去掉遮罩的 button 语义后不闪。所以这里钉住三件事：
// 1) 暗层由 frame 的 ::after 画（同一棵绘制树，不新增全屏合成层）；
// 2) 遮罩元素只做命中目标：透明、无 role/aria、无动画；
// 3) 点遮罩关闭仍走共享的晚提交关闭（toggleSidebar → toggleDrawer），不新开路径。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')
const OVERLAY = readFileSync(join(ROOT, 'src/client/effects/overlay-backdrop-fab.ts'), 'utf8')
const DRAWER_CLOSE = readFileSync(join(ROOT, 'src/client/effects/drawer-close.ts'), 'utf8')

test('the drawer dim is painted by the frame ::after, not by a separate layer', () => {
  const at = BASE.indexOf('html [data-mobile-nav="frame"]::after')
  assert.notEqual(at, -1, 'frame ::after dim rule missing')
  const block = BASE.slice(at, BASE.indexOf('}', at))
  assert.match(block, /background: rgba\(0, 0, 0, \.45\)/, 'the dim colour lives on the ::after')
  assert.match(block, /pointer-events: none/, 'the ::after must not take hits (the catcher does)')
  assert.match(block, /opacity: 0/, 'closed state is fully transparent')
  assert.match(block, /transition: opacity/, 'geometry-static opacity fade')
  assert.match(BASE, /\[data-mobile-nav-dim="1"\]::after \{\n  opacity: 1;/, 'open state is fully dimmed')
})

test('the backdrop element is a transparent, role-less hit target with no animation', () => {
  const at = BASE.indexOf('[data-mobile-nav="backdrop"] {')
  assert.notEqual(at, -1, 'backdrop rule missing')
  const block = BASE.slice(at, BASE.indexOf('}', at))
  assert.match(block, /background: transparent/, 'the catcher must paint nothing')
  assert.match(block, /transition: none/, 'no animation on the hit target')
  assert.doesNotMatch(block, /!important/, 'no debt: the catcher has no competing declarations')

  assert.match(OVERLAY, /backdrop\.setAttribute\('aria-hidden', 'true'\)/, 'catcher stays out of the a11y tree')
  assert.doesNotMatch(OVERLAY, /backdrop\.setAttribute\('role'/, 'no interactive role on the full-screen catcher')
  assert.doesNotMatch(OVERLAY, /backdrop\.setAttribute\('aria-label'/, 'no label that makes it read as a button')
  assert.match(OVERLAY, /data-mobile-nav-dim/, 'the frame marker drives the ::after dim')
})

test('tapping the blank area still closes through the shared late-commit closer', () => {
  const at = DRAWER_CLOSE.indexOf("target.closest('[data-mobile-nav=\"backdrop\"]')")
  assert.notEqual(at, -1, 'backdrop tap path missing')
  const body = DRAWER_CLOSE.slice(at, at + 600)
  assert.match(body, /if \(drawerOpen\(\)\) toggleSidebar\(\)/, 'use the shared closer')
  assert.doesNotMatch(body, /ctx\.layout\.toggleSidebar\(\)/, 'the backdrop must not bypass toggleDrawer')
})
