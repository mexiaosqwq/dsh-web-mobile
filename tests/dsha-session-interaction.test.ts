// 2026-09-22 会话行交互契约（群内统一）：单击 = 选中、双击 = 打开、长按 = 改会话名。
// 宿主 0.1.7 把「改会话名」挂在会话行标题的 dblclick 上（workspace 的
// onRenameRequest），恰好和「双击 = 打开」撞同一个事件：双击会既打开会话又弹改名框。
// 这个文件把三环钉住，防止以后有人顺手把任一环改回去：
//   1) onDrawerDoubleClick 吞掉真实 dblclick，只放行我们自己派发的那一个；
//   2) 长按计时器走 requestRowRename，只有拿不到标题时才退回 ⋯ 菜单；
//   3) 移动样式把 _rowActions 常显——长按不再开 ⋯ 菜单，菜单不能因此失去触屏入口。
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

test('长按：改名优先，⋯ 菜单只作拿不到标题时的退路', () => {
  // 触发路径抽到 firePress（计时器与系统 contextmenu 共用），退路照旧。
  const arming = bodyOf(CHROME, 'onDrawerPointerDown')
  assert.match(arming, /pressTimer = window\.setTimeout\(firePress, LONG_PRESS_MS\)/)
  assert.match(bodyOf(CHROME, 'firePress'), /if \(!requestRowRename\(row\)\) openRowMenu\(row\)/)
  // Rename replays the host's own entry point instead of forking the dialog:
  // the title's dblclick, dispatched with the identity mark set.
  const rename = bodyOf(CHROME, 'requestRowRename')
  assert.match(rename, /new MouseEvent\('dblclick', \{ bubbles: true, cancelable: true, view: window \}\)/)
  assert.match(rename, /title\.dispatchEvent\(event\)/)
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
