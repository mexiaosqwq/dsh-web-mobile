// Session-menu dual-generation contract: the host's per-row menu changed
// shape in 0.1.5 (label lives directly in the menuitem button, no
// `_itemLabel`/`_itemIcon` spans). Recognition and the injected delete item
// must keep working on both shapes — a _itemLabel-only read silently
// disables the whole feature on 0.1.5 (menu no longer recognized).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'src/client/effects/session-menu.ts'), 'utf8')

test('menu recognition reads labels via the label-or-item fallback, not _itemLabel alone', () => {
  // The fallback helper exists and is documented for both generations.
  assert.match(SOURCE, /const itemLabel = \(item: HTMLElement\): string =>/)
  assert.match(SOURCE, /puts it directly in the button/)
  // isSessionMenu maps over the menuitem list through the helper — the
  // rc.2-only selector `[role="menuitem"] [class*="_itemLabel"]` must be gone
  // from the recognition path.
  assert.doesNotMatch(SOURCE, /querySelectorAll<HTMLElement>\('\[role="menuitem"\] \[class\*="_itemLabel"\]'\)/)
  assert.match(SOURCE, /querySelectorAll<HTMLElement>\('\[role="menuitem"\]'\)/)
  assert.match(SOURCE, /\.map\(itemLabel\)/)
})

test('injected delete item covers both menu shapes', () => {
  // rc.2: the `_itemLabel` span gets the text + danger color.
  assert.match(SOURCE, /label\.textContent = navT\('deleteSession'\)/)
  assert.match(SOURCE, /label\.style\.color = DANGER_COLOR/)
  // 0.1.5: a childless button gets its whole text replaced; a button with
  // element children but no label span is an unknown shape and must be left
  // alone (no text guessing).
  assert.match(SOURCE, /else if \(button\.firstElementChild === null\) \{[\s\S]*?button\.textContent = navT\('deleteSession'\)/)
  assert.match(SOURCE, /button\.style\.color = DANGER_COLOR/)
  assert.match(SOURCE, /unknown future shape/)
})

test('the host delete-endpoint flow is unchanged', () => {
  // Marker + dialog ids (the browser-review and probe contract).
  assert.match(SOURCE, /DELETE_ITEM_MARKER = 'data-mobile-nav="session-delete"'/)
  assert.match(SOURCE, /delete-dialog-backdrop/)
  // The host menu is closed through its own anchor before the flow starts.
  assert.match(SOURCE, /captured\?\.button\.click\(\)/)
})

test('menu recognition is containment-style: rename + fork + archive', () => {
  // 0.1.7 added a fourth 「置顶会话」 item — an exact item-count gate
  // silently disabled the whole feature there, so the counted form must
  // stay gone from the predicate (the source comment may still cite it as
  // history).
  assert.doesNotMatch(SOURCE, /labels\.length === 3/)
  assert.match(SOURCE, /labels\.includes\(rename\) && labels\.includes\(fork\)/)
  assert.match(SOURCE, /labels\.includes\(wsT\('menu\.archiveSession'\)\)/)
  // The discriminating-triple rationale (fork label exists only in the
  // session menu) is documented next to the predicate.
  assert.match(SOURCE, /fork label exists only in ui-workspace/)
})

test('archived rows (unarchive swap) never get the injected delete item', () => {
  // #V1 N1: the former unarchive branch recognized archived-row menus and
  // injected a delete item that resolution can never satisfy (archived ids
  // are filtered out) — the tap always ended in deleteErrorResolve. The
  // predicate must key on archiveSession only; the unarchive call form must
  // stay gone from the code (negative assertion pinned to the call shape,
  // NOT a bare word — source comments may still cite the history).
  assert.doesNotMatch(SOURCE, /labels\.includes\(wsT\('menu\.unarchiveSession'\)\)/)
  assert.match(SOURCE, /Archived rows swap archive/)
  assert.match(SOURCE, /delete via unarchive first/)
})

test('blank (new-session) rows never get the injected delete item', () => {
  // A blank row renders the host's localized "New session" label while
  // displayTitle stays empty — resolution could never succeed, so the item
  // is withheld and the menu stays host-native.
  assert.match(SOURCE, /const blankLabel = wsT\('session\.new'\)/)
  assert.match(SOURCE, /anchor\.title === blankLabel/)
  // The accepted ceiling (a session manually titled exactly the host label)
  // is annotated in the source so it is not re-litigated as a bug.
  assert.match(SOURCE, /Known ceiling/)
})

test('the row id comes from the host\'s stable anchors, never from title guessing (2026-10-07)', () => {
  // 宿主 0.2.0-rc.2 把会话行包进 HoverCard 的 <span>，于是 `:scope > _sessionRow` 取不到行
  // → rowIndex=-1 → 重名标题被静默算成"第一个同名会话"（**会删错会话**）。整套按标题猜 id
  // 的做法已删除，改成读宿主自己的稳定锚。
  assert.doesNotMatch(SOURCE, /resolveSessionId/, '按标题/组内位置猜 id 的路径必须不存在')
  // 只查代码形态（注释里保留历史说明是刻意的）。
  assert.doesNotMatch(SOURCE, /querySelectorAll<HTMLElement>\(':scope > \[class\*="_sessionRow"\]'\)/, '不再用 :scope > 取行（HoverCard 已包一层）')
  assert.doesNotMatch(SOURCE, /querySelector<HTMLElement>\(':scope > \[class\*="_projectRow"\]/, '组头锚同样已失效，不许再用')
  // 1) data-row-key="session:<id>"（宿主 AnimatedRows 同源依赖的稳定属性）
  assert.match(SOURCE, /row\.getAttribute\('data-row-key'\)/)
  assert.match(SOURCE, /rowKey\.startsWith\('session:'\)/)
  assert.match(SOURCE, /rowKey\.slice\('session:'\.length\)/)
  // 2) DSHA 构建直接戳了 id
  assert.match(SOURCE, /row\.getAttribute\('data-dsha-session-select'\)/)
  // 3) 最后才回落到 fiber
  assert.match(SOURCE, /return findSessionIdInFiber\(reactFiberOf\(row\), isKnownSessionId\)/)
  // 删除时只用录制到的 id；读不到就报错（不许猜）
  assert.match(SOURCE, /const sessionId = captured\.sessionId/)
  assert.match(SOURCE, /if \(sessionId === null\) \{[\s\S]{0,120}?deleteErrorResolve/)
  // ⋯ 按钮按 aria-label 识别，显式排除同行的归档/置顶按钮（每行三个按钮）
  assert.match(SOURCE, /\/session actions\/i\.test\(label\)/)
  assert.match(SOURCE, /!\/archive session\|pin session\/i\.test\(label\)/)
  assert.doesNotMatch(SOURCE, /row\.querySelector<HTMLButtonElement>\('button'\)/, '不再赌行里只有一个按钮')
  assert.match(SOURCE, /const sessionId = rowSessionId\(row\)/)
})
