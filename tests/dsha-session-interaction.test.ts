// 2026-09-22 会话行交互契约（群内统一）：单击 = 选中、双击 = 打开、长按 = 改会话名。
// 宿主把「改会话名」挂在会话行标题的 dblclick 上（workspace 的 onRenameRequest），
// 恰好和「双击 = 打开」撞同一个事件：双击会既打开会话又弹改名框。
// 这个文件把三环钉住，防止以后有人顺手把任一环改回去：
//   1) onDrawerDoubleClick 吞掉真实 dblclick，只放行我们自己派发的那一个；
//   2) 长按计时器走 openRename（宿主自己的 ⋯ → 「重命名」入口，2026-10-07 真机
//      定位：事件重放到不了宿主），给标题重放 dblclick 只剩兜底；
//   3) 移动样式把 _rowActions 常显——长按要能点到那个 ⋯，菜单不能失去触屏入口。
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

test('双击：真实 dblclick 被吞掉，只有我们派发的合成事件放行', () => {
  const swallow = bodyOf(CHROME, 'onDrawerDoubleClick')
  // Identity check first: without it our own long-press replay would be eaten too.
  assert.match(swallow, /syntheticDoubleClicks\.has\(event\)/)
  assert.match(swallow, /target\.closest\('\[class\*="sessionRow"\] \[class\*="_title"\]'\)/)
  assert.match(swallow, /event\.stopPropagation\(\)/)
  // The event object we dispatch ourselves is the only one marked in the WeakSet.
  assert.match(bodyOf(CHROME, 'requestRowRename'), /syntheticDoubleClicks\.add\(event\)/)
})

test('长按：改名走宿主自己的 ⋯ → 「重命名」入口，事件重放只作退路', () => {
  // 触发路径抽到 firePress（计时器与系统 contextmenu 共用）。
  const arming = bodyOf(CHROME, 'onDrawerPointerDown')
  assert.match(arming, /pressTimer = window\.setTimeout\(firePress, LONG_PRESS_MS\)/)
  // 2026-10-07 真机定位：主路径是 openRename（点 ⋯ → 点菜单里的「重命名」），
  // 因为给标题重放 dblclick 在真机 WebView 上到不了宿主的 onDoubleClick。
  assert.match(bodyOf(CHROME, 'firePress'), /openRename\(row\)/)
  assert.match(bodyOf(CHROME, 'openRename'), /clickHost\(button\)[\s\S]*sessionRenameItem\(\)[\s\S]*clickHost\(item\)/)
  // 退路仍是重放宿主自己的入口：标题的 dblclick，带身份标记派发。
  const rename = bodyOf(CHROME, 'requestRowRename')
  assert.match(rename, /new MouseEvent\('dblclick', \{ bubbles: true, cancelable: true, view: window \}\)/)
  assert.match(rename, /title\.dispatchEvent\(event\)/)
  assert.match(bodyOf(CHROME, 'openRename'), /requestRowRename\(row\)/)
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
