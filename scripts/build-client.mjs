// Wrap the tsc-compiled CommonJS client program into the DSH browser loader
// shape: window.__ModuleLoader__.load({ id, factory: (require) => ... }).
// Relative modules are inlined with a tiny local require; platform modules
// (react, primitives, ...) stay as require() calls and are resolved by the
// host's browser module table.
//
// Guardrails (2026-10-07, issue #85): this script is the white-screen gate's
// upstream, so it must never silently emit a broken bundle. The dependency scan
// now
//   - accepts every quote style tsc can emit for a relative require,
//   - ignores requires that only appear inside comments (a commented example
//     used to fail the whole build),
//   - verifies, after assembly, that every inlined `require("./x")` target is
//     actually present in __modules, and
//   - parses the finished program with `vm.Script` before writing it, so a
//     leftover ESM `import`/`export` or any other syntax error fails the build
//     here instead of blanking the user's page.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const buildDir = join(root, '.client-build')
const outputPath = join(root, 'lib', 'client.js')

// Walk the emit dir recursively and key each module by its forward-slash
// relative path (e.g. "index.js", "styles/index.js"). Nested emit dirs now
// appear because the CSS lives in src/client/styles/.
async function collectSources(dir, { rel = '' } = {}) {
  const sources = new Map()
  for (const entry of (await readdir(dir, { withFileTypes: true }))) {
    const abs = join(dir, entry.name)
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      for (const [k, v] of await collectSources(abs, { rel: relPath })) {
        sources.set(k, v)
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      sources.set(
        relPath,
        (await readFile(abs, 'utf8')).replace(/\n?\/\/# sourceMappingURL=.*$/u, ''),
      )
    }
  }
  return sources
}

const sources = await collectSources(buildDir)

// Every relative require tsc can emit, whatever quote style it used. tsc
// writes double quotes today, but a hand-written or differently configured
// emit may use single quotes or a template literal — missing those used to
// inline nothing and fail at runtime instead of at build time.
const REQUIRE_RE = /require\(\s*(['"`])(\.\.?\/[^'"`]+\.js)\1\s*\)/g

/** Skip a quoted string starting at `start` (returns the index past the closing quote). */
function skipQuoted(code, start, quote) {
  let i = start + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i += 1
  }
  return code.length
}

/** Skip the `${...}` span of a template literal (nested braces/strings included). */
function skipInterpolation(code, start) {
  let i = start
  let depth = 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch)
      continue
    }
    if (ch === '`') {
      i = skipTemplate(code, i)
      continue
    }
    if (ch === '{') {
      depth += 1
      i += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      i += 1
      if (depth === 0) return i
      continue
    }
    i += 1
  }
  return code.length
}

/** Skip a template literal, including its `${...}` spans, from `start`. */
function skipTemplate(code, start) {
  let i = start + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`') return i + 1
    if (ch === '$' && code[i + 1] === '{') {
      i = skipInterpolation(code, i + 2)
      continue
    }
    i += 1
  }
  return code.length
}

/**
 * Comment ranges of one module, so a require that only appears in a comment is
 * not treated as a dependency. Strings and template literals are skipped, so
 * `//` inside a URL or a CSS string never opens a comment.
 */
function commentRanges(code) {
  const ranges = []
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '"' || ch === "'") {
      i = skipQuoted(code, i, ch)
      continue
    }
    if (ch === '`') {
      i = skipTemplate(code, i)
      continue
    }
    if (ch === '/' && code[i + 1] === '/') {
      const start = i
      const lineEnd = code.indexOf('\n', i)
      i = lineEnd === -1 ? code.length : lineEnd
      ranges.push([start, i])
      continue
    }
    if (ch === '/' && code[i + 1] === '*') {
      const start = i
      const end = code.indexOf('*/', i + 2)
      i = end === -1 ? code.length : end + 2
      ranges.push([start, i])
      continue
    }
    i += 1
  }
  return ranges
}

