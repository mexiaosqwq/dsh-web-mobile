// 2026-09-22 会话行交互契约（群内统一）：单击 = 选中、双击 = 打开。
// 宿主把「改会话名」挂在会话行标题的 dblclick 上（workspace 的 onRenameRequest），
// 恰好和「双击 = 打开」撞同一个事件：双击会既打开会话又弹改名框。改名本身走那一行
// 常显的 ⋯ 菜单（长按改名已于 2026-10-07 下线，见 session-row-longpress-removed）。
// 这个文件把三环钉住，防止以后有人顺手把任一环改回去：
//   1) onDrawerDoubleClick 吞掉真实 dblclick（只吞 trusted 事件）；
//   2) 长按不再武装任何手势 —— pointerdown 只记录触摸起点；
//   3) 移动样式把 _rowActions 常显 —— 重命名/归档/分叉必须留在触屏入口上。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')
const LAYOUT_CSS = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')

// Same extraction as dsha-long-press-gate.test.ts: a top-level const arrow body
// inside installOverlayInteractions, cut at the next sibling — an exactly-4-space
// `const ` or `//` comment.
const bodyOf = (source: string, name: string): string => {
  const start = source.indexOf(`const ${name} = `)
  assert.notEqual(start, -1, `const ${name} not found in phone-chrome.ts`)
  const rest = source.slice(start)
  const ends = ['\n    const ', '\n    // ']
    .map((marker) => rest.indexOf(marker, 1))
    .filter((index) => index !== -1)
  const next = ends.length > 0 ? Math.min(...ends) : -1
  return next === -1 ? rest : rest.slice(0, next)
}

test('双击：真实 dblclick 被吞掉（只吞 trusted），不会连带弹出宿主改名框', () => {
  const swallow = bodyOf(CHROME, 'onDrawerDoubleClick')
  // 长按下线后本插件不再派发任何合成 dblclick，所以判据回到 isTrusted：
  // 真实双击（= 打开会话）的那一下不会走到标题的 onDoubleClick。
  assert.match(swallow, /if \(!event\.isTrusted\) return/)
  assert.match(swallow, /target\.closest\('\[class\*="sessionRow"\] \[class\*="_title"\]'\)/)
  assert.match(swallow, /event\.preventDefault\(\)/)
  assert.match(swallow, /event\.stopPropagation\(\)/)
  assert.equal(CHROME.includes('syntheticDoubleClicks'), false)
})

test('长按不再是交互：改名只走常显的 ⋯ 菜单，pointerdown 不再武装手势', () => {
  // 2026-10-07 店主拍板：长按改名整体下线（它依赖的标题 dblclick 重放在真机
  // WebView 上到不了宿主）。pointerdown 只留触摸起点记录，供点行导航兜底。
  const down = bodyOf(CHROME, 'onDrawerPointerDown')
  assert.match(down, /touchDownAt = event\.pointerType/)
  assert.doesNotMatch(down, /setTimeout/)
  assert.equal(CHROME.includes('requestRowRename'), false)
  assert.equal(CHROME.includes('LONG_PRESS_MS'), false)
  // 重命名的入口 = 常显的 ⋯ 菜单（layout.css），一步可达。
  assert.match(
    readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8'),
    /\[class\*="_rowActions"\] \{\s*display: inline-flex !important;/,
  )
})

test('双击拦截挂在 document 捕获阶段（React 根容器之前）', () => {
  assert.match(CHROME, /document\.addEventListener\('dblclick', onDrawerDoubleClick, true\)/)
  assert.match(CHROME, /document\.removeEventListener\('dblclick', onDrawerDoubleClick, true\)/)
})

test('长按改义后，⋯ 菜单在触屏仍可达（_rowActions 常显）', () => {
  assert.match(
    LAYOUT_CSS,
    /\[data-mobile-nav="frame"\] \[class\*="sessionRow"\] \[class\*="_rowActions"\] \{\s*display: inline-flex !important;/,
  )
})
