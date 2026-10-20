// 快捷键弹层「抽搐/闪」的三个真机结论（2026-09-25，Android 16 WebView）。
//
// ① 卡片不许随软键盘改大小：实测 vh / svh / lvh / dvh 四个单位**一起**随键盘变
//    （754↔471），所以拿视口单位定高的卡片必然跟着缩；改成用 --dsh-web-mobile-vh
//    （只在高度变大或宽度变化时更新 = 不含键盘的视口高度）定高。
// ② 打开弹层不得改变全屏亮度：设置面板自己已压一层 0.24 遮罩，弹层再叠一层就是
//    0.24 → 0.42 的一步跳深（报障人「全屏闪」）；那一层的 ::after 还挂着宿主的
//    _modalEnter 淡入。两者都去掉。
// ③ 手机档收掉搜索行：报障人两次实机复现钉死因果 —— **行在打开就闪、行藏就不闪**
//    （宿主把焦点抢到该输入框 → 键盘在打开瞬间抬起 → 布局视口 754→471 → 整页重排）。
//    只收手机档，平板（768–1023）与桌面照旧。只做 CSS 隐藏，绝不删宿主节点。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LAYOUT = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')
// P1 拆分第五片（2026-10-12）：本文件钉的 STABLE_VIEWPORT_VAR / syncStableViewport
// 那一块整个搬进 viewport-meta.ts（phone-chrome.ts 已不再持有它），故只读那一份。
const VIEWPORT = readFileSync(join(ROOT, 'src/client/effects/viewport-meta.ts'), 'utf8')
const VAR = 'var(--dsh-web-mobile-vh, 100dvh)'

test('phone-chrome maintains the keyboard-less viewport height', () => {
  assert.match(VIEWPORT, /export const STABLE_VIEWPORT_VAR = '--dsh-web-mobile-vh'/)
  assert.match(VIEWPORT, /setProperty\(STABLE_VIEWPORT_VAR/)
  assert.match(VIEWPORT, /removeProperty\(STABLE_VIEWPORT_VAR\)/)
  const at = VIEWPORT.indexOf('const writeViewport')
  assert.notEqual(at, -1, 'writeViewport missing')
  // Monotonic height + width-change rule: the keyboard only changes height.
  assert.match(
    VIEWPORT.slice(at, VIEWPORT.indexOf('\n  }', at)),
    /stableVh === 0 \|\| height > stableVh \|\| width !== stableWidth/,
  )
  assert.match(VIEWPORT, /addEventListener\('resize', syncStableViewport\)/)
  assert.match(VIEWPORT, /removeEventListener\('resize', syncStableViewport\)/)
  // 2026-10-09：值没变就不许再写一次 —— 在 :root 上写自定义属性会让整棵文档的
  // 样式失效，同值重写等于白跑一次文档级样式计算。
  assert.match(VIEWPORT, /if \(next !== stableValue\)/)
  assert.match(VIEWPORT, /stableValue = ''/)
})

test('progressive keyboard resize writes at most once per frame', () => {
  // 2026-10-20：原生侧按输入法动画逐帧缩 WebView 后，一次键盘动画会连发十几到
  // 二十次 resize；逐事件写等于十几次整文档样式重算。写入走 rAF 合并调度。
  assert.match(VIEWPORT, /import \{ createRafScheduler \} from '\.\.\/core\/raf-scheduler\.ts'/)
  assert.match(VIEWPORT, /createRafScheduler\(requestAnimationFrame, cancelAnimationFrame\)/)
  assert.match(VIEWPORT, /const syncStableViewport = \(\): void => \{\s*writer\.schedule\(writeViewport\)/)
  assert.match(VIEWPORT, /writer\.cancel\(\)/)
  // 首次同步必须同步写完：调用方同一轮就读取 STABLE_VIEWPORT_VAR。
  assert.match(VIEWPORT, /writeViewport\(\)\n  window\.addEventListener\('resize'/)
})

test('the two keyboard-facing cards size themselves off that variable', () => {
  assert.notEqual(
    LAYOUT.indexOf('max-height: min(800px, calc(' + VAR + ' - 24px - env(safe-area-inset-top, 0px)));'),
    -1, 'settings sheet must cap on the stable viewport height')
  assert.notEqual(
    LAYOUT.indexOf('max-height: min(760px, calc(' + VAR + ' - 24px - env(safe-area-inset-top, 0px))) !important;'),
    -1, 'shortcut card must cap on the stable viewport height')
  assert.doesNotMatch(LAYOUT, /max-height: min\((?:800|760)px, calc\(100dvh/,
    'a bare 100dvh cap would collapse with the keyboard again')
})

test('opening the shortcut modal never changes full-screen luminance', () => {
  const at = LAYOUT.indexOf(':has(> [aria-modal="true"][data-shortcut-modal="shortcuts"]) > [class*="_mask"]::after')
  assert.notEqual(at, -1, 'the shortcut mask override is missing')
  const body = LAYOUT.slice(at, LAYOUT.indexOf('}', at))
  assert.match(body, /animation: none !important/, 'no opacity fade on the scrim')
  assert.match(body, /background: transparent !important/, 'no second dim layer')
})

test('only the PHONE branch drops the search row; tablet keeps it', () => {
  const at = LAYOUT.indexOf('[aria-modal="true"][data-shortcut-modal="shortcuts"] [class*="_searchRow"]')
  assert.notEqual(at, -1, 'the search row must be hidden on phones')
  assert.match(LAYOUT.slice(at, LAYOUT.indexOf('}', at)), /display: none !important/, 'hide, do not remove')
  // Phone-only: it must sit inside a narrow-screen query, not the whole mobile branch.
  const phoneQuery = LAYOUT.lastIndexOf('@media (max-width: 767px)', at)
  assert.notEqual(phoneQuery, -1, 'the hide must be scoped to phones')
  assert.doesNotMatch(LAYOUT.slice(phoneQuery, at), /\}\s*\}\s*$/, 'the query must still enclose the rule')
  assert.ok(at - phoneQuery < 200, 'the narrow query must be the rule\'s nearest block')
})

test('the viewport meta asks Chromium for the WebView keyboard model', () => {
  // Chrome for Android defaults to `interactive-widget=resizes-visual`: the
  // keyboard only shrinks the VISUAL viewport, the layout viewport (what
  // `100%` / `100dvh` sizing follows) keeps the full screen height, and the
  // browser pans the document up to reveal the focused composer — the frame
  // and its header slide off the top. Android WebView (`adjustResize`), the
  // engine every keyboard measurement in this repo was taken on, resizes the
  // LAYOUT viewport instead, which is why this never reproduced there.
  // Asking for `resizes-content` puts Chromium browsers on that same model.
  assert.match(
    VIEWPORT,
    /const VIEWPORT_CONTENT =\s*'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'/,
  )
})
