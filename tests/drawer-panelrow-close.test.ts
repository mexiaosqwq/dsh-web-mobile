import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TAP_CLOSE_NAV_SELECTOR } from '../src/client/effects/drawer-close.ts'

interface FakeNode {
  tag: string
  className: string
  attrs?: Record<string, string>
}

// ponytail: matcher implements only the two selector shapes the whitelist
// uses (tag[attr] presence and [class*="x"]); real CSS matching stays in the
// browser. Ceiling: a new selector shape in TAP_CLOSE_NAV_SELECTOR throws here
// instead of silently passing.
const partMatches = (node: FakeNode, part: string): boolean => {
  const classContains = part.match(/^\[class\*="([^"]+)"\]$/)
  if (classContains !== null) return node.className.includes(classContains[1])
  const tagged = part.match(/^([a-z]+)\[([^\]]+)\]$/)
  if (tagged !== null) {
    if (node.tag.toLowerCase() !== tagged[1]) return false
    return node.attrs !== undefined && node.attrs[tagged[2]] !== undefined
  }
  throw new Error(`unsupported selector part: ${part}`)
}

// Simulates Element.closest(): walk the chain from the tap target upward and
// report whether any node matches any whitelist part.
const closestNavTarget = (chain: FakeNode[]): boolean =>
  chain.some((node) =>
    TAP_CLOSE_NAV_SELECTOR.split(',')
      .map((part) => part.trim())
      .some((part) => partMatches(node, part)),
  )

test('tapping a sidebar panelRow inside the drawer is classified as a nav target (drawer closes)', () => {
  const panelButton: FakeNode = { tag: 'BUTTON', className: 'hHd-Xa_panelRow hHd-Xa_panelActive' }
  const panelList: FakeNode = { tag: 'NAV', className: 'hHd-Xa_panelList' }
  const drawerRoot: FakeNode = { tag: 'DIV', className: 'hHd-Xa_root hHd-Xa_quietBars' }
  assert.equal(closestNavTarget([panelButton, panelList, drawerRoot]), true)
})

test('pre-existing nav targets stay classified', () => {
  const drawerRoot: FakeNode = { tag: 'DIV', className: 'hHd-Xa_root hHd-Xa_quietBars' }
  const cases: FakeNode[] = [
    { tag: 'BUTTON', className: 'hHd-Xa_newSession' },
    { tag: 'DIV', className: 'hHd-Xa_sessionRow' },
    { tag: 'DIV', className: 'hHd-Xa_searchResultRow' },
    { tag: 'BUTTON', className: 'x_takeover', attrs: { 'data-dsh-taskboard-entry': '' } },
    { tag: 'BUTTON', className: 'x_takeover', attrs: { 'data-dsh-ssh-entry': '' } },
  ]
  for (const target of cases) {
    assert.equal(closestNavTarget([target, drawerRoot]), true, `missed: ${target.className}`)
  }
})

test('settings trigger (VOzbGW_trigger) is NOT classified as a nav target', () => {
  const trigger: FakeNode = { tag: 'BUTTON', className: 'VOzbGW_trigger' }
  const triggerLabel: FakeNode = { tag: 'SPAN', className: 'VOzbGW_triggerLabel' }
  const triggerRow: FakeNode = { tag: 'DIV', className: 'VOzbGW_triggerRow' }
  const settingsPanel: FakeNode = { tag: 'DIV', className: 'VOzbGW_panel' }
  assert.equal(closestNavTarget([triggerLabel, trigger, triggerRow, settingsPanel]), false)
})

test('plain taps inside the drawer (no nav target) stay unclassified', () => {
  const blank: FakeNode = { tag: 'DIV', className: 'hHd-Xa_panelList' }
  const drawerRoot: FakeNode = { tag: 'DIV', className: 'hHd-Xa_root hHd-Xa_quietBars' }
  assert.equal(closestNavTarget([blank, drawerRoot]), false)
})
