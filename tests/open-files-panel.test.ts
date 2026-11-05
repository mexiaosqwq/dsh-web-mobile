// The Files control must act on the surface the user actually has: the host's
// right sidebar when present (0.1.5 ships the workspace tree there), and only
// otherwise the third-party explorer marker. Regression this guards: the
// control toggled the explorer marker unconditionally, so on a host without
// dsh-web-ui-all it painted an icon that did nothing at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openFilesPanel, HOST_FILES_CLOSER, HOST_FILES_OPENER } from '../src/client/components/open-files-panel.ts'

const openerDoc = (found: unknown) => ({ querySelector: (selector: string) => (selector === HOST_FILES_OPENER ? found : null) })
const bothDoc = (opener: unknown, closer: unknown) => ({ querySelector: (selector: string) => (selector === HOST_FILES_OPENER ? opener : selector === HOST_FILES_CLOSER ? closer : null) })

test('openFilesPanel: clicks the host right-sidebar opener when it exists', () => {
  let clicks = 0
  const frame = { removeAttribute: () => assert.fail('explorer fallback must not run'), setAttribute: () => assert.fail('explorer fallback must not run') }
  const opened = openFilesPanel(openerDoc({ click: () => { clicks += 1 } }), frame)
  assert.equal(opened, true)
  assert.equal(clicks, 1)
})

test('openFilesPanel: falls back to the explorer marker on hosts without it', () => {
  const calls: string[] = []
  const frame = {
    removeAttribute: (name: string) => calls.push('remove:' + name),
    setAttribute: (name: string) => calls.push('set:' + name),
  }
  const opened = openFilesPanel(openerDoc(null), frame)
  assert.equal(opened, false)
  assert.deepEqual(calls, ['remove:data-aionui-preview-open', 'set:data-aionui-explorer-open'])
})

test('openFilesPanel: no frame and no host opener is a no-op', () => {
  assert.equal(openFilesPanel(openerDoc(null), null), false)
})

test('openFilesPanel: a non-clickable match still falls back instead of throwing', () => {
  const calls: string[] = []
  const frame = { removeAttribute: () => calls.push('remove'), setAttribute: () => calls.push('set') }
  // Plain object (not an HTMLElement): no click() to call, so the fallback runs.
  assert.equal(openFilesPanel(openerDoc({}), frame), false)
  assert.deepEqual(calls, ['remove', 'set'])
})

// The host unmounts the opener while the panel is open, so a control keyed on
// the opener alone went dead exactly when the user had the panel already up.
test('openFilesPanel: uses the collapse control when the panel is already open', () => {
  let collapses = 0
  let opens = 0
  const frame = { removeAttribute: () => assert.fail('explorer fallback must not run'), setAttribute: () => assert.fail('explorer fallback must not run') }
  const opened = openFilesPanel(bothDoc(null, { click: () => { collapses += 1 } }), frame)
  assert.equal(opened, true)
  assert.equal(collapses, 1)
  assert.equal(opens, 0)
})

test('openFilesPanel: prefers the opener when both controls are present', () => {
  let collapses = 0
  let opens = 0
  const frame = { removeAttribute: () => assert.fail('explorer fallback must not run'), setAttribute: () => assert.fail('explorer fallback must not run') }
  const opened = openFilesPanel(bothDoc({ click: () => { opens += 1 } }, { click: () => { collapses += 1 } }), frame)
  assert.equal(opened, true)
  assert.equal(opens, 1)
  assert.equal(collapses, 0)
})

// 0.2.2 keeps the opener mounted while the panel is open and marks it `disabled`
// (dsh-client-ui-sidebar-right ExpandButton: only desktop unmounts it). Clicking
// a disabled button is a no-op, so the header control went dead with the panel
// up (real device 2026-11-05). A disabled opener must count as absent.
test('openFilesPanel: an opener that stays mounted but disabled yields to the collapse control', () => {
  let collapses = 0
  let opens = 0
  const frame = { removeAttribute: () => assert.fail('explorer fallback must not run'), setAttribute: () => assert.fail('explorer fallback must not run') }
  const opened = openFilesPanel(bothDoc({ click: () => { opens += 1 }, disabled: true }, { click: () => { collapses += 1 } }), frame)
  assert.equal(opened, true)
  assert.equal(opens, 0)
  assert.equal(collapses, 1)
})

test('openFilesPanel: a disabled opener with no collapse control is not a host hit', () => {
  let opens = 0
  let marks = 0
  const frame = { removeAttribute: () => { marks += 1 }, setAttribute: () => { marks += 1 } }
  const opened = openFilesPanel(openerDoc({ click: () => { opens += 1 }, disabled: true }), frame)
  // No usable control at all: fall through to the explorer marker instead of
  // pretending the dead expand button did something.
  assert.equal(opened, false)
  assert.equal(opens, 0)
  assert.equal(marks, 2)
})
