import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { shadowFocus } from '../core/prototype-focus-shadow.ts'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * Mobile guard: opening the host's model / reasoning-level menu must not raise
 * the soft keyboard by itself (owner report 2026-10-07, screenshot: the menu
 * opens with 「搜索模型…」 focused and the keyboard covers the whole list).
 *
 * `dsh-client-ui-model-selection` renders a 模型 / 推理等级 menu; tapping 「模型」
 * drills into the model pane and a `useEffect` calls
 * `searchRef.current?.focus()` (`dsh-client-ui-model-selection/lib/client.js:29497`,
 * the same call also fires from the menu's ArrowDown handler at :33452). On a
 * phone that costs half the screen the moment the user asks for the model list.
 *
 * Why the METHOD shadow (the technique `shortcut-modal-keyboard-guard.ts` uses)
 * and why the capture-phase pointerdown: that focus runs in a PASSIVE effect
 * right after the pane commits, so any observer-based arming is a race — the
 * arming has to happen strictly earlier, and the pointerdown that will become
 * the drill tap is the last deterministic moment before it. A tap ON the field
 * still focuses it natively (only the JS method is replaced), so searching
 * stays one deliberate tap away.
 *
 * Cost (deliberately minimal): one capture listener, one `querySelector` per
 * tap plus one idle check ~2s after the last tap. NO MutationObserver — the
 * session streams text, so a subtree observer would run every frame (the same
 * reasoning as `model-menu-anchor.ts`, which documents the measured cost).
 *
 * DOM contract (verified against 0.2.0-rc.2):
 * - the portaled menu surface carries the primitives' `data-menu-material`
 *   marker (`dsh-client-ui-primitives` MenuSurface) and, for this menu, the
 *   hashed `_7KE1Ra_menu` class;
 * - the pane's search field is an `input[role="searchbox"]` with
 *   `aria-controls="<menuId>-models"`.
 * Re-audit both when the host or dsh-client-ui-model-selection upgrades.
 */
/** A host menu surface (primitive marker first, hashed class as the fallback). */
const HOST_MENU = '[data-menu-material], [class*="_7KE1Ra_menu"]'

/**
 * The field the drill-in focus must not reach on phones: the model pane's
 * search box. Scoped two ways — inside a host menu surface, or carrying the
 * model list's own `-models` control — so neither the shortcut modal's search
 * field nor a settings-page input ever matches.
 */
const MODEL_SEARCHBOX =
  '[data-menu-material] input[role="searchbox"], input[role="searchbox"][aria-controls$="-models"]'

/** How long the shadow stays armed after the last tap while no menu is up. */
const IDLE_DISARM_MS = 2_000

/**
 * Keep the model menu's search field from grabbing focus (and the soft
 * keyboard) by itself, on the mobile breakpoint only.
 * @param ctx - client root context.
 */
export function installModelMenuKeyboardGuard(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: model menu keyboard guard', () => {
    // The shared manager owns the single prototype patch: with the shortcut
    // modal's guard (or any future guard) loaded at the same time, neither can
    // wipe the other's rule or leave a stale wrapper behind (see
    // core/prototype-focus-shadow.ts).
    let release: (() => void) | null = null
    let idleTimer = 0

    const arm = (): void => {
      if (release !== null) return
      release = shadowFocus((element) => element.matches(MODEL_SEARCHBOX))
    }

    const disarm = (): void => {
      release?.()
      release = null
    }

    const onPointerDown = (): void => {
      // A tap is the moment before React can open the menu or drill into a
      // pane, so arm now; the check below only decides when to give the
      // prototype back, and a menu opened by this same gesture keeps it armed.
      arm()
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        if (document.querySelector(HOST_MENU) === null) disarm()
      }, IDLE_DISARM_MS)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.clearTimeout(idleTimer)
      disarm()
    }
  })
}
