import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Issue #228: deepseek-harness-background 0.6.x clears two frame tokens on
// body[data-dsh-bg] (--dsw-alias-bg-base, --dsw-specific-sidebar-fill) so the
// wallpaper shows through. The drawer column and the dark session header used
// those tokens as their ONLY ground; a var() fallback never fires because the
// token still exists and transparent is a legal value. The fix refills both
// surfaces from the static palette the tokens are defined with, gated on the
// wallpaper attribute (no wallpaper => the original rules stay in charge).
//
// Measured cascade (synthetic host DOM, real token values):
//   light + wallpaper: drawer #f9fafb, header #fff (the general rule already
//                      paints --dsw-alias-bg-layer-1, which the plugin keeps)
//   dark  + wallpaper: drawer #1b1b1c, header #151517
// The dark header override must out-specify the base #176 rule (0,3,2); the
// gated selector is (0,4,2), so it does not depend on source order.

const layout = await readFile(new URL('../src/client/styles/layout.css.ts', import.meta.url), 'utf8')

test('wallpaper: the drawer refills from the static sidebar palette', () => {
  assert.match(layout,
    /body\[data-dsh-bg\] \[data-mobile-nav="frame"\] > :first-child \{\s*background: var\(--dsw-static-neutral-bluish-50, #f9fafb\);/,
    '浅色抽屉在壁纸下必须回到 --dsw-static-neutral-bluish-50')
  assert.match(layout,
    /body\[data-ds-dark-theme\]\[data-dsh-bg\] \[data-mobile-nav="frame"\] > :first-child \{\s*background: var\(--dsw-static-neutral-bluish-900, #1b1b1c\);/,
    '深色抽屉在壁纸下必须回到 --dsw-static-neutral-bluish-900')
})

test('wallpaper: the dark session header keeps its page-base tone', () => {
  assert.match(layout,
    /body\[data-ds-dark-theme\]\[data-dsh-bg\] \[data-mobile-nav="frame"\] \[data-phase\] header \{\s*background-color: var\(--dsw-static-neutral-bluish-950, #151517\) !important;/,
    '深色顶栏在壁纸下必须回到 --dsw-static-neutral-bluish-950（#151517），而不是面板色 #232324')
})

test('wallpaper: the compensation is additive, not a replacement for the base rule', () => {
  // Issue #176's rule must stay: it is what makes the unwallpapered dark
  // header join the page background. Replacing it with the gated rule would
  // leave the header on the general bg-layer-1 paint (#232324).
  assert.match(layout,
    /body\[data-ds-dark-theme\] \[data-mobile-nav="frame"\] \[data-phase\] header,\s*\n\s*html\[data-ds-dark-theme\] \[data-mobile-nav="frame"\] \[data-phase\] header \{\s*background-color: var\(--dsw-alias-bg-base, #151517\) !important;/,
    '无壁纸的深色顶栏规则（#176）不得被壁纸门控规则替换')
})
