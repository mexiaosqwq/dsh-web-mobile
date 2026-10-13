import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { detectIosWebKit } from '../platform/device.ts'
import { installMobileEffect } from '../platform/breakpoints.ts'

/**
 * Issue #149 mitigation: keep the iOS keyboard's composer above the system
 * form-assistant bar.
 *
 * Root cause (host side, unfixed through dsh-client-ui-conversation
 * 0.2.1-alpha.1): the bundled Lexical selection-scroll helper compares its
 * window-branch visible band `[visualViewport.offsetTop, offsetTop + height]`
 * — LAYOUT coordinates — with the caret's `getBoundingClientRect` — VISUAL
 * coordinates. The frames only agree at window scroll 0, which holds on
 * desktop and Android (adjustResize shrinks the layout viewport and keeps
 * scroll at 0). The iOS keyboard instead forces a nonzero window scroll (the
 * reporter's iPhone 13 Pro: 417 = 844 − 427), so every keystroke computes a
 * bogus negative `window.scrollBy(0, f)` (−158px) that drops the sticky
 * composer seat — and with it the text row, send button and stats row —
 * behind the keyboard. Upstream family: Lexical #8848/#6277, WebKit 46bfd8e.
 *
 * Mitigation contract (derivation in tests/composer-keyboard-lift.test.ts):
 * - iOS WebKit only, mobile branch only, and only while the composer editing
 *   surface holds focus.
 * - The lift comes from screen-space quantities only: the seat's
 *   `getBoundingClientRect().bottom` against `visualViewport.height`. No
 *   layout-viewport quantity (inner height, vh units, scroll-padding) may
 *   enter the math — that mixup is the incident itself.
 * - Fail open (lift 0, the known status quo) whenever the screen-space model
 *   is unverified: pinch `vv.scale !== 1`, or `scrollY` and `vv.offsetTop`
 *   disagreeing beyond tolerance (a visual-viewport pan, or an engine that
 *   changes its keyboard-scroll model, separates the channels).
 * - A rect already includes the transform we applied, so the adapter adds
 *   the applied lift back before comparing — without that the fixed point
 *   self-cancels and oscillates.
 * - Every listener, the rAF and the inline transform die on focusout or
 *   disposal.
 *
 * DOM contract (docs/debug/composer-tree-recon.md): the seat
 * `[class*="_composerSeat"]` is host-owned and hashed (the substring is
 * unique against `_composerStack`) and wraps the card AND the stats row, so
 * one transform lifts the whole block; scope it under the frame marker. The
 * focus anchor `[data-composer-input]` is the Lexical surface, the same
 * marker composer-keyboard-guard.ts audits.
 *
 * The active path cannot be verified headless (`detectIosWebKit` is false in
 * chromium, pitfalls §键盘 guard); acceptance is the reporter's device.
 */

/** Inputs of the pure lift decision, read fresh by the adapter per event. */
export interface ComposerLiftState {
  /** Seat `rect.bottom` with the applied lift added back (screen px). */
  seatBottom: number
  /** `visualViewport.height` — keyboard assembly top on screen (scale 1 only). */
  viewportHeight: number
  /** `visualViewport.scale`. */
  scale: number
  /** `window.scrollY`, cross-checked against `offsetTop`. */
  scrollY: number
  /** `visualViewport.offsetTop`, cross-checked against `scrollY`. */
  offsetTop: number
}

/** How far the two scroll channels may drift before the coordinate model
 *  counts as unverified: covers rounding and event-order jitter, still small
 *  enough to catch a real visual-viewport pan. */
export const CHANNEL_TOLERANCE_PX = 24

/** CSS px to lift the composer seat by; 0 rests (fail-open for every
 *  unverified model, not just for "no overlap"). */
export function computeComposerLift(state: ComposerLiftState): number {
  const { seatBottom, viewportHeight, scale, scrollY, offsetTop } = state
  if (!Number.isFinite(seatBottom) || !Number.isFinite(viewportHeight)) return 0
  if (!Number.isFinite(scale) || Math.abs(scale - 1) > 0.01) return 0
  if (!Number.isFinite(scrollY) || !Number.isFinite(offsetTop)) return 0
  if (Math.abs(scrollY - offsetTop) > CHANNEL_TOLERANCE_PX) return 0
  const overlap = seatBottom - viewportHeight
  return overlap > 0 ? overlap : 0
}

/** Host composer seat, scoped under the plugin frame marker. */
const SEAT_SELECTOR = '[data-mobile-nav="frame"] [class*="_composerSeat"]'

/** The Lexical editing surface — the only focus that arms the lift. */
const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

export function installComposerKeyboardLift(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: composer keyboard lift', () => {
    if (
      !detectIosWebKit(
        navigator,
        typeof CSS !== 'undefined' && typeof CSS.supports === 'function' ? CSS.supports.bind(CSS) : null,
      )
    ) {
      return undefined
    }
    const viewport = window.visualViewport
    if (!viewport) return undefined

    let seat: HTMLElement | null = null
    let appliedLift = 0
    let frame = 0

    const sync = (): void => {
      frame = 0
      if (seat === null || !seat.isConnected) return
      const lift = computeComposerLift({
        // The rect already carries our own transform: add the applied lift
        // back so `seatBottom` reads as the un-lifted screen bottom.
        seatBottom: seat.getBoundingClientRect().bottom + appliedLift,
        viewportHeight: viewport.height,
        scale: viewport.scale,
        scrollY: window.scrollY,
        offsetTop: viewport.offsetTop,
      })
      appliedLift = lift
      seat.style.transform = lift > 0 ? `translateY(${-lift}px)` : ''
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(sync)
    }

    const release = (): void => {
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('scroll', schedule)
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      if (seat !== null) seat.style.transform = ''
      seat = null
      appliedLift = 0
    }

    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || target.closest(COMPOSER_INPUT_SELECTOR) === null) return
      release()
      const found = document.querySelector<HTMLElement>(SEAT_SELECTOR)
      if (found === null) return
      seat = found
      viewport.addEventListener('resize', schedule)
      viewport.addEventListener('scroll', schedule)
      window.addEventListener('scroll', schedule, { passive: true })
      schedule()
    }
    const onFocusOut = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || target.closest(COMPOSER_INPUT_SELECTOR) === null) return
      const next = event.relatedTarget
      // Focus moving inside the seat keeps the keyboard up: stay armed.
      if (next instanceof Element && next.closest(SEAT_SELECTOR) !== null) return
      release()
    }

    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    return () => {
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      release()
    }
  })
}
