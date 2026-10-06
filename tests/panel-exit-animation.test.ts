// 面板进出动画（店主 2026-10-07 两轮报障：先「退出像掉帧、直接回聊天界面」，
// 再「空档有点久了，要像侧边栏那样从侧面滑出来、原路返回」）。
// 终态 = 冻结快照 + 立即切换：面板 clone 成插件自有的固定层滑回右侧（合成器跑，
// 主线程重挂会话时也不掉帧），切换不再等任何动画 ⇒ 不额外增加空档。
// 这组断言钉四件事：快照存在、提交在同一 tick、兜底一定能清理、CSS 配套与时长对齐。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXIT = readFileSync(join(ROOT, 'src/client/effects/panel-exit.ts'), 'utf8')
const CSS = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')

test('the outgoing panel is frozen into a snapshot and the swap happens on the same tick', () => {
  assert.match(EXIT, /const PANEL_GHOST_VALUE = 'panel-ghost'/)
  assert.match(EXIT, /ghost\.append\(panel\.cloneNode\(true\)\)/)
  assert.match(EXIT, /document\.body\.append\(ghost\)/)
  // 关键不变量：selectPanel() 紧跟其后，不挂在任何 animationend/回调里
  // （上一版「先动画后提交」把会话重挂推迟了 220ms，店主立刻感觉到空档）。
  assert.match(EXIT, /selectPanel\(\)\s*\n\s*cleanupTimer/)
  // 旧的「动真面板」标记必须彻底消失。
  assert.doesNotMatch(EXIT, /PANEL_LEAVING_ATTR/)
  assert.doesNotMatch(EXIT, /dsh-web-mobile-panel-out/)
})

test('a ghost layer can never be left covering the whole screen', () => {
  assert.match(EXIT, /const PANEL_GHOST_MS = 280/)
  assert.match(EXIT, /window\.setTimeout\(drop, PANEL_GHOST_MS \+ 120\)/)
  // 兜底与 animationend 两条路都走同一个幂等 drop。
  assert.match(EXIT, /if \(dropped\) return/)
  assert.match(EXIT, /ghost\.remove\(\)/)
})

test('cleanup drops leftover snapshots too', () => {
  assert.match(EXIT, /function cleanup\(\): void \{[\s\S]*?removeGhosts\(\)/)
  assert.match(EXIT, /function removeGhosts\(\): void \{/)
})

test('CSS: the panel slides in from the side, the snapshot slides back out at drawer length', () => {
  assert.match(CSS, /@keyframes dsh-web-mobile-panel-in \{\s*from \{ opacity: \.55; transform: translateX\(100%\); \}/)
  assert.match(CSS, /animation: dsh-web-mobile-panel-in \.28s/)
  assert.match(CSS, /@keyframes dsh-web-mobile-panel-ghost-out \{\s*to \{ opacity: \.72; transform: translateX\(100%\); \}/)
  assert.match(CSS, /\[data-mobile-nav="panel-ghost"\] \{\s*position: fixed;[\s\S]*?animation: dsh-web-mobile-panel-ghost-out \.28s/)
  // 快照必须不吃点击，否则它会挡住底下刚挂上来的会话。
  assert.match(CSS, /\[data-mobile-nav="panel-ghost"\] \{\s*position: fixed;[\s\S]*?pointer-events: none;/)
})

test('reduced-motion switches both panel animations off', () => {
  const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce) {\n    [data-mobile-nav="frame"]:has([class*="panelRow"]'))
  const head = block.slice(0, 700)
  assert.match(head, /\[data-mobile-nav="panel-ghost"\]/)
  assert.match(head, /animation: none !important/)
})
