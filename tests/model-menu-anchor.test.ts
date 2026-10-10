// 模型菜单重锚定的「成本契约」：滚动 / 视口路径不得查询全文档。
//
// 起因（2026-09-23，店主批准的优化）：本机 18,359 节点时
// `querySelectorAll('[class*="_7KE1Ra_menu"]')` = 0.568ms/次、卡片查询 0.08ms/次。
// 旧版把这些查询挂在 pointerdown/click/resize/scroll 上 ⇒ 菜单关着时每次滚动也白花
// 约 0.65ms/帧（模型流式输出时页面每帧都在滚 —— 60Hz 帧预算的 4%、120Hz 的 8%）。
// 现在查询只在「命中触发器/菜单的交互」后发生，滚动/改变尺寸只对缓存节点重算位置。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(
  fileURLToPath(new URL('../src/client/effects/model-menu-anchor.ts', import.meta.url)),
  'utf8',
)

test('滚动/改变尺寸只重算缓存节点，绝不查询', () => {
  const start = SRC.indexOf('const follow = ')
  const end = SRC.indexOf('const schedule = ', start)
  assert.ok(start > 0 && end > start, 'follow() 未找到')
  assert.ok(!SRC.slice(start, end).includes('querySelector'), 'follow() 里出现了查询')
  assert.match(SRC, /document\.addEventListener\('scroll', onViewportChange, true\)/)
  assert.match(SRC, /window\.addEventListener\('resize', onViewportChange\)/)
})

test('全文档查询只有一个入口，且只在命中触发器/菜单的交互后触发', () => {
  const queries = SRC.match(/querySelectorAll<HTMLElement>\(MODEL_MENU\)/g) ?? []
  assert.equal(queries.length, 1, '菜单查询必须集中在 findMenu() 一处')
  assert.match(
    SRC,
    /target\.closest\(MODEL_TRIGGER\) !== null \|\| target\.closest\(MODEL_MENU\) !== null/,
    '交互路径必须按目标做门控，不能对每次点击都查询',
  )
  for (const event of ['pointerdown', 'keydown', 'focusin', 'click']) {
    assert.ok(SRC.includes(`document.addEventListener('${event}', on`), `${event} 未接入交互路径`)
  }
})

test('菜单能放入视口时贴触发器右缘，越界时回退卡片居中', () => {
  assert.match(SRC, /triggerBox\.right - width/)
  assert.match(SRC, /flush >= GUTTER && flush <= max/)
  assert.match(SRC, /cardBox\.left \+ \(cardBox\.width - width\) \/ 2/)
  const start = SRC.indexOf('const place = ')
  const end = SRC.indexOf('const refresh = ', start)
  assert.ok(!SRC.slice(start, end).includes('querySelector'), 'place() 只能读取缓存锚点')
})
