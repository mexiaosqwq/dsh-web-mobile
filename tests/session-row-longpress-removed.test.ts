// 2026-10-07：会话行长按改名**整体下线**（店主拍板）。
//
// 背景：这条交互最终依赖「给会话行标题重放 dblclick」，而真机 WebView 上那个事件
// 到不了宿主的 onDoubleClick —— 长按只有扫光、改名框永远不出现；阈值 2s→900→500ms
// 与 contextmenu / pointercancel 兜底的几轮调整都落在断掉的这条路上。改走宿主自己的
// ⋯ → 「重命名」也因长按在真机上难以可靠复现而收手，店主决定不再折腾。
//
// 本文件钉住三件事，防止这条链路被顺手加回来：
//   1) phone-chrome.ts 里不再有长按计时器 / 进度标记 / dblclick 重放 / press 监听；
//   2) 真实 dblclick 仍被吞掉（否则「双击 = 打开」会连带弹出宿主的改名框）；
//   3) ⋯ 菜单在触屏常显 —— 重命名仍有一步可达的入口。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = readFileSync(join(ROOT, 'src/client/effects/phone-chrome.ts'), 'utf8')
const BASE = readFileSync(join(ROOT, 'src/client/styles/base.css.ts'), 'utf8')
const LAYOUT = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')

test('长按机制已下线：没有计时器、进度标记、事件重放与 press 监听', () => {
  for (const needle of [
    'LONG_PRESS_MS',
    'LONG_PRESS_SYSTEM_MS',
    'RENAME_MENU_WAIT_MS',
    'data-mobile-nav-press',
    'firePress',
    'requestRowRename',
    'openRename',
    'pressTimer',
    'afterFire',
    'onDrawerPointerCancel',
    'onDrawerContextMenu',
  ]) {
    assert.equal(CHROME.includes(needle), false, `${needle} 仍在 phone-chrome.ts 里`)
  }
  // 只留下「触摸起点」记录：pointerdown 不再武装任何手势、不再起计时器。
  const down = CHROME.slice(
    CHROME.indexOf('const onDrawerPointerDown'),
    CHROME.indexOf('const onDrawerClick'),
  )
  assert.match(down, /touchDownAt = event\.pointerType/)
  assert.doesNotMatch(down, /setTimeout/)
  // press 专用监听摘干净；pointerup 保留（点行关抽屉 / 无 click 兜底导航靠它）。
  for (const event of ['pointermove', 'pointerleave', 'pointercancel', 'contextmenu']) {
    assert.equal(CHROME.includes(`addEventListener('${event}'`), false, `${event} 监听仍在`)
    assert.equal(CHROME.includes(`removeEventListener('${event}'`), false, `${event} 监听仍在`)
  }
  assert.match(CHROME, /addEventListener\('pointerup', onDrawerPointerUp, true\)/)
  assert.match(CHROME, /removeEventListener\('pointerup', onDrawerPointerUp, true\)/)
})

test('进度条样式与关键帧一并删除，不留死代码', () => {
  assert.equal(BASE.includes('data-mobile-nav-press'), false)
  assert.equal(BASE.includes('dsh-web-mobile-press-fill'), false)
})

test('真实 dblclick 仍被吞掉，且只吞真实（trusted）事件', () => {
  const swallow = CHROME.slice(
    CHROME.indexOf('const onDrawerDoubleClick'),
    CHROME.indexOf('const selectedRowSignature'),
  )
  assert.match(swallow, /if \(!event\.isTrusted\) return/)
  assert.match(swallow, /target\.closest\('\[class\*="sessionRow"\] \[class\*="_title"\]'\)/)
  assert.match(swallow, /event\.preventDefault\(\)/)
  assert.match(swallow, /event\.stopPropagation\(\)/)
  assert.match(CHROME, /document\.addEventListener\('dblclick', onDrawerDoubleClick, true\)/)
})

test('重命名仍有一步可达的入口：⋯ 菜单在触屏常显', () => {
  assert.match(
    LAYOUT,
    /\[data-mobile-nav="frame"\] \[class\*="sessionRow"\] \[class\*="_rowActions"\] \{\s*display: inline-flex !important;/,
  )
})
