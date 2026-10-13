// Client-entry activation surface: NO `ctx.<service>` read may name a service
// that this plugin does not declare in `export const inject`.
//
// Why this is a gate and not a style rule (2026-10-07 hot-load incident): the
// client runtime's service proxy THROWS on an undeclared property read —
//
//   static handler = { get: (target, key, receiver) => {
//     if (Reflect.has(target, key)) return ...
//     const error = new Error(`cannot get property "${key}" without inject`)
//     ... // an accessor schema entry may still resolve it, otherwise this throws
//   }}
//   (dsh-web-frontend/dist/assets/index-*.js, ClientContext proxy)
//
// — and that read happens inside `apply()`. A single `ctx.remote` added to an
// effect therefore fails the WHOLE entry activation: the page shows
// 「Failed to load plugins / dsh-web-mobile: failed」 and the plugin is dead
// until the bundle is replaced. `ctx.get(name)` is the allowed escape hatch
// (it reads the registry without the inject requirement), which is how the
// settings remote is reached.
//
// The static gates in the hot-load checklist cannot see this class of bug:
// TS1xxx / TS2304 / bundle smoke all pass, because the access is well-typed and
// only the runtime proxy rejects it. Hence this scan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'src/client')

/** Context members that are API, not services, and need no `inject` entry. */
const CONTEXT_API = new Set([
  'effect', 'get', 'inject', 'on', 'off', 'logger', 'emit', 'parallel',
  'waterfall', 'bail', 'set', 'provide', 'isolate', 'scope', 'fiber', 'reflect', 'root',
])

/** Strip comments so prose about the failure mode is not scanned as code. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every `src/client/**` TypeScript source. */
function clientSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...clientSources(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

/** The plugin's declared fiber inject list, read from the client entry. */
function declaredInject(): string[] {
  const entry = readFileSync(join(CLIENT, 'index.tsx'), 'utf8')
  const match = entry.match(/export const inject = \[([^\]]*)\]/)
  assert.ok(match !== null, 'src/client/index.tsx must declare `export const inject = [...]`')
  return [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2])
}

/** Property reads on the plugin context, direct (`ctx.x`) and cast-wrapped
 *  (`(ctx as unknown as { x?: unknown }).x` — the shape the 2026-10-07 incident
 *  actually used). */
function ctxMemberReads(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/\bctx\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) found.push(match[1])
  for (const match of source.matchAll(/\(\s*ctx\s+as\s+[^()]*?\)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) found.push(match[1])
  for (const match of source.matchAll(/\(\s*ctx\s*\)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) found.push(match[1])
  return found
}

test('every ctx.<service> read in the client half is a declared inject', () => {
  const inject = declaredInject()
  assert.ok(inject.length >= 5, `inject list looks wrong: ${inject.join(', ')}`)
  const allowed = new Set([...inject, ...CONTEXT_API])
  const violations: string[] = []
  let seen = 0
  for (const file of clientSources(CLIENT)) {
    const source = withoutComments(readFileSync(file, 'utf8'))
    for (const member of ctxMemberReads(source)) {
      seen += 1
      if (allowed.has(member)) continue
      violations.push(`${file.slice(ROOT.length + 1)}: ctx.${member}`)
    }
  }
  // Non-vacuity: a broken walk or regex must not turn this gate into a no-op.
  assert.ok(seen >= 30, `expected to scan the client's ctx reads, saw only ${seen}`)
  assert.deepEqual(
    violations,
    [],
    'undeclared service read(s) throw `cannot get property "…" without inject` at apply() time '
      + 'and fail the whole client entry — use ctx.get(name) or add the service to `inject`',
  )
})

test('the inject list actually covers what the entry reaches for', () => {
  // The known-reachable services, pinned so a rename in index.tsx cannot make
  // the guard above silently permissive. `workspaces` is deliberately absent:
  // the entry never reads it, and `inject` is a hard dependency, so listing it
  // would only make hosts without that service fail to load the plugin.
  const inject = new Set(declaredInject())
  for (const service of ['slots', 'layout', 'locale', 'sessionLogDownload', 'sessions']) {
    assert.ok(inject.has(service), `inject must declare ${service}`)
  }
  assert.equal(inject.has('workspaces'), false, 'inject must not demand a service the entry never reads')
})

// 上游删依赖/改包名时，"值导入一个可为缺席的 peer" 会在 entry factory 执行期直接抛，
// 整个插件激活失败（0.2.1 预览通道删包导致同类事故的机制）。规则：**任何值导入的
// `@deepseek-ai/*` 包都必须是「必需 peer」**；声明成 optional 却值导入 = 自相矛盾。
const PEER_DEBT = new Map<string, string>([
  // 待决（见 续航计划 §5）：改成必需 peer，或把导入改为受守护的懒加载 / 去掉该依赖。
  ['@deepseek-ai/dsh-client-ui-primitives', 'optional 却值导入，2 处（core/icon-compat.ts、components/file-share-controls.tsx）'],
])

test('值导入的 @deepseek-ai/* 必须是必需 peer（optional peer 不得值导入）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }
  const peers = pkg.peerDependencies ?? {}
  const optional = pkg.peerDependenciesMeta ?? {}
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(join(ROOT, 'src/client'))
  const violations = new Set<string>()
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/^import\s/.test(line) || /^import\s+type\s/.test(line)) continue
      const match = line.match(/from '(@deepseek-ai\/[^']+)'/)
      if (match === null) continue
      const name = match[1]
      if (peers[name] === undefined) violations.add(`${name} 未在 peerDependencies 里声明（值导入）`)
      else if (optional[name]?.optional === true && !PEER_DEBT.has(name)) {
        violations.add(`${name} 是 optional peer 却被值导入 → 宿主缺它时整个 entry 抛错`)
      }
    }
  }
  assert.deepEqual([...violations], [])
})

test('peer 债务台账不得过期：已解决（不再值导入或已改必需）就必须删掉', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }
  const optional = pkg.peerDependenciesMeta ?? {}
  const stale = [...PEER_DEBT.keys()].filter((name) => optional[name]?.optional !== true)
  assert.deepEqual(stale, [], 'PEER_DEBT 里的包已不是 optional peer，请从台账删除')
})
