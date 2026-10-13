// Platform layer: engine/device probes. Moved out of effects/phone-chrome.ts
// (architecture P1) so the two composer keyboard guards depend on the platform
// layer instead of on another effect.

/**
 * Whether the page runs on iOS / iPadOS WebKit, where focusing a text field
 * whose computed font-size is below 16px zooms the whole visual viewport
 * (#45). Every other engine ignores field font-size, so the 16px floor in
 * misc.css.ts is gated on this marker instead of applying to every phone —
 * Android would only get bigger search boxes for no benefit.
 *
 * Pure and injectable so the decision table is unit-testable:
 * - The feature probe is the reliable signal: `font: -apple-system-body` is
 *   Safari-only and `-webkit-touch-callout` is an iOS property, so the pair
 *   is true on iOS WebKit (including Chrome / Edge / Opera on iOS, which are
 *   WebKit and zoom identically) and false on Chromium (measured) and on
 *   macOS Safari.
 * - The UA fallback covers engines whose CSS.supports is missing or which
 *   parse the probe differently: iPhone / iPad / iPod UAs, plus iPadOS 13+
 *   which reports a Macintosh UA and is told apart by its touch points.
 */
export function detectIosWebKit(
  nav: { userAgent: string; maxTouchPoints: number },
  supports: ((condition: string) => boolean) | null,
): boolean {
  if (supports !== null) {
    try {
      if (supports('(font: -apple-system-body) and (-webkit-touch-callout: none)')) return true
    } catch {
      // A UA that rejects the condition string falls through to the UA test.
    }
  }
  const ua = nav.userAgent
  if (/iP(hone|ad|od)/.test(ua)) return true
  return /Macintosh/.test(ua) && nav.maxTouchPoints > 1
}
