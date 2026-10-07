// Parity harness for the TWO copies of `planReasoningEffortFill`.
//
// The host half (`src/reasoning-effort.ts`) and the browser half
// (`src/client/effects/reasoning-defaults.ts`) each own a copy of the planner:
// the host copy is emitted into the host bundle, the client copy is inlined
// into `lib/client.js` by the client bundler, and neither build can import the
// other's module. Until the two halves share one module, the two copies can
// drift silently — the only guard so far is a "keep the two in step" comment.
//
// This file is the drift alarm: every case is planned by BOTH implementations
// and the resulting op batches must be identical, op for op. The table is
// built from the rules the module headers call load-bearing (user layer only,
// declared levels untouched, lower layers never materialized, modelOverrides
// addressed by path), so a rule that changes in one file only fails here
// instead of on a phone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_REASONING_EFFORTS as HOST_DEFAULTS,
  LLM_PI_AI_ENTRY as HOST_ENTRY,
  planReasoningEffortFill as planHost,
} from '../src/reasoning-effort.ts'
import {
  DEFAULT_REASONING_EFFORTS as CLIENT_DEFAULTS,
  LLM_PI_AI_ENTRY as CLIENT_ENTRY,
  planReasoningEffortFill as planClient,
} from '../src/client/effects/reasoning-defaults.ts'

/** One route object shaped like the profile patch layer. */
function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { baseURL: 'https://gateway.example/v1', api: 'openai-completions', ...overrides }
}

/** Deep-freeze a value so an implementation that mutates its arguments throws. */
function frozen<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  for (const entry of Object.values(value as Record<string, unknown>)) frozen(entry)
  return Object.freeze(value)
}

interface ParityCase {
  /** The rule this case pins, named after the module contracts. */
  readonly rule: string
  /** The merged section: a literal, or a function deriving it from `user`. */
  readonly resolved: unknown
  readonly user: unknown
}

const CASES: readonly ParityCase[] = [
  {
    rule: 'fills a hand-declared model in the user layer',
    resolved: user => user,
    user: { providers: { a: profile({ models: [{ id: 'm', name: 'M' }] }) } },
  },
  {
    rule: 'never restates levels the user already declared',
    resolved: user => user,
    user: { providers: { a: profile({ models: [{ id: 'm', reasoningEfforts: { off: null, low: 'low', high: 'ultra', max: 'max' } }] }) } },
  },
  {
    rule: 'treats an explicit falsy level set as declared',
    resolved: user => user,
    user: { providers: { a: profile({ models: [{ id: 'm', reasoningEfforts: false }] }) } },
  },
  {
    rule: 'leaves a model whose levels come from a lower layer alone',
    resolved: { providers: { a: profile({ models: [{ id: 'm', reasoningEfforts: { high: 'high' } }] }) } },
    user: { providers: { a: profile({ models: [{ id: 'm' }] }) } },
  },
  {
    rule: 'counts resolved models past the user-layer array instead of materializing them',
    resolved: { providers: { a: profile({ models: [{ id: 'distant', name: 'Distant' }] }) } },
    user: { providers: { a: profile({ models: [{ id: 'mine', name: 'Mine' }] }) } },
  },
  {
    rule: 'plans nothing for a route whose user layer declares no models list',
    resolved: { providers: { a: profile({ models: [{ id: 'one' }, { id: 'two' }] }) } },
    user: { providers: { a: profile() } },
  },
  {
    rule: 'fills modelOverrides one path at a time',
    resolved: { providers: { catalog: profile({ modelOverrides: { inherited: { contextWindow: 200000, reasoningEfforts: { high: 'high' } } } }) } },
    user: {
      providers: {
        catalog: profile({
          modelOverrides: {
            needs: { contextWindow: 262144 },
            has: { reasoningEfforts: { high: 'high' } },
            inherited: { contextWindow: 200000 },
          },
        }),
      },
    },
  },
  {
    rule: 'handles several routes in one pass',
    resolved: user => user,
    user: {
      providers: {
        a: profile({ models: [{ id: 'a1' }] }),
        b: profile({ models: [{ id: 'b1', reasoningEfforts: { high: 'high' } }, { id: 'b2' }] }),
        c: profile({ modelOverrides: { c1: {} } }),
      },
    },
  },
  {
    rule: 'passes a non-record model entry through untouched',
    resolved: user => user,
    user: { providers: { a: profile({ models: [{ id: 'ok' }, null, 'stray'] }) } },
  },
  {
    rule: 'plans nothing without a usable user layer',
    resolved: { providers: { a: profile({ models: [{ id: 'm' }] }) } },
    user: undefined,
  },
  {
    rule: 'plans nothing when providers is not a record',
    resolved: { providers: { a: profile({ models: [{ id: 'm' }] }) } },
    user: { providers: 'nope' },
  },
]

/** Cases whose `resolved` mirrors the user layer (the common single-layer case). */
function resolve(caseValue: ParityCase): { resolved: unknown; user: unknown } {
  const user = caseValue.user
  const given = caseValue.resolved
  const resolved = typeof given === 'function' ? (given as (user: unknown) => unknown)(user) : given
  return { resolved, user }
}

test('both halves declare the same entry id and the same default level set', () => {
  assert.equal(HOST_ENTRY, CLIENT_ENTRY)
  assert.deepEqual(HOST_DEFAULTS, CLIENT_DEFAULTS)
  // The default set is the one both module headers describe; changing it in one
  // file only would otherwise reach users on one half of the plugin.
  assert.deepEqual(HOST_DEFAULTS, { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' })
})

test('the parity table covers the load-bearing rules', () => {
  assert.ok(CASES.length >= 11, 'keep the drift table populated')
})

for (const entry of CASES) {
  test(`parity: ${entry.rule}`, () => {
    const { resolved, user } = resolve(entry)
    const before = JSON.stringify({ resolved, user })
    const host = planHost(frozen(resolved), frozen(user))
    const client = planClient(frozen(resolved), frozen(user))
    // Ops are compared as whole batches: a path change, a value change, a
    // missing op and an extra op all fail here.
    assert.deepEqual(client.ops, host.ops)
    assert.equal(client.filled, host.filled)
    // The freeze above already rejects a write; the snapshot catches a mutation
    // the freeze cannot see (a copy the planner then mutates in place).
    assert.equal(JSON.stringify({ resolved, user }), before, 'neither planner may mutate its arguments')
  })
}

test('the host-only counters stay host-only', () => {
  const user = frozen({ providers: { a: profile({ models: [{ id: 'm' }] }) } })
  const host = planHost(user, user)
  const client = planClient(user, user)
  // `unresolved` is a logging aid the host half uses; the browser half has no
  // logger for it. The asymmetry is intentional and must not grow into an op
  // difference (asserted above).
  assert.deepEqual(Object.keys(host).sort(), ['filled', 'ops', 'unresolved'])
  assert.deepEqual(Object.keys(client).sort(), ['filled', 'ops'])
})
