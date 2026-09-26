// 快捷键弹层「抽搐/闪」的三个真机结论（2026-09-25，Android 16 WebView）。
//
// ① 卡片不许随软键盘改大小：实测 vh / svh / lvh / dvh 四个单位**一起**随键盘变
//    （754↔471），所以拿视口单位定高的卡片必然跟着缩；改成用 --dsh-web-mobile-vh
//    （只在高度变大或宽度变化时更新 = 不含键盘的视口高度）定高。
// ② 打开弹层不得改变全屏亮度：设置面板自己已压一层 0.24 遮罩，弹层再叠一层就是
//    0.24 → 0.42 的一步跳深（报障人「全屏闪」）；那一层的 ::after 还挂着宿主的
//    _modalEnter 淡入。两者都去掉。
// ③ 手机档搜索行已于 2026-09-27 应用户拍板恢复（当时的闪 = v3.0.3 旧包零防线，
//    main 三道防线齐备，见 docs/handover/2026-09-27-keyboard-reflow-scout.md）——
//    行显隐是用户决策域，不是不变量，不设锚。
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
  assert.match(PHONE, /export const STABLE_VIEWPORT_VAR = '--dsh-web-mobile-vh'/)
  assert.match(PHONE, /setProperty\(STABLE_VIEWPORT_VAR/)
  assert.match(PHONE, /removeProperty\(STABLE_VIEWPORT_VAR\)/)
  const at = PHONE.indexOf('const syncStableViewport')
  assert.notEqual(at, -1, 'syncStableViewport missing')
  // Monotonic height + width-change rule: the keyboard only changes height.
  assert.match(
    PHONE.slice(at, PHONE.indexOf('\n    }', at)),
    /stableVh === 0 \|\| height > stableVh \|\| width !== stableWidth/,
  )
  assert.match(PHONE, /addEventListener\('resize', syncStableViewport\)/)
  assert.match(PHONE, /removeEventListener\('resize', syncStableViewport\)/)
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

// ④ 光栅隔离（2026-09-27 真机「弹层瞬间消失又回来」）：几何锁救不了光栅——键盘
//    resize 的整页重光栅会甩下未提升的卡片 tile（低端 WebView 赶不上帧截止）。
//    卡片必须带 will-change 提升为独立合成层；它的几何在键盘瞬间不变（①的锁），
//    层缓存因此可跨 resize 复用。宿主侧无 resize→setState 订阅（remount 已排除），
//    这条提升是该现象我们能握住的唯一前端杠杆。
test('the shortcut paper is raster-isolated from the keyboard resize storm', () => {
  const at = LAYOUT.indexOf('[aria-modal="true"][data-shortcut-modal="shortcuts"] {')
  assert.notEqual(at, -1, 'the paper rule is missing')
  const rule = LAYOUT.slice(at, LAYOUT.indexOf('}', at))
  assert.match(rule, /will-change: transform/, 'the paper must ride its own compositor layer')
})
