// Shared CSS-source slicing for the band tests.
//
// `tests/lib/` is test infrastructure, not a test: it sits outside the
// `tests/*.test.ts` glob (and therefore outside the counted-claim gate).
//
// Both band tests pin the same block of src/client/styles/base.css.ts, so the
// endpoints live here once. `sliceBand` returns the marker offsets alongside
// the text and throws when either marker is missing, naming it: a missing
// marker must fail here, not as a downstream regex mismatch against ''.
import assert from 'node:assert/strict'

export interface CssBand {
  /** Offset of the start marker (never -1: sliceBand throws instead). */
  start: number
  /** Offset of the end marker after the start (never -1: sliceBand throws instead). */
  end: number
  /** Start-marker-to-end-marker slice (never empty). */
  text: string
}

export function sliceBand(source: string, startMarker: string, endMarker: string): CssBand {
  const start = source.indexOf(startMarker)
  if (start === -1) throw new Error(`CSS band start marker not found: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  if (end <= start) throw new Error(`CSS band end marker not found after the start marker: ${endMarker}`)
  return { start, end, text: source.slice(start, end) }
}

/** Declarations of the rule whose selector starts at `selectorAt`.
 *
 * A plain `indexOf('}')` cannot delimit a band rule: closing braces are
 * indented by two spaces and matching the selector plus `{ z-index }` anywhere
 * in the band is satisfied by a sibling rule with the same selector. Read only
 * this selector's own block, and fail loud when it never closes —
 * `slice(at, indexOf('}', at))` would instead clip the last character and let
 * the assertion run on a truncated fragment. The message names the selector.
 *
 * Both brace guards are load-bearing. The first one rejects a `}` between the
 * selector and its `{` (the opening brace was deleted, so `open` is already a
 * later rule's block). The second one rejects a `{` before the closing brace
 * (the closing brace was deleted, so a sibling's block would be swallowed).
 * Without them a damaged fixture can still satisfy the assertion by reading the
 * sibling rule that carries the same value — green, for the wrong reason. */
export function ruleBodyAt(band: string, selector: string, selectorAt: number): string {
  const open = band.indexOf('{', selectorAt)
  assert.ok(
    open > selectorAt && band.lastIndexOf('}', open) < selectorAt,
    `rule has no declaration block: ${selector}`,
  )
  const close = band.indexOf('}', open)
  const nested = band.indexOf('{', open + 1)
  assert.ok(
    close !== -1 && (nested === -1 || close < nested),
    `rule has no closing brace: ${selector}`,
  )
  return band.slice(open + 1, close)
}

/** Header comment of the mobile popover band in base.css.ts. */
export const POPOVER_BAND_START = 'popover band above the open drawer'
/** Section comment that closes the mobile popover band. */
export const POPOVER_BAND_END = '/* Floating fallback button'
