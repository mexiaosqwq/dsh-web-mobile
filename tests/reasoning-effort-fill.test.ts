// Host half: default thinking-effort levels for hand-declared `llm-pi-ai`
// models. The planner is pure, so every rule below is pinned as data:
//   - the level set is added only where the USER's layer carries the model,
//   - an entry that already declares levels (user or resolved) is never touched,
//   - entries only a lower layer supplies are counted, never materialized,
//   - `modelOverrides` are addressed by path, not by rewriting the dict.
// The store face is exercised through fakes, so `describe`/`mutate` contract
// drift shows up here instead of on a phone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_REASONING_EFFORTS,
  LLM_PI_AI_ENTRY,
  fillReasoningEffortDefaults,
  planReasoningEffortFill,
  type SettingsFace,
  type SettingsPathOp,
} from '../src/reasoning-effort.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** One route object shaped like the profile patch layer. */
function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { baseURL: 'https://gateway.example/v1', api: 'openai-completions', ...overrides }
}

/** `describe()` output carrying one `llm-pi-ai` descriptor. */
function described(value: unknown, user: unknown, revision = 7): unknown[] {
  return [
    { ns: 'ui-settings-general', value: {}, user: {} },
    { ns: LLM_PI_AI_ENTRY, value, user, revision },
  ]
}

/** A settings face whose `mutate` records its calls. */
function recordingSettings(value: unknown, user: unknown, revision = 7): { face: SettingsFace; calls: unknown[][] } {
  const calls: unknown[][] = []
  const face: SettingsFace = {
    describe: () => described(value, user, revision),
    mutate: (...args: unknown[]) => {
      calls.push(args)
      return Promise.resolve(revision + 1)
    },
  }
  return { face, calls }
}

test('adds the default level set to a hand-declared model', () => {
  const user = {
    providers: {
      a: profile({
        models: [{ id: 'glm-5.3-flash', name: 'glm-5.3-flash' }],
      }),
    },
  }
  const plan = planReasoningEffortFill(user, user)
  assert.equal(plan.filled, 1)
  assert.equal(plan.unresolved, 0)
  assert.deepEqual(plan.ops, [
    {
      op: 'set',
      path: ['providers', 'a', 'models'],
      value: [{ id: 'glm-5.3-flash', name: 'glm-5.3-flash', reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } }],
    },
  ])
  // The planner is pure: neither argument gained the field.
  const models = (user.providers.a as { models: unknown[] }).models
  assert.equal('reasoningEfforts' in (models[0] as Record<string, unknown>), false)
})

