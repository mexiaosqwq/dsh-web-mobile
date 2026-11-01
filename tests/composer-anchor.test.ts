import assert from 'node:assert/strict'
import test from 'node:test'
import { carriesComposer, isRingCandidate, locateRing } from '../src/client/platform/composer-anchor.ts'

// Minimal stand-in for the two host shapes that matter. The real ones are read
// from @deepseek-ai/dsh-client-ui-conversation:
//   ring  = ContextMeter: <span><button><svg viewBox="0 0 14 14"><circle class="_track"/>
//           <circle class="_fill" stroke-dasharray="…"/></svg>45%</button></span>
//   card  = the composer card, whose text can mention a percentage too.

interface FakeOptions {
  text?: string
  circles?: number
  dash?: string
  matches?: boolean
  containsComposer?: boolean
}

const fake = (options: FakeOptions): Element => {
  const circles = Array.from({ length: options.circles ?? 0 }, () => ({} as Element))
  const node = {
    textContent: options.text ?? '',
    contains: () => options.containsComposer === true,
    matches: () => options.matches === true,
    querySelector: () => (options.containsComposer === true ? ({} as Element) : null),
    querySelectorAll: () => circles,
  }
  globalThis.getComputedStyle = ((element: Element) => ({
    strokeDasharray: (element as unknown as { __dash?: string }).__dash ?? options.dash ?? 'none',
  })) as unknown as typeof getComputedStyle
  for (const circle of circles) (circle as unknown as { __dash?: string }).__dash = options.dash
  return node as unknown as Element
}

const stats = { contains: () => false } as unknown as Element

test('a drawn progress ring is the ring', () => {
  assert.equal(isRingCandidate(fake({ text: '45%', circles: 2, dash: '34.56px 34.56px' }), stats), true)
})

test('a node that merely mentions a percentage is not the ring', () => {
  // 2026-10-31: the composer card's model line read like a percentage, the walk
  // took the card, and the fold moved the whole composer to left:299px.
  assert.equal(isRingCandidate(fake({ text: '45% of context used', circles: 0 }), stats), false)
})

test('an undrawn ring (dash 0) is not a ring yet', () => {
  assert.equal(isRingCandidate(fake({ text: '0%', circles: 2, dash: '0px 0px' }), stats), false)
  assert.equal(isRingCandidate(fake({ text: '0%', circles: 2, dash: 'none' }), stats), false)
})

test('the stats line itself and anything carrying the composer are never the ring', () => {
  assert.equal(isRingCandidate(fake({ circles: 2, dash: '3px 3px', containsComposer: true }), stats), false)
  assert.equal(isRingCandidate(fake({ circles: 2, dash: '3px 3px', matches: true }), stats), false)
})

test('carriesComposer recognises the composer card and controls by selector', () => {
  assert.equal(carriesComposer(fake({ matches: true })), true)
  assert.equal(carriesComposer(fake({ containsComposer: true })), true)
  assert.equal(carriesComposer(fake({})), false)
})

// --- hierarchy: the ring is the dock's other child -------------------------
// Host structure (InputBar.tsx):
//   <div data-composer-dock>{slot: stats pills}<ContextMeter/></div>

const element = (init: { containsStats?: boolean; dock?: Element | null; children?: Element[] }): Element => {
  const children = init.children ?? []
  const node = {
    textContent: '',
    children,
    contains: () => init.containsStats === true,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    hasAttribute: () => false,
    closest: (selector: string) => (selector.includes('data-composer-dock') ? init.dock ?? null : null),
    parentElement: null,
  }
  return node as unknown as Element
}

test('the ring is the dock child that does not hold the stats pills', () => {
  const ring: Element = { ...(element({}) as object), } as Element
  const pills = element({ containsStats: true })
  const dock = element({ children: [pills, ring] })
  const stats = element({ containsStats: true })
  ;(stats as unknown as { closest: (s: string) => Element | null }).closest = () => dock
  const located = locateRing(stats)
  assert.equal(located?.ring, ring)
  assert.equal(located?.dock, dock)
})

test('with no dock ancestor the stack walk is still used', () => {
  const ring = fake({ text: '45%', circles: 2, dash: '34.56px 34.56px' })
  const parent = element({ children: [ring] })
  ;(parent as unknown as { contains: () => boolean }).contains = () => false
  const stats = element({})
  ;(stats as unknown as { closest: () => Element | null }).closest = () => null
  ;(stats as unknown as { parentElement: Element | null }).parentElement = parent
  const located = locateRing(stats)
  assert.equal(located?.ring, ring)
})
