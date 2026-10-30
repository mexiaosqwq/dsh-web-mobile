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
    /body\[data-ds-dark-theme\]\[data-dsh-bg\] \[data-mobile-nav="frame"\] \[data-phase\] header\.wSkVaW_header \{\s*background-color: var\(--dsw-static-neutral-bluish-950, #151517\) !important;/,
    '深色顶栏在壁纸下必须回到 --dsw-static-neutral-bluish-950（#151517），而不是面板色 #232324')
})

test('wallpaper: the compensation is additive, not a replacement for the base rule', () => {
  // Issue #176's rule must stay: it is what makes the unwallpapered dark
  // header join the page background. Replacing it with the gated rule would
  // leave the header on the general bg-layer-1 paint (#232324).
  assert.match(layout,
    /body\[data-ds-dark-theme\] \[data-mobile-nav="frame"\] \[data-phase\] header\.wSkVaW_header,\s*\n\s*html\[data-ds-dark-theme\] \[data-mobile-nav="frame"\] \[data-phase\] header\.wSkVaW_header \{\s*background-color: var\(--dsw-alias-bg-base, #151517\) !important;/,
    '无壁纸的深色顶栏规则（#176）不得被壁纸门控规则替换')
})

// #247 third tier: the same wallpaper plugin also clears --dsw-alias-bg-base,
// which is the ONLY ground the fullscreen right panel inherits. The drawer and
// header fills cover their own surfaces; the panel had none.
test('wallpaper: the fullscreen right panel refills from the page-base palette', () => {
  assert.match(layout,
    /body\[data-dsh-bg\] \[data-sidebar-right-open\]\[data-sidebar-right-panel="fullscreen"\] \{\s*background-color: var\(--dsw-static-neutral-bluish-00, #fff\);/,
    '浅色面板继承的是 bg-base（-00），不是抽屉的 -50')
  assert.match(layout,
    /body\[data-ds-dark-theme\]\[data-dsh-bg\] \[data-sidebar-right-open\]\[data-sidebar-right-panel="fullscreen"\] \{\s*background-color: var\(--dsw-static-neutral-bluish-950, #151517\);/,
    '深色面板必须用 -950（bg-base 的深色档）')
})

test('wallpaper: every panel background rule is gated on the open marker', () => {
  // Multi-line aware: the selector sits on its own line and the declaration on
  // the next, so a per-line filter would match nothing and pass vacuously.
  const rules = [
    ...layout.matchAll(/([^{}\n]*data-sidebar-right-panel="fullscreen"[^{}\n]*)\{\s*background(?:-color)?:/g),
  ]
  assert.equal(rules.length, 2, 'expected exactly two panel background rules')
  for (const rule of rules) {
    assert.ok(
      rule[1].includes('[data-sidebar-right-open]'),
      'an ungated panel fill paints a full-screen mask over the closed panel: ' + rule[1].trim(),
    )
  }
})
