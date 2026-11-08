// 子代理谱系 chip 的触摸 shim 契约（2026-11-08，对账 dsh-client-ui-subagent 0.2.2-rc.1）。
//
// 背景（#281「⋯ 与子代理展开冲突 且子代理展开失效」）：shim 用组件自己的键盘路径
// （ArrowDown / Escape）开关卡片，并吞掉那一击自己的 click —— 但**键盘路径不置组件的
// pinnedRef**，而 0.2.2-rc.1 把 hover 定时器搬到了 pointer 通道：谱系根与菜单容器都带
// onPointerLeave → scheduleHoverClose(120ms)，且 scheduleHoverClose 在 pinnedRef 为
// false 时照常武装。手指抬起时浏览器必然派发 pointerout / pointerleave，于是卡片在我们
// 打开后约 120ms 自己关掉（CDP 实测：pointerup 后 expanded 已为 true，60ms 仍开，
// 150ms 已 false；把这两个事件挡掉即保持打开）。第一代上游用的是 mouseenter/mouseleave，
// 老名单只盖住那一族，换到 pointer 通道后就成了「打开又突然关闭」。
//
// 本测试钉住三件不可回退的事：吞名单同时覆盖 mouse 与 pointer 两族、吞事件仍在捕获阶段
// 且带 isTrusted / 子树两道门、以及入口确实武装了该效果。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(
  fileURLToPath(new URL('../src/client/effects/subagent-chip-touch.ts', import.meta.url)),
  'utf8',
)
const ENTRY = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

function swallowedTypes(): string[] {
  const found = SRC.match(/const SWALLOWED_TYPES = \[([\s\S]*?)\] as const/)
  assert.ok(found !== null, 'SWALLOWED_TYPES 未找到')
  return [...found[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])
}

test('吞名单同时覆盖 mouse 与 pointer 两族（宿主换代时定时器跟着换了通道）', () => {
  const types = swallowedTypes()
  // 第一代上游（hover 定时器）：鼠标族
  for (const type of ['mouseover', 'mouseout', 'mouseenter', 'mouseleave']) {
    assert.ok(types.includes(type), `鼠标族 ${type} 不得移除（老宿主只认它）`)
  }
  // 0.2.2-rc.1：onPointerLeave → scheduleHoverClose。缺了它们，卡片刻意 120ms 后自关。
  for (const type of ['pointerout', 'pointerleave']) {
    assert.ok(types.includes(type), `pointer 族 ${type} 必须被吞，否则卡片打开后被 hover 关闭定时器关掉`)
  }
})

test('吞事件仍在捕获阶段，且只吞信任事件与谱系子树内的目标', () => {
  // 捕获阶段才能在 React 的根委托之前拦住它
  assert.match(SRC, /for \(const type of SWALLOWED_TYPES\) \{\s*document\.addEventListener\(type, swallowSyntheticHover, true\)/)
  const start = SRC.indexOf('const swallowSyntheticHover')
  const end = SRC.indexOf('document.addEventListener', start)
  const body = SRC.slice(start, end)
  assert.ok(start > 0 && end > start, 'swallowSyntheticHover 未找到')
  // 合成事件不吞（我们只挡浏览器替触摸合成的那些）
  assert.match(body, /if \(!event\.isTrusted\) return/)
  // 子树门：只有谱系根与它的菜单会被挡，页面其他 hover 不受影响
  assert.match(body, /event\.target/)
  assert.match(body, /target\.closest\(HOVER_SUBTREE_SELECTOR\) === null\) return/)
  assert.match(body, /event\.stopImmediatePropagation\(\)/)
  // 名单的每一族都必须走同一个 handler，否则同类失效点会分裂成两份
  assert.match(SRC, /document\.removeEventListener\(type, swallowSyntheticHover, true\)/)
})

test('触发器选择器仍然只认计数变体（switcher 有自己的 onClick）', () => {
  assert.match(SRC, /const CHIP_TRIGGER_SELECTOR =\s*\n?\s*'\[data-mobile-nav="frame"\] button\[class\*="_trigger"\]\[aria-haspopup="tree"\]\[aria-expanded\]:not\(\[class\*="_switcherTrigger"\]\)'/)
})

test('入口武装该效果', () => {
  assert.match(ENTRY, /import \{ installSubagentChipTouch \} from '\.\/effects\/subagent-chip-touch\.ts'/)
  assert.match(ENTRY, /installSubagentChipTouch\(ctx\)/)
})