const comments = new Map()
for (const [file, source] of sources) {
  comments.set(file, commentRanges(source))
}

const inComment = (file, index) => comments.get(file).some(([start, end]) => index >= start && index < end)

// Resolve a `./x.js` child relative to its parent module to the canonical
// forward-slash key used in __modules (e.g. styles/index.js requires
// "./base.css.js" -> "styles/base.css.js").
const resolveChild = (parent, rel) => {
  const joined = posix.join(posix.dirname(parent), rel)
  const normalized = posix.normalize(joined)
  return normalized === '.' ? '' : normalized
}

// Dependency-first topological order from the entry.
const visited = new Set()
const order = []
const visit = (file) => {
  if (visited.has(file)) return
  visited.add(file)
  const src = sources.get(file)
  if (!src) throw new Error(`client module not found for require: ${file}`)
  for (const match of src.matchAll(REQUIRE_RE)) {
    // A require inside a comment is documentation, not a dependency.
    if (inComment(file, match.index)) continue
    visit(resolveChild(file, match[2]))
  }
  order.push(file)
}
visit('index.js')

/**
 * Rewrite the real (non-comment) relative requires of one module to their
 * canonical key, and report the keys it rewrote. Requires that only appear
 * inside a comment are left exactly as written — they are documentation and
 * must not be inlined, rewritten or validated.
 */
function rewriteRequires(file, src) {
  let out = ''
  let last = 0
  const deps = []
  for (const match of src.matchAll(REQUIRE_RE)) {
    if (inComment(file, match.index)) continue
    const target = resolveChild(file, match[2])
    deps.push(target)
    out += src.slice(last, match.index) + `require("./${target}")`
    last = match.index + match[0].length
  }
  return { src: out + src.slice(last), deps }
}

// Post-assembly validation: every rewritten require must have its module in
// __modules. rewriteRequires() and visit() share one predicate, so this can
// only fire if a future change lets them diverge — fail loudly here instead of
// shipping a bundle that throws on first use.
const emitted = new Set(order)
const modules = order
  .map((file) => {
    // Rewrite each relative require to its canonical path so the runtime
    // __localRequire (id.slice(2), entry-relative) resolves nested modules.
    const { src, deps } = rewriteRequires(file, sources.get(file))
    for (const dep of deps) {
      if (!emitted.has(dep)) {
        throw new Error(`client bundle would require a module that is not inlined: ${dep}`)
      }
    }
    return `__modules[${JSON.stringify(file)}] = function (require, module, exports) {\n${src}\n};`
  })
  .join('\n')

const wrapped = [
  'window.__ModuleLoader__.load({ id: "dsh-web-mobile", factory: (require) => {',
  'var __modules = {};',
  modules,
  'var __cache = {};',
  'function __localRequire(id) {',
  '  if (id.charCodeAt(0) !== 46) return require(id);',
  '  id = id.slice(2);',
  '  var cached = __cache[id];',
  '  if (cached) return cached.exports;',
  '  var module = { exports: {} };',
  '  __cache[id] = module;',
  '  __modules[id](__localRequire, module, module.exports);',
  '  return module.exports;',
  '}',
  'var module = { exports: {} };',
  '__modules["index.js"](__localRequire, module, module.exports);',
  'return module.exports; } });',
  '',
].join('\n')

// Parse-only self check: compiles the program without running it. A leftover
// ESM `import`/`export` statement is a syntax error in script context, so this
// is also the "the bundle contains no ESM syntax" gate.
try {
  new vm.Script(wrapped, { filename: 'lib/client.js' })
} catch (error) {
  throw new Error(`client bundle failed its syntax self-check: ${error instanceof Error ? error.message : String(error)}`)
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, wrapped)
await rm(join(root, 'lib', 'client.js.map'), { force: true })
await rm(buildDir, { recursive: true, force: true })
console.log(`client bundle written: ${outputPath} (${order.length} modules inlined)`)
