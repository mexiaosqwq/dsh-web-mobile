// Locale namespace ownership (issue #165).
//
// The host's `locale.register` THROWS on a duplicate namespace — no merge, no
// override — and that throw fails the whole plugin fiber, so a collision does
// not degrade this plugin, it kills the entire web boot on narrow screens.
// Downstream copies of this plugin keep whatever namespace we ship: dsh-pocket
// embeds a copy of the mobile adaptation and still registers `mobileNav`
// (maintainer-verified in its published 2.10.6 tarball), which is exactly how
// #165 bricked the boot. Hence two invariants, and both are easy to break by
// hand-editing one of the four places a namespace id can appear:
//
//   1. the three namespaces stay package-prefixed and mutually distinct, and
//   2. no source file may reintroduce a bare `mobileNav`/`mobileNav.*` locale id.
//
// The DOM vocabulary (`data-mobile-nav="…"`, `dataset.mobileNav`, the
// `dsh-mobile-nav:` effect labels) is a marker/property name, not a locale
// namespace, and is deliberately NOT in scope here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NS } from '../src/client/i18n/locales.ts'
import { FILE_SHARE_NS } from '../src/client/components/file-share-locale.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The historical namespace dsh-pocket's copy occupies (issue #165). */
const TAKEN = /^mobileNav(\.|$)/

/** Strip comments so prose about the failure mode is not scanned as code. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every `.ts`/`.tsx` under src/client, as [relative path, source] pairs. */
function clientSources(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (/\.tsx?$/.test(entry.name)) out.push([rel, readFileSync(join(ROOT, rel), 'utf8')])
    }
  }
  walk('src/client')
  return out
}

const SOURCES = clientSources()

test('the three locale namespaces are package-prefixed, distinct, and not the taken one', () => {
  const attachment = SOURCES.find(([rel]) => rel.endsWith('effects/attachment-mention.ts'))
  assert.ok(attachment, 'effects/attachment-mention.ts disappeared from src/client')
  const declared = withoutComments(attachment[1]).match(/export const ATTACHMENT_NS = '([^']+)'/)
  assert.ok(declared, 'ATTACHMENT_NS declaration not found')
  const attachmentNs = declared[1]

  const namespaces = [NS, FILE_SHARE_NS, attachmentNs]
  for (const ns of namespaces) {
    assert.ok(ns.startsWith(NS), `${ns} lost the package prefix`)
    assert.doesNotMatch(ns, TAKEN, `${ns} reintroduces the namespace dsh-pocket already owns (#165)`)
  }
  assert.equal(new Set(namespaces).size, namespaces.length, 'two features share one namespace')
  // The sub-namespaces hang off the root one, the way `mobileNav.attachments` did.
  assert.equal(attachmentNs, `${NS}.attachments`)
  assert.equal(FILE_SHARE_NS, `${NS}FileShare`)
})

test('no source file reintroduces a bare mobileNav locale id', () => {
  const offenders = SOURCES.filter(([, source]) =>
    // A *quoted* bare namespace: `'mobileNav'` or `'mobileNav.attachments'`.
    // The DOM spellings carry a dash (`data-mobile-nav`) or no quotes
    // (`dataset.mobileNav`), so neither can match.
    /['"]mobileNav(\.|['"])/.test(withoutComments(source)),
  ).map(([rel]) => rel)
  assert.deepEqual(offenders, [], 'these files use the taken namespace as a locale id: ' + offenders.join(' | '))
})

test('every locale namespace is registered and bound through a constant', () => {
  const offenders = SOURCES.filter(([, source]) =>
    // `locale.register('x'` / `locale.bind("x"` — a literal here drifts from the
    // augmentation and from the registration in silence.
    /locale\.(?:register|bind)\(\s*['"]/.test(withoutComments(source)),
  ).map(([rel]) => rel)
  assert.deepEqual(offenders, [], 'literal namespace at a register/bind site: ' + offenders.join(' | '))

  // …and the three registered ids are exactly the three declared constants: the
  // `LocaleNamespaceMap` augmentations are what the typed `PropsLocale` /
  // `TranslateNS` consumers resolve against, so a stale key there breaks the
  // contract even while the runtime registration is correct.
  const keys = SOURCES.flatMap(([, source]) =>
    (withoutComments(source).match(/interface LocaleNamespaceMap \{[\s\S]*?\n {2}\}/g) ?? [])
      .flatMap((block) => block.match(/^\s*'([^']+)':/gm) ?? [])
      .map((line) => line.trim().slice(1, -2)),
  ).sort()
  assert.deepEqual(keys, [`${NS}.attachments`, FILE_SHARE_NS, NS].sort())
})
