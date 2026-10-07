// Browser half of the reasoning-level fill: the twin of
// tests/reasoning-effort-fill.test.ts. The rules are the same, so the cases
// here only pin the shape that the HOST SETTINGS REMOTE hands over
// (`{ ok, value: { namespaces } }`), plus the wiring the mobile contract needs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_REASONING_EFFORTS, LLM_PI_AI_ENTRY, planReasoningEffortFill } from '../src/client/effects/reasoning-defaults.ts'

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
