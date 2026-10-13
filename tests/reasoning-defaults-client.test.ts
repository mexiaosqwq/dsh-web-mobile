// Browser half of the reasoning-level fill: the twin of
// tests/reasoning-effort-fill.test.ts. The rules are the same, so the cases
// here only pin the shape that the HOST SETTINGS REMOTE hands over
// (`{ ok, value: { namespaces } }`), plus the wiring the mobile contract needs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_REASONING_EFFORTS, LLM_PI_AI_ENTRY, installReasoningDefaults, planReasoningEffortFill } from '../src/client/effects/reasoning-defaults.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const profile = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  api: 'openai-completions',
  baseURL: 'https://gateway.example/v1',
  ...extra,
})

test('the browser twin fills a hand-declared model and leaves declared levels alone', () => {
  const user = {
    providers: {
      o: profile({
        models: [
          { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
          { id: 'gpt-5.5', name: 'GPT-5.5', reasoningEfforts: { off: null, high: 'ultra' } },
        ],
      }),
    },
  }
  const plan = planReasoningEffortFill(user, user)
  assert.equal(plan.filled, 1)
  assert.deepEqual(plan.ops, [
    {
      op: 'set',
      path: ['providers', 'o', 'models'],
      value: [
        { id: 'gpt-6-astra', name: 'GPT-6 Astra', reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } },
        { id: 'gpt-5.5', name: 'GPT-5.5', reasoningEfforts: { off: null, high: 'ultra' } },
      ],
    },
  ])
})

test('the browser twin skips models whose levels come from a lower layer', () => {
  const user = { providers: { o: profile({ models: [{ id: 'm' }] }) } }
  const resolved = { providers: { o: profile({ models: [{ id: 'm', reasoningEfforts: { high: 'high' } }] }) } }
  assert.deepEqual(planReasoningEffortFill(resolved, user).ops, [])
})

