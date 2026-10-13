// 团队 chip「再点关闭」的源码契约（2026-09-23，对账 0.1.7-rc.1）。
//
// 背景：宿主 agent-team 插件的触发器 onClick 只在关闭时 changeOpen(true)，开态时
// 仅 panelRef.focus() —— 它永不 toggle；关闭只有 useDismissOnOutsidePointer
// （document pointerdown，靶心在 root/panel 外）与 Escape 两条路。修复在
// pointerdown 捕获期读开态、click 捕获期先派发一次合成 pointerdown（走宿主自己的
// outside-dismiss）再吞掉那颗 click。本测试钉住「哪里介入、什么时候介入」这几个
// 不可回退的判据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(
  fileURLToPath(new URL('../src/client/effects/team-chip-toggle.ts', import.meta.url)),
  'utf8',
)
const ENTRY = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

test('选择器只认根的直接子 dialog 触发器与 body portal 面板标记', () => {
  // 带 `>` 才不会误伤面板内部按钮；aria-haspopup 是 dialog（团队面板），不是 menu。
  assert.match(SRC, /const TRIGGER_SELECTOR = '\[data-team-action\] > button\[aria-haspopup="dialog"\]'/)
  // 面板 portal 到 body，用稳定标记而不是易变哈希类名。
  assert.match(SRC, /const PANEL_SELECTOR = '\[data-team-panel\]'/)
  assert.doesNotMatch(SRC, /PANEL_SELECTOR = '\[class\*=/)
})

test('两个事件都必须在捕获阶段介入', () => {
  assert.match(SRC, /document\.addEventListener\('pointerdown', onPointerDownCapture, true\)/)
  assert.match(SRC, /document\.addEventListener\('click', onClickCapture, true\)/)
})

test('开态取自触发器自己的 aria-expanded，且要求根与面板都在场', () => {
  const start = SRC.indexOf('const onPointerDownCapture')
  const end = SRC.indexOf('const onClickCapture', start)
  const body = SRC.slice(start, end)
  assert.ok(start > 0 && end > start, 'onPointerDownCapture 未找到')
  assert.match(body, /trigger\.getAttribute\('aria-expanded'\) !== 'true'/, '开态必须读触发器自己的 aria-expanded')
  assert.match(body, /document\.querySelector\(ROOT_SELECTOR\) === null/)
  assert.match(body, /document\.querySelector\(PANEL_SELECTOR\) === null/)
})

test('只在同一颗触发器的紧随 click 上动手，且顺序是先派发再吞', () => {
  const start = SRC.indexOf('const onClickCapture')
  const end = SRC.indexOf('document.addEventListener', start)
  const body = SRC.slice(start, end)
  assert.match(body, /triggerFrom\(event\.target\) !== trigger/)
  // 必须用 pointerdown：宿主的 dismiss 只监听 pointerdown（click 不听）。
  assert.match(body, /new PointerEvent\('pointerdown'/)
  // 靶心必须是真外部：document.body 不在 root 内、也不在面板内。
  assert.match(body, /document\.body\.dispatchEvent/)
  assert.match(body, /event\.stopPropagation\(\)/)
  // 顺序不可换：先派发关闭，再吞掉那颗 click。
  assert.ok(
    body.indexOf('dispatchEvent') < body.indexOf('stopPropagation()'),
    '必须先派发合成 pointerdown 再 stopPropagation',
  )
})

test('dispose 摘掉两个监听器', () => {
  assert.match(SRC, /document\.removeEventListener\('pointerdown', onPointerDownCapture, true\)/)
  assert.match(SRC, /document\.removeEventListener\('click', onClickCapture, true\)/)
})

test('入口武装该效果', () => {
  assert.match(ENTRY, /import \{ installTeamChipToggle \} from '\.\/effects\/team-chip-toggle\.ts'/)
  assert.match(ENTRY, /installTeamChipToggle\(ctx\)/)
})

// 用户报障（2026-10-11）：平板模式下点开智能体面板后，再点同一颗 chip 收不起来。
// 根因之一是门控：MOBILE_QUERY 的 `max-width: 1023px` 在宽视口恒 false ⇒ 本效果压根没安装，
// 而宽触屏没有 hover 兜底。这条断言是**防回退**的：把第四参改回 MOBILE_QUERY（或删掉）
// 必须让它变红 —— 顺带 tsc 的 noUnusedLocals 也会因 TOUCH_QUERY 未使用而拦住。
test('门控是 TOUCH_QUERY：宽触屏（平板）也必须武装', () => {
  assert.match(SRC, /import \{ TOUCH_QUERY, installMobileEffect \} from '\.\.\/platform\/breakpoints\.ts'/)
  const at = SRC.indexOf("installMobileEffect(ctx, 'dsh-web-mobile: team chip toggle'")
  assert.ok(at > 0, '安装点未找到')
  const call = SRC.slice(at, SRC.indexOf('\n}', at))
  assert.match(call, /, TOUCH_QUERY\)/, '第四参必须是 TOUCH_QUERY（宽触屏也要武装）')
  assert.doesNotMatch(call, /MOBILE_QUERY/, '不得再用 MOBILE_QUERY 门控（平板恒不命中）')
  // 门控语义：TOUCH_QUERY = '(pointer: coarse)' ⇒ 鼠标驱动的窗口（含窄桌面窗口）恒不命中，
  // 宽触屏（平板/折叠屏展开）命中。这一条把「扩到平板」与「桌面仍零介入」同时钉住。
  const BREAKPOINTS = readFileSync(
    fileURLToPath(new URL('../src/client/platform/breakpoints.ts', import.meta.url)),
    'utf8',
  )
  assert.match(BREAKPOINTS, /export const TOUCH_QUERY = '\(pointer: coarse\)'/)
})
