// Wrap the tsc-compiled CommonJS client program into the DSH browser loader
// shape: window.__ModuleLoader__.load({ id, factory: (require) => ... }).
// Relative modules are inlined with a tiny local require; platform modules
// (react, primitives, ...) stay as require() calls and are resolved by the
// host's browser module table.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const REQUIRE_RE = /require\("(\.[^"]+\.js)"\)/g
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
    visit(resolveChild(file, match[1]))
  }
  order.push(file)
}
visit('index.js')

const modules = order
  .map((file) => {
    // Rewrite each relative require to its canonical path so the runtime
    // __localRequire (id.slice(2), entry-relative) resolves nested modules.
    const src = sources.get(file).replace(REQUIRE_RE, (m, rel) => `require("./${resolveChild(file, rel)}")`)
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

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, wrapped)
await rm(join(root, 'lib', 'client.js.map'), { force: true })
await rm(buildDir, { recursive: true, force: true })
console.log(`client bundle written: ${outputPath} (${order.length} modules inlined)`)