test('the browser twin leaves a model that refuses custom levels at its own default (auto 档)', () => {
  // 用户反馈的关键场景，走浏览器半区：夹具里这个手写模型与可补齐的模型形状完全
  // 相同，只是模型级 compat 声明了它不吃 reasoning effort。补齐后它不得带
  // reasoningEfforts —— 宿主没有 `auto` 档位值可写（`THINKING_LEVELS` 闭枚举），
  // 正确做法就是**不写**，宿主 UI 于是给它显示 provider 默认项。
  const user = {
    providers: {
      o: profile({
        models: [
          { id: 'fixture-refuses-effort', name: 'Fixture Refuses Effort', compat: { supportsReasoningEffort: false } },
          { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
        ],
      }),
    },
  }
  const plan = planReasoningEffortFill(user, user)
  assert.equal(plan.filled, 1)
  assert.equal(plan.auto, 1)
  const models = (plan.ops[0]?.value ?? []) as Record<string, unknown>[]
  assert.equal(models.length, 2)
  assert.equal('reasoningEfforts' in models[0]!, false, '不接受自定义档位的模型不得被写入具体档位')
  assert.deepEqual(models[1]?.reasoningEfforts, { ...DEFAULT_REASONING_EFFORTS })
})

test('the namespace constant matches the host entry id', () => {
  assert.equal(LLM_PI_AI_ENTRY, 'llm-pi-ai')
})

test('the browser half is mobile-gated and reads the remote lazily', () => {
  const source = readFileSync(join(ROOT, 'src/client/effects/reasoning-defaults.ts'), 'utf8')
  // Desktop stays a complete no-op (desktop installs are covered by the host half).
  assert.match(source, /installMobileEffect\(ctx, 'dsh-web-mobile: reasoning level defaults'/)
  // `remote.settings` must NOT become a required fiber dependency: a host
  // generation without it would otherwise keep the whole plugin dormant.
  assert.match(source, /ctx\.get\?\.\('remote\.settings'\)/)
  assert.match(source, /'remote\.settings'/)
  assert.doesNotMatch(source, /export const inject/)
  // The event and the sweep both re-run the fill.
  assert.match(source, /'settings\/document-updated'/)
  assert.match(source, /setInterval\(fill, 10_000\)/)
})

test('the client entry installs the effect', () => {
  const source = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8')
  assert.match(source, /import \{ installReasoningDefaults \} from '\.\/effects\/reasoning-defaults\.ts'/)
  assert.match(source, /installReasoningDefaults\(ctx\)/)
})

test('the document event is subscribed through the host-event gateway, not the client bus (2026-10-07)', () => {
  const source = readFileSync(join(ROOT, 'src/client/effects/reasoning-defaults.ts'), 'utf8')
  // Host → browser events are dispatched by the api-gateway (`ctx.remote.$on`,
  // the form every official client plugin uses); `ctx.on` is the page's own
  // bus and never carries this event, so subscribing there silently made the
  // immediate pass dead code — only the 10s sweep ran.
  assert.match(source, /remoteEventsOf\(context\)\?\.\$on\?\.\('settings\/document-updated'/)
  assert.match(source, /function remoteEventsOf\(ctx: ReasoningDefaultsContext\): RemoteEventFace \| undefined/)
  assert.match(source, /ctx\.get\?\.\('remote'\)/)
  // The gateway is reached through `ctx.get` ONLY. A property read on a service
  // outside `inject` throws `cannot get property "…" without inject` from the
  // client runtime's proxy, and because that read runs inside apply() it fails
  // the whole entry activation (2026-10-07 hot-load incident). The wiring is
  // additionally best-effort: a subscription failure must not take the entry
  // down either.
  assert.match(source, /candidate = ctx\.get\?\.\('remote'\)/)
  assert.doesNotMatch(source, /as unknown as \{ remote\?: unknown \}\)\.remote/)
  assert.match(source, /reasoning-level document event unavailable/)
  assert.doesNotMatch(source, /\.on\?\.\(\s*'settings\/document-updated'/, '不许再用客户端本地总线订阅宿主事件')
  // The namespace filter stays, but a payload-less emit must still re-arm.
  assert.match(source, /args\.length === 0 \|\| args\[0\] === LLM_PI_AI_ENTRY/)
})

test('remote settings calls are bounded so one silent carrier cannot wedge the fill', () => {
  const source = readFileSync(join(ROOT, 'src/client/effects/reasoning-defaults.ts'), 'utf8')
  // `running` is only cleared in `finally`: an unsettled promise would disable
  // every later pass, the sweep included.
  assert.match(source, /withTimeout\(remote\.describe\(\), REMOTE_TIMEOUT_MS\)/)
  assert.match(source, /withTimeout\(remote\.mutate\(LLM_PI_AI_ENTRY, plan\.ops, revision\), REMOTE_TIMEOUT_MS\)/)
  assert.match(source, /reject\(new Error\(`settings remote did not answer within \$\{ms\}ms`\)\)/)
})

// ---------------------------------------------------------------------------
// Behavior: the fill is asynchronous (`describe` -> plan -> `mutate`), so its
// disposer can run BETWEEN the two calls — plugin unload, or the mobile
// breakpoint dropping back to desktop. Every audit above is a string/data
// check and cannot see that window, so the guard is executed here against a
// describe that is deliberately still in flight when the disposer fires.
// ---------------------------------------------------------------------------

/** The installer, widened so the minimal fake context can be passed in. */
const install = installReasoningDefaults as unknown as (ctx: unknown) => void

/** Fake `remote.settings` whose `mutate` records every call it receives. */
function settingsFixture(describe: () => Promise<unknown>): { settings: Record<string, unknown>; mutateCalls: unknown[][] } {
  const mutateCalls: unknown[][] = []
  const settings = {
    describe,
    mutate: (...args: unknown[]) => {
      mutateCalls.push(args)
      return Promise.resolve({ ok: true, value: { revision: 8 } })
    },
  }
  return { settings, mutateCalls }
}

/**
 * Minimal client context: `effect` arms the installer on the spot (exactly what
 * the real `installMobileEffect` does on a narrow viewport) and keeps the
 * disposer it returns; `get` answers the effect's two lazy service lookups.
 */
function armedEffect(settings: Record<string, unknown>): { ctx: unknown; dispose: () => void } {
  let disposer: (() => void) | undefined
  const ctx = {
    effect: (installEffect: () => (() => void) | undefined) => { disposer = installEffect() },
    get: (service: string) => (service === 'remote.settings' ? settings : undefined),
    logger: { warn: () => {} },
  }
  return { ctx, dispose: () => disposer?.() }
}

/** Let every already-queued microtask/timer callback of the fill run. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('a dispose while describe is in flight makes the fill zero-write (2026-10-11)', async () => {
  const previousWindow = (globalThis as { window?: unknown }).window
  // `installMobileEffect` arms through `window.matchMedia`; one narrow viewport
  // is all this case needs.
  ;(globalThis as { window?: unknown }).window = {
    matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  }
  // A payload that HAS something to fill, so a mutating implementation really
  // reaches `mutate` (an empty plan would pass this test vacuously).
  const payload = {
    ok: true,
    value: {
      namespaces: [
        {
          ns: LLM_PI_AI_ENTRY,
          revision: 7,
          value: { providers: { o: profile({ models: [{ id: 'm' }] }) } },
          user: { providers: { o: profile({ models: [{ id: 'm' }] }) } },
        },
      ],
    },
  }
  try {
    // Control: the same fixture DOES mutate when nothing disposes it, so the
    // zero-call assertion below cannot pass by accident.
    const control = settingsFixture(() => Promise.resolve(payload))
    const controlEffect = armedEffect(control.settings)
    install(controlEffect.ctx)
    await settle()
    assert.equal(control.mutateCalls.length, 1, 'control: an undisposed fill writes once')
    controlEffect.dispose()

    // The defect: the disposer fires while `describe` is still unanswered; the
    // await resumes afterwards and must NOT send its mutate.
    let releaseDescribe: (value: unknown) => void = () => {}
    let describeCalls = 0
    const inFlight = new Promise((resolve) => { releaseDescribe = resolve })
    const disposedCase = settingsFixture(() => { describeCalls += 1; return inFlight })
    const disposedEffect = armedEffect(disposedCase.settings)
    install(disposedEffect.ctx)
    await settle()
    assert.equal(describeCalls, 1, 'the fill must be parked on the in-flight describe')
    disposedEffect.dispose()
    releaseDescribe(payload)
    await settle()
    assert.deepEqual(disposedCase.mutateCalls, [], 'dispose 后 describe resolve 不得再写宿主设置（零 mutate）')
  } finally {
    ;(globalThis as { window?: unknown }).window = previousWindow
  }
})
