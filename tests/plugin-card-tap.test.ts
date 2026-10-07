// 插件管理页「整卡可点」的判定纯核 + 接线锚（2026-10-07 店主报障：
// 「打开如图里面的功能，需要点击那些加黑字体才行」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decidePluginCardTap } from '../src/client/core/plugin-card-tap-core.ts'

const CORE = readFileSync(fileURLToPath(new URL('../src/client/core/plugin-card-tap-core.ts', import.meta.url)), 'utf8')
const EFFECT = readFileSync(fileURLToPath(new URL('../src/client/effects/plugin-card-tap.ts', import.meta.url)), 'utf8')
const ENTRY = readFileSync(fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)), 'utf8')

test('a tap on the description/icon/blank forwards to the host open button', () => {
  assert.equal(decidePluginCardTap({ insideOpen: false, onInteractive: false }), 'open')
})

test('a tap on the title itself is left to the host (no double activation)', () => {
  assert.equal(decidePluginCardTap({ insideOpen: true, onInteractive: false }), 'ignore')
  // 标题按钮本身也是 button：两个条件同时成立时也必须放过。
  assert.equal(decidePluginCardTap({ insideOpen: true, onInteractive: true }), 'ignore')
})

test('the switch and any other control keep their own clicks', () => {
  assert.equal(decidePluginCardTap({ insideOpen: false, onInteractive: true }), 'ignore')
})

test('the effect targets the host entry roots and forwards in the capture phase', () => {
  assert.match(EFFECT, /const CARD = 'li\[data-plugin-package\], li\[data-plugin-row\]'/, '两种条目根（卡片/行式）都锚稳定标记')
  assert.match(EFFECT, /const OPEN = 'button\[class\*="_cardOpen"\], button\[class\*="_rowOpen"\]'/, '打开按钮锚语义化 class 子串')
  assert.match(EFFECT, /role="switch"/, '开关必须在放过清单里')
  assert.match(EFFECT, /document\.addEventListener\('click', onClick, true\)/, '捕获期监听')
  assert.match(EFFECT, /event\.preventDefault\(\)\s*\n\s*open\.click\(\)/, '转发前先掐掉本次点击的默认行为')
  assert.match(EFFECT, /installMobileEffect\(ctx, 'dsh-web-mobile: plugin card tap'/, '手机档门控（桌面零影响）')
  assert.match(ENTRY, /installPluginCardTap\(ctx\)/, '已接进客户端入口')
})
