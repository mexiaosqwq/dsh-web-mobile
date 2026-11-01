import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = new URL('..', import.meta.url).pathname
const LOCK = readFileSync(join(ROOT, 'src/client/effects/document-scroll-lock.ts'), 'utf8')
const INDEX = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')

test('the document scroll lock is armed and pins the scroll back to zero', () => {
  // 2026-10-31 dumps: scrollY === visualViewport.offsetTop in 1604/1604 samples,
  // and frameTop === -scrollY in 1604/1604 — the "keyboard pan" is the document
  // scroll, and any nonzero value displaces the whole shell.
  assert.match(LOCK, /installMobileEffect\(/)
  assert.match(LOCK, /window\.scrollX !== 0 \|\| window\.scrollY !== 0/)
  // Undoing is not enough — the call itself is refused (one frame of it is one
  // frame of the shell sitting 339px above the band).
  assert.match(LOCK, /window\.scrollBy = patchedScrollBy/)
  assert.match(LOCK, /window\.scrollTo = patchedScrollTo/)
  assert.match(LOCK, /nativeScrollTo\(0, 0\)/)
  // Both channels: the host calls window.scrollBy (window 'scroll' fires), and a
  // nested scroller bubbling a scroll event must not slip through either.
  assert.match(LOCK, /addEventListener\('scroll', pin/)
  assert.match(LOCK, /removeEventListener\('scroll', pin/)
})

test('the scroll lock is registered with the other mobile effects', () => {
  assert.match(INDEX, /import \{ installDocumentScrollLock \} from '\.\/effects\/document-scroll-lock\.ts'/)
  assert.match(INDEX, /installDocumentScrollLock\(ctx\)/)
})

test('the shell keeps the CSS that made it stop scrolling in the first place', () => {
  const LAYOUT = readFileSync(join(ROOT, 'src/client/styles/layout.css.ts'), 'utf8')
  assert.match(LAYOUT, /overflow: hidden !important;\s*\n\s*overscroll-behavior: none !important;/)
  assert.match(LAYOUT, /height: var\(--dsha-mobile-visible-vh, 100%\) !important;/)
  // position: fixed on html/body broke the document paint on device; it must not
  // come back.
  assert.doesNotMatch(LAYOUT, /position: fixed !important;\s*\n\s*inset: 0 !important;/)
})