test('the default set is the union of the two gateway conventions, with `off` valueless (2026-10-07)', () => {
  // Classic OpenAI trio (low/medium/high) ∪ DeepSeek/kimi/GLM family
  // (low/high/max) — the ecosystem survey's answer, and a strict superset of
  // the three levels shipped before. `off: null` omits the parameter; a
  // generic set that drops `max` (or one that drops `medium`) leaves one of the
  // two conventions without a level it supports.
  assert.deepEqual(DEFAULT_REASONING_EFFORTS, { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' })
})

test('never restates a level set the user already declared', () => {
  const user = {
    providers: {
      a: profile({
        models: [{ id: 'm', reasoningEfforts: { off: null, low: 'low', high: 'ultra', max: 'max' } }],
      }),
    },
  }
  const plan = planReasoningEffortFill(user, user)
  assert.equal(plan.filled, 0)
  assert.deepEqual(plan.ops, [])
})

test('leaves a model whose level set comes from a lower layer alone', () => {
  const user = { providers: { a: profile({ models: [{ id: 'm' }] }) } }
  const resolved = { providers: { a: profile({ models: [{ id: 'm', reasoningEfforts: { high: 'high' } }] }) } }
  const plan = planReasoningEffortFill(resolved, user)
  assert.equal(plan.filled, 0)
  assert.deepEqual(plan.ops, [])
})

test('counts resolved models past the user-layer array instead of materializing them', () => {
  const user = { providers: { a: profile({ models: [{ id: 'mine' }] }) } }
  const resolved = {
    providers: { a: profile({ models: [{ id: 'mine' }, { id: 'catalog-only' }] }) },
  }
  const plan = planReasoningEffortFill(resolved, user)
  assert.equal(plan.filled, 1)
  assert.equal(plan.unresolved, 1)
  assert.equal((plan.ops[0].value as unknown[]).length, 1)
})

test('counts models of a route whose user layer declares no models list', () => {
  const user = { providers: { a: profile() } }
  const resolved = { providers: { a: profile({ models: [{ id: 'one' }, { id: 'two' }] }) } }
  const plan = planReasoningEffortFill(resolved, user)
  assert.deepEqual(plan.ops, [])
  assert.equal(plan.unresolved, 2)
})

test('fills modelOverrides one path at a time, and only when nothing declares levels', () => {
  const user = {
    providers: {
      catalog: profile({
        modelOverrides: {
          needs: { contextWindow: 262144 },
          has: { reasoningEfforts: { high: 'high' } },
          inherited: { contextWindow: 200000 },
        },
      }),
    },
  }
  const resolved = {
    providers: {
      catalog: profile({
        modelOverrides: {
          needs: { contextWindow: 262144 },
          has: { reasoningEfforts: { high: 'high' } },
          inherited: { contextWindow: 200000, reasoningEfforts: { high: 'high' } },
        },
      }),
    },
  }
  const plan = planReasoningEffortFill(resolved, user)
  assert.equal(plan.filled, 1)
  assert.deepEqual(plan.ops, [
    {
      op: 'set',
      path: ['providers', 'catalog', 'modelOverrides', 'needs', 'reasoningEfforts'],
      value: { ...DEFAULT_REASONING_EFFORTS },
    },
  ])
})

test('every op stays under providers (no write can reach an unrelated field)', () => {
  const user = {
    providers: {
      a: profile({ models: [{ id: 'm' }], modelOverrides: { o: {} } }),
    },
  }
  const plan = planReasoningEffortFill(user, user)
  assert.ok(plan.ops.length > 0)
  for (const op of plan.ops) assert.equal(op.path[0], 'providers')
})

test('a missing user layer plans nothing', () => {
  assert.deepEqual(planReasoningEffortFill(undefined, undefined).ops, [])
  assert.deepEqual(planReasoningEffortFill({ providers: {} }, {}).ops, [])
  assert.deepEqual(planReasoningEffortFill({ providers: {} }, { providers: 'nope' }).ops, [])
})

test('fill writes one mutate batch carrying the revision it read', async () => {
  const user = { providers: { a: profile({ models: [{ id: 'm' }] }) } }
  const { face, calls } = recordingSettings(user, user, 11)
  const outcome = await fillReasoningEffortDefaults(face)
  assert.equal(outcome.status, 'filled')
  assert.equal(outcome.filled, 1)
  assert.equal(calls.length, 1)
  const [ns, ops, revision] = calls[0] as [string, SettingsPathOp[], number]
  assert.equal(ns, LLM_PI_AI_ENTRY)
  assert.equal(revision, 11)
  assert.equal(ops[0].op, 'set')
})

test('fill reports unavailable without a usable service face', async () => {
  assert.equal((await fillReasoningEffortDefaults(undefined)).status, 'unavailable')
  assert.equal((await fillReasoningEffortDefaults({})).status, 'unavailable')
  assert.equal((await fillReasoningEffortDefaults({ describe: () => [] })).status, 'unavailable')
  assert.equal((await fillReasoningEffortDefaults({ mutate: () => undefined })).status, 'unavailable')
})

test('fill is quiet when every reachable model already declares levels', async () => {
  const user = { providers: { a: profile({ models: [{ id: 'm', reasoningEfforts: { high: 'high' } }] }) } }
  const { face, calls } = recordingSettings(user, user)
  const outcome = await fillReasoningEffortDefaults(face)
  assert.equal(outcome.status, 'nothing-to-do')
  assert.equal(calls.length, 0)
})

test('a refused write reports failed instead of throwing', async () => {
  const user = { providers: { a: profile({ models: [{ id: 'm' }] }) } }
  const face: SettingsFace = {
    describe: () => described(user, user),
    mutate: () => Promise.reject(new Error('revision conflict')),
  }
  const outcome = await fillReasoningEffortDefaults(face)
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.filled, 0)
})

// --- Source invariants: the wiring stays where the contract says it is ------

test('the host entry wires the fill inside the settings inject scope', () => {
  const source = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')
  assert.match(source, /ctx\.inject\(\['settings'\]/)
  assert.match(source, /fillReasoningEffortDefaults\(settings\)/)
  // Re-arm on the document event for the owning entry only (a model added in
  // the Models page fills without a restart).
  assert.match(source, /'settings\/document-updated'/)
  assert.match(source, /args\[0\] === LLM_PI_AI_ENTRY/)
})

test('the initial pass retries while `llm-pi-ai` is not yet describable', () => {
  const source = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')
  // `describe()` lists only ACTIVE entries, and this plugin can apply while the
  // adapter is still loading: one early miss must not be final, because no
  // document change follows an initial load.
  assert.match(source, /const retryable = outcome\.status === 'unavailable' \|\| outcome\.status === 'failed'/)
  assert.match(source, /timer = setTimeout\(run, RETRY_DELAYS_MS\[attempts\+\+\]\)/)
  // The pending retry is scope-owned, and a later service provide re-runs until
  // the section is describable.
  assert.match(source, /clearTimeout\(timer\)/)
  assert.match(source, /'internal\/service'/)
  assert.match(source, /if \(!settled\) run\(\)/)
})

test('a slow sweep re-reads the section without anyone else describing it', () => {
  const source = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')
  // The change event is a side effect of the NEXT `describe()`: if nothing
  // re-reads the section after an edit, no event ever fires. The sweep is the
  // safety net that makes the fill independent of other components' reads.
  assert.match(source, /const SWEEP_INTERVAL_MS = 10_000/)
  assert.match(source, /setInterval\(schedule, SWEEP_INTERVAL_MS\)/)
  assert.match(source, /clearInterval\(sweep\)/)
})

test('a failed fill reports why instead of swallowing it', async () => {
  const user = { providers: { a: profile({ models: [{ id: 'm' }] }) } }
  const face: SettingsFace = {
    describe: () => described(user, user),
    mutate: () => Promise.reject(new Error('nested transaction')),
  }
  const outcome = await fillReasoningEffortDefaults(face)
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.reason, 'nested transaction')
})

test('the module writes through the settings service only, never a file', () => {
  const source = readFileSync(join(ROOT, 'src/reasoning-effort.ts'), 'utf8')
  assert.doesNotMatch(source, /node:fs|writeFile|readFile/)
  assert.match(source, /settings\.mutate\(LLM_PI_AI_ENTRY, plan\.ops, revision\)/)
})

test('a settings event defers the fill out of the service write', () => {
  const source = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')
  // `settings/document-updated` is emitted from inside `describe()`, which the
  // service runs while holding its write transaction: a mutate issued straight
  // from the listener is refused as a nested transaction, so the handler only
  // schedules and the timer owns the fill.
  assert.match(source, /if \(args\[0\] === LLM_PI_AI_ENTRY\) schedule\(\)/)
  assert.match(source, /scheduled = setTimeout\(/)
  assert.match(source, /clearTimeout\(scheduled\)/)
})

// --- Disposal latching and write bounding (2026-10-07 audit H1/H2) ----------

test('disposal latches so an in-flight fill cannot re-arm a retry timer', () => {
  const source = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')
  // The retry timer is armed from inside the async fill's `.then`, so a scope
  // disposed while a fill was in flight would otherwise get a fresh timer after
  // the disposer already ran (up to 3 more fills on a hot reload).
  assert.match(source, /let disposed = false/)
  assert.match(source, /if \(disposed \|\| running\) return/)
  assert.match(source, /if \(!disposed && retryable && attempts < RETRY_DELAYS_MS\.length\)/)
  assert.match(source, /if \(disposed \|\| scheduled !== undefined\) return/)
  assert.match(source, /disposed = true\s*\n\s*settled = true/)
})

test('the sweep handle is declared before the disposer that clears it', () => {
  const source = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')
  // `const sweep` below the disposer is a TDZ if the scope disposes
  // synchronously; the handle is declared up front and assigned at arm time.
  assert.match(source, /let sweep: ReturnType<typeof setInterval> \| undefined/)
  assert.match(source, /sweep = setInterval\(schedule, SWEEP_INTERVAL_MS\)/)
  assert.doesNotMatch(source, /const sweep = setInterval/)
  assert.match(source, /if \(sweep !== undefined\) clearInterval\(sweep\)/)
})

test('the settings write is bounded so the one-fill guard cannot stay set forever', () => {
  const source = readFileSync(join(ROOT, 'src/reasoning-effort.ts'), 'utf8')
  // `running` is only cleared in `.finally`: a write that never settles would
  // make every later pass return immediately (the 10s sweep included).
  assert.match(source, /withTimeout\(Promise\.resolve\(settings\.mutate\(LLM_PI_AI_ENTRY, plan\.ops, revision\)\), MUTATE_TIMEOUT_MS\)/)
  assert.match(source, /settings write did not answer within/)
})
