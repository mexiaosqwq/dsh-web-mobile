// Shared CSS-source slicing for the band tests.
//
// `tests/lib/` is test infrastructure, not a test: it sits outside the
// `tests/*.test.ts` glob (and therefore outside the counted-claim gate).
//
// Both band tests pin the same block of src/client/styles/base.css.ts, so the
// endpoints live here once. `sliceBand` returns the marker offsets alongside
// the text: a caller asserts on them, so a missing marker fails with "which
// marker is missing" instead of a downstream regex mismatch against ''.

export interface CssBand {
  /** Offset of the start marker, -1 when it is absent. */
  start: number
  /** Offset of the end marker, -1 when it is absent or the start is. */
  end: number
  /** Start-marker-to-end-marker slice; empty when a marker is missing. */
  text: string
}

export function sliceBand(source: string, startMarker: string, endMarker: string): CssBand {
  const start = source.indexOf(startMarker)
  const end = start === -1 ? -1 : source.indexOf(endMarker, start)
  return {
    start,
    end,
    text: start !== -1 && end > start ? source.slice(start, end) : '',
  }
}

/** Header comment of the mobile popover band in base.css.ts. */
export const POPOVER_BAND_START = 'popover band above the open drawer'
/** Section comment that closes the mobile popover band. */
export const POPOVER_BAND_END = '/* Floating fallback button'
