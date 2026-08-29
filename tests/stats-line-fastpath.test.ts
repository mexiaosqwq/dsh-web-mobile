import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statsAnchorAlive } from '../src/client/effects/stats-line.ts'

const fake = (opts: { connected?: boolean; phase?: boolean; stack?: boolean }): Element =>
  ({
    isConnected: opts.connected !== false,
    closest(sel: string): Element | null {
      if (sel === '[data-phase]') return opts.phase === false ? null : ({} as Element)
      if (sel === '[class*="_composerStack"]') return opts.stack === false ? null : ({} as Element)
      return null
    },
  }) as unknown as Element

test('statsAnchorAlive decision table', () => {
  assert.equal(statsAnchorAlive(null), false)
  assert.equal(statsAnchorAlive(fake({ connected: false })), false)
  assert.equal(statsAnchorAlive(fake({ phase: false })), false)
  assert.equal(statsAnchorAlive(fake({ stack: false })), false)
  assert.equal(statsAnchorAlive(fake({})), true)
})
