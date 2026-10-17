// dsh-our-free-model 公告 toast 的层级锚（2026-10-17 报障：打开侧边栏时左下角
// 的官方推送消息被抽屉挡住）。
//
// 契约：toast（插件写死 z 1200，portal 到 document.body）必须浮在抽屉 1300
// 与遮罩 1250 之上、本插件自己的弹层 1400 之下。抽屉与遮罩的 z 值住在另外两个
// 样式文件里，所以这里读它们做数值比较 —— 只钉 1310 会让「有人把抽屉抬到
// 1500」悄悄复活同一个 bug，而那种改动在本仓库是常见的几何调整。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPAT_CSS } from '../src/client/styles/compat.css.ts'
import { BASE_CSS } from '../src/client/styles/base.css.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'

const HEADER = '/* ---------- dsh-our-free-model: announcement toast above the drawer ----------'

/**
 * One rule block, from its opening brace to the first closing brace.
 *
 * Comments are stripped first: the drawer rule opens with a comment that
 * quotes the host's own `{ width: ... }` declaration, and a naive indexOf('}')
 * stops inside that quote — measured here, the drawer block came back 204 chars
 * long without any z-index in it.
 */
const blockOf = (css: string, selector: string): string => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = clean.indexOf(selector)
  assert.ok(start > -1, `${selector} is missing`)
  const open = clean.indexOf('{', start)
  const close = clean.indexOf('}', open)
  return clean.slice(open, close)
}

/** The rules of this patch, comment stripped (same trap as the cost test). */
const rules = (): string => {
  const start = COMPAT_CSS.indexOf(HEADER)
  assert.ok(start > -1, 'the our-free-model toast-layer section header is missing')
  const sheet = COMPAT_CSS.slice(start)
  const end = sheet.indexOf('*/')
  assert.ok(end > -1, 'the toast-layer section lost its comment terminator')
  return sheet.slice(end)
}

test('the toast rule lives inside the top-level mobile query', () => {
  const top = COMPAT_CSS.indexOf('@media (max-width: 1023px) and (pointer: coarse) {')
  assert.ok(top > -1 && top < COMPAT_CSS.indexOf(HEADER))
})

test('the toast host is body-anchored, never frame- or root-scoped', () => {
  // The plugin appends .ofm_toasts to document.body; a frame descendant
  // selector (or .ofm_root, which is the settings page) silently misses it.
  assert.doesNotMatch(rules(), /\[data-mobile-nav="frame"\]/)
  assert.doesNotMatch(rules(), /\.ofm_root/)
  assert.match(rules(), /body > \.ofm_toasts \{\n    z-index: 1310 !important;\n  \}/)
})

test('the raised layer clears the drawer and the backdrop', () => {
  const toastZ = Number(rules().match(/z-index: (\d+) !important/)?.[1])
  const drawerZ = Number(blockOf(LAYOUT_CSS, '[data-mobile-nav="frame"] > :first-child {').match(/z-index: (\d+)/)?.[1])
  const backdropZ = Number(blockOf(BASE_CSS, '[data-mobile-nav="backdrop"] {').match(/z-index: (\d+)/)?.[1])
  assert.ok(Number.isFinite(toastZ) && Number.isFinite(drawerZ) && Number.isFinite(backdropZ), 'z-index values must parse')
  assert.ok(backdropZ < drawerZ, 'the backdrop must stay under the drawer')
  assert.ok(toastZ > drawerZ, `toast z ${toastZ} must clear the drawer z ${drawerZ}`)
  assert.ok(toastZ > backdropZ, `toast z ${toastZ} must clear the backdrop z ${backdropZ}`)
  // 1400 is our own modal layer (base.css.ts); an announcement toast must
  // never out-rank a dialog the user opened.
  assert.ok(toastZ < 1400, `toast z ${toastZ} must stay below our modal layer 1400`)
})

test('the patch self-declares its four fields', () => {
  const at = COMPAT_CSS.indexOf('id: ofm-toast-above-drawer')
  assert.ok(at > -1, 'the toast-layer patch lost its @patch declaration')
  const open = COMPAT_CSS.lastIndexOf('/*', at)
  const close = COMPAT_CSS.indexOf('*/', at)
  const decl = COMPAT_CSS.slice(open, close)
  for (const field of ['id:', 'for:', 'why:', 'until:', 'test:']) {
    assert.ok(decl.includes(field), `@patch is missing ${field}`)
  }
  assert.match(decl, /test: tests\/our-free-model-toast-layer\.test\.ts/)
})
